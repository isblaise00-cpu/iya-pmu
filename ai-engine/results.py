"""
Fetch today's PMUB results PDF from lonab.bf/resultats-gains-pmub,
extract arrival order via LLM, save to Result table.

Même logique que lonab.py mais pour la page des résultats.
"""
from __future__ import annotations

import os
import re
from datetime import date, datetime
from pathlib import Path
from typing import Optional

import aiohttp
import pdfplumber
from bs4 import BeautifulSoup
from loguru import logger

from database import AsyncSessionLocal, Race, Pronostic, Result

INDEX_URL = "https://lonab.bf/resultats-gains-pmub"
BASE_URL  = "https://lonab.bf"

PDF_HREF_RE    = re.compile(r'\.pdf$', re.IGNORECASE)
DATE_IN_NAME   = re.compile(r'(\d{2})[-_](\d{2})[-_](\d{4})')

_PROMPT = """\
Tu es un expert en hippisme. Analyse ce document officiel de résultats PMUB/LONAB.

DOCUMENT :
{text}

Réponds UNIQUEMENT avec un JSON valide (sans markdown, sans commentaire) :

{{
  "date": "2026-06-03",
  "race_type": "QUARTE",
  "hippodrome": "COTONOU",
  "arrival_order": [5, 9, 4, 1]
}}

RÈGLES :
1. JSON valide uniquement — sans markdown, sans backticks
2. arrival_order = numéros des chevaux dans l'ordre exact d'arrivée (du 1er au dernier placé)
3. race_type = TIERCE, QUARTE ou QUINTE selon le document
4. date au format YYYY-MM-DD
5. Inclure uniquement les chevaux classés (3 pour TIERCE, 4 pour QUARTE, 5 pour QUINTE)
"""


# ---------------------------------------------------------------------------
# PDF helpers
# ---------------------------------------------------------------------------

def _extract_text(pdf_path: str) -> str:
    pages: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            pages.append(page.extract_text() or "")
    return "\n".join(pages).strip()


def _parse_json(raw: str) -> dict:
    import json
    raw = raw.strip()
    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    return json.loads(raw)


# ---------------------------------------------------------------------------
# LLM extraction
# ---------------------------------------------------------------------------

async def _llm_extract(text: str) -> dict:
    provider = os.getenv("AI_PROVIDER", "anthropic").lower()
    if provider == "groq":
        from groq import AsyncGroq
        client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))
        response = await client.chat.completions.create(
            model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
            messages=[{"role": "user", "content": _PROMPT.format(text=text)}],
            max_tokens=512,
            response_format={"type": "json_object"},
        )
        return _parse_json(response.choices[0].message.content)
    else:
        from anthropic import AsyncAnthropic
        client = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        response = await client.messages.create(
            model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
            max_tokens=512,
            messages=[{"role": "user", "content": _PROMPT.format(text=text)}],
        )
        return _parse_json(response.content[0].text)


# ---------------------------------------------------------------------------
# LONAB scraping for result PDFs
# ---------------------------------------------------------------------------

async def _list_result_links(session: aiohttp.ClientSession) -> list[dict]:
    async with session.get(INDEX_URL, timeout=aiohttp.ClientTimeout(total=20)) as resp:
        resp.raise_for_status()
        html = await resp.text()
    soup = BeautifulSoup(html, "html.parser")
    entries: list[dict] = []
    for a in soup.find_all("a", href=PDF_HREF_RE):
        href = a["href"]
        url  = href if href.startswith("http") else BASE_URL + href
        name = href.rsplit("/", 1)[-1]
        m    = DATE_IN_NAME.search(name)
        d: Optional[date] = None
        if m:
            try:
                d = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
            except ValueError:
                d = None
        entries.append({"url": url, "date": d, "filename": name})
    return entries


async def _find_result_pdf(
    session: aiohttp.ClientSession,
    target: date,
    preferred_race_type: Optional[str] = None,
) -> Optional[dict]:
    entries    = await _list_result_links(session)
    candidates = [e for e in entries if e["date"] == target]
    if not candidates:
        return None
    # Prefer file whose name contains the race type (QUARTE, TIERCE, QUINTE)
    if preferred_race_type:
        rtype_upper = preferred_race_type.upper()
        typed = [c for c in candidates if rtype_upper in c["filename"].upper()]
        if typed:
            return typed[0]
    return candidates[0]


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

async def _get_today_race_type(today: date) -> Optional[str]:
    from sqlalchemy import select
    async with AsyncSessionLocal() as session:
        race = (await session.execute(
            select(Race).where(Race.date == today)
        )).scalar_one_or_none()
        return race.race_type if race else None


async def _save_result(data: dict, today: date, source_url: str) -> int:
    from sqlalchemy import select
    async with AsyncSessionLocal() as session:
        # Find today's pronostic via Race
        race = (await session.execute(
            select(Race).where(Race.date == today)
        )).scalar_one_or_none()

        prono_id: Optional[int] = None
        if race:
            prono = (await session.execute(
                select(Pronostic).where(Pronostic.race_id == race.id)
            )).scalar_one_or_none()
            if prono:
                prono_id = prono.id
                # Upsert: update if result already exists
                existing = (await session.execute(
                    select(Result).where(Result.pronostic_id == prono_id)
                )).scalar_one_or_none()
                if existing:
                    existing.arrival_order = data.get("arrival_order", [])
                    existing.source        = source_url
                    await session.commit()
                    await session.refresh(existing)
                    logger.info(f"Résultat mis à jour (id={existing.id})")
                    return existing.id

        result = Result(
            arrival_order=data.get("arrival_order", []),
            source=source_url,
            pronostic_id=prono_id,
        )
        session.add(result)
        await session.commit()
        await session.refresh(result)
        logger.info(f"Résultat enregistré (id={result.id}, pronosticId={prono_id})")
        return result.id


