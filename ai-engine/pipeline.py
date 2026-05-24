"""
Orchestrate the full pronostic pipeline:

  1. Idempotence check  — if a Race already exists for today's date, return it.
  2. Fetch the LONAB PMUB PDF for today.
  3. Parse the PDF (pdf_parser).
  4. Persist Race + Horse rows in DB.
  5. Enrich each horse with external sources (external_scraper).
  6. Synthesize 4 strategies via the LLM (ai_engine.synthesize_proposals).
  7. Persist Pronostic row (linked to Race).

Job state is held in memory (a single dict guarded by an asyncio Lock). Sufficient
for one daily pipeline run; if scaled, swap for Redis or similar.
"""
from __future__ import annotations

import asyncio
import secrets
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional

from loguru import logger
from sqlalchemy import select

from database import AsyncSessionLocal, Race, Horse, Pronostic, RaceType, Discipline
from lonab import fetch_today_pmub_pdf
from pdf_parser import parse_pdf, to_dict
from external_scraper import enrich_race
from ai_engine import synthesize_proposals


# ---------------------------------------------------------------------------
# Job state registry
# ---------------------------------------------------------------------------

JOBS: dict[str, dict] = {}
_JOBS_LOCK = asyncio.Lock()


async def _set(job_id: str, **fields):
    async with _JOBS_LOCK:
        if job_id not in JOBS:
            return
        JOBS[job_id].update(fields)


async def _make_job() -> str:
    job_id = secrets.token_urlsafe(8)
    async with _JOBS_LOCK:
        JOBS[job_id] = {
            "id": job_id,
            "status": "pending",          # pending | running | done | error | cached
            "step": "queued",
            "progress": 0.0,
            "message": "En file d'attente…",
            "startedAt": datetime.utcnow().isoformat(),
            "finishedAt": None,
            "result": None,                # {"raceId":..., "pronosticId":...}
            "error": None,
        }
    return job_id


def get_job(job_id: str) -> Optional[dict]:
    return JOBS.get(job_id)


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

async def _existing_race_for(today: date) -> Optional[Race]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Race).where(Race.date == today))
        return result.scalar_one_or_none()


async def _persist_race(parsed: dict, pdf_path: str, pdf_url: str) -> int:
    """Insert Race + Horse rows, return Race.id. Race.date is the unique key
    so this is safe to call after the idempotence check."""
    race_meta = parsed.get("race", {})
    horses = parsed.get("horses", [])
    async with AsyncSessionLocal() as db:
        race_type_str = race_meta.get("raceType") or "AUTRE"
        discipline_str = race_meta.get("discipline") or "AUTRE"
        try:
            race_type_enum = RaceType[race_type_str]
        except KeyError:
            race_type_enum = RaceType.AUTRE
        try:
            discipline_enum = Discipline[discipline_str]
        except KeyError:
            discipline_enum = Discipline.AUTRE

        # Combine the race date with start_time for the DateTime column.
        start_dt = None
        if race_meta.get("startTime") and race_meta.get("date"):
            try:
                start_dt = datetime.fromisoformat(
                    f"{race_meta['date']}T{race_meta['startTime']}:00"
                )
            except ValueError:
                start_dt = None

        race = Race(
            date=date.fromisoformat(race_meta["date"]) if race_meta.get("date") else date.today(),
            race_type=race_type_enum,
            discipline=discipline_enum,
            race_name=race_meta.get("raceName") or "Course du jour",
            hippodrome=race_meta.get("hippodrome") or "Inconnu",
            country="FR",
            distance=race_meta.get("distance") or 0,
            num_horses=race_meta.get("numHorses") or len(horses),
            start_time=start_dt,
            allocation_xof=race_meta.get("allocationXof"),
            pdf_url=pdf_url,
            pdf_fetched_at=datetime.utcnow(),
            raw_pdf_text=(parsed.get("rawText") or "")[:65000],
        )
        db.add(race)
        await db.flush()  # populate race.id

        for h in horses:
            db.add(Horse(
                race_id=race.id,
                number=h.get("number") or 0,
                name=h.get("name") or "",
                driver=h.get("driver"),
                trainer=h.get("trainer"),
                owner=h.get("owner"),
                sex=h.get("sex"),
                age=h.get("age"),
                distance=h.get("distance"),
                chrono=h.get("chrono"),
                recent_perf=h.get("recentPerf"),
                gains_xof=h.get("gainsXof"),
                odds_paris_turf=h.get("oddsParisTurf"),
                odds_tierce_mag=h.get("oddsTierceMag"),
            ))
        await db.commit()
        await db.refresh(race)
        return race.id


