"""Extraction du programme du jour : l'IA ne produit ni sélection ni confiance."""
import json
import os
import re

import pdfplumber

_PROMPT = """\
Extrais les données du programme PMUB/LONAB ci-dessous. Ne génère aucun pronostic.
Le document contient aussi des résultats d'anciennes courses : ignore ces encadrés.
La course à extraire est celle annoncée dans le titre principal du programme.

PROGRAMME :
{text}

Retourne uniquement ce JSON, sans markdown :
{{
  "race": {{
    "type": "QUINTE",
    "race_name": "nom exact",
    "hippodrome": "hippodrome exact",
    "distance": 1600,
    "num_concurrents": 16,
    "date": "YYYY-MM-DD",
    "start_time": "HH:MM"
  }},
  "horses": [
    {{"num": 1, "nom": "NOM COMPLET DU CHEVAL", "non_partant": false}}
  ]
}}

Règles :
- type = TIERCE, QUARTE ou QUINTE. « 4+1 » signifie QUINTE (5 chevaux).
- Copie tous les numéros et noms COMPLETS du tableau CHEVAUX, non-partants compris.
- num_concurrents = nombre de chevaux inscrits au tableau, non-partants compris.
- non_partant est vrai uniquement si c'est explicitement indiqué pour CETTE course.
  Les mentions NP/NPO dans les résultats des journées précédentes ne s'appliquent pas.
- date = date du programme principal, jamais celle des résultats anciens.
- start_time = heure de « DÉPART DE LA COURSE », pas la clôture des jeux.
- Une métadonnée absente reste null. N'invente aucune donnée ni aucun score.
"""


def _extract_text(pdf_path: str) -> str:
    with pdfplumber.open(pdf_path) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages).strip()


def extract_pdf_signals(text: str) -> tuple[dict, list]:
    """Lit la section du tableau, après les résultats anciens de la une."""
    header = re.search(r"(?im)^.*\bCHEVAUX\b[^\n]*(?:JOCKEYS|DRIVERS)[^\n]*$", text)
    if not header:
        raise ValueError("Tableau des partants introuvable dans le PDF.")
    section = text[header.end():]
    token = r"(?:\d+(?:[.,]\d+)?\s*/\s*\d+(?:[.,]\d+)?|N\.?/?P\.?O?\.?|[-–—])"
    row = re.compile(rf"^\s*(\d{{1,2}})\s+.+?\s+({token})\s+({token})\s*$", re.I)
    partner_row = re.compile(r"^\s*([^\d:\n]{2,70}?)\s+(\d{1,2}(?:\s*[-–—]\s*\d{1,2}){4,})\s*$")
    odds = {}
    partners = []
    for line in section.splitlines():
        match = row.fullmatch(line)
        if match:
            number = int(match[1])
            values = [re.sub(r"\s", "", match[i]) for i in (2, 3)]
            record = {"cote_pt": values[0], "cote_tm": values[1]}
            if number in odds and odds[number] != record:
                raise ValueError(f"Cotes contradictoires pour le cheval {number}.")
            odds[number] = record
        match = partner_row.fullmatch(line)
        if match:
            name = match[1].strip()
            if re.search(r"ARRIV|RESULT|RÉSULT|FAVORI|FORME|CLASSE|PROGR|REGULAR|RÉGULAR|OUTSIDER", name, re.I):
                continue
            partners.append({"source": name, "nums": [int(n) for n in re.findall(r"\d+", match[2])]})
    if len(odds) < 7 or len(partners) < 2:
        raise ValueError("Extraction insuffisante : tableau de cotes ou listes des partenaires incomplets.")
    return odds, partners


def _parse_json(raw: str) -> dict:
    raw = raw.strip()
    fence = chr(96) * 3
    if fence in raw:
        raw = raw.split(fence)[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


async def _analyze_anthropic(text: str) -> dict:
    from anthropic import AsyncAnthropic
    client = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    response = await client.messages.create(
        model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
        max_tokens=4096,
        messages=[{"role": "user", "content": _PROMPT.format(text=text)}],
    )
    return _parse_json(response.content[0].text)


async def _analyze_groq(text: str) -> dict:
    from groq import AsyncGroq
    client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))
    response = await client.chat.completions.create(
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        messages=[{"role": "user", "content": _PROMPT.format(text=text)}],
        max_tokens=4096, response_format={"type": "json_object"},
    )
    return _parse_json(response.choices[0].message.content)


def _analyze_mock(text: str, odds: dict) -> dict:
    """Mode mock : construit une extraction minimale depuis les données regex sans appel LLM."""
    from datetime import date
    race_type = "QUARTE"
    for rt in ("QUINTE", "QUARTE", "TIERCE"):
        if rt in text.upper():
            race_type = rt
            break
    horses = [{"num": n, "nom": f"CHEVAL_{n}", "non_partant": False} for n in sorted(odds)]
    return {
        "race": {
            "type": race_type,
            "race_name": "MOCK",
            "hippodrome": "MOCK",
            "distance": None,
            "num_concurrents": len(odds),
            "date": date.today().isoformat(),
            "start_time": None,
        },
        "horses": horses,
    }


async def analyze_pdf(pdf_path: str) -> dict:
    text = _extract_text(pdf_path)
    odds, partners = extract_pdf_signals(text)
    provider = os.getenv("AI_PROVIDER", "anthropic").lower()
    if provider == "mock":
        data = _analyze_mock(text, odds)
    elif provider == "groq":
        data = await _analyze_groq(text)
    else:
        data = await _analyze_anthropic(text)
    horses = data.get("horses", [])
    if {h.get("num") for h in horses} != set(odds):
        raise ValueError("Les chevaux extraits ne correspondent pas au tableau des cotes.")
    for horse in horses:
        horse.update(odds[horse["num"]])
        if any(re.sub(r'[./]', '', str(horse[key]).upper()) in ("NP", "NPO") for key in ("cote_pt", "cote_tm")):
            horse["non_partant"] = True
    return {"race": data["race"], "horses": horses, "partner_predictions": partners}
