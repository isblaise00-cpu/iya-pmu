import os
import json
import re
from typing import Optional
from loguru import logger

AI_PROVIDER = os.getenv("AI_PROVIDER", "mock").lower()
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

SYNTHESIS_PROMPT = """Tu es un expert en pronostics hippiques PMU français.
Analyse les données suivantes collectées de plusieurs sources de pronostics et génère un pronostic synthétique structuré.

Données collectées:
{scraped_data}

Génère un pronostic JSON strictement structuré comme suit (sans texte avant ou après):
{{
  "base_horse": "N°X - NOM DU CHEVAL",
  "tierce": ["N°X", "N°Y", "N°Z"],
  "quarte": ["N°X", "N°Y", "N°Z", "N°W"],
  "quinte": ["N°X", "N°Y", "N°Z", "N°W", "N°V"],
  "outsider": "N°X - NOM DU CHEVAL",
  "confidence_score": 75,
  "commentary": "Analyse détaillée en français expliquant les choix, la forme des chevaux, les conditions de course, etc. (200-400 mots)"
}}

Règles:
- Utilise uniquement les numéros de chevaux mentionnés dans les sources
- Le score de confiance doit être entre 0 et 100 basé sur la cohérence des sources
- Si les données sont insuffisantes ou contradictoires, baisse le score de confiance
- Le commentaire doit être en français, analytique et informatif
- Les sélections doivent être dans l'ordre de préférence (le meilleur en premier)
"""

RESULTS_PARSE_PROMPT = """Tu es un assistant qui analyse des résultats de courses hippiques.
Extrais l'ordre d'arrivée de la course principale (Quinté+) depuis ce texte:

{raw_text}

Retourne uniquement un JSON avec l'ordre d'arrivée (sans texte avant ou après):
{{
  "arrival_order": ["N°X", "N°Y", "N°Z", "N°W", "N°V", ...]
}}

Si tu ne peux pas extraire les résultats, retourne:
{{"arrival_order": [], "error": "Impossible d'extraire les résultats"}}
"""


def _call_anthropic(prompt: str, max_tokens: int) -> str:
    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    message = client.messages.create(
        model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}]
    )
    return message.content[0].text.strip()


def _call_groq(prompt: str, max_tokens: int) -> str:
    from openai import OpenAI
    client = OpenAI(
        api_key=GROQ_API_KEY,
        base_url="https://api.groq.com/openai/v1"
    )
    response = client.chat.completions.create(
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}]
    )
    return response.choices[0].message.content.strip()


def _call_ai(prompt: str, max_tokens: int) -> str:
    if AI_PROVIDER == "anthropic" and ANTHROPIC_API_KEY:
        return _call_anthropic(prompt, max_tokens)
    elif AI_PROVIDER == "groq" and GROQ_API_KEY:
        return _call_groq(prompt, max_tokens)
    raise ValueError(f"Provider '{AI_PROVIDER}' non configuré ou clé manquante")


async def synthesize_pronostic(scraped_data: dict) -> dict:
    if AI_PROVIDER == "mock" or (AI_PROVIDER == "groq" and not GROQ_API_KEY) or (AI_PROVIDER == "anthropic" and not ANTHROPIC_API_KEY):
        logger.warning(f"Provider '{AI_PROVIDER}' non disponible - pronostic mock")
        return _generate_mock_pronostic(scraped_data)

    data_text = ""
    for source, text in scraped_data.get("raw_texts", {}).items():
        if text:
            data_text += f"\n=== Source: {source} ===\n{text}\n"

    horses = scraped_data.get("total_horses", [])
    if horses:
        data_text += f"\n=== Chevaux mentionnés ===\n" + "\n".join(horses[:30])

    if not data_text.strip():
        logger.warning("Pas de données scrapées - pronostic mock")
        return _generate_mock_pronostic(scraped_data)

    try:
        response_text = _call_ai(
            SYNTHESIS_PROMPT.format(scraped_data=data_text[:8000]),
            max_tokens=1500
        )
        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if json_match:
            result = json.loads(json_match.group())
            result["sources"] = scraped_data.get("sources", [])
            logger.info(f"Synthèse IA [{AI_PROVIDER}] OK. Confiance: {result.get('confidence_score')}")
            return result
        logger.error(f"Impossible de parser la réponse IA: {response_text[:200]}")
        return _generate_mock_pronostic(scraped_data)

    except Exception as e:
        logger.error(f"Erreur IA [{AI_PROVIDER}]: {e}")
        return _generate_mock_pronostic(scraped_data)


