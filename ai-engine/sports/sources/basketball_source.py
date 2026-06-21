"""
BasketballSource — fetches structured basketball data from API-Basketball (api-sports.io).

Environment variables:
    BASKETBALL_API_KEY   — api-sports.io key (required for live data; same key as football)
    BASKETBALL_API_BASE  — base URL (default: https://v2.nba.api-sports.io)

Default leagues (numeric IDs passed by the pipeline from setting basketball_leagues):
    12   NBA
    120  EuroLeague

Caching: same strategy as FootballSource — per-day JSON files under
_sports_cache/BASKETBALL/<YYYY-MM-DD>/<hash>.json.

Additional data vs football source: points scored/conceded per game (needed to
estimate offensive and defensive efficiency for the basketball model).
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import date
from pathlib import Path

import aiohttp
from loguru import logger

from sports.base import SportSource

_BASE_URL = os.getenv("BASKETBALL_API_BASE", "https://v2.nba.api-sports.io")
_CACHE_ROOT = Path("./_sports_cache/BASKETBALL")
_REQUEST_DELAY = 0.3  # seconds between API calls


def _cache_path(endpoint: str, params: dict) -> Path:
    key = json.dumps({"ep": endpoint, **params}, sort_keys=True)
    h = hashlib.md5(key.encode()).hexdigest()[:12]
    return _CACHE_ROOT / date.today().isoformat() / f"{h}.json"


def _current_season(ref: date) -> str:
    """Return the NBA season year for v2.nba.api-sports.io.

    The NBA API uses a single year (start of season):
        Oct 2024 – Jun 2025  →  "2024"
        Jul–Sep 2025         →  offseason, anticipate "2025"
    """
    if ref.month >= 10:
        return str(ref.year)
    elif ref.month <= 6:
        return str(ref.year - 1)
    else:
        # July–September: offseason, anticipate next season
        return str(ref.year)


class BasketballSource(SportSource):
    """API-Basketball adapter. Instantiate once per pipeline run."""

    def _headers(self) -> dict[str, str]:
        key = os.getenv("BASKETBALL_API_KEY", "")
        if not key:
            logger.warning("[BasketballSource] BASKETBALL_API_KEY manquante — données live indisponibles")
        return {"x-apisports-key": key}

    async def _get(self, session: aiohttp.ClientSession, endpoint: str, params: dict) -> dict:
        """Cached GET with per-day file cache."""
        import asyncio

        cache_file = _cache_path(endpoint, params)
        if cache_file.exists():
            logger.debug(f"[BasketballSource] Cache hit: {cache_file.name}")
            return json.loads(cache_file.read_text(encoding="utf-8"))

        url = f"{_BASE_URL}/{endpoint}"
        await asyncio.sleep(_REQUEST_DELAY)
        async with session.get(
            url,
            params=params,
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            resp.raise_for_status()
            data = await resp.json()

        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(data), encoding="utf-8")
        logger.debug(f"[BasketballSource] Fetched + cached: {endpoint} {params}")
        return data

    # ── Public interface ────────────────────────────────────────────────────

    async def list_events(self, target_date: date, leagues: list[str]) -> list[dict]:
        """Return all games scheduled on target_date for the requested league IDs."""
        if not os.getenv("BASKETBALL_API_KEY"):
            return []

        season = _current_season(target_date)
        events: list[dict] = []

        async with aiohttp.ClientSession() as session:
            for league_id in leagues:
                try:
                    data = await self._get(session, "games", {
                        "date":   target_date.isoformat(),
                        "league": str(league_id),
                        "season": season,
                    })
                    for item in data.get("response", []):
                        game   = item.get("game", item)   # API-Basketball wraps differently
                        league = item.get("league", {})
                        teams  = item.get("teams", {})
                        home   = teams.get("home", {})
                        away   = teams.get("away", {})

                        # Kickoff: "HH:MM" from ISO-8601 date field
                        raw_date = item.get("date", "")
                        kickoff = raw_date[11:16] if len(raw_date) >= 16 else "00:00"

                        events.append({
                            "external_id":  str(item.get("id", "")),
                            "league":       league.get("name", ""),
                            "league_id":    league.get("id", league_id),
                            "home_team":    home.get("name", ""),
                            "home_team_id": home.get("id"),
                            "away_team":    away.get("name", ""),
                            "away_team_id": away.get("id"),
                            "kickoff":      kickoff,
                            "date":         target_date,
                            "status":       item.get("status", {}).get("short", "NS"),
                        })
                except Exception as exc:
                    logger.error(f"[BasketballSource] list_events league={league_id}: {exc}")

        return events

    async def team_form(self, team_id: int | str) -> dict:
        """Return form data for the last 10 games, including points scored/allowed.

        The basketball model uses points_scored_avg and points_conceded_avg to
        estimate offensive and defensive efficiency (adjusted for pace).
        """
        if not os.getenv("BASKETBALL_API_KEY"):
            return _empty_form(team_id)

        season = _current_season(date.today())
        async with aiohttp.ClientSession() as session:
            try:
                data = await self._get(session, "games", {
                    "team":   str(team_id),
                    "last":   "10",
                    "season": season,
                })
                return _parse_basketball_form(int(team_id), data.get("response", []))
            except Exception as exc:
                logger.error(f"[BasketballSource] team_form team={team_id}: {exc}")
                return _empty_form(team_id)

    async def head_to_head(self, team_a_id: int | str, team_b_id: int | str) -> list[dict]:
        """Return last 10 H2H games between two teams."""
        if not os.getenv("BASKETBALL_API_KEY"):
            return []

        async with aiohttp.ClientSession() as session:
            try:
                data = await self._get(session, "games/h2h", {
                    "h2h":  f"{team_a_id}-{team_b_id}",
                    "last": "10",
                })
                return _parse_basketball_h2h(data.get("response", []))
            except Exception as exc:
                logger.error(f"[BasketballSource] head_to_head {team_a_id}-{team_b_id}: {exc}")
                return []

    async def standings(self, league_id: int | str) -> list[dict]:
        """Return current standings for a basketball league."""
        if not os.getenv("BASKETBALL_API_KEY"):
            return []

        season = _current_season(date.today())
        async with aiohttp.ClientSession() as session:
            try:
                data = await self._get(session, "standings", {
                    "league": str(league_id),
                    "season": season,
                })
                return [_parse_basketball_standing(e) for e in data.get("response", [])]
            except Exception as exc:
                logger.error(f"[BasketballSource] standings league={league_id}: {exc}")
                return []

    async def event_odds(self, event_id: int | str) -> dict:
        """Return decimal odds: moneyline home/away + over/under line."""
        if not os.getenv("BASKETBALL_API_KEY"):
            return {}

        async with aiohttp.ClientSession() as session:
            try:
                data = await self._get(session, "odds", {
                    "game": str(event_id),
                })
                return _parse_basketball_odds(data.get("response", []))
            except Exception as exc:
                logger.error(f"[BasketballSource] event_odds game={event_id}: {exc}")
                return {}


# ── Private parsers ─────────────────────────────────────────────────────────

def _parse_basketball_form(team_id: int, games: list[dict]) -> dict:
    """Summarise last N games into form stats with offensive/defensive averages."""
    last_matches = []
    wins = losses = total_scored = total_conceded = 0
    form_chars = []

    for g in games:
        teams  = g.get("teams", {})
        scores = g.get("scores", {})

        is_home = teams.get("home", {}).get("id") == team_id
        home_pts = _total_points(scores.get("home", {}))
        away_pts = _total_points(scores.get("away", {}))

        if home_pts is None or away_pts is None:
            continue  # game not finished

        pts_for     = home_pts if is_home else away_pts
        pts_against = away_pts if is_home else home_pts

        won = pts_for > pts_against
        if won:
            wins += 1; form_chars.append("W")
        else:
            losses += 1; form_chars.append("L")

        total_scored    += pts_for
        total_conceded  += pts_against
        n = len(last_matches) + 1

        last_matches.append({
            "date":          g.get("date", "")[:10],
            "result":        "W" if won else "L",
            "points_for":    pts_for,
            "points_against": pts_against,
            "is_home":       is_home,
        })

    n = len(last_matches) or 1
    return {
        "team_id":              team_id,
        "last_matches":         last_matches,
        "wins":                 wins,
        "draws":                0,   # no draws in basketball
        "losses":               losses,
        "goals_scored":         total_scored,    # named goals_* for interface compat
        "goals_conceded":       total_conceded,
        "points_scored_avg":    round(total_scored / n, 2),
        "points_conceded_avg":  round(total_conceded / n, 2),
        "form_string":          "".join(form_chars[-5:]),
    }


def _total_points(score_obj: dict) -> int | None:
    """Sum quarter scores into a total. Returns None if incomplete."""
    total = score_obj.get("total")
    if total is not None:
        try:
            return int(total)
        except (TypeError, ValueError):
            pass
    # Fallback: sum quarters
    quarters = [score_obj.get(f"quarter_{i}") for i in range(1, 5)]
    if all(q is not None for q in quarters):
        try:
            return sum(int(q) for q in quarters)
        except (TypeError, ValueError):
            pass
    return None


def _parse_basketball_h2h(games: list[dict]) -> list[dict]:
    result = []
    for g in games:
        teams  = g.get("teams", {})
        scores = g.get("scores", {})
        result.append({
            "date":       g.get("date", "")[:10],
            "home_team":  teams.get("home", {}).get("name", ""),
            "home_score": _total_points(scores.get("home", {})),
            "away_score": _total_points(scores.get("away", {})),
            "away_team":  teams.get("away", {}).get("name", ""),
        })
    return result


def _parse_basketball_standing(entry: dict) -> dict:
    team    = entry.get("team", {})
    games   = entry.get("games", {})
    points  = entry.get("points", {})
    return {
        "rank":          entry.get("position"),
        "team":          team.get("name", ""),
        "team_id":       team.get("id"),
        "wins":          games.get("win", {}).get("total"),
        "losses":        games.get("lose", {}).get("total"),
        "draws":         0,
        "points":        None,   # basketball standings use W-L, not points
        "played":        (games.get("win", {}).get("total") or 0) +
                         (games.get("lose", {}).get("total") or 0),
        "goals_for":     points.get("for"),
        "goals_against": points.get("against"),
        "goal_diff":     None,
    }


def _parse_basketball_odds(response: list[dict]) -> dict:
    """Extract moneyline and over/under odds from API-Basketball response."""
    odds: dict = {}
    if not response:
        return odds

    bookmakers = response[0].get("bookmakers", [])
    bm = bookmakers[0] if bookmakers else {}

    for bet in bm.get("bets", []):
        name   = bet.get("name", "")
        values = bet.get("values", [])

        if name in ("Home/Away", "Money Line", "Moneyline"):
            for v in values:
                label = v.get("value", "")
                try:
                    odd = float(v["odd"])
                except (KeyError, ValueError):
                    continue
                if label == "Home":
                    odds["home"] = odd
                elif label == "Away":
                    odds["away"] = odd

        elif "Over/Under" in name or name == "Total":
            # e.g. "Over/Under 220.5"
            for v in values:
                label = v.get("value", "")   # "Over 220.5" or "Under 220.5"
                try:
                    odd = float(v["odd"])
                except (KeyError, ValueError):
                    continue
                if label.startswith("Over"):
                    parts = label.split()
                    line  = parts[1] if len(parts) > 1 else "0"
                    odds[f"over_{line}"] = odd

    return odds


def _empty_form(team_id) -> dict:
    return {
        "team_id": team_id, "last_matches": [], "wins": 0,
        "draws": 0, "losses": 0, "goals_scored": 0,
        "goals_conceded": 0, "points_scored_avg": 0.0,
        "points_conceded_avg": 0.0, "form_string": "",
    }
