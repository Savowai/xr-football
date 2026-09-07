"""
Closing betting odds from football-data.co.uk -- BENCHMARK ONLY.

Read this before wiring it into anything:

    Odds are never an input to the model. Not as a feature, not as a prior,
    not as a tie-breaker. They exist so the backtest can answer one question:
    how far is xR from the closing market, which prices in team news, weather
    and money that public data alone cannot see.

That separation is the whole point. A model that has seen the odds cannot be
compared against them -- it has already been told the answer -- so the moment
this module is imported anywhere outside scripts/backtest.py, the comparison
on the About page stops meaning anything. FotMob remains the sole source of
everything the model actually consumes.

Matching is done on kickoff date plus fuzzy team name rather than on an id,
because the two sources share no identifier. football-data writes "Man United"
and "Nott'm Forest"; FotMob writes "Manchester United" and "Nottingham Forest".
config.CANONICAL_TEAMS handles the names we already know about and string
similarity catches the rest, but the match rate is returned to the caller so a
silent partial merge cannot quietly turn into a published number.
"""

from __future__ import annotations

import csv
import difflib
import io
import os
import re
import unicodedata
import urllib.error
import urllib.request
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

import config as C

BASE = "https://www.football-data.co.uk/mmz4281"

# football-data's division codes. Only the top flight of each country.
DIVISION = {
    "epl": "E0",
    "laliga": "SP1",
    "seriea": "I1",
    "bundesliga": "D1",
    "ligue1": "F1",
}

# Preference order for the three 1X2 columns. "C" means closing -- the last
# price before kickoff, which is the sharp one and the only one worth
# benchmarking against. Avg* averages the whole bookmaker panel and so is
# steadier than any single book; B365 is the fallback because it is the one
# column present in every season going back years.
ODDS_COLUMNS = [
    ("AvgCH", "AvgCD", "AvgCA"),   # panel average, closing
    ("B365CH", "B365CD", "B365CA"),  # Bet365, closing
    ("PSCH", "PSCD", "PSCA"),      # Pinnacle, closing
    ("AvgH", "AvgD", "AvgA"),      # panel average, opening
    ("B365H", "B365D", "B365A"),   # Bet365, opening
]

# Below this, two names are different clubs rather than two spellings of one.
# 0.72 clears "Man United"/"Manchester United" (0.83) and "Ein Frankfurt"/
# "Eintracht Frankfurt" (0.79) while still separating the Manchester and
# Sheffield pairs, which is the case that actually matters.
NAME_THRESHOLD = 0.72

# Tokens that carry no identifying information once a league is fixed.
NOISE = {
    "fc", "cf", "afc", "ac", "as", "ss", "sc", "rc", "cd", "ud", "sd",
    "us", "ogc", "sm", "rcd", "club", "calcio", "de", "of",
}


class OddsError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------

def _cache_path(league_key: str, season_start: int) -> str:
    return os.path.join(
        C.DATA_CACHE_DIR, f"odds_{league_key}_{C.season_key(season_start)}.csv")


def fetch_csv(league_key: str, season_start: int,
              refresh: bool = False) -> str:
    """
    The season's raw CSV, cached on disk.

    A finished season is frozen, so its file is cached forever. The season in
    progress gains a row per matchday, so it is re-fetched -- but the cached
    copy is still kept as a fallback, because this site goes down often enough
    that an outage should degrade the benchmark, not break the backtest.
    """
    if league_key not in DIVISION:
        raise OddsError(f"No football-data division for '{league_key}'")

    path = _cache_path(league_key, season_start)
    complete = season_start < C.SEASON_START_YEAR
    if os.path.exists(path) and complete and not refresh:
        with open(path) as fh:
            return fh.read()

    url = f"{BASE}/{C.season_key(season_start)}/{DIVISION[league_key]}.csv"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        raw = urllib.request.urlopen(req, timeout=60).read()
    except (urllib.error.URLError, OSError) as exc:
        if os.path.exists(path):
            with open(path) as fh:
                return fh.read()
        raise OddsError(f"{url}: {exc}") from exc

    text = raw.decode("utf-8-sig", "replace")
    # The site answers outages with a 200-ish HTML page rather than an error,
    # so validate the shape instead of trusting the status code.
    if "HomeTeam" not in text.split("\n", 1)[0]:
        if os.path.exists(path):
            with open(path) as fh:
                return fh.read()
        raise OddsError(f"{url}: response is not a football-data CSV")

    os.makedirs(C.DATA_CACHE_DIR, exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)
    return text