async def parse_results(raw_text: str) -> dict:
    if AI_PROVIDER == "mock" or not raw_text.strip():
        return {"arrival_order": [], "error": "Provider mock ou texte vide"}

    try:
        response_text = _call_ai(
            RESULTS_PARSE_PROMPT.format(raw_text=raw_text[:4000]),
            max_tokens=500
        )
        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
        return {"arrival_order": [], "error": "Impossible de parser la réponse"}

    except Exception as e:
        logger.error(f"Erreur parsing résultats [{AI_PROVIDER}]: {e}")
        return {"arrival_order": [], "error": str(e)}


def _generate_mock_pronostic(scraped_data: dict) -> dict:
    sources = scraped_data.get("sources", ["mock"])
    horses = scraped_data.get("total_horses", [])

    horse_nums = []
    for h in horses[:20]:
        m = re.search(r'N°?(\d+)', h)
        if m:
            horse_nums.append(f"N°{m.group(1)}")

    if len(horse_nums) < 5:
        horse_nums = [f"N°{i}" for i in range(1, 16)]

    return {
        "base_horse": f"{horse_nums[0]} - CHEVAL FAVORI",
        "tierce": horse_nums[:3],
        "quarte": horse_nums[:4],
        "quinte": horse_nums[:5],
        "outsider": f"{horse_nums[5] if len(horse_nums) > 5 else 'N°9'} - OUTSIDER",
        "confidence_score": 50,
        "commentary": f"Pronostic mock depuis {len(sources)} source(s): {', '.join(sources)}. Configurez AI_PROVIDER=groq avec GROQ_API_KEY pour activer l'IA.",
        "sources": sources,
    }


# ============================================================================
# New multi-strategy pipeline (PDF LONAB + external enrichment)
# ============================================================================

# Maps race type → number of horses required in the proposal selection.
SELECTION_SIZES = {
    "TIERCE": 3,
    "QUARTE": 4,
    "QUARTE_PLUS": 4,
    "QUINTE_PLUS": 5,
    "COUPLE": 2,
    "AUTRE": 4,
}

PROPOSAL_PROMPT = """Tu es un expert en pronostics hippiques (PMU/PMUB) qui aide des joueurs au Burkina Faso à parier sur les courses françaises diffusées par la LONAB.

# Contexte
La course du jour est documentée par la LONAB dans son journal officiel (PDF). Cette source contient déjà la synthèse de 6 publications spécialisées et une ligne FAVORIS éditoriale. Des informations complémentaires ont été récoltées sur d'autres sites (canalturf, zone-turf, equidia, paris-turf).

Type de course : {race_type}
Tu dois produire EXACTEMENT {selection_size} chevaux par sélection (sauf "COUPLE" qui en a 2, "TIERCE" 3, "QUARTE/QUARTE_PLUS" 4, "QUINTE_PLUS" 5).

# Données de la course
{race_data_json}

# Ton travail
Génère 4 stratégies de pari distinctes, chacune avec un angle différent :

1. **SECURITE** 🛡️ — Le pari le plus probable. Base-toi sur le consensus FAVORIS LONAB + sources PDF + cotes les plus basses. Confiance > 75.
2. **VALEUR** 💎 — Cherche un cheval avec cote intéressante (≥ 8/1 sur Paris Turf) mais soutenu par les aptitudes (forme/classe/régularité) ou les notes externes. Confiance 50-70.
3. **AUDACE** 🎯 — Mise audacieuse incluant un OUTSIDER ou GROS OUTSIDER bien placé. Tente le coup. Confiance 30-50.
4. **RECOMMANDE** ⭐ — Ta synthèse pondérée idéale. Mix entre sécurité et valeur. Indique pourquoi c'est ton choix par défaut.

# Format JSON exigé (sans texte avant ou après)
{{
  "proposals": [
    {{
      "strategy": "SECURITE",
      "label": "🛡️ Sécurité",
      "selections": [13, 3, 15, 14],
      "base": 13,
      "outsider": 9,
      "confidence": 85,
      "reasoning": "Phrase d'analyse en français (2-3 lignes)."
    }},
    {{ "strategy": "VALEUR", ... }},
    {{ "strategy": "AUDACE", ... }},
    {{ "strategy": "RECOMMANDE", ... }}
  ],
  "globalCommentary": "Synthèse en français de 200-300 mots couvrant la dynamique de la course, les chevaux clés, les outsiders à surveiller, et les éléments météo/forme/équipage importants. Tutoie le lecteur burkinabè et reste concret.",
  "globalConfidence": 82
}}

# Règles strictes
- Chaque "selections" est une LISTE DE NUMÉROS DE CHEVAUX (entiers 1-{num_horses}).
- L'ordre dans la liste reflète la préférence (le meilleur en premier).
- "base" est un seul numéro (le cheval pivot, doit être dans selections).
- "outsider" est un seul numéro (peut être hors selections, doit être dans la liste OUTSIDERS ou GROS OUTSIDERS).
- "confidence" est un entier 0-100.
- N'invente AUCUN numéro hors de [1, {num_horses}].
- Les 4 stratégies doivent être distinctes (au moins un cheval ou base différent entre elles).
- Tout le texte est en français, ton accessible non-technique.
"""


