"""
Extract structured race data from a LONAB PMUB programme PDF.

The PDF is 2 pages, mostly text-based:
- Page 1: header (date, race, hippodrome, distance, allocation), editorial
  commentary, per-horse short comments, previous race results.
- Page 2: tabular partants list, source predictions (6 publications),
  aptitudes, outsiders, favoris, best of week, schedule.

We rely on stable textual landmarks ("FAVORIS :", "LE PARISIEN", etc.) and
let pdfplumber extract the partants table directly. If the layout ever
changes meaningfully, the corresponding regex/section will fail loudly
rather than silently produce wrong data.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, time
from pathlib import Path
from typing import Optional

import pdfplumber
from loguru import logger


MONTHS_FR = {
    "JANVIER": 1, "FEVRIER": 2, "FÉVRIER": 2, "MARS": 3, "AVRIL": 4,
    "MAI": 5, "JUIN": 6, "JUILLET": 7, "AOUT": 8, "AOÛT": 8,
    "SEPTEMBRE": 9, "OCTOBRE": 10, "NOVEMBRE": 11, "DECEMBRE": 12, "DÉCEMBRE": 12,
}

RACE_TYPES = {
    "TIERCE": "TIERCE", "TIERCÉ": "TIERCE",
    "QUARTE": "QUARTE", "QUARTÉ": "QUARTE",
    "QUARTE+": "QUARTE_PLUS", "QUARTÉ+": "QUARTE_PLUS",
    "QUINTE+": "QUINTE_PLUS", "QUINTÉ+": "QUINTE_PLUS",
    "COUPLE": "COUPLE", "COUPLÉ": "COUPLE",
}

DISCIPLINES = {
    "ATTELE": "TROT_ATTELE", "ATTELÉ": "TROT_ATTELE",
    "MONTE": "TROT_MONTE", "MONTÉ": "TROT_MONTE",
    "PLAT": "PLAT",
    "HAIES": "OBSTACLE", "STEEPLE": "OBSTACLE", "STEEPLE-CHASE": "OBSTACLE",
}

SOURCE_PUBLICATIONS = ["LE PARISIEN", "LA MONTAGNE", "TURFOMANIA", "EQUIDIA", "L'ALSACE", "TURF-FR.COM"]


@dataclass
class HorseRow:
    number: int
    name: str
    driver: Optional[str] = None
    trainer: Optional[str] = None
    owner: Optional[str] = None
    sex: Optional[str] = None
    age: Optional[int] = None
    distance: Optional[int] = None
    chrono: Optional[str] = None
    recent_perf: Optional[str] = None
    gains_xof: Optional[int] = None
    odds_paris_turf: Optional[str] = None
    odds_tierce_mag: Optional[str] = None


@dataclass
class ParsedRace:
    race_date: Optional[date] = None
    race_type: Optional[str] = None        # TIERCE | QUARTE | QUINTE_PLUS | ...
    discipline: Optional[str] = None       # TROT_ATTELE | PLAT | ...
    race_name: Optional[str] = None        # "Prix Henri Berry"
    hippodrome: Optional[str] = None       # "Vichy"
    course_number: Optional[int] = None    # "4ème COURSE"
    num_horses: Optional[int] = None
    distance: Optional[int] = None         # meters
    allocation_xof: Optional[int] = None   # F CFA total
    allocation_eur: Optional[int] = None   # for reference
    start_time: Optional[time] = None
    bet_close_time: Optional[time] = None
    horses: list[HorseRow] = field(default_factory=list)
    favoris: list[int] = field(default_factory=list)             # ordered horse numbers
    sources: dict[str, list[int]] = field(default_factory=dict)  # publication -> ordered numbers
    aptitudes: dict[str, list[int]] = field(default_factory=dict)  # forme/classe/progres/regularite
    outsiders: list[int] = field(default_factory=list)
    big_outsiders: list[int] = field(default_factory=list)
    second_chances: list[int] = field(default_factory=list)
    editorial: Optional[str] = None
    horse_comments: dict[int, str] = field(default_factory=dict)
    previous_results: dict = field(default_factory=dict)
    raw_text: str = ""


def _to_int_or_none(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    cleaned = re.sub(r"[^\d]", "", s)
    return int(cleaned) if cleaned else None


def _parse_numbers_list(s: str) -> list[int]:
    """'13 - 3 - 15 - 14 - 10' → [13, 3, 15, 14, 10]. Ignores trailing junk."""
    return [int(m) for m in re.findall(r"\b(\d{1,2})\b", s)]


def _parse_header(text: str, parsed: ParsedRace) -> None:
    """Extract race metadata from page 1 header lines."""
    # "QUARTE" DU LUNDI 04 MAI 2026
    m = re.search(
        r'"([A-ZÉÊÀÂÇa-z+]+)"\s+DU\s+\w+\s+(\d{1,2})\s+([A-ZÉÊÔÛa-z]+)\s+(\d{4})',
        text,
    )
    if m:
        rt_token = m.group(1).upper()
        parsed.race_type = RACE_TYPES.get(rt_token, "AUTRE")
        try:
            parsed.race_date = date(int(m.group(4)), MONTHS_FR[m.group(3).upper()], int(m.group(2)))
        except (KeyError, ValueError):
            logger.warning(f"Could not parse date from {m.group(0)!r}")

    # VICHY - PRIX HENRI BERRY  (often appears mid-line because page 1 has
    # editorial text wrapped across columns; we anchor on the all-caps token
    # immediately preceding " - PRIX ").
    m = re.search(
        r'\b([A-ZÉÊÀÂÇÔÎÏÈ]{3,}(?:[-\s][A-ZÉÊÀÂÇÔÎÏÈ]{2,}){0,3})\s+-\s+(PRIX\s+[A-ZÉÊÀÂÇÔÎÏÈ \-\']{3,}?)(?=\s*\n|\s+\d|$)',
        text,
    )
    if m:
        parsed.hippodrome = m.group(1).strip().title()
        parsed.race_name = re.sub(r"\s+", " ", m.group(2).strip()).title()

    # 16 CONCURRENTS - 4ème COURSE - ATTELE
    m = re.search(
        r'(\d+)\s+CONCURRENTS\s*-\s*(\d+)\s*[èeéê]me\s+COURSE\s*-\s*([A-ZÉÊa-z\-]+)',
        text,
    )
    if m:
        parsed.num_horses = int(m.group(1))
        parsed.course_number = int(m.group(2))
        parsed.discipline = DISCIPLINES.get(m.group(3).upper(), "AUTRE")

    # 37 000 EUROS ( ENV. 24 500 000 F CFA ) - 2 950 METRES
    m = re.search(
        r'([\d\s]+)\s*EUROS\s*\(\s*ENV\.?\s*([\d\s]+)\s*F\s*CFA\s*\)\s*-\s*([\d\s]+)\s*M[EÈÊ]TRES',
        text,
    )
    if m:
        parsed.allocation_eur = _to_int_or_none(m.group(1))
        parsed.allocation_xof = _to_int_or_none(m.group(2))
        parsed.distance = _to_int_or_none(m.group(3))


def _parse_schedule(text: str, parsed: ParsedRace) -> None:
    """ARRÊT DES JEUX EST FIXÉ : 11h 45mn / DÉPART DE LA COURSE : 11h 55mn"""
    m = re.search(r'ARR[ÊE]T\s+DES\s+JEUX[^\d]+(\d{1,2})\s*h\s*(\d{1,2})', text, flags=re.IGNORECASE)
    if m:
        parsed.bet_close_time = time(int(m.group(1)), int(m.group(2)))
    m = re.search(r'D[ÉE]PART\s+DE\s+LA\s+COURSE[^\d]+(\d{1,2})\s*h\s*(\d{1,2})', text, flags=re.IGNORECASE)
    if m:
        parsed.start_time = time(int(m.group(1)), int(m.group(2)))


def _parse_favoris(text: str, parsed: ParsedRace) -> None:
    """FAVORIS : 13 – 3 – 15 – 14 – 10 – 16 – 8 (uses en-dash '–', not hyphen)."""
    m = re.search(r'FAVORIS\s*:?\s*([\d\s\-–—]+)', text)
    if m:
        parsed.favoris = _parse_numbers_list(m.group(1))


def _parse_sources(text: str, parsed: ParsedRace) -> None:
    """Each publication name on its own line, followed by space-separated numbers."""
    # Use a regex that anchors on each publication and captures the rest of the line.
    for pub in SOURCE_PUBLICATIONS:
        pat = re.escape(pub) + r'\s+([\d\s\-]+?)(?:\n|$)'
        m = re.search(pat, text)
        if m:
            nums = _parse_numbers_list(m.group(1))
            if nums:
                parsed.sources[pub] = nums


def _parse_aptitudes(text: str, parsed: ParsedRace) -> None:
    """FORME : 3 – 13 – 15 – 10 – 16, etc. (en-dash dominant on these lines)."""
    labels = {
        "FORME": "forme",
        "CLASSE": "classe",
        "PROGRES": "progres", "PROGRÈS": "progres",
        "REGULARITE": "regularite", "RÉGULARITÉ": "regularite",
    }
    for label, key in labels.items():
        m = re.search(rf'{label}\s*:?\s*([\d\s\-–—]+)', text)
        if m:
            nums = _parse_numbers_list(m.group(1))
            if nums:
                parsed.aptitudes[key] = nums


def _parse_classement(text: str, parsed: ParsedRace) -> None:
    """The 'CLASSEMENT' block has 3 side-by-side columns:

        SECONDES CHANCES   OUTSIDERS         GROS OUTSIDERS
        7 – CERTAINLY      9 – HAPPY PACHA   12 – GENERAL DU NORD
        6 – ADAMO DIPA     2 – INVADER AM    5 – HERMES SCOTT
        ...

    pdfplumber concatenates them into single lines. We extract all
    'N – NAME' pairs per line and assign positionally to (sc, out, big).
    """
    block_m = re.search(
        r'SECONDES\s+CHANCES\s+OUTSIDERS\s+GROS\s+OUTSIDERS\s*\n(.*?)(?=\n\s*[A-Z]{4,}\s*\n|\Z)',
        text, flags=re.DOTALL,
    )
    if not block_m:
        return
    sc: list[int] = []
    out: list[int] = []
    big: list[int] = []
    for line in block_m.group(1).splitlines()[:6]:
        nums = re.findall(r'\b(\d{1,2})\s*[\-–—]\s*[A-ZÉÊÀÂÇÔÎÏÈ]', line)
        if len(nums) >= 3:
            sc.append(int(nums[0])); out.append(int(nums[1])); big.append(int(nums[2]))
        elif len(nums) == 2:
            sc.append(int(nums[0])); out.append(int(nums[1]))
        elif len(nums) == 1:
            sc.append(int(nums[0]))
    parsed.second_chances = sc
    parsed.outsiders = out
    parsed.big_outsiders = big


def _parse_partants_table(pdf: pdfplumber.PDF, parsed: ParsedRace) -> None:
    """Find the 12-column partants table on any page and split each newline-stacked cell."""
    expected_cols = 12
    target_table = None
    for page in pdf.pages:
        for tbl in page.extract_tables():
            if not tbl or not tbl[0]:
                continue
            header = [str(c or "").strip().upper() for c in tbl[0]]
            if "CHEVAUX" in header and "DRIVERS" in header:
                target_table = tbl
                break
        if target_table:
            break
    if not target_table:
        logger.warning("Partants table not found")
        return

    # Header normalisation
    header = [str(c or "").strip().upper() for c in target_table[0]]
    col = {name: i for i, name in enumerate(header)}

    def cell(row, name: str) -> list[str]:
        idx = col.get(name)
        if idx is None or idx >= len(row):
            return []
        return [s.strip() for s in str(row[idx] or "").splitlines() if s.strip()]

    horses_acc: list[HorseRow] = []
    for row in target_table[1:]:
        numbers = cell(row, "N°") or cell(row, "N")
        names = cell(row, "CHEVAUX")
        drivers = cell(row, "DRIVERS")
        trainers = cell(row, "ENTRAINEURS")
        owners = cell(row, "PROPRIETAIRES")
        sex_age = cell(row, "SEXE\nAGE") or cell(row, "SEXE AGE") or cell(row, "SEXE")
        dist = cell(row, "DIST.")
        chrono = cell(row, "CHRONO")
        perf = cell(row, "PERF.")
        gains = cell(row, "GAINS")
        odds_pt = cell(row, "PARIS\nTURF") or cell(row, "PARIS TURF")
        odds_tm = cell(row, "TIERCE\nMAGAZINE") or cell(row, "TIERCE MAGAZINE")

        n = len(numbers)
        for i in range(n):
            try:
                num = int(numbers[i])
            except (ValueError, IndexError):
                continue
            sa = sex_age[i] if i < len(sex_age) else ""
            sa_m = re.match(r'([HFM])\.?(\d{0,2})', sa)
            horses_acc.append(HorseRow(
                number=num,
                name=names[i] if i < len(names) else "",
                driver=drivers[i] if i < len(drivers) else None,
                trainer=trainers[i] if i < len(trainers) else None,
                owner=owners[i] if i < len(owners) else None,
                sex=sa_m.group(1) if sa_m else None,
                age=int(sa_m.group(2)) if sa_m and sa_m.group(2) else None,
                distance=_to_int_or_none(dist[i]) if i < len(dist) else None,
                chrono=chrono[i] if i < len(chrono) else None,
                recent_perf=perf[i] if i < len(perf) else None,
                gains_xof=_to_int_or_none(gains[i]) if i < len(gains) else None,
                odds_paris_turf=odds_pt[i] if i < len(odds_pt) else None,
                odds_tierce_mag=odds_tm[i] if i < len(odds_tm) else None,
            ))
    horses_acc.sort(key=lambda h: h.number)
    parsed.horses = horses_acc


def _parse_horse_comments(page: pdfplumber.page.Page, parsed: ParsedRace) -> None:
    """Page 1 lays out 'N - HORSE_NAME : ...' comments in 2 vertical columns
    (1-8 left, 9-16 right). We detect column x-positions from anchor words,
    crop each column as a vertical strip, then split the clean column text
    into per-horse blocks using anchor regex.
    """
    words = page.extract_words(x_tolerance=2, y_tolerance=2)
    anchor_xs: list[float] = []
    for i in range(len(words) - 2):
        w0, w1, w2 = words[i:i + 3]
        if (
            re.match(r'^\d{1,2}$', w0['text'])
            and w1['text'] == '-'
            and re.match(r'^[A-ZÉÈÊÀÂÇÔÎÏ]{3,}', w2['text'])
        ):
            num = int(w0['text'])
            if 1 <= num <= 30:
                anchor_xs.append(w0['x0'])
    if not anchor_xs:
        return

    # Cluster anchor x-positions into columns (rounded to nearest 50).
    by_x: dict[int, list[float]] = {}
    for x in anchor_xs:
        by_x.setdefault(round(x / 50) * 50, []).append(x)
    cols_sorted = sorted(by_x.keys())

    # Estimate column width from the gap between adjacent columns; reuse it
    # to bound the last column's right edge (otherwise it would leak into the
    # right-side editorial / results pane).
    if len(cols_sorted) >= 2:
        col_width = cols_sorted[1] - cols_sorted[0]
    else:
        col_width = 200

    # The 'RESULTATS DES COURSES' banner sits in col 3 only and doesn't
    # actually clip the horse-comment columns vertically — col 1/2 horses
    # extend below its y-position. So no y-cap here; tightening x bounds is
    # what prevents col 3 content from leaking in.
    y_bottom_cap = page.height

    pat = re.compile(
        r'(?:^|\s)(\d{1,2})\s*-\s*([A-ZÉÈÊÀÂÇÔÎÏ \'\-]+?)\s*:\s*',
    )

    for idx, col_key in enumerate(cols_sorted):
        col_xs = by_x[col_key]
        x_left = max(0, min(col_xs) - 2)
        x_right = (cols_sorted[idx + 1] - 2) if idx + 1 < len(cols_sorted) else min(page.width, min(col_xs) + col_width - 25)
        try:
            col_txt = page.crop((x_left, 0, x_right, y_bottom_cap)).extract_text() or ""
        except Exception:
            continue
        # Replace newlines with spaces so anchors inside one block stay glued.
        flat = re.sub(r'\s+', ' ', col_txt)
        matches = list(pat.finditer(flat))
        for j, m in enumerate(matches):
            num = int(m.group(1))
            if not 1 <= num <= 30:
                continue
            start = m.end()
            end = matches[j + 1].start() if j + 1 < len(matches) else len(flat)
            chunk = flat[start:end].strip()
            if chunk and num not in parsed.horse_comments:
                parsed.horse_comments[num] = chunk


def _parse_previous_results(text: str, parsed: ParsedRace) -> None:
    """Captures e.g. 'ARRIVEE DU "TIERCE" DU SAMEDI 02 MAI 2026 : 5 - 3 - 6 NPO : 0 NP : 0'"""
    m = re.search(r'ARRIVEE\s+DU\s+"([A-Z+]+)"\s+DU\s+\w+\s+(\d{1,2})\s+([A-Z]+)\s+(\d{4})\s*:\s*([\d\s\-]+)', text)
    if m:
        try:
            d = date(int(m.group(4)), MONTHS_FR[m.group(3).upper()], int(m.group(2)))
        except (KeyError, ValueError):
            d = None
        parsed.previous_results = {
            "type": m.group(1),
            "date": d.isoformat() if d else None,
            "arrivalOrder": _parse_numbers_list(m.group(5)),
        }


def _parse_editorial(page: pdfplumber.page.Page, parsed: ParsedRace) -> None:
    """The editorial paragraph sits in the right column of page 1 (above the
    'RESULTATS DES COURSES' block). We crop the right ~38% and slice between
    the 'METRES' marker and the next-section anchor."""
    try:
        right = page.crop((page.width * 0.62, 0, page.width, page.height))
        txt = right.extract_text() or ""
    except Exception:
        return
    start_m = re.search(r'M[EÈÊ]TRES\s*\n', txt)
    start_idx = start_m.end() if start_m else -1
    if start_idx < 0:
        return
    # End at the first line that looks like a previous-result arrival ('5 - 3 - 6'),
    # the GAINS/RESULTATS header, or 'NPO :' marker — whichever comes first.
    candidates = []
    for pat in [
        r'\n[^\n]*\d+\s*-\s*\d+\s*-\s*\d+\s*NPO',
        r'\n[^\n]*RESULTATS\s+DES\s+COURSES',
        r'\n[^\n]*GAINS\s+EN\s+F\s*CFA',
    ]:
        m = re.search(pat, txt[start_idx:])
        if m:
            candidates.append(start_idx + m.start())
    end_idx = min(candidates) if candidates else len(txt)
    chunk = re.sub(r'\s+', ' ', txt[start_idx:end_idx]).strip()
    if chunk:
        parsed.editorial = chunk


def parse_pdf(path: Path | str) -> ParsedRace:
    """Public entry point. Returns a ParsedRace populated from the LONAB PDF."""
    path = Path(path)
    parsed = ParsedRace()
    with pdfplumber.open(str(path)) as pdf:
        pages_text: list[str] = []
        for page in pdf.pages:
            t = page.extract_text() or ""
            pages_text.append(t)
        parsed.raw_text = "\n\n".join(pages_text)

        # Page 1 has the header + editorial + results + horse comments
        p1 = pages_text[0] if pages_text else ""
        p2 = pages_text[1] if len(pages_text) > 1 else ""

        _parse_header(p1, parsed)
        _parse_previous_results(p1, parsed)
        if pdf.pages:
            _parse_editorial(pdf.pages[0], parsed)
            _parse_horse_comments(pdf.pages[0], parsed)

        # Page 2: schedule, favoris, sources, aptitudes, classement, partants table
        _parse_schedule(p2, parsed)
        _parse_favoris(p2, parsed)
        _parse_sources(p2, parsed)
        _parse_aptitudes(p2, parsed)
        _parse_classement(p2, parsed)
        _parse_partants_table(pdf, parsed)

    return parsed


def to_dict(parsed: ParsedRace) -> dict:
    """JSON-serialisable form for storage / API exposure."""
    return {
        "race": {
            "date": parsed.race_date.isoformat() if parsed.race_date else None,
            "raceType": parsed.race_type,
            "discipline": parsed.discipline,
            "raceName": parsed.race_name,
            "hippodrome": parsed.hippodrome,
            "courseNumber": parsed.course_number,
            "numHorses": parsed.num_horses,
            "distance": parsed.distance,
            "allocationXof": parsed.allocation_xof,
            "allocationEur": parsed.allocation_eur,
            "startTime": parsed.start_time.strftime("%H:%M") if parsed.start_time else None,
            "betCloseTime": parsed.bet_close_time.strftime("%H:%M") if parsed.bet_close_time else None,
        },
        "horses": [
            {
                "number": h.number, "name": h.name, "driver": h.driver,
                "trainer": h.trainer, "owner": h.owner, "sex": h.sex,
                "age": h.age, "distance": h.distance, "chrono": h.chrono,
                "recentPerf": h.recent_perf, "gainsXof": h.gains_xof,
                "oddsParisTurf": h.odds_paris_turf, "oddsTierceMag": h.odds_tierce_mag,
            }
            for h in parsed.horses
        ],
        "favoris": parsed.favoris,
        "sources": parsed.sources,
        "aptitudes": parsed.aptitudes,
        "outsiders": parsed.outsiders,
        "bigOutsiders": parsed.big_outsiders,
        "secondChances": parsed.second_chances,
        "editorial": parsed.editorial,
        "horseComments": parsed.horse_comments,
        "previousResults": parsed.previous_results,
    }


if __name__ == "__main__":
    import json
    import sys
    src = sys.argv[1] if len(sys.argv) > 1 else "_lonab_cache/JH_PMUB_DU_04-05-2026.pdf"
    parsed = parse_pdf(src)
    print(json.dumps(to_dict(parsed), ensure_ascii=False, indent=2, default=str))
