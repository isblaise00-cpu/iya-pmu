"""
FootballModel — Dixon-Coles bivariate Poisson with low-score correction.

Algorithm
---------
1. Extract attack / defense indices from the last-N form matches using
   exponential temporal decay (most recent match = weight 1.0, older
   matches decay at rate DECAY per step).
2. Compute expected goals (λ_home, λ_away) from team indices, league
   average, and a home-advantage multiplier.
3. Build an (MAX_GOALS+1)² score probability matrix, applying the
   Dixon-Coles τ correction to the 2×2 low-score corner
   (scores 0-0, 1-0, 0-1, 1-1 occur more often than independent Poisson).
4. Derive 1X2, over-2.5, BTTS, and expected score from the matrix.
5. Optionally blend with H2H historical results (H2H_WEIGHT = 15 %).

Claude receives the output of compute() and must use these numbers exactly
— it never recalculates probabilities itself.
"""
from __future__ import annotations

import math

import numpy as np
from scipy.stats import poisson

from sports.base import SportModel

# ── Model hyperparameters ──────────────────────────────────────────────────

_LEAGUE_AVG  = 1.35   # average goals per team per game (European leagues)
_HOME_ADV    = 1.15   # home attack multiplier
_RHO         = -0.13  # Dixon-Coles low-score correlation (typically −0.13 to −0.10)
_DECAY       = 0.15   # exponential decay per match step (most recent index 0 → 1.0)
_MAX_GOALS   = 10     # Poisson truncation (covers > 99.99 % of probability mass)
_H2H_WEIGHT  = 0.15   # blend weight for H2H historical rates
_MIN_MATCHES = 3      # min matches to trust form; falls back to league avg below


class FootballModel(SportModel):
    """Dixon-Coles bivariate Poisson model with low-score correction and H2H blend."""

    def compute(self, event_data: dict) -> dict:  # noqa: D401
        home_form = event_data.get("home_form", {})
        away_form = event_data.get("away_form", {})
        h2h       = event_data.get("h2h", [])
        home_name = event_data.get("event", {}).get("home_team", "")

        # Step 1 — weighted attack / defense (goals per game) ---------------
        home_att, home_def = _weighted_goals(home_form)
        away_att, away_def = _weighted_goals(away_form)

        # Normalize to league-average indices (1.0 = league average)
        home_att_idx = _clamp(home_att / _LEAGUE_AVG)
        home_def_idx = _clamp(home_def / _LEAGUE_AVG)
        away_att_idx = _clamp(away_att / _LEAGUE_AVG)
        away_def_idx = _clamp(away_def / _LEAGUE_AVG)

        # Step 2 — expected goals -------------------------------------------
        # λ_home = home_attack × away_defense × league_avg × home_advantage
        # λ_away = away_attack × home_defense × league_avg
        lambda_h = _HOME_ADV * home_att_idx * away_def_idx * _LEAGUE_AVG
        lambda_a = away_att_idx * home_def_idx * _LEAGUE_AVG

        lambda_h = max(0.30, min(lambda_h, 5.0))
        lambda_a = max(0.30, min(lambda_a, 5.0))

        # Step 3 — Dixon-Coles score matrix ----------------------------------
        mat = _score_matrix(lambda_h, lambda_a, _RHO, _MAX_GOALS)

        # Step 4 — outcome probabilities -------------------------------------
        # mat[i, j] = P(home scores i goals, away scores j goals)
        # Home wins  when i > j → lower triangle  (tril k=-1)
        # Draw       when i = j → diagonal
        # Away wins  when i < j → upper triangle  (triu k=+1)
        prob_1 = float(np.tril(mat, k=-1).sum())    # home > away
        prob_x = float(np.diag(mat).sum())           # home == away
        prob_2 = float(np.triu(mat, k=1).sum())     # away > home

        # Renormalize to exactly 1.0 (τ correction can shift total slightly)
        total_12x = prob_1 + prob_x + prob_2
        if total_12x > 0:
            prob_1 /= total_12x
            prob_x /= total_12x
            prob_2 /= total_12x

        # Over 2.5 goals
        goals_matrix = np.add.outer(
            np.arange(_MAX_GOALS + 1),
            np.arange(_MAX_GOALS + 1),
        )
        prob_over_2_5 = float(mat[goals_matrix > 2].sum())

        # Both teams to score (each team scores ≥ 1)
        prob_btts = float(mat[1:, 1:].sum())

        # Expected score (probability-weighted mean goals)
        g_home = np.arange(_MAX_GOALS + 1)[:, None]
        g_away = np.arange(_MAX_GOALS + 1)[None, :]
        xh = float((mat * g_home).sum())
        xa = float((mat * g_away).sum())

        # Step 5 — H2H blend ------------------------------------------------
        if h2h:
            h2h_1, h2h_x, h2h_2 = _h2h_rates(h2h, home_name)
            prob_1 = (1 - _H2H_WEIGHT) * prob_1 + _H2H_WEIGHT * h2h_1
            prob_x = (1 - _H2H_WEIGHT) * prob_x + _H2H_WEIGHT * h2h_x
            prob_2 = (1 - _H2H_WEIGHT) * prob_2 + _H2H_WEIGHT * h2h_2

        return {
            "prob_1":        round(prob_1, 4),
            "prob_x":        round(prob_x, 4),
            "prob_2":        round(prob_2, 4),
            "prob_over_2_5": round(prob_over_2_5, 4),
            "prob_btts":     round(prob_btts, 4),
            "expected_score": [round(xh, 2), round(xa, 2)],
            # Internals surfaced for Claude's commentary
            "lambda_home":   round(lambda_h, 3),
            "lambda_away":   round(lambda_a, 3),
        }


