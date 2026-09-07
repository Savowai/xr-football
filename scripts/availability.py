"""
Squad availability adjustment.

The rating model fits one attack and one defence number per club and then
assumes that squad is the squad. It is the largest thing the betting market
can see that a public-data model cannot: the market knows a side is without
its first-choice striker and centre-back, and the ratings do not.

This module closes part of that gap. It reads the current squad snapshot,
works out who is unavailable *for a specific fixture date*, and turns that
into a pair of multipliers on the club's attack and defence ratings.

Three design decisions are worth stating, because each of them is a place a
naive version would go wrong.

  1. Loss is measured against replacement, not in absolute terms. A club that
     loses its fourth-choice centre-back has lost nothing, because the third
     was already playing. So each positional group is scored as "sum of the
     best N available" over "sum of the best N in the full squad". Depth is
     therefore priced automatically: the same injury costs a thin squad more
     than a deep one, which is the actual football fact.

  2. It is per-fixture, not per-club. FotMob publishes an expected return
     date, so a player out until mid-October is missing for next weekend and
     present for the one after. Applying a single blanket penalty to every
     future fixture would be wrong in a way that gets worse the further out
     you look, and the club pages show fixtures two months ahead.

  3. It applies to forecasts only, never to the rating fit or to the
     walk-forward predictions for matches already played. The snapshot
     describes who is injured *today*. Using it to "predict" a match from
     August would be leakage of the worst kind -- scoring the model on
     information that did not exist at kick-off.

Player importance is market value. On the surface that is a crude proxy, but
in September it is the only one that is not mostly noise: three matches of
FotMob ratings cannot distinguish a first choice from a stand-in, and goals
and assists at that sample size are close to meaningless. Market value is
the market's own standing estimate of quality, and it is available for every
player in every squad.

CALIBRATION HONESTLY STATED: the strength of the adjustment (AVAILABILITY_K)
is not fitted, because it cannot be. Fitting it needs historical injury
snapshots and this project has one snapshot, taken now. The value is chosen
so that a typical mid-season injury list moves a forecast by one to three
percent and the worst case is capped at twelve, which is smaller than the
effect the literature reports. Erring small is deliberate: an unfitted
parameter should not be allowed to overrule ratings that were fitted. Every
build appends a dated snapshot to data/history/availability.jsonl so that
this becomes a fittable question in a few months rather than a permanent
assumption.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

# --- tunables --------------------------------------------------------------

# How many players from each group are "the team". Roughly a 4-3-3, which is
# what the FotMob grouping (keepers/defenders/midfielders/attackers) implies
# once wingers are counted as attackers.
STARTERS = {"keepers": 1, "defenders": 4, "midfielders": 3, "attackers": 3}

# How much each group contributes to scoring and to preventing goals. Each
# column sums to 1.0, so a club that lost its entire squad would post a
# deficit of exactly 1.0 on both sides.
ATTACK_SHARE = {"keepers": 0.00, "defenders": 0.10, "midfielders": 0.35, "attackers": 0.55}
DEFENCE_SHARE = {"keepers": 0.35, "defenders": 0.40, "midfielders": 0.20, "attackers": 0.05}

# Strength of the adjustment, and the hard cap on it. See the note above.
AVAILABILITY_K = 0.35
MAX_SHIFT = 0.12

# The source writes two kinds of return note. Roughly five in six are an
# absolute month -- "Mid October 2026" -- and the rest are relative prose.
# The relative ones matter more than their share suggests: "Back in training"
# is a player who will be fit this weekend, and reading it as "no date given,
# assume still out" would keep him sidelined in every forecast for months.
# That was this parser's first bug and it is the reason the phrase table below
# exists rather than a bare regex.
DOUBTFUL_DAYS = 5
UNKNOWN_DAYS = 30
SEASON_END_DAYS = 250

_PHRASES = {
    "doubtful": DOUBTFUL_DAYS,
    "back in training": 4,
    "about a week": 7,
    "about 1-2 weeks": 11,
    "a few weeks": 21,
    "out for season": SEASON_END_DAYS,
    "unknown": UNKNOWN_DAYS,
    "": UNKNOWN_DAYS,
    "-": UNKNOWN_DAYS,
}

# Generic fallbacks for phrasings the table has not seen yet, so a wording
# change at the source degrades to a sensible number instead of to "forever".
_WEEKS_RE = re.compile(r"(\d+)\s*(?:-\s*(\d+)\s*)?week", re.IGNORECASE)
_MONTHS_RE = re.compile(r"(\d+)\s*(?:-\s*(\d+)\s*)?month", re.IGNORECASE)

_MONTHS = {m: i + 1 for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"])}

# "Early" / "Mid" / "Late" mapped to a day of the month.
_PART = {"early": 7, "mid": 15, "late": 25}

_RETURN_RE = re.compile(
    r"^\s*(early|mid|late)?\s*([a-z]+)\s+(\d{4})\s*$", re.IGNORECASE)

# Every return string the parser could not read, collected so that a build can
# report vocabulary drift instead of absorbing it silently.
UNPARSED: Dict[str, int] = {}


def parse_return(text: Optional[str], today: date) -> Optional[date]:
    """
    Turn FotMob's free-text return into a date.

    The field is prose written for humans, so this is a parser, not a cast.
    It handles absolute months ("Late October 2026"), a table of known
    phrases, and a numeric fallback for "3 weeks" style wording. Anything
    still unreadable returns None; the caller treats None as "out
    indefinitely", because an unparseable note is still an injury.
    """
    if not text:
        return None
    t = " ".join(text.strip().lower().split())

    if t in _PHRASES:
        return today + timedelta(days=_PHRASES[t])

    m = _RETURN_RE.match(t)
    if m:
        part, month_name, year = m.group(1), m.group(2), m.group(3)
        month = _MONTHS.get(month_name)
        if month:
            try:
                return date(int(year), month, _PART.get(part or "mid", 15))
            except ValueError:
                pass

    # "2 weeks", "1-2 weeks", "3 months": take the upper bound, since clubs
    # optimise these estimates for hope.
    for pattern, unit in ((_WEEKS_RE, 7), (_MONTHS_RE, 30)):
        m = pattern.search(t)
        if m:
            n = int(m.group(2) or m.group(1))
            return today + timedelta(days=n * unit)

    if "season" in t:
        return today + timedelta(days=SEASON_END_DAYS)

    UNPARSED[t] = UNPARSED.get(t, 0) + 1
    return None


def is_out_on(player: Dict[str, Any], on: date, today: date) -> bool:
    """Is this player unavailable for a fixture on `on`?"""
    if not player.get("injured"):
        return False
    back = parse_return(player.get("expected_return"), today)
    if back is None:
        # Injured with no readable return date: assume still out.
        return True
    return back > on


def _importance(player: Dict[str, Any]) -> float:
    """
    A player's weight within their group.

    Market value, with the season rating as a fallback and a small floor so
    that a squad of entirely unvalued players still divides sensibly rather
    than by zero.
    """
    mv = player.get("market_value")
    if mv:
        return float(mv)
    rating = player.get("rating")
    if rating:
        # Ratings live around 6-8; cube them so the spread resembles value.
        return float(rating) ** 3
    return 1.0


def _group_loss(players: Sequence[Dict[str, Any]], out: set, group: str) -> float:
    """
    Fraction of a group's first-choice strength that is missing.

    Compares the best N available against the best N in the full squad, so
    the answer is zero whenever the injured player was not going to play.
    """
    n = STARTERS.get(group, 3)
    full = sorted((_importance(p) for p in players), reverse=True)[:n]
    avail = sorted((_importance(p) for p in players
                    if id(p) not in out), reverse=True)[:n]
    total = sum(full)
    if total <= 0:
        return 0.0
    return max(0.0, 1.0 - sum(avail) / total)


@dataclass
class Adjustment:
    """Multipliers on a club's fitted ratings for one fixture."""
    attack: float = 1.0
    defence: float = 1.0
    missing: List[str] = None
    attack_deficit: float = 0.0
    defence_deficit: float = 0.0

    def __post_init__(self) -> None:
        if self.missing is None:
            self.missing = []

    @property
    def active(self) -> bool:
        """True when this actually moves the forecast at all."""
        return abs(self.attack - 1.0) > 0.002 or abs(self.defence - 1.0) > 0.002


