import os
import sys
import asyncio
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env", override=True)

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from database import get_setting, AsyncSessionLocal, Setting, Race
from pipeline import start_pipeline, get_job
from results import fetch_and_save_results, already_have_results, start_results_polling
from scheduler import setup_scheduler, update_scrape_schedule


async def _daily_pipeline():
    job_id = await start_pipeline()
    logger.info(f"Pipeline journalier lancé — job {job_id}")


async def _resume_polling_if_needed() -> None:
    """Au démarrage, reprend le polling résultats si la course du jour n'a pas encore de résultats."""
    from datetime import date
    from sqlalchemy import select

    today = date.today()
    async with AsyncSessionLocal() as session:
        race = (await session.execute(
            select(Race).where(Race.date == today)
        )).scalar_one_or_none()

    if not race or not race.start_time:
        return  # Pas de course aujourd'hui ou startTime inconnu

    if await already_have_results(today):
        return  # Résultats déjà disponibles

    logger.info(
        f"[Startup] Course du jour sans résultats (départ {race.start_time}) "
        "— reprise du polling résultats."
    )
    start_results_polling(race.start_time, today)


@asynccontextmanager
async def lifespan(app: FastAPI):
    scraping_time = await get_setting("scraping_time", "07:00")
    scheduler = setup_scheduler(_daily_pipeline, scraping_time)
    logger.info(f"Scheduler démarré — pipeline à {scraping_time}")
    await _resume_polling_if_needed()
    yield
    scheduler.shutdown()


app = FastAPI(title="PMU AI Engine", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.post("/pipeline/start")
async def pipeline_start(force: bool = False):
    job_id = await start_pipeline(force=force)
    return {"jobId": job_id}


@app.get("/pipeline/job/{job_id}")
async def pipeline_job(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job introuvable")
    return {"id": job_id, **job}


@app.get("/schedule")
async def get_schedule():
    t = await get_setting("scraping_time", "07:00")
    return {"scraping_time": t}


@app.post("/results/fetch")
async def results_fetch():
    """Télécharge le PDF résultats LONAB du jour, extrait l'arrivée, sauvegarde."""
    try:
        data = await fetch_and_save_results()
        return data
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post("/schedule")
async def set_schedule(body: dict):
    from sqlalchemy import select
    t = body.get("scraping_time")
    if not t:
        raise HTTPException(status_code=400, detail="scraping_time requis")
    async with AsyncSessionLocal() as session:
        row = (await session.execute(select(Setting).where(Setting.key == "scraping_time"))).scalar_one_or_none()
        if row:
            row.value = t
        else:
            session.add(Setting(key="scraping_time", value=t))
        await session.commit()
    update_scrape_schedule(t, _daily_pipeline)
    return {"scraping_time": t}
