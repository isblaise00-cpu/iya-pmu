"""
Enrich PDF-parsed race data with external commentary from French turf sites.

Strategy: rather than building per-horse profile URLs (fragile, requires
slugification + search), we fetch each site's "today's race" page and locate
each horse from the PDF by exact name match in the scraped text. Around each
match we extract a short context window (~250 chars) as the external note.

Sources used:
- canalturf.com   (HTML, latin-1 encoded)
- zone-turf.fr    (HTML, utf-8)
- equidia.fr      (Playwright, JS-rendered)
- paris-turf.com  (HTML, utf-8)

Each scraper is best-effort: failures are logged and contribute nothing.
The orchestrator can show users which sources contributed which horses.
"""
from __future__ import annotations

import asyncio
import re
from typing import Optional

import aiohttp
from bs4 import BeautifulSoup
from loguru import logger

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
TIMEOUT_S = 25


async def _fetch_html(session: aiohttp.ClientSession, url: str, encoding: str = "utf-8") -> Optional[str]:
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=TIMEOUT_S)) as resp:
            if resp.status >= 400:
                logger.warning(f"{url} → HTTP {resp.status}")
                return None
            return await resp.text(encoding=encoding, errors="replace")
    except Exception as e:
        logger.warning(f"fetch {url} failed: {e}")
        return None


async def _fetch_canalturf(session: aiohttp.ClientSession) -> tuple[str, str]:
    html = await _fetch_html(session, "https://www.canalturf.com/courses_liste_pronostics.php", encoding="latin-1") or ""
    if not html:
        return ("canalturf", "")
    soup = BeautifulSoup(html, "html.parser")
    main = soup.find("main") or soup.find("div", id="content") or soup.find("body")
    return ("canalturf", main.get_text(" ", strip=True) if main else "")


async def _fetch_zone_turf(session: aiohttp.ClientSession) -> tuple[str, str]:
    html = await _fetch_html(session, "https://www.zone-turf.fr/quinte/") or ""
    if not html:
        return ("zone-turf", "")
    soup = BeautifulSoup(html, "html.parser")
    main = soup.find("article") or soup.find("main") or soup.find("body")
    return ("zone-turf", main.get_text(" ", strip=True) if main else "")


async def _fetch_paris_turf(session: aiohttp.ClientSession) -> tuple[str, str]:
    """paris-turf.com homepage usually links to today's quinté coverage."""
    html = await _fetch_html(session, "https://www.paris-turf.com/quinte-plus") or ""
    if not html:
        return ("paris-turf", "")
    soup = BeautifulSoup(html, "html.parser")
    main = soup.find("main") or soup.find("article") or soup.find("body")
    return ("paris-turf", main.get_text(" ", strip=True) if main else "")