NEUTRAL = Adjustment()


def for_fixture(squad: Optional[Sequence[Dict[str, Any]]], on: date,
                today: date, k: float = AVAILABILITY_K) -> Adjustment:
    """
    Attack and defence multipliers for one club on one date.

    Attack comes back at or below 1.0 and defence at or above 1.0, because
    defence is leakiness: a depleted side both scores less and concedes more.
    """
    if not squad:
        return NEUTRAL

    out = {id(p) for p in squad if is_out_on(p, on, today)}
    if not out:
        return NEUTRAL

    by_group: Dict[str, List[Dict[str, Any]]] = {}
    for p in squad:
        by_group.setdefault(p.get("group") or "midfielders", []).append(p)

    atk_def = 0.0
    dfn_def = 0.0
    for group, players in by_group.items():
        loss = _group_loss(players, out, group)
        if loss <= 0:
            continue
        atk_def += ATTACK_SHARE.get(group, 0.0) * loss
        dfn_def += DEFENCE_SHARE.get(group, 0.0) * loss

    attack = 1.0 - min(k * atk_def, MAX_SHIFT)
    defence = 1.0 + min(k * dfn_def, MAX_SHIFT)

    missing = sorted(
        (p.get("name", "?") for p in squad if id(p) in out),
        key=lambda n: n)
    return Adjustment(attack=attack, defence=defence, missing=missing,
                      attack_deficit=atk_def, defence_deficit=dfn_def)


