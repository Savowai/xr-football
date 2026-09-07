"""
FotMob adapter.

Why FotMob rather than the previous ESPN + football-data.co.uk pairing:

  * It covers all five major European leagues from one shape of page, so
    adding a league is a config entry rather than a new parser.
  * It carries per-match expected goals -- and splits them into open play vs
    set play, which football-data.co.uk never did. Set-piece xG is a genuinely
    different signal from open-play xG and the model can use it.
  * football-data.co.uk went 503 mid-build and took the entire expected table
    down with it. One source that is actually maintained beats two that are not.

How the data is obtained: FotMob's pages are server-rendered by Next.js, which
means the full payload for a page is embedded in it as JSON inside a
<script id="__NEXT_DATA__"> tag. We fetch the ordinary public page and read that
blob. No headless browser, no private endpoints.

On politeness -- this matters, so it is enforced rather than documented:
  * robots.txt disallows /api/*, so we never touch it. Normal page paths are
    explicitly allowed.
  * League pages are cheap (five per run). Match detail pages are not, so
    finished matches are cached permanently: a played match's xG never changes,
    so it is fetched exactly once, ever.
  * Every request is rate limited by REQUEST_DELAY.
"""

from __future__ import annotations

import gzip
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import config as C

BASE = "https://www.fotmob.com"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

# Seconds between requests. FotMob is somebody else's server and this pipeline
# runs hourly; there is no hurry.
REQUEST_DELAY = 1.5

_NEXT_DATA = re.compile(
    r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S
)

_last_request = 0.0


class FotmobError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------

def _raw_get(url: str, timeout: int = 30,
             accept: str = "text/html,application/xhtml+xml") -> bytes:
    """
    One throttled request, gzip handled.

    Everything goes through here so the delay above stays shared across every
    caller. The stats host (data.fotmob.com) serves pre-gzipped objects and
    sends them regardless of request headers, so decompression is decided by
    what came back rather than by what we asked for.
    """
    global _last_request
    elapsed = time.time() - _last_request
    if elapsed < REQUEST_DELAY:
        time.sleep(REQUEST_DELAY - elapsed)

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": accept,
            "Accept-Encoding": "gzip",
            "Accept-Language": "en-GB,en;q=0.9",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            gzipped = (resp.headers.get("Content-Encoding") == "gzip"
                       or raw[:2] == b"\x1f\x8b")
        if gzipped:
            raw = gzip.decompress(raw)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise FotmobError(f"fetch failed for {url}: {exc}") from exc
    finally:
        _last_request = time.time()
    return raw


def _get(url: str, timeout: int = 30) -> str:
    return _raw_get(url, timeout).decode("utf-8", errors="replace")


def fetch_json(url: str, timeout: int = 30) -> Any:
    """A JSON document from FotMob's stats host."""
    raw = _raw_get(url, timeout, accept="application/json")
    try:
        return json.loads(raw.decode("utf-8", errors="replace"))
    except ValueError as exc:
        raise FotmobError(f"unparseable JSON at {url}: {exc}") from exc


def page_data(url: str) -> Dict[str, Any]:
    """Fetch a FotMob page and return its embedded pageProps."""
    match = _NEXT_DATA.search(_get(url))
    if not match:
        raise FotmobError(f"no __NEXT_DATA__ payload in {url}")
    try:
        blob = json.loads(match.group(1))
    except ValueError as exc:
        raise FotmobError(f"unparseable __NEXT_DATA__ in {url}: {exc}") from exc
    try:
        return blob["props"]["pageProps"]
    except KeyError as exc:
        raise FotmobError(f"unexpected payload shape in {url}") from exc


def league_url(league: "C.League",
               season_start_year: Optional[int] = None) -> str:
    url = f"{BASE}/leagues/{league.fotmob_id}/overview/{league.fotmob_slug}"
    if season_start_year is not None:
        # FotMob wants the full four-digit pair, hyphenated: 2025-2026.
        url += f"?season={season_start_year}-{season_start_year + 1}"
    return url


# ---------------------------------------------------------------------------
# Parsing: fixtures and results
# ---------------------------------------------------------------------------

