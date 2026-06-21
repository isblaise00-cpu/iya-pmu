"""
Sports LLM analyzer — analyse qualitative d'un événement sportif via Claude ou Groq.

Même provider-pattern que analyzer.py hippique :
  AI_PROVIDER=anthropic|groq|mock  (défaut: anthropic)
  ANTHROPIC_MODEL, GROQ_MODEL via env

Principe NON NÉGOCIABLE :
  Claude reçoit les probabilités du modèle statistique et doit les utiliser
  EXACTEMENT. Il fournit l'analyse qualitative (forme, domicile, enjeux,
  back-to-back) et le repérage des value bets — il n'invente aucun chiffre.

Sortie garantie :
  {
    "predictions": [{"market", "label", "model_prob", "recommended", "rationale"}],
    "value_bets":  [...],   // identiques à ceux du modèle statistique
    "confidence":  int,     // 0-100 : cohérence des signaux, pas certitude du résultat
    "commentary":  str      // 2-4 phrases en français
  }
"""
from __future__ import annotations

import json
import os

from loguru import logger

# ── Prompt football ──────────────────────────────────────────────────────────

_FOOTBALL_PROMPT = """\
Tu es un expert en analyse de matchs de football. Tu vas rédiger une analyse qualitative \
en utilisant EXACTEMENT les probabilités calculées par le modèle statistique ci-dessous — \
tu n'inventes ou ne recalcules AUCUN chiffre.

DONNÉES DU MATCH :
{match_json}

RÈGLES IMPÉRATIVES :
1. Utilise EXACTEMENT les valeurs de "PROBABILITÉS_MODÈLE_NE_PAS_MODIFIER" dans predictions.model_prob.
2. predictions doit contenir au moins ces marchés : 1 (victoire domicile), X (nul), 2 (victoire extérieur), over_2_5, btts.
3. recommended = true uniquement si le modèle affiche > 55 % ET le contexte qualitatif confirme.
4. value_bets = reprends EXACTEMENT la liste "value_bets_modèle" fournie (ne la recalcule pas).
5. confidence (0-100) = cohérence des signaux (forme + H2H + classement), pas la certitude du résultat.
6. commentary = 2 à 4 phrases en français : forme récente des équipes, avantage domicile/extérieur, enjeux du match, H2H notable.
7. JSON valide uniquement — sans markdown, sans ```, sans commentaire.

Réponds UNIQUEMENT avec ce JSON :
{{
  "predictions": [
    {{"market": "1",        "label": "Victoire {home}",              "model_prob": 0.0, "recommended": false, "rationale": "..."}},
    {{"market": "X",        "label": "Match nul",                    "model_prob": 0.0, "recommended": false, "rationale": "..."}},
    {{"market": "2",        "label": "Victoire {away}",              "model_prob": 0.0, "recommended": false, "rationale": "..."}},
    {{"market": "over_2_5", "label": "Plus de 2.5 buts",            "model_prob": 0.0, "recommended": false, "rationale": "..."}},
    {{"market": "btts",     "label": "Les deux équipes marquent",    "model_prob": 0.0, "recommended": false, "rationale": "..."}}
  ],
  "value_bets": [],
  "confidence": 0,
  "commentary": ""
}}
"""

# ── Prompt basketball ────────────────────────────────────────────────────────