def lambdas(ratings, home: str, away: str,
            home_adj: Adjustment = NEUTRAL,
            away_adj: Adjustment = NEUTRAL) -> Tuple[float, float]:
    """
    The model's goal rates with availability folded in.

    Deliberately mirrors Ratings.lambdas rather than wrapping it, so that the
    adjustment is visible at the point the rates are formed instead of being
    applied as a mystery correction afterwards.
    """
    import config as C
    from xr_model import _clamp

    lh = (ratings.base
          * ratings.attack_of(home) * home_adj.attack
          * ratings.defence_of(away) * away_adj.defence
          * ratings.home_adv)
    la = (ratings.base
          * ratings.attack_of(away) * away_adj.attack
          * ratings.defence_of(home) * home_adj.defence)
    return (_clamp(lh, C.MIN_LAMBDA, C.MAX_LAMBDA),
            _clamp(la, C.MIN_LAMBDA, C.MAX_LAMBDA))


# ---------------------------------------------------------------------------
# Snapshot history
# ---------------------------------------------------------------------------

HISTORY_PATH = "data/history/availability.jsonl"


def record_snapshot(league_key: str, squads: Dict[str, List[Dict[str, Any]]],
                    today: Optional[date] = None,
                    path: str = HISTORY_PATH) -> None:
    """
    Append today's injury list to an ever-growing log.

    This is the only reason the adjustment above can ever stop being a guess.
    One snapshot supports no inference at all; a season of dated snapshots
    can be replayed against results and the strength of the effect measured
    rather than asserted. Writing the file costs nothing now and is the
    difference between a parameter that can be checked and one that cannot.

    One line per league per day; re-running a build on the same day replaces
    that day's line rather than duplicating it.
    """
    today = today or date.today()
    stamp = today.isoformat()

    entry = {
        "date": stamp,
        "league": league_key,
        "clubs": {
            team: [
                {"name": p.get("name"),
                 "player_id": p.get("player_id"),
                 "group": p.get("group"),
                 "market_value": p.get("market_value"),
                 "expected_return": p.get("expected_return")}
                for p in squad if p.get("injured")
            ]
            for team, squad in squads.items()
        },
    }

    os.makedirs(os.path.dirname(path), exist_ok=True)
    kept: List[str] = []
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if row.get("date") == stamp and row.get("league") == league_key:
                    continue
                kept.append(line)

    kept.append(json.dumps(entry, separators=(",", ":")))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(kept) + "\n")