def _parse_score(score_str: Optional[str]) -> tuple:
    """'3 - 0' -> (3, 0). Anything unexpected -> (None, None)."""
    if not score_str:
        return None, None
    parts = score_str.replace("–", "-").split("-")
    if len(parts) != 2:
        return None, None
    try:
        return int(parts[0].strip()), int(parts[1].strip())
    except ValueError:
        return None, None


def _status_of(status: Dict[str, Any]) -> str:
    if status.get("cancelled"):
        # FotMob reuses `cancelled` for postponements; the reason text
        # distinguishes them and the two mean different things to the model
        # (a postponed match will be replayed, a cancelled one will not).
        reason = (status.get("reason", {}) or {}).get("long", "").lower()
        return "postponed" if "postpon" in reason else "cancelled"
    if status.get("finished"):
        return "finished"
    if status.get("started"):
        return "live"
    return "scheduled"


def parse_matches(props: Dict[str, Any], league: "C.League",
                  season: str) -> List[Dict[str, Any]]:
    raw = (props.get("fixtures") or {}).get("allMatches") or []
    out: List[Dict[str, Any]] = []

    for m in raw:
        status = m.get("status") or {}
        kickoff = status.get("utcTime") or ""
        home = C.canon((m.get("home") or {}).get("name", ""))
        away = C.canon((m.get("away") or {}).get("name", ""))
        if not home or not away:
            continue

        hg, ag = _parse_score(status.get("scoreStr"))
        state = _status_of(status)
        # A match FotMob still calls "started" but which has a full-time score
        # is finished; trust the score over the flag.
        if state == "live" and status.get("reason", {}).get("short") == "FT":
            state = "finished"

        out.append({
            "fotmob_id": str(m.get("id")),
            "page_url": m.get("pageUrl"),
            "league": league.key,
            "season": season,
            "round": _int_or_none(m.get("roundName") or m.get("round")),
            "date": kickoff[:10],
            "kickoff_iso": kickoff,
            "status": state,
            "status_detail": (status.get("reason") or {}).get("long"),
            "minute": (status.get("liveTime") or {}).get("short"),
            "home": home,
            "away": away,
            "home_goals": hg,
            "away_goals": ag,
            # Filled in later from the match detail page, for finished matches.
            "home_xg": None, "away_xg": None,
            "home_xg_set_play": None, "away_xg_set_play": None,
            "home_xgot": None, "away_xgot": None,
            "home_shots": None, "away_shots": None,
            "home_sot": None, "away_sot": None,
            "home_possession": None, "away_possession": None,
            "home_corners": None, "away_corners": None,
            "home_big_chances": None, "away_big_chances": None,
        })

    out.sort(key=lambda m: (m["kickoff_iso"] or "", m["home"]))
    return out


def _int_or_none(v: Any) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Parsing: league table
# ---------------------------------------------------------------------------