_BASKETBALL_PROMPT = """\
Tu es un expert en analyse de matchs de basketball. Tu vas rédiger une analyse qualitative \
en utilisant EXACTEMENT les probabilités calculées par le modèle statistique ci-dessous — \
tu n'inventes ou ne recalcules AUCUN chiffre.

DONNÉES DU MATCH :
{match_json}

RÈGLES IMPÉRATIVES :
1. Utilise EXACTEMENT les valeurs de "PROBABILITÉS_MODÈLE_NE_PAS_MODIFIER" dans predictions.model_prob.
2. predictions doit contenir : home (moneyline domicile), away (moneyline extérieur), over (total points).
   Ajoute spread_home si un spread est disponible dans les données.
3. recommended = true uniquement si le modèle affiche > 60 % ET le contexte qualitatif confirme.
4. value_bets = reprends EXACTEMENT la liste "value_bets_modèle" fournie (ne la recalcule pas).
5. confidence (0-100) = cohérence des signaux (forme, back-to-back, avantage domicile, H2H).
6. commentary = 2 à 4 phrases en français : forme récente, fatigue/back-to-back, avantage de terrain, H2H notable.
7. JSON valide uniquement — sans markdown, sans ```, sans commentaire.

Réponds UNIQUEMENT avec ce JSON :
{{
  "predictions": [
    {{"market": "home",  "label": "Victoire {home}",         "model_prob": 0.0, "recommended": false, "rationale": "..."}},
    {{"market": "away",  "label": "Victoire {away}",         "model_prob": 0.0, "recommended": false, "rationale": "..."}},
    {{"market": "over",  "label": "Total over {ou_line}",    "model_prob": 0.0, "recommended": false, "rationale": "..."}}
  ],
  "value_bets": [],
  "confidence": 0,
  "commentary": ""
}}
"""


# ── Public entry point ───────────────────────────────────────────────────────

async def analyze_event(
    sport: str,
    event_data: dict,
    model_probs: dict,
    value_bets_data: list,
) -> dict:
    """Analyse qualitative d'un événement sportif via LLM.

    Args:
        sport:           "FOOTBALL" | "BASKETBALL"
        event_data:      dict complet (event, home_form, away_form, h2h, standings, odds)
        model_probs:     sortie brute de SportModel.compute()
        value_bets_data: sortie de SportModel.value_bets()

    Returns:
        {predictions, value_bets, confidence, commentary}
    """
    provider = os.getenv("AI_PROVIDER", "anthropic").lower()

    match_json = _build_match_json(sport, event_data, model_probs, value_bets_data)
    prompt     = _build_prompt(sport, event_data, match_json)

    if provider == "mock" or (
        provider == "anthropic" and not os.getenv("ANTHROPIC_API_KEY")
    ) or (
        provider == "groq" and not os.getenv("GROQ_API_KEY")
    ):
        logger.warning(f"[SportsAnalyzer] Provider {provider!r} sans clé — mock déterministe.")
        return _mock_analyze(sport, event_data, model_probs, value_bets_data)

    try:
        if provider == "groq":
            raw = await _call_groq(prompt)
        else:
            raw = await _call_anthropic(prompt)
        result = _parse_json(raw)
        _validate(result)
        return result
    except Exception as exc:
        logger.error(f"[SportsAnalyzer] LLM error ({provider}): {exc} — fallback mock.")
        return _mock_analyze(sport, event_data, model_probs, value_bets_data)


# ── LLM calls ────────────────────────────────────────────────────────────────

async def _call_anthropic(prompt: str) -> str:
    from anthropic import AsyncAnthropic
    client = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    response = await client.messages.create(
        model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


async def _call_groq(prompt: str) -> str:
    from groq import AsyncGroq
    client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))
    response = await client.chat.completions.create(
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        messages=[{"role": "user", "content": prompt}],
        max_tokens=2048,
        response_format={"type": "json_object"},
    )
    return response.choices[0].message.content


# ── Prompt builders ──────────────────────────────────────────────────────────

def _build_prompt(sport: str, event_data: dict, match_json: str) -> str:
    event = event_data.get("event", {})
    home  = event.get("home_team", "Domicile")
    away  = event.get("away_team", "Extérieur")
    template = _FOOTBALL_PROMPT if sport == "FOOTBALL" else _BASKETBALL_PROMPT
    ou_line = event_data.get("model_probs_cache", {}).get("ou_line", "?")
    return template.format(
        match_json=match_json,
        home=home,
        away=away,
        ou_line=ou_line,
    )


