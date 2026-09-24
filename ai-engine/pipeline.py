"""Pipeline du jour : PDF LONAB → extraction → consensus presse/cotes → sauvegarde."""
import asyncio
import uuid
from datetime import date

from loguru import logger
from sqlalchemy import select

from lonab import fetch_today_pmub_pdf
from analyzer import analyze_pdf
from consensus_model import build_pronostic
from database import AsyncSessionLocal, Race, Pronostic, Result
from results import race_type_from_date

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
            today = date.today()
            async with AsyncSessionLocal() as session:
                existing = (await session.execute(
                    select(Race).where(Race.date == today)
                )).scalar_one_or_none()
                if existing and not force:
                    prono = (await session.execute(
                        select(Pronostic).where(Pronostic.race_id == existing.id)
                    )).scalar_one_or_none()
                    if prono:
                        _upd(job_id, status="finished", progress=100,
                             message="Pronostic du jour déjà disponible.",
                             result={"raceId": existing.id, "pronosticId": prono.id, "cached": True})
                        return

            _upd(job_id, status="running", step="fetch", progress=10,
                 message="Téléchargement du programme LONAB...")
            pdf_info = await fetch_today_pmub_pdf(target=today)
            if pdf_info["date"] != today:
                raise ValueError("Le programme du jour n'est pas disponible. Le PDF d'une ancienne course ne sera pas utilisé.")

            _upd(job_id, step="analyze", progress=35,
                 message="Extraction des partants, des pronostics partenaires et des cotes...")
            data = await analyze_pdf(str(pdf_info["path"]))
            # La date du fichier PDF a déjà été validée ci-dessus — on corrige
            # la date extraite pour éviter les faux positifs dus aux résultats
            # d'anciennes courses affichés dans le document.
            if "race" in data:
                data["race"]["date"] = today.isoformat()

            # Forcer le type de course depuis le jour de la semaine (plus fiable que le LLM)
            correct_type = race_type_from_date(today)
            if "race" in data:
                data["race"]["type"] = correct_type

            _upd(job_id, step="model", progress=65,
                 message="Classement des sept meilleurs chevaux et calcul des vingt groupes...")
            data = build_pronostic(data)

            _upd(job_id, step="persist", progress=85, message="Sauvegarde du pronostic...")
            race_id, prono_id = await _persist(data, today, pdf_info)
            _upd(job_id, status="finished", progress=100,
                 message="Sélection et combinaisons générées.",
                 result={"raceId": race_id, "pronosticId": prono_id, "cached": False})

            start_time = data["race"].get("start_time")
            if start_time:
                from results import start_results_polling
                start_results_polling(start_time, today)
            else:
                logger.warning("Heure de départ absente — récupération manuelle des résultats nécessaire.")
        except Exception as exc:
            logger.exception(f"Pipeline error: {exc}")
            _upd(job_id, status="error", message=f"Erreur : {exc}", error=str(exc))


async def _persist(data: dict, today: date, pdf_info: dict) -> tuple[int, int]:
    """Remplace un brouillon dans une transaction, après validation complète."""
    r = data["race"]
    async with AsyncSessionLocal() as session:
        race = (await session.execute(select(Race).where(Race.date == today))).scalar_one_or_none()
        if race is None:
            race = Race(date=today)
            session.add(race)
        race.race_type = r.get("type")
        race.race_name = r.get("race_name")
        race.hippodrome = r.get("hippodrome")
        race.distance = r.get("distance")
        race.num_horses = r.get("num_concurrents")
        race.start_time = r.get("start_time")
        race.pdf_url = pdf_info.get("url")
        await session.flush()

        prono = (await session.execute(
            select(Pronostic).where(Pronostic.race_id == race.id)
        )).scalar_one_or_none()
        if prono is not None:
            result = (await session.execute(
                select(Result).where(Result.pronostic_id == prono.id)
            )).scalar_one_or_none()
            if result is not None:
                raise ValueError("Un pronostic avec une arrivée enregistrée ne peut pas être régénéré.")
        else:
            prono = Pronostic(date=today, race_id=race.id)
            session.add(prono)
        prono.horses = data["horses"]
        prono.proposals = data["proposals"]
        prono.commentary = data["commentary"]
        prono.is_sent = False
        prono.modified_by_admin = False
        await session.commit()
        await session.refresh(prono)
        return race.id, prono.id
