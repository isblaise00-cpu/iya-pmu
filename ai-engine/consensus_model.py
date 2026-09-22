"""Classement du jour : presse 70 %, cotes 30 %, sept candidats, vingt groupes.

Les scores servent uniquement à classer les sélections. Ce ne sont pas des
probabilités. Aucune base de données, aucun historique et aucun appel IA ici.
"""
from __future__ import annotations

from collections import defaultdict
from itertools import combinations
import math
import unicodedata

MODEL_VERSION = "consensus_v1"


def race_size(race_type: str) -> int:
    if not isinstance(race_type, str):
        raise ValueError("Type de course absent du programme.")
    normalized = "".join(c for c in unicodedata.normalize("NFD", race_type.upper())
                         if not unicodedata.combining(c)).replace(" ", "")
    sizes = {"TIERCE": 3, "QUARTE": 4, "QUINTE": 5, "QUINTE+": 5, "4+1": 5}
    if normalized not in sizes:
        raise ValueError(f"Type de course non reconnu : {race_type!r}")
    return sizes[normalized]


def decimal_odds(value) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        text = str(value).strip().replace(",", ".")
        if "/" in text:
            numerator, denominator = map(float, text.split("/"))
            if numerator <= 0 or denominator <= 0:
                return None
            result = 1 + numerator / denominator
        else:
            result = float(text)
        return result if math.isfinite(result) and result > 1 else None
    except (ValueError, ZeroDivisionError):
        return None


def _odds_points(odds: dict[int, float]) -> dict[int, float]:
    """5..1 points, ex aequo partageant les positions, y compris à la coupure."""
    groups = defaultdict(list)
    for number, value in odds.items():
        groups[value].append(number)
    points = {}
    position = 0
    for value in sorted(groups):
        numbers = groups[value]
        shared = sum(max(0, 5 - rank) for rank in range(position, position + len(numbers))) / len(numbers)
        points.update({number: shared for number in numbers})
        position += len(numbers)
    return points