def _build_match_json(
    sport: str,
    event_data: dict,
    model_probs: dict,
    value_bets_data: list,
) -> str:
    """Serialize relevant event data into a compact French-labelled JSON for the prompt."""
    event     = event_data.get("event", {})
    hf        = event_data.get("home_form", {})
    af        = event_data.get("away_form", {})
    h2h       = event_data.get("h2h", [])[:5]
    standings = event_data.get("standings", [])
    odds_raw  = event_data.get("odds", {})
    # Sépare les cotes numériques des prédictions ML BSD (sous-clé "bsd")
    bsd_preds = odds_raw.get("bsd") if isinstance(odds_raw, dict) else None
    odds      = {k: v for k, v in odds_raw.items() if k != "bsd"}

    home_name = event.get("home_team", "")
    away_name = event.get("away_team", "")

    # Standing positions for the two teams
    home_rank = next((s["rank"] for s in standings if s.get("team") == home_name), None)
    away_rank = next((s["rank"] for s in standings if s.get("team") == away_name), None)

    if sport == "FOOTBALL":
        form_section = {
            "forme_domicile": _football_form_summary(hf),
            "forme_extérieur": _football_form_summary(af),
        }
    else:
        form_section = {
            "forme_domicile": _basketball_form_summary(hf),
            "forme_extérieur": _basketball_form_summary(af),
        }

    h2h_lines = [
        f"{m.get('home_team')} {m.get('home_score')}-{m.get('away_score')} "
        f"{m.get('away_team')} ({m.get('date', '')[:10]})"
        for m in h2h
    ]

    data = {
        "match": {
            "compétition":  event.get("league", ""),
            "domicile":     home_name,
            "extérieur":    away_name,
            "heure":        event.get("kickoff", ""),
            "classement":   {home_name: home_rank, away_name: away_rank},
        },
        **form_section,
        "historique_h2h": h2h_lines if h2h_lines else ["Pas d'historique disponible"],
        "cotes_marché":   odds,
        # Claude MUST copy these values exactly into predictions.model_prob
        "PROBABILITÉS_MODÈLE_NE_PAS_MODIFIER": model_probs,
        "value_bets_modèle": value_bets_data,
    }
    # Ajoute les prédictions CatBoost BSD si disponibles (enrichissement facultatif)
    if bsd_preds:
        data["prédictions_ia_bsd"] = bsd_preds
    return json.dumps(data, ensure_ascii=False, indent=2)


def _football_form_summary(form: dict) -> dict:
    matches = form.get("last_matches", [])
    n = max(len(matches), 1)
    return {
        "5_derniers":          form.get("form_string", "N/A"),
        "buts_marqués_moy":    round(form.get("goals_scored", 0) / n, 2),
        "buts_encaissés_moy":  round(form.get("goals_conceded", 0) / n, 2),
    }


def _basketball_form_summary(form: dict) -> dict:
    matches = form.get("last_matches", [])
    n = max(len(matches), 1)
    return {
        "5_derniers":          form.get("form_string", "N/A"),
        "pts_marqués_moy":     form.get("points_scored_avg", round(form.get("goals_scored", 0) / n, 2)),
        "pts_encaissés_moy":   form.get("points_conceded_avg", round(form.get("goals_conceded", 0) / n, 2)),
    }


# ── JSON parsing & validation ────────────────────────────────────────────────

def _parse_json(raw: str) -> dict:
    raw = raw.strip()
    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    return json.loads(raw)


def _validate(result: dict) -> None:
    """Raise ValueError if required keys are missing."""
    for key in ("predictions", "value_bets", "confidence", "commentary"):
        if key not in result:
            raise ValueError(f"Clé manquante dans la réponse LLM : {key!r}")
    if not isinstance(result["predictions"], list) or not result["predictions"]:
        raise ValueError("predictions doit être une liste non vide")
    if not isinstance(result["confidence"], int) or not (0 <= result["confidence"] <= 100):
        raise ValueError(f"confidence invalide : {result['confidence']}")


# ── Deterministic mock fallback ───────────────────────────────────────────────

