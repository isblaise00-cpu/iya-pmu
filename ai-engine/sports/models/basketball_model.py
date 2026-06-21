"""
BasketballModel — pace-adjusted efficiency model with normal-distribution win probability.

Algorithm
---------
1. Apply exponential temporal decay to recent game logs to compute weighted
   offensive efficiency (points scored per game) and defensive efficiency
   (points allowed per game) for each team.
2. Estimate expected points for each team:
       xPts_home = (home_offense + away_defense_allowed) / 2 + home_adv / 2
       xPts_away = (away_offense + home_defense_allowed) / 2 − home_adv / 2
3. Convert the expected point margin into a win probability via the normal CDF.
   The margin of a basketball game ≈ N(μ, σ²), where σ ≈ 11–12 pts (NBA).
       P(home wins) = Φ(expected_margin / margin_std)
4. Compute over/under probability against the market line extracted from odds:
       P(total > line) = 1 − Φ((line − expected_total) / total_std)
5. Compute ATS cover probability if a spread line is present.

League-specific parameters (avg_pts, home_adv, margin_std, total_std) are
selected from _LEAGUE_PARAMS based on the league name; unknown leagues get
the "default" (mid-way between NBA and EuroLeague).

Claude receives the output of compute() and must use these numbers exactly.
"""
from __future__ import annotations

import math

import numpy as np
from scipy.stats import norm

from sports.base import SportModel

# ── League-specific hyperparameters ────────────────────────────────────────
# Key = substring of the league name (lower-case). First match wins.

_LEAGUE_PARAMS: dict[str, dict] = {
    "nba": {
        "avg_pts":    225.0,  # total points per game (both teams)
        "home_adv":     3.5,  # home court advantage (pts)
        "margin_std":  11.0,  # std dev of final margin   (used for win prob)
        "total_std":   14.0,  # std dev of total points   (used for O/U prob)
    },
    "euroleague": {
        "avg_pts":    165.0,
        "home_adv":     3.0,
        "margin_std":  10.0,
        "total_std":   13.0,
    },
    "default": {
        "avg_pts":    190.0,
        "home_adv":     3.0,
        "margin_std":  11.0,
        "total_std":   14.0,
    },
}

_DECAY     = 0.12  # exponential decay per match step (most recent index 0 → 1.0)
_MIN_GAMES = 3     # minimum games required to trust efficiency data


class BasketballModel(SportModel):
    """Pace-adjusted efficiency model with normal-distribution win / O/U probabilities."""

    def compute(self, event_data: dict) -> dict:  # noqa: D401
        event      = event_data.get("event", {})
        home_form  = event_data.get("home_form", {})
        away_form  = event_data.get("away_form", {})
        odds       = event_data.get("odds", {})
        league_key = event.get("league", "").lower()
        p          = _league_params(league_key)

        # Per-team share of league average (points per game per team)
        half_avg = p["avg_pts"] / 2.0

        # Step 1 — weighted offensive / defensive efficiency -----------------
        home_off, home_def = _weighted_efficiency(home_form, half_avg)
        away_off, away_def = _weighted_efficiency(away_form, half_avg)

        # Step 2 — expected points ------------------------------------------
        # Each team's expected output = average of own offense and opponent defense,
        # then shift by half the home-court advantage.
        xPts_home = (home_off + away_def) / 2.0 + p["home_adv"] / 2.0
        xPts_away = (away_off + home_def) / 2.0 - p["home_adv"] / 2.0

        expected_total  = xPts_home + xPts_away
        expected_margin = xPts_home - xPts_away  # positive = home team favored

        # Step 3 — win probability via normal CDF ---------------------------
        # Y = (home_pts − away_pts) ~ N(expected_margin, margin_std²)
        # P(home wins) = P(Y > 0) = Φ(expected_margin / margin_std)
        prob_home = float(norm.cdf(expected_margin / p["margin_std"]))
        prob_away = 1.0 - prob_home

        # Step 4 — over/under probability ------------------------------------
        # Find market O/U line from odds (key format: "over_<line>")
        ou_line = _extract_ou_line(odds)
        if ou_line is not None:
            # P(total > line) = 1 − Φ((line − expected_total) / total_std)
            prob_over = float(1.0 - norm.cdf(
                (ou_line - expected_total) / p["total_std"]
            ))
        else:
            prob_over = 0.5  # neutral when no market line available

        # Step 5 — ATS cover probability (spread, if present) ---------------
        spread_line = _extract_spread_line(odds)
        if spread_line is not None:
            # spread_line > 0 means home team favored by that many pts
            # P(home covers) = P(margin > spread) = 1 − Φ((spread − margin) / std)
            cover_prob = float(1.0 - norm.cdf(
                (spread_line - expected_margin) / p["margin_std"]
            ))
        else:
            cover_prob = prob_home  # fallback to moneyline probability

        return {
            "prob_home":          round(prob_home, 4),
            "prob_away":          round(prob_away, 4),
            "expected_total":     round(expected_total, 1),
            "expected_margin":    round(expected_margin, 1),
            "prob_over":          round(prob_over, 4),
            "cover_prob_spread":  round(cover_prob, 4),
            # Internals surfaced for Claude's commentary
            "xPts_home":          round(xPts_home, 1),
            "xPts_away":          round(xPts_away, 1),
            "ou_line":            ou_line,
            "spread_line":        spread_line,
        }


# ── Internal helpers ────────────────────────────────────────────────────────

def _league_params(league_name: str) -> dict:
    """Return hyperparameter set for the detected league; defaults to 'default'."""
    for key, params in _LEAGUE_PARAMS.items():
        if key != "default" and key in league_name:
            return params
    return _LEAGUE_PARAMS["default"]


def _weighted_efficiency(form: dict, fallback: float) -> tuple[float, float]:
    """Return (weighted_offense, weighted_defense) with exponential temporal decay.

    Most recent game is index 0 → weight exp(0) = 1.0.
    Older games decay at rate _DECAY per step.
    Falls back to (fallback, fallback) — i.e., league half-average — when sparse.
    """
    # Sort descending by date so index 0 is always the most recent
    matches = sorted(
        form.get("last_matches", []),
        key=lambda m: m.get("date", ""),
        reverse=True,
    )
    if len(matches) < _MIN_GAMES:
        return fallback, fallback

    weights = [math.exp(-_DECAY * i) for i in range(len(matches))]
    total_w = sum(weights)

    off_ = sum(w * m["points_for"]     for w, m in zip(weights, matches)) / total_w
    def_ = sum(w * m["points_against"] for w, m in zip(weights, matches)) / total_w

    return off_, def_


def _extract_ou_line(odds: dict) -> float | None:
    """Find the first 'over_<line>' key in market odds and return the line value.

    Example: "over_220.5" → 220.5
    """
    for key in odds:
        if key.startswith("over_"):
            try:
                return float(key[5:])
            except ValueError:
                pass
    return None


def _extract_spread_line(odds: dict) -> float | None:
    """Find the home team spread line from market odds.

    Expected key format: "spread_home_<line>"  (e.g. "spread_home_5.5")
    Positive value = home team favored by that many points.
    Returns None when no spread key is found.
    """
    for key in odds:
        if key.startswith("spread_home_"):
            try:
                return float(key[12:])
            except ValueError:
                pass
    return None
