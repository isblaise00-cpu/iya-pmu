"""
Pipeline journalier : LONAB PDF → Claude → Pronostic
3 étapes : fetch · analyze · persist
"""
import asyncio
import uuid
from datetime import date

from loguru import logger

from lonab import fetch_today_pmub_pdf
from analyzer import analyze_pdf
from database import AsyncSessionLocal, Race, Pronostic

JOBS: dict[str, dict] = {}
_LOCK = asyncio.Lock()


def _new_job() -> dict:
    return {"status": "pending", "step": None, "progress": 0, "message": "", "result": None, "error": None}


def get_job(job_id: str) -> dict | None:
    return JOBS.get(job_id)


async def start_pipeline(force: bool = False) -> str:
    job_id = str(uuid.uuid4())
    JOBS[job_id] = _new_job()
    asyncio.create_task(_run(job_id, force))
    return job_id


def _upd(job_id: str, **kw):
    JOBS[job_id].update(kw)


async def _run(job_id: str, force: bool):
    async with _LOCK:
        try:
            # Étape 1 — Téléchargement PDF
            _upd(job_id, status="running", step="fetch", progress=10,
                 message="Téléchargement du programme LONAB...")
            pdf_info = await fetch_today_pmub_pdf()

            # Idempotence : course déjà générée ?
            today = date.today()
            async with AsyncSessionLocal() as session:
                from sqlalchemy import select
                existing = (await session.execute(
                    select(Race).where(Race.date == today)
                )).scalar_one_or_none()

                if existing and not force:
                    prono = (await session.execute(
                        select(Pronostic).where(Pronostic.race_id == existing.id)
                    )).scalar_one_or_none()
                    _upd(job_id, status="finished", progress=100,
                         message="Pronostic du jour déjà disponible.",
                         result={"raceId": existing.id, "pronosticId": prono.id if prono else None, "cached": True})
                    return

                if existing and force:
                    await session.delete(existing)
                    await session.commit()

            # Étape 2 — Analyse Claude
            _upd(job_id, step="analyze", progress=40,
                 message="Analyse du programme par Claude AI...")
            data = await analyze_pdf(str(pdf_info["path"]))

            # Étape 3 — Persistance
            _upd(job_id, step="persist", progress=80, message="Sauvegarde du pronostic...")
            race_id, prono_id = await _persist(data, today, pdf_info)

            _upd(job_id, status="finished", progress=100,
                 message="Pronostic généré avec succès.",
                 result={"raceId": race_id, "pronosticId": prono_id, "cached": False})

            # Démarrage automatique du polling résultats si startTime disponible
            start_time = data["race"].get("start_time")
            if start_time:
                from results import start_results_polling
                start_results_polling(start_time, today)
            else:
                logger.warning("startTime absent — polling résultats désactivé, utilisez le bouton manuel.")

        except Exception as exc:
            logger.exception(f"Pipeline error: {exc}")
            _upd(job_id, status="error", message=f"Erreur : {exc}", error=str(exc))


async def _persist(data: dict, today: date, pdf_info: dict) -> tuple[int, int]:
    r = data["race"]
    async with AsyncSessionLocal() as session:
        race = Race(
            date=today,
            race_type=r.get("type"),
            race_name=r.get("race_name"),
            hippodrome=r.get("hippodrome"),
            distance=r.get("distance"),
            num_horses=r.get("num_concurrents"),
            start_time=r.get("start_time"),
            pdf_url=pdf_info.get("url"),
        )
        session.add(race)
        await session.flush()

        prono = Pronostic(
            date=today,
            horses=data.get("horses", []),
            proposals=data.get("proposals", []),
            commentary=data.get("commentary"),
            race_id=race.id,
        )
        session.add(prono)
        await session.commit()
        await session.refresh(race)
        await session.refresh(prono)
        return race.id, prono.id