def _mock_analyze(
    sport: str,
    event_data: dict,
    model_probs: dict,
    value_bets_data: list,
) -> dict:
    """Fallback déterministe — utilisé quand la clé API est absente ou le parsing échoue.

    Génère des predictions cohérentes avec model_probs sans appel LLM.
    """
    event = event_data.get("event", {})
    home  = event.get("home_team", "Domicile")
    away  = event.get("away_team", "Extérieur")

    if sport == "FOOTBALL":
        p1 = model_probs.get("prob_1", 1 / 3)
        px = model_probs.get("prob_x", 1 / 3)
        p2 = model_probs.get("prob_2", 1 / 3)
        po = model_probs.get("prob_over_2_5", 0.50)
        pb = model_probs.get("prob_btts", 0.40)
        xs = model_probs.get("expected_score", ["-", "-"])

        predictions = [
            {"market": "1",        "label": f"Victoire {home}",           "model_prob": round(p1, 4), "recommended": p1 > 0.55, "rationale": "Basé sur la force relative des équipes."},
            {"market": "X",        "label": "Match nul",                   "model_prob": round(px, 4), "recommended": px > 0.38, "rationale": "Niveau d'incertitude estimé par le modèle."},
            {"market": "2",        "label": f"Victoire {away}",           "model_prob": round(p2, 4), "recommended": p2 > 0.55, "rationale": "Basé sur la forme récente de l'équipe."},
            {"market": "over_2_5", "label": "Plus de 2.5 buts",           "model_prob": round(po, 4), "recommended": po > 0.55, "rationale": "Estimation basée sur les attaques et défenses."},
            {"market": "btts",     "label": "Les deux équipes marquent",   "model_prob": round(pb, 4), "recommended": pb > 0.55, "rationale": "Basé sur les efficacités offensives."},
        ]
        commentary = (
            f"Le modèle statistique estime {round(p1 * 100)}% de victoire pour {home}, "
            f"{round(px * 100)}% pour le nul et {round(p2 * 100)}% pour {away}. "
            f"Score attendu : {xs[0]}-{xs[1]}. "
            "Configurez AI_PROVIDER et ANTHROPIC_API_KEY pour une analyse qualitative complète."
        )
        conf_base = max(p1, px, p2)

    else:  # BASKETBALL
        ph = model_probs.get("prob_home", 0.50)
        pa = model_probs.get("prob_away", 0.50)
        po = model_probs.get("prob_over", 0.50)
        xt = model_probs.get("expected_total", "?")
        xm = model_probs.get("expected_margin", "?")
        xl = model_probs.get("ou_line")
        xph = model_probs.get("xPts_home", "?")
        xpa = model_probs.get("xPts_away", "?")
        ou_label = f"over {xl}" if xl else "over total"

        predictions = [
            {"market": "home", "label": f"Victoire {home}", "model_prob": round(ph, 4), "recommended": ph > 0.60, "rationale": "Estimé par le modèle d'efficacité ajusté au pace."},
            {"market": "away", "label": f"Victoire {away}", "model_prob": round(pa, 4), "recommended": pa > 0.60, "rationale": "Estimé par le modèle d'efficacité ajusté au pace."},
            {"market": "over",  "label": f"Total {ou_label}", "model_prob": round(po, 4), "recommended": po > 0.60, "rationale": "Basé sur les efficacités offensives et défensives."},
        ]
        commentary = (
            f"Le modèle prédit {round(ph * 100)}% de victoire pour {home} "
            f"avec un écart attendu de {xm} pts ({xph}-{xpa}). "
            f"Total de points attendu : {xt}. "
            "Configurez AI_PROVIDER et ANTHROPIC_API_KEY pour une analyse qualitative complète."
        )
        conf_base = max(ph, pa)

    # confidence = cohérence approximée par la probabilité dominante (50→95 range)
    confidence = min(95, max(50, int(conf_base * 100)))

    return {
        "predictions": predictions,
        "value_bets":  value_bets_data,
        "confidence":  confidence,
        "commentary":  commentary,
    }