async def _fetch_equidia(_session=None) -> tuple[str, str]:
    """Equidia is JS-rendered — uses Playwright. Session arg ignored, kept
    for signature symmetry. Imported lazily so callers that don't need it
    don't pay the startup cost."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return ("equidia", "")
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
            page = await browser.new_page(user_agent=USER_AGENT)
            try:
                await page.goto("https://www.equidia.fr/pronostics", wait_until="networkidle", timeout=30000)
                await page.wait_for_timeout(2000)
                content = await page.evaluate(
                    """() => {
                        const sels = ['article', 'main', '[class*=\"prono\"]', 'body'];
                        for (const s of sels) { const el = document.querySelector(s); if (el && el.innerText.length > 500) return el.innerText; }
                        return document.body.innerText;
                    }"""
                )
            finally:
                await browser.close()
        return ("equidia", content or "")
    except Exception as e:
        logger.warning(f"equidia scrape failed: {e}")
        return ("equidia", "")


def _find_horse_context(haystack: str, horse_name: str, window: int = 250) -> Optional[str]:
    """Locate horse_name in haystack (case-insensitive, accent-insensitive),
    return surrounding context up to `window` characters trimmed at sentence
    boundaries. Returns None if not found."""
    if not haystack or not horse_name:
        return None
    # Normalise both sides: strip accents, uppercase.
    def norm(s: str) -> str:
        import unicodedata
        s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().upper()
        return re.sub(r"\s+", " ", s)

    hn = norm(horse_name)
    if len(hn) < 4:
        return None
    norm_hay = norm(haystack)
    idx = norm_hay.find(hn)
    if idx < 0:
        return None
    # Map back to original by approximation (lengths roughly match for ASCII).
    start = max(0, idx - 80)
    end = min(len(haystack), idx + len(hn) + window)
    snippet = haystack[start:end].strip()
    snippet = re.sub(r"\s+", " ", snippet)
    return snippet[:window + 100] if snippet else None


async def enrich_race(horse_names_by_number: dict[int, str], on_progress=None) -> dict:
    """Public entry point.

    Args:
        horse_names_by_number: {1: "ONE LOVE BIANCA", 2: "INVADER AM", ...}
        on_progress: optional callback(message: str, ratio: float in [0,1])

    Returns:
        {
          "sources": [
              {"name": "canalturf", "ok": True, "url": "...", "matched": [1,3,7]},
              ...
          ],
          "horseNotes": {1: [{"source": "canalturf", "snippet": "..."}, ...], ...}
        }
    """
    progress = on_progress or (lambda m, r: None)
    progress("Connexion aux sites partenaires…", 0.0)

    async with aiohttp.ClientSession(headers={"User-Agent": USER_AGENT}) as session:
        tasks = [
            _fetch_canalturf(session),
            _fetch_zone_turf(session),
            _fetch_paris_turf(session),
        ]
        # Equidia has its own session via Playwright.
        results = await asyncio.gather(*tasks, return_exceptions=True)
    progress("Site Equidia (rendu JavaScript)…", 0.5)
    # Equidia uses Playwright internally; the aiohttp session arg is unused
    # but we pass a sentinel for signature compatibility.
    eq = await _fetch_equidia(None)  # type: ignore[arg-type]
    results.append(eq if isinstance(eq, tuple) else ("equidia", ""))

    progress("Recoupement des chevaux…", 0.85)
    sources_summary: list[dict] = []
    horse_notes: dict[int, list[dict]] = {n: [] for n in horse_names_by_number}

    site_urls = {
        "canalturf": "https://www.canalturf.com/courses_liste_pronostics.php",
        "zone-turf": "https://www.zone-turf.fr/quinte/",
        "paris-turf": "https://www.paris-turf.com/quinte-plus",
        "equidia": "https://www.equidia.fr/pronostics",
    }

    for item in results:
        if isinstance(item, Exception) or not isinstance(item, tuple):
            continue
        name, text = item
        ok = bool(text and len(text) > 200)
        matched_numbers: list[int] = []
        if ok:
            for num, horse in horse_names_by_number.items():
                snippet = _find_horse_context(text, horse)
                if snippet:
                    horse_notes[num].append({"source": name, "snippet": snippet})
                    matched_numbers.append(num)
        sources_summary.append({
            "name": name,
            "url": site_urls.get(name, ""),
            "ok": ok,
            "matched": sorted(matched_numbers),
        })

    progress("Enrichissement terminé.", 1.0)
    return {"sources": sources_summary, "horseNotes": horse_notes}


if __name__ == "__main__":
    import json
    test_horses = {
        1: "ONE LOVE BIANCA", 3: "FEROX BRICK", 13: "ISTORIC MAUZUN",
        14: "IQUEM D'AMER", 15: "HARMONY LA NUIT", 16: "ICARE WILLIAMS",
    }
    out = asyncio.run(enrich_race(test_horses, on_progress=lambda m, r: print(f"[{int(r*100):3d}%] {m}")))
    print(json.dumps(out, ensure_ascii=False, indent=2)[:3000])