def _build_race_data_compact(parsed_race: dict, external: dict) -> dict:
    """Trim the parsed PDF + external enrichment into a compact JSON for LLM."""
    horses_compact = []
    for h in parsed_race.get("horses", []):
        horses_compact.append({
            "n": h.get("number"),
            "name": h.get("name"),
            "driver": h.get("driver"),
            "trainer": h.get("trainer"),
            "sex": h.get("sex"),
            "age": h.get("age"),
            "chrono": h.get("chrono"),
            "perf": h.get("recentPerf"),
            "gainsXof": h.get("gainsXof"),
            "oddsParisTurf": h.get("oddsParisTurf"),
            "oddsTierceMag": h.get("oddsTierceMag"),
        })
    # External notes: keep at most 2 snippets per horse, 200 chars each.
    horse_notes_trimmed = {}
    for num, notes in (external.get("horseNotes") or {}).items():
        if not notes:
            continue
        horse_notes_trimmed[str(num)] = [
            {"source": n["source"], "text": (n["snippet"] or "")[:240]}
            for n in notes[:2]
        ]
    return {
        "race": parsed_race.get("race", {}),
        "horses": horses_compact,
        "favorisLonab": parsed_race.get("favoris", []),
        "sourcesPdf": parsed_race.get("sources", {}),
        "aptitudes": parsed_race.get("aptitudes", {}),
        "outsiders": parsed_race.get("outsiders", []),
        "bigOutsiders": parsed_race.get("bigOutsiders", []),
        "secondChances": parsed_race.get("secondChances", []),
        "editorial": (parsed_race.get("editorial") or "")[:1500],
        "horseComments": {str(k): v[:300] for k, v in (parsed_race.get("horseComments") or {}).items()},
        "externalNotes": horse_notes_trimmed,
    }


def _validate_proposals(payload: dict, valid_numbers: set[int], required_size: int) -> Optional[str]:
    """Return an error description if the payload is malformed, else None."""
    if not isinstance(payload, dict):
        return "payload n'est pas un objet"
    proposals = payload.get("proposals")
    if not isinstance(proposals, list) or len(proposals) != 4:
        return "proposals doit être une liste de 4 stratégies"
    expected_strategies = {"SECURITE", "VALEUR", "AUDACE", "RECOMMANDE"}
    seen_strategies: set[str] = set()
    for p in proposals:
        if not isinstance(p, dict):
            return "chaque stratégie doit être un objet"
        if p.get("strategy") not in expected_strategies:
            return f"stratégie inconnue: {p.get('strategy')}"
        seen_strategies.add(p["strategy"])
        sel = p.get("selections")
        if not isinstance(sel, list) or len(sel) != required_size:
            return f"selections de {p['strategy']} doit contenir {required_size} chevaux"
        if not all(isinstance(x, int) and x in valid_numbers for x in sel):
            return f"selections de {p['strategy']} contient des numéros invalides"
        if len(set(sel)) != len(sel):
            return f"selections de {p['strategy']} contient des doublons"
        if not isinstance(p.get("base"), int) or p["base"] not in valid_numbers:
            return f"base de {p['strategy']} invalide"
        if p.get("outsider") is not None and p["outsider"] not in valid_numbers:
            return f"outsider de {p['strategy']} invalide"
        conf = p.get("confidence")
        if not isinstance(conf, int) or not (0 <= conf <= 100):
            return f"confidence de {p['strategy']} hors plage"
    if seen_strategies != expected_strategies:
        return f"stratégies manquantes: {expected_strategies - seen_strategies}"
    return None


