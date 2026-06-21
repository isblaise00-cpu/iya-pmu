"""
Sports pipeline : source → model → analyzer → persist
Calqué sur pipeline.py (hippique) ; paramétré par sport.

Étapes :
  1. fetch   — récupère les matchs du jour via SportSource.list_events()
  2. model   — enrichit chaque match (form, H2H, standings, odds) et calcule
               les probabilités + value bets via SportModel
  3. analyze — analyse qualitative via le LLM (sports/analyzer.py)
  4. persist — sauvegarde SportEvent + SportPronostic

Idempotence : si des pronostics existent déjà pour (sport, date), on saute.
force=True efface et régénère.

JOBS et _SPORT_LOCKS sont distincts du pipeline hippique.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import date

from loguru import logger
from sqlalchemy import select, func

from database import AsyncSessionLocal, SportEvent, SportPronostic, SportResult, get_setting
from sports.registry import get_source, get_model
from sports.analyzer import analyze_event

# ── Job tracking ─────────────────────────────────────────────────────────────

JOBS: dict[str, dict] = {}

# Un verrou par sport → FOOTBALL et BASKETBALL tournent en parallèle si besoin
_SPORT_LOCKS: dict[str, asyncio.Lock] = {
    "FOOTBALL":   asyncio.Lock(),
    "BASKETBALL": asyncio.Lock(),
}

# ── Settings defaults ─────────────────────────────────────────────────────────

_LEAGUE_SETTINGS = {
    "FOOTBALL":   ("football_leagues",   "39,140,135,78,61,2"),
    "BASKETBALL": ("basketball_leagues", "12"),
}


# ── Public API ────────────────────────────────────────────────────────────────

def get_job(job_id: str) -> dict | None:
    return JOBS.get(job_id)


async def start_pipeline(sport: str, force: bool = False) -> str:
    """Lance le pipeline asynchrone pour un sport et retourne le job_id."""
    job_id = str(uuid.uuid4())
    JOBS[job_id] = _new_job()
    asyncio.create_task(_run(job_id, sport.upper(), force))
    return job_id


# ── Internal helpers ──────────────────────────────────────────────────────────

def _new_job() -> dict:
    return {
        "status": "pending", "step": None, "progress": 0,
        "message": "", "result": None, "error": None,
    }


def _upd(job_id: str, **kw) -> None:
    JOBS[job_id].update(kw)


# ── Main pipeline coroutine ───────────────────────────────────────────────────

async def _run(job_id: str, sport: str, force: bool) -> None:
    lock = _SPORT_LOCKS.get(sport)
    if lock is None:
        _upd(job_id, status="error", message=f"Sport inconnu : {sport}")
        return

    async with lock:
        try:
            today  = date.today()
            source = get_source(sport)
            model  = get_model(sport)

            # ── Étape 1 : récupération des matchs ──────────────────────────
            _upd(job_id, status="running", step="fetch", progress=10,
                 message=f"Récupération des matchs {sport} du jour...")

            setting_key, default_leagues = _LEAGUE_SETTINGS[sport]
            leagues_raw = await get_setting(setting_key, default_leagues)
            leagues = [l.strip() for l in leagues_raw.split(",") if l.strip()]

            events = await source.list_events(today, leagues)

            if not events:
                _upd(job_id, status="finished", progress=100,
                     message=f"Aucun match {sport} programmé aujourd'hui.",
                     result={"sport": sport, "total": 0, "cached": False})
                return

            logger.info(f"[SportsPipeline] {sport} — {len(events)} match(s) récupéré(s).")

            # ── Idempotence : pronostics existants pour (sport, date) ──────
            async with AsyncSessionLocal() as session:
                existing_count = (await session.execute(
                    select(func.count()).where(
                        SportPronostic.sport == sport,
                        SportPronostic.date == today,
                    )
                )).scalar()

                if existing_count and not force:
                    _upd(job_id, status="finished", progress=100,
                         message=f"Pronostics {sport} du jour déjà disponibles.",
                         result={"sport": sport, "total": existing_count, "cached": True})
                    return

                if existing_count and force:
                    logger.info(f"[SportsPipeline] force=True — suppression des données {sport} existantes.")
                    await _delete_today(session, sport, today)

            # ── Étape 2 : enrichissement + modèle ─────────────────────────
            total = len(events)
            enriched: list[dict] = []

            for i, ev in enumerate(events):
                pct = 20 + int(55 * i / total)
                _upd(job_id, step="model", progress=pct,
                     message=f"Modèle {i + 1}/{total} : "
                             f"{ev['home_team']} – {ev['away_team']}...")
                try:
                    ed = await _enrich(source, model, ev)
                    enriched.append(ed)
                except Exception as exc:
                    logger.error(
                        f"[SportsPipeline] Enrich échoué pour "
                        f"{ev.get('external_id')}: {exc}"
                    )

            # ── Étape 3 : analyse LLM ──────────────────────────────────────
            _upd(job_id, step="analyze", progress=78,
                 message=f"Analyse qualitative ({len(enriched)} matchs)...")

            for ed in enriched:
                try:
                    ed["_analysis"] = await analyze_event(
                        sport,
                        ed,
                        ed["_model_probs"],
                        ed["_value_bets"],
                    )
                except Exception as exc:
                    logger.error(f"[SportsPipeline] LLM échoué : {exc}")
                    ed["_analysis"] = None

            # ── Étape 4 : persistance ──────────────────────────────────────
            _upd(job_id, step="persist", progress=92, message="Sauvegarde en base...")
            saved_ids = await _persist_all(sport, today, enriched)

            _upd(
                job_id, status="finished", progress=100,
                message=f"{len(saved_ids)} pronostic(s) {sport} généré(s).",
                result={"sport": sport, "total": len(saved_ids),
                        "ids": saved_ids, "cached": False},
            )

        except Exception as exc:
            logger.exception(f"[SportsPipeline] {sport} — erreur fatale : {exc}")
            _upd(job_id, status="error", message=f"Erreur : {exc}", error=str(exc))


# ── Event enrichment ──────────────────────────────────────────────────────────

async def _enrich(source, model, ev: dict) -> dict:
    """Fetch form / H2H / standings / odds concurrently, then run the statistical model."""
    home_id   = ev["home_team_id"]
    away_id   = ev["away_team_id"]
    league_id = ev["league_id"]
    event_id  = ev["external_id"]

    # All I/O in parallel
    home_form, away_form, h2h, standings, odds = await asyncio.gather(
        source.team_form(home_id),
        source.team_form(away_id),
        source.head_to_head(home_id, away_id),
        source.standings(league_id),
        source.event_odds(event_id),
        return_exceptions=True,
    )

    # Replace any exception with a safe empty fallback
    if isinstance(home_form, Exception):  home_form = {}
    if isinstance(away_form, Exception):  away_form = {}
    if isinstance(h2h,       Exception):  h2h       = []
    if isinstance(standings, Exception):  standings = []
    if isinstance(odds,      Exception):  odds      = {}

    event_data = {
        "event":     ev,
        "home_form": home_form,
        "away_form": away_form,
        "h2h":       h2h,
        "standings": standings,
        "odds":      odds,
    }

    model_probs = model.compute(event_data)
    value_bets  = model.value_bets(model_probs, odds)

    event_data["_model_probs"] = model_probs
    event_data["_value_bets"]  = value_bets
    return event_data


# ── Persistence ───────────────────────────────────────────────────────────────

async def _persist_all(sport: str, today: date, enriched: list[dict]) -> list[int]:
    """Insert SportEvent + SportPronostic rows. Returns list of saved pronostic IDs."""
    saved: list[int] = []

    async with AsyncSessionLocal() as session:
        for ed in enriched:
            if ed.get("_analysis") is None:
                logger.warning(
                    f"[SportsPipeline] Pas d'analyse pour "
                    f"{ed['event'].get('home_team')} – {ed['event'].get('away_team')}, ignoré."
                )
                continue

            ev       = ed["event"]
            probs    = ed["_model_probs"]
            vb       = ed["_value_bets"]
            analysis = ed["_analysis"]

            sport_event = SportEvent(
                sport=sport,
                date=today,
                league=ev.get("league", ""),
                home_team=ev.get("home_team", ""),
                away_team=ev.get("away_team", ""),
                kickoff=ev.get("kickoff", "00:00"),
                external_id=ev.get("external_id", ""),
            )
            session.add(sport_event)
            await session.flush()   # generates sport_event.id

            prono = SportPronostic(
                event_id=sport_event.id,
                sport=sport,
                date=today,
                model_probs=probs,
                predictions=analysis.get("predictions", []),
                value_bets=vb,
                commentary=analysis.get("commentary", ""),
                confidence=analysis.get("confidence", 50),
            )
            session.add(prono)
            await session.flush()
            saved.append(prono.id)

        await session.commit()

    return saved


async def _delete_today(session, sport: str, today: date) -> None:
    """Delete all (sport_results →) sport_pronostics → sport_events for (sport, today)."""
    events = (await session.execute(
        select(SportEvent).where(
            SportEvent.sport == sport,
            SportEvent.date  == today,
        )
    )).scalars().all()

    for ev in events:
        result = (await session.execute(
            select(SportResult).where(SportResult.event_id == ev.id)
        )).scalar_one_or_none()
        if result:
            await session.delete(result)

        prono = (await session.execute(
            select(SportPronostic).where(SportPronostic.event_id == ev.id)
        )).scalar_one_or_none()
        if prono:
            await session.delete(prono)

        await session.delete(ev)

    await session.commit()
