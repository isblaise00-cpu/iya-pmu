from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from loguru import logger


scheduler = AsyncIOScheduler()
_scrape_job_id = "auto_scrape"
_results_job_id = "auto_results"


def setup_scheduler(scrape_callback, results_callback):
    """Initialize the scheduler with default jobs."""
    scheduler.start()
    logger.info("Scheduler started")
    return scheduler


def update_scrape_schedule(time_str: str, scrape_callback):
    """Update the scraping schedule. time_str format: 'HH:MM'"""
    try:
        hour, minute = time_str.split(":")
        if scheduler.get_job(_scrape_job_id):
            scheduler.remove_job(_scrape_job_id)
        scheduler.add_job(
            scrape_callback,
            CronTrigger(hour=int(hour), minute=int(minute)),
            id=_scrape_job_id,
            name="Auto Scraping",
            replace_existing=True,
        )
        logger.info(f"Scraping scheduled at {time_str}")
    except Exception as e:
        logger.error(f"Failed to update scrape schedule: {e}")


def update_results_schedule(time_str: str, results_callback):
    """Update the results fetch schedule. time_str format: 'HH:MM'"""
    try:
        hour, minute = time_str.split(":")
        if scheduler.get_job(_results_job_id):
            scheduler.remove_job(_results_job_id)
        scheduler.add_job(
            results_callback,
            CronTrigger(hour=int(hour), minute=int(minute)),
            id=_results_job_id,
            name="Auto Results Fetch",
            replace_existing=True,
        )
        logger.info(f"Results fetch scheduled at {time_str}")
    except Exception as e:
        logger.error(f"Failed to update results schedule: {e}")
