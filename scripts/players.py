"""
Player data from FotMob: league leaderboards and club squads.

Two surfaces, one fetch budget:

  leaderboards  43 stat categories per league (goals, xG, assists, tackles,
                saves, ...), each a ranked list. The league page embeds only
                the top three; the full list is a separate JSON document whose
                URL the page hands us in `fetchAllUrl`.

  squads        every player at every club, with season totals -- and, more
                importantly, an `injury` field carrying an expected return
                date.

That injury field is why this module is not only a display feature. The model
fits one attack and one defence rating per club and then assumes that squad is
the squad, so a side missing its first-choice striker is rated as though he is
fit. Availability is the largest single thing the closing betting market can
see that we cannot, and this is the cheapest honest way to start closing that
gap -- the same request that renders a squad table also tells us who is out.

Nothing here is wired into the model yet. It is ingest and display first; any
rating adjustment has to earn its place against scripts/backtest.py rather than
be assumed to help.

Volume: one league page plus 43 small documents plus one page per club. Cached
on disk with a TTL, because squads change on a transfer-window timescale and
this pipeline runs hourly.
"""

from __future__ import annotations

import json
import os
import sys
import time
import unicodedata
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config as C
import fotmob

# Leaderboards and squads move on a scale of days, not minutes, and the build
# runs every hour. Re-fetching 60-odd documents per league every time would be
# rude for data that has not changed.
CACHE_TTL_SECONDS = 6 * 3600

# How many players to keep per category. The source returns ~60; a leaderboard
# nobody scrolls past 20 rows of does not need the other 40.
TOP_N = 20


def _cache_path(name: str, league_key: str, season: str) -> str:
    safe = season.replace("/", "-")
    return os.path.join(C.DATA_CACHE_DIR, f"{name}_{league_key}_{safe}.json")


def _read_cache(path: str, ttl: int = CACHE_TTL_SECONDS) -> Optional[Any]:
    if not os.path.exists(path):
        return None
    if time.time() - os.path.getmtime(path) > ttl:
        return None
    try:
        with open(path) as fh:
            return json.load(fh)
    except (ValueError, OSError):
        return None


def _write_cache(path: str, payload: Any) -> None:
    os.makedirs(C.DATA_CACHE_DIR, exist_ok=True)
    with open(path, "w") as fh:
        json.dump(payload, fh, indent=1)


# ---------------------------------------------------------------------------
# Leaderboards
# ---------------------------------------------------------------------------

def _clean_entry(row: Dict[str, Any]) -> Dict[str, Any]:
    # The source misspells ParticipantId as "ParticiantId"; accept both so a
    # future correction upstream does not silently empty every leaderboard.
    pid = row.get("ParticipantId", row.get("ParticiantId"))
    return {
        "player_id": str(pid) if pid is not None else None,
        "name": row.get("ParticipantName"),
        "team": C.canon(row.get("TeamName", "")),
        "team_id": str(row.get("TeamId")) if row.get("TeamId") else None,
        "country": row.get("ParticipantCountryCode"),
        "value": row.get("StatValue"),
        "sub_value": row.get("SubStatValue"),
        "matches": row.get("MatchesPlayed"),
        "minutes": row.get("MinutesPlayed"),
        "rank": row.get("Rank"),
    }


def leaderboards(league: C.League, props: Optional[Dict[str, Any]] = None,
                 top_n: int = TOP_N, refresh: bool = False,
                 verbose: bool = False) -> List[Dict[str, Any]]:
    """Every stat category for a league, each with its ranked top `top_n`."""
    season = C.SEASON_LABEL
    path = _cache_path("players", league.key, season)
    if not refresh:
        cached = _read_cache(path)
        if cached is not None:
            return cached

    if props is None:
        props = fotmob.page_data(fotmob.league_url(league))

    categories = (props.get("stats") or {}).get("players") or []
    out: List[Dict[str, Any]] = []

    for cat in categories:
        url = cat.get("fetchAllUrl")
        header = cat.get("header") or cat.get("name")
        if not url or not header:
            continue
        try:
            doc = fotmob.fetch_json(url)
        except fotmob.FotmobError as exc:
            if verbose:
                print(f"    ! {header}: {exc}")
            continue

        lists = doc.get("TopLists") or []
        if not lists:
            continue
        top = lists[0]
        rows = [_clean_entry(r) for r in (top.get("StatList") or [])[:top_n]]
        if not rows:
            continue

        out.append({
            "key": top.get("StatName") or cat.get("name"),
            "title": header,
            "subtitle": top.get("Subtitle"),
            "category": cat.get("category"),
            "format": top.get("StatFormat"),
            "decimals": top.get("StatDecimals", 0),
            "players": rows,
        })

    if verbose:
        print(f"  {len(out)} player stat categories")
    _write_cache(path, out)
    return out


