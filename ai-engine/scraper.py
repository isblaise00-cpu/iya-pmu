import asyncio
import aiohttp
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright
from loguru import logger
from typing import Optional


async def scrape_canalturf() -> Optional[dict]:
    """Scrape canalturf.com pronostics."""
    url = "https://www.canalturf.com/courses_liste_pronostics.php"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                html = await resp.text(encoding='latin-1', errors='replace')
        soup = BeautifulSoup(html, "html.parser")
        data = {"source": "canalturf", "url": url, "horses": [], "raw_text": ""}

        # Extract horse selections from the page
        tables = soup.find_all("table", class_=lambda x: x and "prono" in x.lower() if x else False)
        if not tables:
            tables = soup.find_all("table")

        for table in tables[:3]:
            rows = table.find_all("tr")
            for row in rows:
                cells = row.find_all(["td", "th"])
                row_text = " ".join(c.get_text(strip=True) for c in cells)
                if row_text:
                    data["horses"].append(row_text)

        # Fallback: extract all text blocks
        content = soup.find("div", id=lambda x: x and "prono" in x.lower() if x else False)
        if not content:
            content = soup.find("div", class_=lambda x: x and "prono" in x.lower() if x else False)
        if content:
            data["raw_text"] = content.get_text(separator="\n", strip=True)[:3000]
        else:
            # Get main content area
            main = soup.find("main") or soup.find("div", id="content") or soup.find("body")
            if main:
                data["raw_text"] = main.get_text(separator="\n", strip=True)[:3000]

        logger.info(f"CanalTurf scraped: {len(data['horses'])} horse rows")
        return data
    except Exception as e:
        logger.error(f"CanalTurf scraping error: {e}")
        return {"source": "canalturf", "error": str(e), "horses": [], "raw_text": ""}


async def scrape_zone_turf() -> Optional[dict]:
    """Scrape zone-turf.fr quinte pronostics."""
    url = "https://www.zone-turf.fr/quinte/"
    try:
        async with aiohttp.ClientSession(headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}) as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                html = await resp.text()
        soup = BeautifulSoup(html, "html.parser")
        data = {"source": "zone-turf", "url": url, "horses": [], "raw_text": ""}

        # Find pronostic sections
        prono_divs = soup.find_all("div", class_=lambda x: x and any(k in x.lower() for k in ["prono", "cheval", "quinte", "tierce"]) if x else False)

        for div in prono_divs[:5]:
            text = div.get_text(separator=" ", strip=True)
            if text:
                data["horses"].append(text[:500])

        # Extract numbered horses (N°X or num X)
        import re
        horse_pattern = re.compile(r'[Nn]°?\s*(\d+)\s*[-–]?\s*([A-Z][A-Z\s]+)', re.MULTILINE)
        full_text = soup.get_text()
        matches = horse_pattern.findall(full_text)
        for num, name in matches[:20]:
            data["horses"].append(f"N°{num} - {name.strip()}")

        main_content = soup.find("article") or soup.find("main") or soup.find("div", class_="content")
        if main_content:
            data["raw_text"] = main_content.get_text(separator="\n", strip=True)[:3000]

        logger.info(f"Zone-Turf scraped: {len(data['horses'])} horse entries")
        return data
    except Exception as e:
        logger.error(f"Zone-Turf scraping error: {e}")
        return {"source": "zone-turf", "error": str(e), "horses": [], "raw_text": ""}


async def scrape_equidia() -> Optional[dict]:
    """Scrape equidia.fr with Playwright (JS-heavy site)."""
    url = "https://www.equidia.fr/pronostics"
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
            page = await browser.new_page()
            await page.goto(url, wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(3000)

            content = await page.evaluate("""() => {
                const selectors = ['.pronostic', '.prono', '[class*="prono"]', '[class*="horse"]', 'article', 'main'];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) return el.innerText;
                }
                return document.body.innerText.slice(0, 3000);
            }""")

            await browser.close()

        data = {
            "source": "equidia",
            "url": url,
            "horses": [],
            "raw_text": content[:3000] if content else "",
        }

        # Parse horse numbers
        import re
        horse_pattern = re.compile(r'[Nn]°?\s*(\d+)\s*[-–]?\s*([A-Z][A-Z\s]+)', re.MULTILINE)
        matches = horse_pattern.findall(content or "")
        for num, name in matches[:20]:
            data["horses"].append(f"N°{num} - {name.strip()}")

        logger.info(f"Equidia scraped: {len(data['horses'])} horse entries")
        return data
    except Exception as e:
        logger.error(f"Equidia scraping error: {e}")
        return {"source": "equidia", "error": str(e), "horses": [], "raw_text": ""}


async def scrape_all_sources() -> dict:
    """Run all scrapers concurrently and return combined data."""
    results = await asyncio.gather(
        scrape_canalturf(),
        scrape_zone_turf(),
        scrape_equidia(),
        return_exceptions=True,
    )

    combined = {
        "sources": [],
        "total_horses": [],
        "raw_texts": {},
    }

    for result in results:
        if isinstance(result, Exception):
            logger.error(f"Scraper exception: {result}")
            continue
        if result and not result.get("error"):
            combined["sources"].append(result["source"])
            combined["total_horses"].extend(result.get("horses", []))
            combined["raw_texts"][result["source"]] = result.get("raw_text", "")

    logger.info(f"Scraping complete. Sources: {combined['sources']}, Horses found: {len(combined['total_horses'])}")
    return combined


async def fetch_race_results() -> dict:
    """Attempt to fetch race results from PMU website."""
    url = "https://www.pmu.fr/turf/2-quinze"
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
            page = await browser.new_page()
            await page.goto(url, wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(3000)

            content = await page.evaluate("""() => {
                const resultSelectors = ['.resultat', '.result', '[class*="result"]', '[class*="arrive"]'];
                for (const sel of resultSelectors) {
                    const el = document.querySelector(sel);
                    if (el) return el.innerText;
                }
                return document.body.innerText.slice(0, 2000);
            }""")

            await browser.close()

        return {"source": "pmu.fr", "raw_text": content[:2000] if content else "", "url": url}
    except Exception as e:
        logger.error(f"Results fetch error: {e}")
        return {"source": "pmu.fr", "error": str(e), "raw_text": ""}