async def _persist_pronostic(race_id: int, parsed: dict, proposals: dict, external: dict) -> int:
    """Persist a Pronostic row from the LLM output. The legacy fields
    (baseHorse/tierce/quarte/quinte/outsider) are populated from the
    RECOMMANDE strategy for back-compat with existing routes."""
    recommande = next((p for p in proposals.get("proposals", []) if p.get("strategy") == "RECOMMANDE"), None)
    if not recommande:
        recommande = (proposals.get("proposals") or [{}])[0]

    horses = {h["number"]: h["name"] for h in parsed.get("horses", [])}

    def label(num: int) -> str:
        name = horses.get(num, "")
        return f"N°{num} - {name}".strip(" -")

    selections = recommande.get("selections") or []
    base_num = recommande.get("base") or (selections[0] if selections else None)
    outsider_num = recommande.get("outsider")

    async with AsyncSessionLocal() as db:
        p = Pronostic(
            date=datetime.utcnow(),
            base_horse=label(base_num) if base_num else None,
            tierce=[label(n) for n in selections[:3]] if selections else None,
            quarte=[label(n) for n in selections[:4]] if selections else None,
            quinte=[label(n) for n in selections[:5]] if selections else None,
            outsider=label(outsider_num) if outsider_num else None,
            confidence_score=int(proposals.get("globalConfidence") or recommande.get("confidence") or 0),
            commentary=proposals.get("globalCommentary"),
            raw_data={"parsed": parsed, "external": external},
            is_sent=False,
            modified_by_admin=False,
            race_id=race_id,
            proposals=proposals.get("proposals"),
            sources_pdf=parsed.get("sources"),
        )
        db.add(p)
        await db.commit()
        await db.refresh(p)
        return p.id


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

async def _run_pipeline(job_id: str) -> None:
    """The actual orchestration. Updates job state at each step."""
    try:
        await _set(job_id, status="running", step="check", progress=0.02,
                   message="Vérification d'un pronostic existant…")
        today = datetime.utcnow().date()
        existing = await _existing_race_for(today)
        if existing:
            # Find the linked pronostic (1-1 via Pronostic.raceId).
            async with AsyncSessionLocal() as db:
                p_res = await db.execute(select(Pronostic).where(Pronostic.race_id == existing.id))
                p = p_res.scalar_one_or_none()
            await _set(
                job_id, status="cached", step="cached", progress=1.0,
                message="Un pronostic existe déjà pour aujourd'hui.",
                finishedAt=datetime.utcnow().isoformat(),
                result={"raceId": existing.id, "pronosticId": p.id if p else None, "cached": True},
            )
            return

        await _set(job_id, step="fetch", progress=0.10,
                   message="Téléchargement du programme officiel LONAB…")
        pdf_info = await fetch_today_pmub_pdf(target=today, cache_dir=Path("./_lonab_cache"))

        await _set(job_id, step="parse", progress=0.25,
                   message="Lecture du PDF — identification des partants…")
        parsed = to_dict(parse_pdf(pdf_info["path"]))

        await _set(job_id, step="persist_race", progress=0.35,
                   message="Enregistrement de la course en base…")
        race_id = await _persist_race(parsed, str(pdf_info["path"]), pdf_info["url"])

        await _set(job_id, step="enrich", progress=0.45,
                   message="Recherche d'informations complémentaires sur les chevaux…")
        horse_names = {h["number"]: h["name"] for h in parsed.get("horses", []) if h.get("number") and h.get("name")}

        async def progress_cb(msg: str, ratio: float):
            # Map enrichment internal 0-1 ratio to job-global 0.45-0.75 range.
            await _set(job_id, message=msg, progress=0.45 + ratio * 0.30)
        # external_scraper.enrich_race uses sync callback signature; wrap to dispatch coroutines
        loop = asyncio.get_running_loop()
        def sync_progress(msg, ratio):
            loop.create_task(progress_cb(msg, ratio))
        external = await enrich_race(horse_names, on_progress=sync_progress)

        await _set(job_id, step="synthesize", progress=0.78,
                   message="Synthèse par l'IA — génération des 4 stratégies…")
        proposals = await synthesize_proposals(parsed, external)

        await _set(job_id, step="persist_pronostic", progress=0.92,
                   message="Enregistrement du pronostic…")
        pronostic_id = await _persist_pronostic(race_id, parsed, proposals, external)

        await _set(
            job_id, status="done", step="done", progress=1.0,
            message="Pronostic prêt.",
            finishedAt=datetime.utcnow().isoformat(),
            result={"raceId": race_id, "pronosticId": pronostic_id, "cached": False},
        )
    except Exception as e:
        logger.exception(f"pipeline error for job {job_id}")
        await _set(
            job_id, status="error", step="error", progress=1.0,
            message="Erreur durant le pipeline.",
            error=str(e), finishedAt=datetime.utcnow().isoformat(),
        )


async def start_pipeline() -> str:
    """Public entry. Creates a job, schedules the pipeline coroutine, returns the job ID."""
    job_id = await _make_job()
    asyncio.create_task(_run_pipeline(job_id))
    return job_id