# ---------------------------------------------------------------------------
# Squads
# ---------------------------------------------------------------------------

def _slugify(name: str) -> str:
    """
    'Atlético Madrid' -> 'atletico-madrid'.

    Accents have to be stripped rather than passed through: FotMob's own slugs
    are ASCII, and a URL containing 'atlético' 404s. That silently cost four
    LaLiga squads and three Bundesliga ones the first time round.
    """
    folded = unicodedata.normalize("NFKD", name.lower())
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    return "".join(c if c.isalnum() else "-" for c in folded).strip("-")


def _member(row: Dict[str, Any], group: str) -> Dict[str, Any]:
    injury = row.get("injury") or None
    return {
        "player_id": str(row.get("id")) if row.get("id") else None,
        "name": row.get("name"),
        "shirt": row.get("shirtNumber"),
        "group": group,
        "position": row.get("positionIdsDesc"),
        "country": row.get("ccode"),
        "age": row.get("age"),
        "height": row.get("height"),
        "rating": row.get("rating"),
        "goals": row.get("goals"),
        "assists": row.get("assists"),
        "penalties": row.get("penalties"),
        "yellow_cards": row.get("ycards"),
        "red_cards": row.get("rcards"),
        "market_value": row.get("transferValue"),
        # None when fit. `expected_return` is free text from the source
        # ("Mid October 2026", "Doubtful", "Unknown"), so it is displayed
        # rather than parsed into a date.
        "injured": bool(injury),
        "expected_return": (injury or {}).get("expectedReturn"),
    }


def squad(team_id: str, team_name: str,
          verbose: bool = False) -> List[Dict[str, Any]]:
    url = f"{fotmob.BASE}/teams/{team_id}/squad/{_slugify(team_name)}"
    props = fotmob.page_data(url)

    # The squad tab renders from SWR's fallback cache rather than from
    # pageProps directly, so the real payload hangs off a `team-{id}` key.
    node = (props.get("fallback") or {}).get(f"team-{team_id}") or {}
    groups = ((node.get("squad") or {}).get("squad")) or []

    players: List[Dict[str, Any]] = []
    for group in groups:
        title = (group.get("title") or "").lower()
        if title == "coach":
            continue
        for member in group.get("members") or []:
            players.append(_member(member, title))

    if verbose:
        hurt = sum(1 for p in players if p["injured"])
        print(f"    {team_name}: {len(players)} players, {hurt} unavailable")
    return players


def squads(league: C.League, table: List[Dict[str, Any]],
           refresh: bool = False, verbose: bool = False) -> Dict[str, Any]:
    """
    Every club's squad, keyed by canonical team name.

    `table` is the league's published table, which is where the FotMob team
    ids come from -- there is no separate club directory to walk.
    """
    season = C.SEASON_LABEL
    path = _cache_path("squads", league.key, season)
    if not refresh:
        cached = _read_cache(path)
        if cached is not None:
            return cached

    out: Dict[str, Any] = {}
    failed: List[str] = []
    for row in table:
        team_id, name = row.get("fotmob_team_id"), row.get("team")
        if not (team_id and name):
            continue
        try:
            out[name] = squad(team_id, name, verbose=verbose)
        except fotmob.FotmobError as exc:
            failed.append(name)
            if verbose:
                print(f"    ! {name}: {exc}")

    # Say so even when quiet. A squad that silently fails to fetch looks
    # exactly like a club with no injuries, and the first version of this
    # dropped seven clubs across two leagues without a word.
    if failed:
        print(f"  WARNING: no squad for {len(failed)} of {len(table)} clubs: "
              f"{', '.join(failed)}")

    if verbose:
        total = sum(len(v) for v in out.values())
        hurt = sum(1 for v in out.values() for p in v if p["injured"])
        print(f"  {len(out)} squads, {total} players, {hurt} unavailable")

    # Only cache a complete set, so a bad run expires in six hours rather than
    # freezing a hole in the data.
    if not failed:
        _write_cache(path, out)
    return out


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    key = args[0] if args else "epl"
    lg = C.get_league(key)
    fresh = "--refresh" in sys.argv

    page = fotmob.page_data(fotmob.league_url(lg))
    print(f"{lg.name}")
    boards = leaderboards(lg, page, refresh=fresh, verbose=True)
    rows = squads(lg, fotmob.parse_table(page), refresh=fresh, verbose=True)

    if boards:
        top = boards[0]
        print(f"\n  {top['title']}:")
        for p in top["players"][:5]:
            print(f"    {p['rank']:>2} {p['name']:<24} {p['team']:<18} {p['value']}")
