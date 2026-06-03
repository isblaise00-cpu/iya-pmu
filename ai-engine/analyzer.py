"""
Analyse du programme PMUB journalier via LLM (Anthropic ou Groq).
PDF → texte brut → LLM → race info + 10 propositions de pronostic.

Sélection du provider : variable d'env AI_PROVIDER=anthropic|groq (défaut: anthropic)
"""
import json
import os

import pdfplumber

_PROPOSAL_IDS = [
    "prono_du_jour", "base_immanquable", "consensus_partenaires",
    "cotes_favorites", "en_forme", "la_reguliere",
    "coup_coeur_lonab", "valeur_du_jour", "deuxieme_chance", "coup_audacieux",
]

_PROMPT = """\
Tu es un expert en pronostics hippiques. Analyse ce programme officiel PMUB/LONAB et génère 10 pronostics.

PROGRAMME :
{text}

Réponds UNIQUEMENT avec un JSON valide (sans markdown, sans commentaire) structuré ainsi :

{{
  "race": {{
    "type": "QUARTE",
    "race_name": "PRIX DES HAUTS DE FRANCE",
    "hippodrome": "COMPIEGNE",
    "distance": 1600,
    "num_concurrents": 16,
    "date": "2026-05-25",
    "start_time": "13:15"
  }},
  "horses": [
    {{"num": 1, "nom": "RIASSOU", "cote_pt": "16/1", "cote_tm": "14/1"}},
    {{"num": 2, "nom": "HALF HALF", "cote_pt": "6/1", "cote_tm": "9/1"}}
  ],
  "proposals": [
    {{
      "id": "prono_du_jour",
      "title": "LE PRONO DU JOUR",
      "subtitle": "Synthèse globale de tous les signaux",
      "nums": [5, 9, 4, 1],
      "confidence": 82,
      "odds": {{"5": "4/1", "9": "4/1", "4": "3/1", "1": "16/1"}}
    }},
    {{
      "id": "base_immanquable",
      "title": "LA BASE IMMANQUABLE",
      "subtitle": "Cheval présent dans tous les pronostics partenaires",
      "nums": [5],
      "confidence": 96,
      "odds": {{"5": "4/1"}}
    }},
    {{
      "id": "consensus_partenaires",
      "title": "CONSENSUS PARTENAIRES",
      "subtitle": "Les chevaux les plus cités par les partenaires",
      "nums": [5, 9, 4, 1],
      "confidence": 78,
      "odds": {{"5": "4/1", "9": "4/1", "4": "3/1", "1": "16/1"}}
    }},
    {{
      "id": "cotes_favorites",
      "title": "LES COTES FAVORITES",
      "subtitle": "Sélection basée sur les meilleures cotes",
      "nums": [5, 9, 4, 2],
      "confidence": 71,
      "odds": {{"5": "4/1", "9": "4/1", "4": "3/1", "2": "6/1"}}
    }},
    {{
      "id": "en_forme",
      "title": "EN FORME",
      "subtitle": "Aptitude FORME + jockey et entraîneur en forme",
      "nums": [4, 9, 5, 3],
      "confidence": 68,
      "odds": {{"4": "3/1", "9": "4/1", "5": "4/1", "3": "9/1"}}
    }},
    {{
      "id": "la_reguliere",
      "title": "LA RÉGULIÈRE",
      "subtitle": "Aptitude RÉGULARITÉ — chevaux qui finissent toujours placés",
      "nums": [4, 9, 1, 14],
      "confidence": 65,
      "odds": {{"4": "3/1", "9": "4/1", "1": "16/1", "14": "29/1"}}
    }},
    {{
      "id": "coup_coeur_lonab",
      "title": "COUP DE CŒUR LONAB",
      "subtitle": "Chevaux mis en avant dans l'éditorial officiel",
      "nums": [5, 9, 4, 6],
      "confidence": 74,
      "odds": {{"5": "4/1", "9": "4/1", "4": "3/1", "6": "15/1"}}
    }},
    {{
      "id": "valeur_du_jour",
      "title": "VALEUR DU JOUR",
      "subtitle": "Bon rapport cote / confiance partenaires",
      "nums": [5, 1, 4, 9],
      "confidence": 63,
      "odds": {{"5": "4/1", "1": "16/1", "4": "3/1", "9": "4/1"}}
    }},
    {{
      "id": "deuxieme_chance",
      "title": "DEUXIÈME CHANCE",
      "subtitle": "Secondes chances et outsiders LONAB",
      "nums": [5, 16, 15, 8],
      "confidence": 45,
      "odds": {{"5": "4/1", "16": "23/1", "15": "25/1", "8": "19/1"}}
    }},
    {{
      "id": "coup_audacieux",
      "title": "LE COUP AUDACIEUX",
      "subtitle": "Gros outsiders pour grand rapport",
      "nums": [5, 12, 11, 13],
      "confidence": 22,
      "odds": {{"5": "4/1", "12": "73/1", "11": "59/1", "13": "54/1"}}
    }}
  ],
  "commentary": "Analyse globale de la course en 2-3 phrases."
}}

RÈGLES IMPÉRATIVES :
1. JSON valide uniquement — sans markdown, sans ```, sans commentaire
2. nums = exactement TIERCE→3 chevaux, QUARTE→4, QUINTE→5 chevaux
3. Les cotes proviennent EXACTEMENT du document (Paris Turf en priorité, format X/1)
4. Les 10 proposals ont exactement ces IDs dans cet ordre : {ids}
5. Scores de confiance réalistes : prono_du_jour ≈ 75-85 %, coup_audacieux < 30 %
6. Analyse tous les signaux : pronostics partenaires (fréquence + position), cotes, aptitudes FORME/CLASSE/RÉGULARITÉ/PROGRÈS, favoris/outsiders LONAB, jockeys et entraîneurs en forme
7. start_time = heure de départ de la course au format "HH:MM" (cherche "DÉPART DE LA COURSE" dans le document)
"""


def _extract_text(pdf_path: str) -> str:
    """Extraction texte brut depuis le PDF (toutes pages)."""
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            pages.append(page.extract_text() or "")
    return "\n".join(pages).strip()


def _parse_json(raw: str) -> dict:
    raw = raw.strip()
    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    return json.loads(raw)


async def _analyze_anthropic(text: str) -> dict:
    from anthropic import AsyncAnthropic
    client = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    response = await client.messages.create(
        model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
        max_tokens=4096,
        messages=[{"role": "user", "content": _PROMPT.format(text=text, ids=", ".join(_PROPOSAL_IDS))}],
    )
    return _parse_json(response.content[0].text)


async def _analyze_groq(text: str) -> dict:
    from groq import AsyncGroq
    client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))
    response = await client.chat.completions.create(
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        messages=[{"role": "user", "content": _PROMPT.format(text=text, ids=", ".join(_PROPOSAL_IDS))}],
        max_tokens=4096,
        response_format={"type": "json_object"},  # force JSON valide
    )
    return _parse_json(response.choices[0].message.content)


async def analyze_pdf(pdf_path: str) -> dict:
    """PDF → texte brut → LLM → race + 10 propositions de pronostic."""
    text = _extract_text(pdf_path)
    provider = os.getenv("AI_PROVIDER", "anthropic").lower()
    if provider == "groq":
        return await _analyze_groq(text)
    return await _analyze_anthropic(text)
