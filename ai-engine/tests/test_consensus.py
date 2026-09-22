"""Régressions métier ; aucune base, clé API ou connexion réseau nécessaire."""
import asyncio
from copy import deepcopy
from itertools import combinations
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from analyzer import analyze_pdf, extract_pdf_signals, _extract_text, _PROMPT
from consensus_model import build_pronostic, decimal_odds, _odds_points


def programme():
    # Données du programme LONAB du 31/07/2026, vérifiées dans le PDF.
    pt = [52, 16, 22, 14, 20, 10, 17, 28, 68, 26, 87, 8, 5, 11, 15, 32]
    tm = [55, 18, 19, 11, 18, 7, 15, 25, 70, 29, 90, 6, 3, 9, 12, 33]
    partners = {
        "TURF-FR.COM": [13, 14, 12, 15, 6, 4, 5, 3, 7],
        "LE PARISIEN": [12, 6, 13, 14, 2, 5, 3, 4, 1],
        "L'ALSACE": [3, 13, 14, 7, 5, 12, 6, 4, 10],
        "TURFOMANIA": [3, 14, 13, 12, 1, 4, 6, 7, 2],
        "LA CHARENTE LIBRE": [13, 12, 14, 6, 3, 1, 2],
    }
    return {
        "race": {"type": "4+1", "date": "2026-07-31", "num_concurrents": 16},
        "horses": [{"num": i + 1, "nom": f"CHEVAL {i + 1}", "cote_pt": f"{pt[i]}/1", "cote_tm": f"{tm[i]}/1"} for i in range(16)],
        "partner_predictions": [{"source": source, "nums": nums} for source, nums in partners.items()],
    }


def pdf_text():
    data = programme()
    return "\n".join([
        # Une arrivée et un ancien pronostic avant le tableau doivent être ignorés.
        "RESULTATS ANCIENS 1 - 2 - 3 - 4 - 5",
        "LE PARISIEN 1 - 2 - 3 - 4 - 5",
        "N° CHEVAUX DRIVERS ENTRAINEURS PARIS TURF TIERCE MAGAZINE",
        *[f"{h['num']} {h['nom']} A. DRIVER H.7 2750.M 1.12.00 {h['cote_pt']} {h['cote_tm']}" for h in data["horses"]],
        *[f"{p['source']} {' - '.join(map(str, p['nums']))}" for p in data["partner_predictions"]],
        "FAVORIS : 13 - 12 - 6 - 14 - 15",
    ])


