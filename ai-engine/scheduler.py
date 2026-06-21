from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from loguru import logger

_scheduler = AsyncIOScheduler()
_JOB_ID = "pipeline_journalier"


def setup_scheduler(callback, time_str: str = "07:00"):
    """Démarre le scheduler et planifie le pipeline journalier hippique."""
    _scheduler.start()
    update_scrape_schedule(time_str, callback)
    return _scheduler


def update_scrape_schedule(time_str: str, callback):
    """Replanifie le pipeline hippique. time_str format : 'HH:MM'"""
    try:
        hour, minute = time_str.split(":")
        if _scheduler.get_job(_JOB_ID):
            _scheduler.remove_job(_JOB_ID)
        _scheduler.add_job(
            callback,
            CronTrigger(hour=int(hour), minute=int(minute)),
            id=_JOB_ID,
            name="Pipeline journalier PMUB",
            replace_existing=True,
        )
        logger.info(f"Pipeline planifié à {time_str}")
    except Exception as exc:
        logger.error(f"Erreur planification : {exc}")


# ── Multi-sports schedulers ───────────────────────────────────────────────────

def setup_sport_scheduler(sport: str, callback, time_str: str) -> None:
    """Planifie le pipeline d'un sport. Le scheduler doit déjà être démarré."""
    update_sport_schedule(sport, time_str, callback)


def update_sport_schedule(sport: str, time_str: str, callback) -> None:
    """Replanifie le pipeline d'un sport. sport en MAJUSCULES, time_str 'HH:MM'."""
    job_id = f"pipeline_{sport.lower()}"
    try:
        hour, minute = time_str.split(":")
        if _scheduler.get_job(job_id):
            _scheduler.remove_job(job_id)
        _scheduler.add_job(
            callback,
            CronTrigger(hour=int(hour), minute=int(minute)),
            id=job_id,
            name=f"Pipeline {sport}",
            replace_existing=True,
        )
        logger.info(f"Pipeline {sport} planifié à {time_str}")
    except Exception as exc:
        logger.error(f"Erreur planification {sport} : {exc}")