async def synthesize_proposals(parsed_race: dict, external: Optional[dict] = None) -> dict:
    """Generate the 4-strategy pronostic from PDF + external enrichment.

    Returns:
      {
        "proposals": [...4 strategies...],
        "globalCommentary": "...",
        "globalConfidence": int,
        "meta": {"provider": "anthropic", "model": "...", "valid": True}
      }

    Falls back to a deterministic mock if the AI provider is unavailable or
    returns an unparseable / invalid payload.
    """
    external = external or {"sources": [], "horseNotes": {}}
    race_meta = parsed_race.get("race", {})
    race_type = race_meta.get("raceType") or "AUTRE"
    selection_size = SELECTION_SIZES.get(race_type, 4)
    horses = parsed_race.get("horses", [])
    valid_numbers = {h["number"] for h in horses if isinstance(h.get("number"), int)}
    num_horses = max(valid_numbers) if valid_numbers else 0

    if AI_PROVIDER == "mock" or (
        AI_PROVIDER == "anthropic" and not ANTHROPIC_API_KEY
    ) or (AI_PROVIDER == "groq" and not GROQ_API_KEY):
        logger.warning(f"Provider '{AI_PROVIDER}' indisponible — proposals mock")
        return _mock_proposals(parsed_race, selection_size)

    compact = _build_race_data_compact(parsed_race, external)
    prompt = PROPOSAL_PROMPT.format(
        race_type=race_type,
        selection_size=selection_size,
        race_data_json=json.dumps(compact, ensure_ascii=False),
        num_horses=num_horses or 16,
    )

    try:
        response_text = _call_ai(prompt, max_tokens=2000)
    except Exception as e:
        logger.error(f"AI call failed: {e}")
        return _mock_proposals(parsed_race, selection_size)

    json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
    if not json_match:
        logger.error(f"No JSON found in AI response: {response_text[:200]}")
        return _mock_proposals(parsed_race, selection_size)

    try:
        payload = json.loads(json_match.group())
    except json.JSONDecodeError as e:
        logger.error(f"AI JSON parse failed: {e}")
        return _mock_proposals(parsed_race, selection_size)

    err = _validate_proposals(payload, valid_numbers, selection_size)
    if err:
        logger.error(f"AI proposals invalid: {err}")
        return _mock_proposals(parsed_race, selection_size)

    payload["meta"] = {"provider": AI_PROVIDER, "model": _model_name(), "valid": True}
    return payload


def _model_name() -> str:
    if AI_PROVIDER == "anthropic":
        return os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
    if AI_PROVIDER == "groq":
        return os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
    return "mock"


def _mock_proposals(parsed_race: dict, size: int) -> dict:
    """Deterministic fallback that builds 4 plausible proposals from PDF data
    alone — useful when no LLM key is configured. Uses LONAB favoris as the
    Sécurité/Recommandé backbone and outsiders for Audace."""
    favoris = parsed_race.get("favoris") or []
    outsiders = parsed_race.get("outsiders") or []
    bigOuts = parsed_race.get("bigOutsiders") or []
    apt = parsed_race.get("aptitudes") or {}
    classe = apt.get("classe") or []

    def take(lst, n):
        return [x for x in lst if isinstance(x, int)][:n]

    def fill(seed: list[int], pool: list[int], n: int) -> list[int]:
        result = list(dict.fromkeys(seed))
        for x in pool:
            if len(result) >= n:
                break
            if x not in result:
                result.append(x)
        return result[:n]

    fav_pool = favoris or list(range(1, 17))
    secu = fill(favoris, fav_pool, size)
    valeur_seed = (classe or favoris)[:1] + favoris
    valeur = fill(valeur_seed, fav_pool, size)
    audace_seed = (outsiders + bigOuts)[:1] + favoris
    audace = fill(audace_seed, fav_pool + outsiders + bigOuts, size)
    reco = fill(favoris[:2] + (classe[:1] or []), fav_pool + classe, size)

    base = favoris[0] if favoris else (secu[0] if secu else 1)
    outsider = (outsiders[0] if outsiders else (bigOuts[0] if bigOuts else (favoris[-1] if favoris else 1)))

    return {
        "proposals": [
            {"strategy": "SECURITE", "label": "🛡️ Sécurité", "selections": secu, "base": base, "outsider": outsider, "confidence": 80, "reasoning": "Consensus des 6 publications du PDF LONAB et de la ligne FAVORIS."},
            {"strategy": "VALEUR", "label": "💎 Valeur", "selections": valeur, "base": valeur[0] if valeur else base, "outsider": outsider, "confidence": 60, "reasoning": "Mix entre la classe et le consensus — équilibre risque/rendement."},
            {"strategy": "AUDACE", "label": "🎯 Audace", "selections": audace, "base": audace[0] if audace else base, "outsider": outsider, "confidence": 40, "reasoning": "Ouverture vers les outsiders identifiés par la LONAB."},
            {"strategy": "RECOMMANDE", "label": "⭐ Recommandé", "selections": reco, "base": base, "outsider": outsider, "confidence": 75, "reasoning": "Synthèse pondérée privilégiant la cohérence des sources."},
        ],
        "globalCommentary": "Pronostic généré sans IA (mode mock). Configure AI_PROVIDER + clé API pour activer l'analyse complète. Les sélections ci-dessus reposent sur la ligne FAVORIS officielle de la LONAB et le classement des aptitudes du PDF.",
        "globalConfidence": 65,
        "meta": {"provider": "mock", "model": "mock", "valid": True},
    }