# ── Internal helpers ────────────────────────────────────────────────────────

def _weighted_goals(form: dict) -> tuple[float, float]:
    """Return (attack_avg, defense_avg) with exponential temporal decay.

    Most recent match is index 0 → weight exp(0) = 1.0.
    Older matches decay at rate _DECAY per step.
    Falls back to (_LEAGUE_AVG, _LEAGUE_AVG) when data is sparse.
    """
    # Sort descending by date so index 0 is always the most recent
    matches = sorted(
        form.get("last_matches", []),
        key=lambda m: m.get("date", ""),
        reverse=True,
    )
    if len(matches) < _MIN_MATCHES:
        return _LEAGUE_AVG, _LEAGUE_AVG

    weights = [math.exp(-_DECAY * i) for i in range(len(matches))]
    total_w = sum(weights)

    attack  = sum(w * m["goals_for"]     for w, m in zip(weights, matches)) / total_w
    defense = sum(w * m["goals_against"] for w, m in zip(weights, matches)) / total_w

    return attack, defense


def _clamp(value: float, lo: float = 0.25, hi: float = 3.0) -> float:
    return max(lo, min(value, hi))


def _tau(i: int, j: int, lh: float, la: float, rho: float) -> float:
    """Dixon-Coles correction factor for the 2×2 low-score corner.

    Accounts for the observed excess of 0-0, 1-0, 0-1, 1-1 scorelines
    compared to independent Poisson distributions.
    """
    if i == 0 and j == 0:
        return 1.0 - lh * la * rho
    if i == 1 and j == 0:
        return 1.0 + la * rho
    if i == 0 and j == 1:
        return 1.0 + lh * rho
    if i == 1 and j == 1:
        return 1.0 - rho
    return 1.0


def _score_matrix(lh: float, la: float, rho: float, n: int) -> np.ndarray:
    """Build the (n+1)×(n+1) score probability matrix.

    mat[i, j] = P(home scores i) × P(away scores j) × τ(i, j)
    The τ correction only applies to the 2×2 corner; all other cells are
    independent Poisson products. Final matrix is renormalized to sum to 1.
    """
    idx = np.arange(n + 1)
    ph = np.array([poisson.pmf(i, lh) for i in idx])  # P(H = i)
    pa = np.array([poisson.pmf(j, la) for j in idx])  # P(A = j)
    mat = np.outer(ph, pa)

    # Apply τ to the 2×2 low-score corner
    mat[0, 0] *= _tau(0, 0, lh, la, rho)
    mat[1, 0] *= _tau(1, 0, lh, la, rho)
    mat[0, 1] *= _tau(0, 1, lh, la, rho)
    mat[1, 1] *= _tau(1, 1, lh, la, rho)

    mat = np.clip(mat, 0.0, None)
    total = mat.sum()
    if total > 0:
        mat /= total
    return mat


def _h2h_rates(h2h: list[dict], home_team: str) -> tuple[float, float, float]:
    """Historical 1X2 rates from H2H records, from the current home team's perspective."""
    wins = draws = losses = 0
    for m in h2h:
        hs = m.get("home_score")
        as_ = m.get("away_score")
        if hs is None or as_ is None:
            continue
        is_home_side = m.get("home_team", "") == home_team
        gf = hs if is_home_side else as_
        ga = as_ if is_home_side else hs
        if gf > ga:
            wins += 1
        elif gf == ga:
            draws += 1
        else:
            losses += 1
    total = wins + draws + losses
    if total == 0:
        return 1 / 3, 1 / 3, 1 / 3
    return wins / total, draws / total, losses / total
