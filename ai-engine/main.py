import os
import sys
import asyncio
from dotenv import load_dotenv
load_dotenv()
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from loguru import logger

from database import get_db, get_setting, Pronostic, Result, AsyncSessionLocal
from scraper import scrape_all_sources, fetch_race_results
from ai_engine import synthesize_pronostic, parse_results
from scheduler import setup_scheduler, update_scrape_schedule, update_results_schedule


async def run_scraping():
    """Full scraping + AI synthesis pipeline."""
    logger.info("Starting scraping pipeline...")
    async with AsyncSessionLocal() as db:
        try:
            # Delete yesterday's pronostics
            yesterday = datetime.utcnow() - timedelta(days=1)
            await db.execute(delete(Pronostic).where(Pronostic.date < yesterday))
            await db.commit()
            logger.info("Cleaned up old pronostics")

            # Scrape all sources
            scraped_data = await scrape_all_sources()

            # Synthesize with AI
            pronostic_data = await synthesize_pronostic(scraped_data)

            # Save to DB
            pronostic = Pronostic(
                date=datetime.utcnow(),
                base_horse=pronostic_data.get("base_horse"),
                tierce=pronostic_data.get("tierce"),
                quarte=pronostic_data.get("quarte"),
                quinte=pronostic_data.get("quinte"),
                outsider=pronostic_data.get("outsider"),
                confidence_score=pronostic_data.get("confidence_score", 0),
                commentary=pronostic_data.get("commentary"),
                raw_data={"scraped": scraped_data, "sources": pronostic_data.get("sources", [])},
                is_sent=False,
            )
            db.add(pronostic)
            await db.commit()
            await db.refresh(pronostic)
            logger.info(f"Pronostic saved: ID {pronostic.id}, confidence: {pronostic.confidence_score}")
            return pronostic
        except Exception as e:
            logger.error(f"Scraping pipeline error: {e}")
            await db.rollback()
            raise


async def run_results_fetch():
    """Fetch and store race results."""
    logger.info("Fetching race results...")
    async with AsyncSessionLocal() as db:
        try:
            raw = await fetch_race_results()
            parsed = await parse_results(raw.get("raw_text", ""))

            if not parsed.get("arrival_order"):
                logger.warning("No results could be parsed")
                return None

            # Find today's pronostic
            today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            result_q = await db.execute(
                select(Pronostic).where(Pronostic.date >= today).order_by(Pronostic.date.desc())
            )
            pronostic = result_q.scalar_one_or_none()

            result = Result(
                date=datetime.utcnow(),
                arrival_order=parsed["arrival_order"],
                source=raw.get("source", "pmu.fr"),
                pronostic_id=pronostic.id if pronostic else None,
            )
            db.add(result)
            await db.commit()
            await db.refresh(result)
            logger.info(f"Result saved: ID {result.id}")
            return result
        except Exception as e:
            logger.error(f"Results fetch error: {e}")
            await db.rollback()
            raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    async with AsyncSessionLocal() as db:
        scrape_time = await get_setting(db, "scraping_time", "07:00")
        results_time = await get_setting(db, "results_fetch_time", "18:00")

    setup_scheduler(run_scraping, run_results_fetch)
    update_scrape_schedule(scrape_time, run_scraping)
    update_results_schedule(results_time, run_results_fetch)
    logger.info(f"Scheduler configured: scraping at {scrape_time}, results at {results_time}")
    yield
    # Shutdown
    from scheduler import scheduler
    if scheduler.running:
        scheduler.shutdown()


app = FastAPI(
    title="PMU AI Engine",
    description="Moteur de scraping et d'IA pour pronostics PMU",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@app.post("/scrape")
async def trigger_scrape():
    """Manually trigger the scraping pipeline."""
    try:
        pronostic = await run_scraping()
        return {
            "success": True,
            "pronostic_id": pronostic.id,
            "confidence_score": pronostic.confidence_score,
            "message": "Scraping completed successfully",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/fetch-results")
async def trigger_results():
    """Manually trigger results fetching."""
    try:
        result = await run_results_fetch()
        if not result:
            return {"success": False, "message": "No results could be parsed from the source"}
        return {
            "success": True,
            "result_id": result.id,
            "arrival_order": result.arrival_order,
            "message": "Results fetched successfully",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/pipeline/start")
async def pipeline_start():
    """Start the new LONAB pipeline (PDF → parse → enrich → AI synthesis).

    Returns immediately with a job ID; poll /pipeline/job/{id} for progress.
    """
    from pipeline import start_pipeline
    job_id = await start_pipeline()
    return {"jobId": job_id}


@app.get("/pipeline/job/{job_id}")
async def pipeline_job(job_id: str):
    """Poll a pipeline job. Returns full state including result/error when finished."""
    from pipeline import get_job
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job introuvable")
    return job


@app.get("/schedule")
async def get_schedule():
    """Get current scheduled times."""
    async with AsyncSessionLocal() as db:
        scrape_time = await get_setting(db, "scraping_time", "07:00")
        results_time = await get_setting(db, "results_fetch_time", "18:00")
    return {"scraping_time": scrape_time, "results_fetch_time": results_time}


@app.post("/schedule")
async def update_schedule(scraping_time: str = None, results_fetch_time: str = None):
    """Update scheduled times."""
    from sqlalchemy import update as sa_update
    from database import Setting
    async with AsyncSessionLocal() as db:
        if scraping_time:
            await db.execute(
                sa_update(Setting).where(Setting.key == "scraping_time").values(value=scraping_time)
            )
            update_scrape_schedule(scraping_time, run_scraping)
        if results_fetch_time:
            await db.execute(
                sa_update(Setting).where(Setting.key == "results_fetch_time").values(value=results_fetch_time)
            )
            update_results_schedule(results_fetch_time, run_results_fetch)
        await db.commit()
    return {"message": "Schedule updated", "scraping_time": scraping_time, "results_fetch_time": results_fetch_time}