def build_pronostic(data: dict) -> dict:
    """Valide l'extraction et ajoute les propositions calculées à ses données."""
    race = data.get("race", {})
    size = race_size(race.get("type", ""))
    horses = data.get("horses")
    if not isinstance(horses, list) or not horses:
        raise ValueError("Liste des chevaux absente du programme.")
    all_numbers = set()
    for horse in horses:
        number = horse.get("num")
        if type(number) is not int or number <= 0 or number in all_numbers:
            raise ValueError("Numéros de chevaux invalides ou dupliqués.")
        if not isinstance(horse.get("nom"), str) or not horse["nom"].strip():
            raise ValueError(f"Nom du cheval {number} absent.")
        if type(horse.get("non_partant", False)) is not bool:
            raise ValueError(f"Statut non-partant du cheval {number} invalide.")
        all_numbers.add(number)
    if type(race.get("num_concurrents")) is not int or race["num_concurrents"] <= 0:
        raise ValueError("num_concurrents absent ou invalide dans le programme.")
    # La liste des chevaux a déjà été croisée avec les cotes dans analyze_pdf :
    # len(horses) fait autorité. Un écart avec num_concurrents déclaré par le LLM
    # (comptage incorrect) ne bloque pas le pipeline.
    active = {h["num"]: h for h in horses if not h.get("non_partant", False)}
    if len(active) < 7:
        raise ValueError("Il faut au moins sept partants pour générer cette sélection.")

    partners = {}
    raw_partners = data.get("partner_predictions")
    if not isinstance(raw_partners, list):
        raise ValueError("Pronostics partenaires absents du programme.")
    excluded_partners: list[str] = []
    for partner in raw_partners:
        name = " ".join(str(partner.get("source", "")).upper().replace("’", "’").split())
        nums = partner.get("nums")
        if not name or not isinstance(nums, list) or any(type(n) is not int or n not in all_numbers for n in nums):
            raise ValueError("Pronostic partenaire invalide : source ou numéro inconnu.")
        if len(set(nums)) != len(nums):
            raise ValueError(f"Cheval répété dans le pronostic de {name}.")
        nums = [n for n in nums if n in active]
        if name in partners and partners[name] != nums:
            raise ValueError(f"Deux pronostics contradictoires pour {name}.")
        # Les listes trop courtes ne sont pas traitées comme un vote complet.
        if len(nums) >= 5:
            partners[name] = nums
        elif nums:
            # Partenaire exclu : sa liste a rétréci sous 5 après filtrage des NP.
            excluded_partners.append(f"{name} ({len(nums)} partant(s) restant(s) après NP)")
    if len(partners) < 2:
        sep = ", "
        suffix = (" - partenaires exclus (trop peu de partants apres NP) : " + sep.join(excluded_partners)) if excluded_partners else ""
        raise ValueError("Au moins deux pronostics partenaires complets sont necessaires" + suffix + ".")

    press = {n: 0 for n in active}
    citations = {n: 0 for n in active}
    for nums in partners.values():
        for rank, number in enumerate(nums[:5]):
            press[number] += 5 - rank
            citations[number] += 1

    # Une colonne incomplète est exclue : une cote manquante n'est pas une cote défavorable.
    columns = {}
    for key in ("cote_pt", "cote_tm"):
        values = {n: decimal_odds(h.get(key)) for n, h in active.items()}
        if all(value is not None for value in values.values()):
            columns[key] = values
    if not columns:
        raise ValueError("Aucune colonne de cotes complète et valide pour les partants.")
    column_points = [_odds_points(values) for values in columns.values()]
    ranked = []
    for number, horse in active.items():
        press_score = press[number] / (5 * len(partners)) * 100
        odds_score = sum(points[number] for points in column_points) / (5 * len(columns)) * 100
        ranked.append({
            "num": number, "nom": horse["nom"],
            "press_score": press_score, "odds_score": odds_score,
            "score": .7 * press_score + .3 * odds_score,
            "citations": citations[number],
            "mean_odds": sum(values[number] for values in columns.values()) / len(columns),
        })
    ranked.sort(key=lambda h: (-h["score"], -h["press_score"], h["mean_odds"], h["num"]))
    selected = ranked[:7]
    # combinations, jamais permutations : chaque groupe de chevaux apparaît une fois.
    groups = list(combinations(range(7), size))
    groups.sort(key=lambda indices: (-sum(selected[i]["score"] for i in indices), indices))
    proposals = []
    for index, indices in enumerate(groups[:20]):
        proposals.append({
            "id": "prono_du_jour" if index == 0 else f"consensus_{index + 1:02d}",
            "title": "LE PRONO DU JOUR" if index == 0 else f"COMBINAISON #{index + 1}",
            "subtitle": "Sélection en désordre · ordre de préférence affiché",
            "nums": [selected[i]["num"] for i in indices],
            "score": round(sum(selected[i]["score"] for i in indices) / size, 2),
            "source": MODEL_VERSION,
        })
    # Métadonnées dans le JSON existant : pas de migration ni d'historique nécessaire.
    proposals[0]["selection"] = {
        "version": MODEL_VERSION, "press_weight": .7, "odds_weight": .3,
        "candidates": [{k: round(v, 2) if isinstance(v, float) else v for k, v in h.items()} for h in selected],
        "partners": [{"source": name, "nums": nums} for name, nums in sorted(partners.items())],
        "odds_columns": list(columns), "possible_combinations": len(groups),
        "generated_combinations": len(proposals),
    }
    commentary = (
        f"Sept chevaux classés à partir de {len(partners)} partenaires et de {len(columns)} colonne(s) de cotes. "
        f"Pondération : presse 70 %, cotes 30 %. {len(proposals)} groupes distincts de {size} chevaux "
        f"sur {len(groups)} possibles dans cette sélection. Les scores sur 100 sont des indices de sélection, "
        "pas des probabilités de réussite."
    )
    return {**data, "proposals": proposals, "commentary": commentary}