class ConsensusTests(unittest.TestCase):
    def test_reference_ranking_and_scores(self):
        result = build_pronostic(programme())
        main = result["proposals"][0]
        candidates = main["selection"]["candidates"]
        self.assertEqual([h["num"] for h in candidates], [13, 12, 14, 6, 3, 4, 15])
        self.assertEqual([h["score"] for h in candidates[:5]], [86, 63.2, 56.8, 37.6, 30.8])
        self.assertEqual(main["nums"], [13, 12, 14, 6, 3])
        self.assertEqual(main["id"], "prono_du_jour")
        self.assertNotIn("confidence", main)

    def test_twenty_unique_unordered_groups_and_no_mandatory_base(self):
        for race_type, size, possible in [("TIERCE", 3, 35), ("QUARTE", 4, 35), ("QUINTE", 5, 21), ("4+1", 5, 21)]:
            with self.subTest(race_type=race_type):
                data = programme()
                data["race"]["type"] = race_type
                proposals = build_pronostic(data)["proposals"]
                groups = [frozenset(p["nums"]) for p in proposals]
                self.assertEqual(len(groups), 20)
                self.assertEqual(len(set(groups)), 20)
                self.assertTrue(all(len(g) == size for g in groups))
                self.assertEqual(len(set.union(*(set(g) for g in groups))), 7)
                self.assertFalse(set.intersection(*(set(g) for g in groups)))
                self.assertEqual(proposals[0]["selection"]["possible_combinations"], possible)

    def test_keeps_twenty_best_sums(self):
        proposals = build_pronostic(programme())["proposals"]
        candidates = proposals[0]["selection"]["candidates"]
        all_scores = sorted(sum(h["score"] for h in combo) for combo in combinations(candidates, 5))
        retained_scores = sorted(round(p["score"] * 5, 1) for p in proposals)
        self.assertEqual(retained_scores, [round(s, 1) for s in all_scores[1:]])

    def test_non_runner_is_removed_everywhere(self):
        data = programme()
        data["horses"][12]["non_partant"] = True
        proposals = build_pronostic(data)["proposals"]
        self.assertTrue(all(13 not in p["nums"] for p in proposals))
        self.assertTrue(all(13 not in p["nums"] for p in proposals[0]["selection"]["partners"]))

    def test_tied_odds_share_points_at_fifth_place(self):
        points = _odds_points({1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 6, 7: 7})
        self.assertEqual(points[5], .5)
        self.assertEqual(points[6], .5)
        self.assertEqual(sum(points.values()), 15)

    def test_incomplete_column_excluded_not_zero_filled(self):
        data = programme()
        data["horses"][0]["cote_tm"] = None
        main = build_pronostic(data)["proposals"][0]
        self.assertEqual(main["selection"]["odds_columns"], ["cote_pt"])
        data["horses"][0]["cote_pt"] = None
        with self.assertRaisesRegex(ValueError, "colonne de cotes"):
            build_pronostic(data)

    def test_duplicate_source_does_not_change_scores(self):
        data = programme()
        expected = build_pronostic(data)["proposals"]
        data["partner_predictions"].append(deepcopy(data["partner_predictions"][0]))
        self.assertEqual(build_pronostic(data)["proposals"], expected)

    def test_invalid_extractions_are_rejected(self):
        for mutation in [
            lambda d: d["horses"].pop(),
            lambda d: d["horses"][0].update(num=2),
            lambda d: d["partner_predictions"][0]["nums"].append(99),
            lambda d: d["partner_predictions"][0]["nums"].append(13),
            lambda d: d.update(partner_predictions=d["partner_predictions"][:1]),
            lambda d: d["race"].update(type="INCONNU"),
        ]:
            data = programme()
            mutation(data)
            with self.assertRaises(ValueError):
                build_pronostic(data)

    def test_input_order_does_not_change_output(self):
        data = programme()
        expected = build_pronostic(data)["proposals"]
        data["horses"].reverse()
        data["partner_predictions"].reverse()
        self.assertEqual(build_pronostic(data)["proposals"], expected)

    def test_odds_validation(self):
        self.assertEqual(decimal_odds("5/2"), 3.5)
        for value in (None, "NP", "NaN", "inf", "1/0", "-1/-2", True, 0, 1):
            self.assertIsNone(decimal_odds(value))


class ExtractionTests(unittest.TestCase):
    def test_only_current_table_signals_are_used(self):
        odds, partners = extract_pdf_signals(pdf_text())
        self.assertEqual(len(odds), 16)
        self.assertEqual(odds[13], {"cote_pt": "5/1", "cote_tm": "3/1"})
        self.assertEqual(len(partners), 5)
        self.assertEqual(next(p for p in partners if p["source"] == "LE PARISIEN")["nums"][0], 12)

    def test_missing_header_fails(self):
        with self.assertRaises(ValueError):
            extract_pdf_signals("RESULTATS 1 - 2 - 3 - 4 - 5")

    def test_llm_cannot_override_numeric_signals(self):
        extracted = programme()
        extracted["horses"][12]["cote_pt"] = "999/1"
        extracted["proposals"] = [{"nums": [1, 2, 3]}]
        with patch("analyzer._extract_text", return_value=pdf_text()), patch.dict("os.environ", {"AI_PROVIDER": "groq"}), patch("analyzer._analyze_groq", new=AsyncMock(return_value=extracted)):
            data = asyncio.run(analyze_pdf("unused.pdf"))
        self.assertEqual(data["horses"][12]["cote_pt"], "5/1")
        self.assertNotIn("proposals", data)
        self.assertEqual(build_pronostic(data)["proposals"][0]["nums"], [13, 12, 14, 6, 3])
        self.assertIn("4+1", _PROMPT.format(text="test"))

    def test_cached_real_programmes_when_available(self):
        files = sorted((Path(__file__).resolve().parents[1] / "_lonab_cache").glob("JH*.pdf"))
        if not files:
            self.skipTest("PDF locaux absents ; les tests sur le texte de référence restent exécutés.")
        for path in files:
            with self.subTest(pdf=path.name):
                odds, partners = extract_pdf_signals(_extract_text(str(path)))
                self.assertGreaterEqual(len(odds), 7)
                self.assertGreaterEqual(len(partners), 2)
                self.assertTrue(all(set(p["nums"]) <= odds.keys() for p in partners))


if __name__ == "__main__":
    unittest.main()