def parse_table(props: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The league's own published table.

    We compute our own standings from results too, but FotMob's is the
    authority on points deductions -- which no amount of adding up match
    results will ever reveal.
    """
    try:
        data = props["table"][0]["data"]["table"]
    except (KeyError, IndexError, TypeError):
        return []
    rows = data.get("all") if isinstance(data, dict) else None
    if not rows:
        return []

    out = []
    for r in rows:
        out.append({
            "position": r.get("idx"),
            "team": C.canon(r.get("name", "")),
            "fotmob_team_id": str(r.get("id")) if r.get("id") else None,
            "played": r.get("played"),
            "won": r.get("wins"),
            "drawn": r.get("draws"),
            "lost": r.get("losses"),
            "gf": _goals_side(r.get("scoresStr"), 0),
            "ga": _goals_side(r.get("scoresStr"), 1),
            "gd": r.get("goalConDiff"),
            "points": r.get("pts"),
        })
    return out


def _goals_side(scores: Optional[str], idx: int) -> Optional[int]:
    """'12-5' -> 12 or 5."""
    if not scores:
        return None
    parts = str(scores).replace("–", "-").split("-")
    if len(parts) != 2:
        return None
    try:
        return int(parts[idx].strip())
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Parsing: per-match detail (the xG that the model actually runs on)
# ---------------------------------------------------------------------------

# FotMob stat keys -> the field names the pipeline uses. Values arrive as a
# two-element [home, away] list, sometimes as strings, sometimes with a
# percentage suffix, hence the tolerant coercion below.
_STAT_KEYS = {
    "expected_goals": ("home_xg", "away_xg", float),
    "expected_goals_set_play": ("home_xg_set_play", "away_xg_set_play", float),
    "expected_goals_on_target": ("home_xgot", "away_xgot", float),
    "total_shots": ("home_shots", "away_shots", int),
    "ShotsOnTarget": ("home_sot", "away_sot", int),
    "BallPossesion": ("home_possession", "away_possession", int),
    "corners": ("home_corners", "away_corners", int),
    "big_chance": ("home_big_chances", "away_big_chances", int),
}


def _coerce(value: Any, cast) -> Optional[Any]:
    if value is None:
        return None
    if isinstance(value, str):
        # "565 (92%)" -> 565 ; "1.88" -> 1.88
        value = value.split("(")[0].strip().rstrip("%")
    try:
        return cast(float(value))
    except (TypeError, ValueError):
        return None


def match_home_team(props: Dict[str, Any]) -> Optional[str]:
    """Whom the match page itself considers the home side.

    Worth checking rather than assuming: the fixture's `pageUrl` slug is NOT
    home-vs-away (the Arsenal 3-0 Coventry fixture lives at
    /matches/coventry-city-vs-arsenal/...), so anyone reasoning from the URL
    would silently invert the fixture. Since every stat on the page is a
    [home, away] pair, an inverted match would hand each side the other's xG
    and quietly poison both the ratings and home advantage.
    """
    try:
        return C.canon(props["general"]["homeTeam"]["name"])
    except (KeyError, TypeError):
        return None


def match_page_id(props: Dict[str, Any]) -> Optional[str]:
    """The match id the returned page actually describes.

    Checked because the team-name guard alone is not enough. Both legs of a
    fixture share two team names, so serving the wrong leg passes a name check
    half the time -- it only trips when the sides happen to be reversed. The id
    is exact, so it catches a wrong leg even when the orientation coincides.
    """
    try:
        value = props["general"]["matchId"]
    except (KeyError, TypeError):
        return None
    return str(value) if value is not None else None


def parse_match_stats(props: Dict[str, Any]) -> Dict[str, Any]:
    """Pull the stats we model on out of a match page payload."""
    stats: Dict[str, Any] = {}
    try:
        groups = props["content"]["stats"]["Periods"]["All"]["stats"]
    except (KeyError, TypeError):
        return stats

    for group in groups or []:
        for item in group.get("stats") or []:
            mapping = _STAT_KEYS.get(item.get("key"))
            if not mapping:
                continue
            home_field, away_field, cast = mapping
            values = item.get("stats") or [None, None]
            if len(values) < 2:
                continue
            home_value = _coerce(values[0], cast)
            away_value = _coerce(values[1], cast)
            # The same key appears more than once per page (a section header
            # row carries [None, None]); never let that clobber a real value.
            if home_value is not None and stats.get(home_field) is None:
                stats[home_field] = home_value
            if away_value is not None and stats.get(away_field) is None:
                stats[away_field] = away_value
    return stats


def match_url(match: Dict[str, Any]) -> str:
    """The one URL form that actually identifies a match to the server.

    The fixture list hands us a `pageUrl` like
    /matches/arsenal-vs-brentford/389pak#4813506, and it is a trap. The match
    id lives in the *fragment*, which a browser keeps to itself and never puts
    on the wire -- so fetching that URL asks the server only for the slug, and
    the slug identifies the fixture *pairing*, not the leg. Requesting the
    Arsenal-hosted December fixture that way returns the Brentford-hosted one
    (a different match id, a different scoreline, mirrored stats).

    /match/{id} resolves server-side and returns the match we asked for.
    """
    return f"{BASE}/match/{match['fotmob_id']}"


# ---------------------------------------------------------------------------
# Match-detail cache
# ---------------------------------------------------------------------------

def cache_path(league_key: str, season: str) -> str:
    safe = season.replace("/", "-")
    return os.path.join(C.DATA_CACHE_DIR, f"{league_key}_{safe}_stats.json")


def load_cache(league_key: str, season: str) -> Dict[str, Any]:
    try:
        with open(cache_path(league_key, season)) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def save_cache(league_key: str, season: str, cache: Dict[str, Any]) -> None:
    os.makedirs(C.DATA_CACHE_DIR, exist_ok=True)
    with open(cache_path(league_key, season), "w") as fh:
        json.dump(cache, fh, indent=1, sort_keys=True)


def hydrate_stats(matches: List[Dict[str, Any]], league_key: str, season: str,
                  limit: Optional[int] = None, verbose: bool = True) -> int:
    """Attach per-match stats to finished matches, fetching only what is new.

    Returns the number of matches fetched from the network this run. A played
    match's stats are immutable, so anything already cached is reused forever
    and the steady-state cost of an hourly run is however many matches finished
    in the last hour -- usually zero.
    """
    cache = load_cache(league_key, season)
    pending = [m for m in matches
               if m["status"] == "finished" and m["fotmob_id"] not in cache]
    if limit is not None:
        pending = pending[:limit]

    fetched, failed, skewed = 0, 0, 0
    for i, match in enumerate(pending, 1):
        try:
            props = page_data(match_url(match))
        except FotmobError as exc:
            failed += 1
            if verbose:
                print(f"    ! {match['home']} v {match['away']}: {exc}")
            continue

        # Refuse the page rather than trust it if it is not unambiguously the
        # match we asked for. Identity first (exact), then orientation.
        page_id = match_page_id(props)
        if page_id and page_id != str(match["fotmob_id"]):
            skewed += 1
            if verbose:
                print(f"    ! wrong match returned for {match['home']} v "
                      f"{match['away']}: asked {match['fotmob_id']}, got {page_id}")
            continue

        page_home = match_home_team(props)
        if page_home and page_home != match["home"]:
            skewed += 1
            if verbose:
                print(f"    ! orientation mismatch for {match['home']} v "
                      f"{match['away']}: match page says home is {page_home}")
            continue

        stats = parse_match_stats(props)
        if stats:
            cache[match["fotmob_id"]] = stats
            fetched += 1
        if verbose and (i % 25 == 0 or i == len(pending)):
            print(f"    match detail {i}/{len(pending)}")

    if fetched:
        save_cache(league_key, season, cache)

    for match in matches:
        stats = cache.get(match["fotmob_id"])
        if stats:
            match.update(stats)

    if verbose and failed:
        print(f"    {failed} match pages failed; will retry next run")
    if verbose and skewed:
        print(f"    {skewed} match pages rejected on home/away mismatch")
    return fetched


# ---------------------------------------------------------------------------
# Top-level
# ---------------------------------------------------------------------------

def load_league(league: "C.League", fetch_details: bool = True,
                detail_limit: Optional[int] = None,
                season_start_year: Optional[int] = None,
                verbose: bool = True) -> Dict[str, Any]:
    """Everything the pipeline needs for one league, in one call.

    Pass season_start_year to load a completed season for the archive; omit it
    for the season currently in progress.
    """
    if verbose:
        print(f"Fetching {league.name} from FotMob...")

    props = page_data(league_url(league, season_start_year))
    season = (props.get("details") or {}).get("selectedSeason") or ""
    matches = parse_matches(props, league, season)
    table = parse_table(props)

    played = [m for m in matches if m["status"] == "finished"]
    if verbose:
        print(f"  {season}: {len(matches)} fixtures, {len(played)} played, "
              f"{len(table)} teams in table")

    if fetch_details and played:
        fetched = hydrate_stats(matches, league.key, season,
                                limit=detail_limit, verbose=verbose)
        covered = sum(1 for m in played if m.get("home_xg") is not None)
        if verbose:
            print(f"  xG: {covered}/{len(played)} played matches "
                  f"({fetched} newly fetched)")

    return {
        "league": league,
        "season": season,
        "matches": matches,
        "table": table,
        # Handed back so callers that want another slice of the same page --
        # player leaderboards, say -- do not have to fetch it a second time.
        "props": props,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