# ---------------------------------------------------------------------------
# Parse
# ---------------------------------------------------------------------------

def _parse_date(value: str) -> Optional[date]:
    value = (value or "").strip()
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            from datetime import datetime
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def _row_odds(row: Dict[str, str]) -> Optional[Tuple[float, float, float]]:
    for h, d, a in ODDS_COLUMNS:
        try:
            trio = (float(row[h]), float(row[d]), float(row[a]))
        except (KeyError, TypeError, ValueError):
            continue
        # A quoted price of 1.0 or less is a placeholder, not a real market.
        if all(x > 1.0 for x in trio):
            return trio
    return None


def parse(text: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for row in csv.DictReader(io.StringIO(text)):
        when = _parse_date(row.get("Date", ""))
        home, away = row.get("HomeTeam"), row.get("AwayTeam")
        if not (when and home and away):
            continue
        trio = _row_odds(row)
        if not trio:
            continue
        out.append({
            "date": when,
            "home": C.canon(home.strip()),
            "away": C.canon(away.strip()),
            "odds_home": trio[0],
            "odds_draw": trio[1],
            "odds_away": trio[2],
        })
    return out


# ---------------------------------------------------------------------------
# Match
# ---------------------------------------------------------------------------

def _norm(name: str) -> str:
    """Strip everything that varies between sources but not between clubs."""
    name = unicodedata.normalize("NFKD", C.canon(name or ""))
    name = "".join(c for c in name if not unicodedata.combining(c)).lower()
    name = re.sub(r"[^a-z0-9 ]+", " ", name)
    tokens = [t for t in name.split() if t and t not in NOISE]
    return " ".join(tokens) or name.strip()


def _similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, _norm(a), _norm(b)).ratio()


def attach(matches: List[Dict[str, Any]], league_key: str,
           season_start: int, verbose: bool = False) -> Tuple[int, int]:
    """
    Merge closing odds into `matches` in place.

    Returns (matched, total). The caller decides what an acceptable rate is --
    this function will not refuse to do a partial job, but it will not hide
    one either.
    """
    try:
        rows = parse(fetch_csv(league_key, season_start))
    except OddsError as exc:
        if verbose:
            print(f"  odds unavailable: {exc}")
        return 0, len(matches)

    # Index by day so each archive match is only compared against the handful
    # of fixtures played around it, not the whole season.
    by_day: Dict[date, List[Dict[str, Any]]] = {}
    for r in rows:
        by_day.setdefault(r["date"], []).append(r)

    matched = 0
    for m in matches:
        when = _parse_iso(m.get("date"))
        if not when:
            continue
        # +/- one day: football-data stamps the local date and FotMob the UTC
        # one, so a late kickoff can legitimately land either side of midnight.
        candidates: List[Dict[str, Any]] = []
        for delta in (0, -1, 1):
            candidates.extend(by_day.get(when + timedelta(days=delta), []))
        if not candidates:
            continue

        best, best_score = None, 0.0
        for r in candidates:
            score = min(_similarity(m["home"], r["home"]),
                        _similarity(m["away"], r["away"]))
            if score > best_score:
                best, best_score = r, score

        if best and best_score >= NAME_THRESHOLD:
            m["odds_home"] = best["odds_home"]
            m["odds_draw"] = best["odds_draw"]
            m["odds_away"] = best["odds_away"]
            matched += 1
        elif verbose and best:
            print(f"  no odds match: {m['home']} v {m['away']} "
                  f"({m.get('date')}) -- closest {best['home']} v "
                  f"{best['away']} at {best_score:.2f}")

    return matched, len(matches)


def _parse_iso(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        y, mo, d = (int(x) for x in value[:10].split("-"))
        return date(y, mo, d)
    except (ValueError, TypeError):
        return None


if __name__ == "__main__":
    import sys

    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    key = args[0] if args else "epl"
    year = int(args[1]) if len(args) > 1 else C.SEASON_START_YEAR - 1

    from build_archive import load_archive

    season = [m for m in load_archive(year, key) if m.get("home_goals") is not None]
    got, total = attach(season, key, year, verbose=True)
    print(f"{key} {C.season_label(year)}: odds on {got}/{total} matches")
