"""
Sport registry — maps sport codes to their (SportSource, SportModel) classes.

To add a new sport:
  1. Create sports/sources/<sport>_source.py  (subclass SportSource)
  2. Create sports/models/<sport>_model.py    (subclass SportModel)
  3. Add one entry to _REGISTRY below.
  4. Add the new sport's scheduler job in scheduler.py.

Nothing else in the pipeline changes.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .base import SportSource, SportModel


# Lazy imports prevent circular deps and avoid loading unused adapters at startup.
def _build_registry() -> dict[str, tuple[type, type]]:
    from .sources.football_source import FootballSource
    from .sources.basketball_source import BasketballSource
    from .models.football_model import FootballModel
    from .models.basketball_model import BasketballModel

    return {
        "FOOTBALL":   (FootballSource, FootballModel),
        "BASKETBALL": (BasketballSource, BasketballModel),
    }


def known_sports() -> list[str]:
    """Return the list of registered sport codes."""
    return list(_build_registry().keys())


def get_source(sport: str) -> "SportSource":
    """Instantiate and return the data source for the given sport."""
    reg = _build_registry()
    if sport not in reg:
        raise ValueError(f"Sport inconnu : {sport!r}. Sports disponibles : {list(reg)}")
    source_cls, _ = reg[sport]
    return source_cls()


def get_model(sport: str) -> "SportModel":
    """Instantiate and return the statistical model for the given sport."""
    reg = _build_registry()
    if sport not in reg:
        raise ValueError(f"Sport inconnu : {sport!r}. Sports disponibles : {list(reg)}")
    _, model_cls = reg[sport]
    return model_cls()