# ---------------------------------------------------------------------------
# Polling state
# ---------------------------------------------------------------------------

_polling_task: "asyncio.Task | None" = None


async def already_have_results(today: date) -> bool:
    """Renvoie True si un Result est déjà enregistré pour ce jour."""
    from sqlalchemy import select
    async with AsyncSessionLocal() as session:
        race = (await session.execute(
            select(Race).where(Race.date == today)
        )).scalar_one_or_none()
        if not race:
            return False
        prono = (await session.execute(
            select(Pronostic).where(Pronostic.race_id == race.id)
        )).scalar_one_or_none()
        if not prono:
            return False
        result = (await session.execute(
            select(Result).where(Result.pronostic_id == prono.id)
        )).scalar_one_or_none()
        return result is not None


async def _polling_loop(start_time_str: str, race_date: date) -> None:
    """
    Polling automatique des résultats LONAB.
    Démarre 20 min après le départ, toutes les 2 min, s'arrête après 2h.
    """
    import asyncio
    from datetime import timedelta

    _DELAY_MIN    = 20    # attente avant le premier essai
    _INTERVAL_SEC = 120   # 2 minutes entre chaque essai
    _MAX_MIN      = 120   # arrêt 2h après le départ

    try:
        h, m = map(int, start_time_str.split(":"))
    except ValueError:
        logger.warning(f"[ResultsPoller] startTime invalide : {start_time_str!r}")
        return

    start_dt  = datetime.combine(race_date, datetime.min.time()).replace(hour=h, minute=m)
    poll_from = start_dt + timedelta(minutes=_DELAY_MIN)
    poll_until = start_dt + timedelta(minutes=_DELAY_MIN + _MAX_MIN)

    # Attente initiale
    now = datetime.now()
    if now < poll_from:
        wait_s = (poll_from - now).total_seconds()
        logger.info(
            f"[ResultsPoller] Démarrage dans {wait_s / 60:.0f} min "
            f"(à {poll_from.strftime('%H:%M')})"
        )
        await asyncio.sleep(wait_s)

    logger.info(
        f"[ResultsPoller] Polling démarré — toutes les {_INTERVAL_SEC // 60} min "
        f"jusqu'à {poll_until.strftime('%H:%M')}"
    )

    while datetime.now() < poll_until:
        # Arrêt si résultats déjà sauvegardés (ex: bouton manuel)
        if await already_have_results(race_date):
            logger.info("[ResultsPoller] Résultats déjà enregistrés, polling terminé.")
            return

        try:
            data = await fetch_and_save_results(race_date)
            logger.success(
                f"[ResultsPoller] Résultats trouvés ! "
                f"Arrivée : {data.get('arrivalOrder')}"
            )
            return
        except RuntimeError:
            logger.info(
                f"[ResultsPoller] Pas encore disponible — "
                f"prochain essai dans {_INTERVAL_SEC // 60} min "
                f"(limite : {poll_until.strftime('%H:%M')})"
            )
        except Exception as exc:
            logger.warning(f"[ResultsPoller] Erreur : {exc}")

        await asyncio.sleep(_INTERVAL_SEC)

    logger.info(
        "[ResultsPoller] 2 h écoulées sans résultats — "
        "utilisez le bouton manuel pour réessayer."
    )


def start_results_polling(start_time_str: str, race_date: Optional[date] = None) -> None:
    """Lance (ou relance) le polling résultats en tâche de fond."""
    import asyncio

    global _polling_task
    race_date = race_date or datetime.utcnow().date()

    # Annule un polling précédent si encore actif
    if _polling_task and not _polling_task.done():
        _polling_task.cancel()
        logger.info("[ResultsPoller] Polling précédent annulé.")

    _polling_task = asyncio.create_task(_polling_loop(start_time_str, race_date))
    logger.info(
        f"[ResultsPoller] Programmé — départ {start_time_str}, "
        f"premier essai à T+20 min."
    )


def is_polling() -> bool:
    return _polling_task is not None and not _polling_task.done()


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def fetch_and_save_results(
    target: Optional[date] = None,
    cache_dir: Optional[Path] = None,
) -> dict:
    """Télécharge le PDF résultats LONAB pour `target`, extrait l'arrivée, sauvegarde."""
    target    = target    or datetime.utcnow().date()
    cache_dir = cache_dir or Path("./_lonab_cache")

    race_type = await _get_today_race_type(target)

    async with aiohttp.ClientSession() as session:
        entry = await _find_result_pdf(session, target, race_type)
        if not entry:
            raise RuntimeError(
                f"Aucun résultat PMUB trouvé sur LONAB pour le {target}. "
                "Vérifiez que les résultats sont publiés sur lonab.bf."
            )

        dest = cache_dir / f"RES_{entry['filename']}"
        if not dest.exists():
            async with session.get(entry["url"], timeout=aiohttp.ClientTimeout(total=60)) as resp:
                resp.raise_for_status()
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(await resp.read())
            logger.info(f"Résultats téléchargés : {dest}")
        else:
            logger.info(f"Résultats en cache : {dest}")

    text       = _extract_text(str(dest))
    data       = await _llm_extract(text)
    result_id  = await _save_result(data, target, entry["url"])

    return {
        "resultId":     result_id,
        "arrivalOrder": data.get("arrival_order", []),
        "raceType":     data.get("race_type"),
        "source":       entry["url"],
    }
