"""
Freeze a completed season into data/archive/ for use as a model prior.

A new season starts with almost no data, so the priors carried over from last
season do most of the work in August and September. That makes the archive part
of the model rather than a leftover, which is why it is regenerated from source
rather than hand-maintained.

Usage:
    python3 scripts/build_archive.py                # last season, all leagues
    python3 scripts/build_archive.py 2025           # a specific season
    python3 scripts/build_archive.py 2025 epl laliga

This is slow the first time -- a full season is 306-380 match pages per league,
fetched politely -- but the per-match cache means re-running it is nearly free.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config as C
import fotmob


def build(start_year: int, league: C.League) -> str:
    label = C.season_label(start_year)
    print(f"\n{league.name} {label}")

    payload = fotmob.load_league(league, season_start_year=start_year)
    matches = payload["matches"]

    played = [m for m in matches if m.get("home_goals") is not None]
    with_xg = sum(1 for m in played if m.get("home_xg") is not None)
    print(f"  {len(played)}/{len(matches)} played, {with_xg} with xG")

    # An archived season should be complete. A half-finished archive would give
    # the new season's priors a silently biased view of last year -- so say so
    # loudly rather than writing something that looks fine.
    if len(matches) and len(played) < len(matches) * 0.98:
        print(f"  WARNING: season looks incomplete "
              f"({len(played)}/{len(matches)}); priors will be skewed")

    os.makedirs(C.DATA_ARCHIVE_DIR, exist_ok=True)
    path = os.path.join(C.DATA_ARCHIVE_DIR,
                        f"{league.key}_{label.replace('-', '_')}.json")
    with open(path, "w") as fh:
        json.dump(matches, fh, indent=1)
    print(f"  Wrote {path}")
    return path


def load_archive(start_year: int, league_key: str = "epl"):
    label = C.season_label(start_year)
    path = os.path.join(C.DATA_ARCHIVE_DIR,
                        f"{league_key}_{label.replace('-', '_')}.json")
    if not os.path.exists(path):
        return []
    with open(path) as fh:
        return json.load(fh)


def main() -> None:
    args = sys.argv[1:]
    year = C.SEASON_START_YEAR - 1
    if args and args[0].isdigit():
        year = int(args.pop(0))
    leagues = [C.get_league(k) for k in args] if args else C.LEAGUES

    for league in leagues:
        try:
            build(year, league)
        except fotmob.FotmobError as exc:
            print(f"  FAILED {league.key}: {exc}")


if __name__ == "__main__":
    main()
