"""
Build the site's data files.

Run hourly by .github/workflows/data-refresh.yml.

    python3 scripts/build.py

Predictions for matches that have already been played are generated
walk-forward: the model is refitted using only results from before that
matchday, so the prediction shown against a finished match is the one the
model would genuinely have made beforehand. Anything else would let the site
quietly mark its own homework.
"""

from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import availability
import config as C
import fotmob
import players
import reasoning
import xr_model as M
from build_archive import load_archive


def league_dir(league_key: str) -> str:
    return os.path.join(C.DATA_PROCESSED_DIR, league_key)


def write(league_key: str, name: str, payload: Any) -> None:
    directory = league_dir(league_key)
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, name)
    with open(path, "w") as fh:
        json.dump(payload, fh, indent=1)
    size = os.path.getsize(path) / 1024
    print(f"  {path}  ({size:.0f} KB)")


def read_previous(league_key: str, name: str) -> Any:
    """Last run's output, or None. Never raises -- a corrupt or missing file
    just means we have no history to fall back on."""
    path = os.path.join(league_dir(league_key), name)
    try:
        with open(path) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


# Per-match detail, as opposed to the fixture list. These are the fields at
# risk if a match detail page fails to fetch.
_CARRIED_FIELDS = ("home_xg", "away_xg", "home_xg_set_play", "away_xg_set_play",
                   "home_xgot", "away_xgot", "home_shots", "away_shots",
                   "home_sot", "away_sot", "home_corners", "away_corners",
                   "home_possession", "away_possession",
                   "home_big_chances", "away_big_chances")


def backfill_from_previous(league_key: str, matches: List[Dict[str, Any]]) -> int:
    """Restore shot-quality fields from the last successful build.

    The pipeline rebuilds every file from scratch on each run, which is what
    keeps it from drifting -- but it also means a single upstream outage would
    otherwise publish a season with no xG at all. That is not a cosmetic
    problem: xPts is computed purely from xG, so a failed fetch silently zeroes
    the entire expected table and reports every side as maximally lucky.

    Since a played match's xG never changes once recorded, carrying the last
    known value forward is strictly better than dropping it. Live values from
    the current fetch always win; this only fills genuine gaps.
    """
    previous = read_previous(league_key, "matches.json")
    if not previous:
        return 0

    prior = {(m.get("home"), m.get("away")): m for m in previous}
    restored = 0
    for m in matches:
        old = prior.get((m.get("home"), m.get("away")))
        if not old:
            continue
        filled = False
        for field in _CARRIED_FIELDS:
            if m.get(field) is None and old.get(field) is not None:
                m[field] = old[field]
                filled = True
        if filled:
            restored += 1
    return restored


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------

def standings(matches: List[Dict[str, Any]], teams: List[str],
              xr_by_key: Dict[tuple, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    The real table and the deserved table, side by side.

    xPts come from each match's own xG, so the expected column answers "what
    would this season look like if chances had been converted at a league-average
    rate" -- which is the question the whole project exists to ask.
    """
    rows = {t: {"team": t, "played": 0, "won": 0, "drawn": 0, "lost": 0,
                "gf": 0, "ga": 0, "gd": 0, "points": 0,
                "xg_for": 0.0, "xg_against": 0.0, "xpts": 0.0}
            for t in teams}

    for m in matches:
        if m.get("home_goals") is None or m.get("status") != "finished":
            continue
        h, a = m["home"], m["away"]
        if h not in rows or a not in rows:
            continue
        hg, ag = m["home_goals"], m["away_goals"]
        for team, gf, ga in ((h, hg, ag), (a, ag, hg)):
            r = rows[team]
            r["played"] += 1
            r["gf"] += gf
            r["ga"] += ga
            r["gd"] = r["gf"] - r["ga"]
            if gf > ga:
                r["won"] += 1
                r["points"] += 3
            elif gf == ga:
                r["drawn"] += 1
                r["points"] += 1
            else:
                r["lost"] += 1

        hx, ax = m.get("home_xg"), m.get("away_xg")
        if hx is not None and ax is not None:
            rows[h]["xg_for"] += hx
            rows[h]["xg_against"] += ax
            rows[a]["xg_for"] += ax
            rows[a]["xg_against"] += hx
            xr = xr_by_key.get((h, a))
            if xr:
                rows[h]["xpts"] += xr["xresult_xpts_home"]
                rows[a]["xpts"] += xr["xresult_xpts_away"]

    out = list(rows.values())
    for r in out:
        r["xg_for"] = round(r["xg_for"], 2)
        r["xg_against"] = round(r["xg_against"], 2)
        r["xg_diff"] = round(r["xg_for"] - r["xg_against"], 2)
        r["xpts"] = round(r["xpts"], 2)
        # Positive means the table flatters them relative to the chances.
        r["luck"] = round(r["points"] - r["xpts"], 2)

    out.sort(key=lambda r: (-r["points"], -r["gd"], -r["gf"], r["team"]))
    for i, r in enumerate(out, 1):
        r["position"] = i
    by_xpts = sorted(out, key=lambda r: (-r["xpts"], -r["xg_diff"], r["team"]))
    for i, r in enumerate(by_xpts, 1):
        r["xposition"] = i
    return out


def power_rankings(ratings: M.Ratings, teams: List[str]) -> List[Dict[str, Any]]:
    """Current model strength, independent of results and fixtures so far."""
    rows = []
    for t in teams:
        atk, dfn = ratings.attack_of(t), ratings.defence_of(t)
        neutral_for = ratings.base * atk
        neutral_against = ratings.base * dfn
        rows.append({
            "team": t,
            "attack": round(atk, 3),
            "defence": round(dfn, 3),
            "expected_gf_per_game": round(neutral_for, 2),
            "expected_ga_per_game": round(neutral_against, 2),
            "net_rating": round(neutral_for - neutral_against, 3),
            "evidence_matches": round(ratings.evidence.get(t, 0.0), 1),
        })
    rows.sort(key=lambda r: -r["net_rating"])
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    return rows


# ---------------------------------------------------------------------------
# Main build
# ---------------------------------------------------------------------------

def build_league(league: C.League) -> Optional[Dict[str, Any]]:
    """Fetch, fit and write everything for one league.

    Returns a summary for the league index, or None if the league was skipped
    because its data could not be trusted. A skipped league keeps whatever was
    published last run rather than being overwritten with something worse.
    """
    start_year = C.SEASON_START_YEAR
    season = C.season_label(start_year)

    print(f"\n{'=' * 62}\n{league.name} ({league.country})\n{'=' * 62}")
    try:
        payload = fotmob.load_league(league)
    except fotmob.FotmobError as exc:
        print(f"  FAILED: {exc}\n  Leaving existing {league.key} data in place.")
        return None

    matches = payload["matches"]
    published_table = payload["table"]

    restored = backfill_from_previous(league.key, matches)
    if restored:
        print(f"  Restored detail on {restored} matches from the last build")

    teams = sorted({m["home"] for m in matches} | {m["away"] for m in matches})
    played = [m for m in matches if m.get("status") == "finished"]

    # Refuse to publish an expected table built on no evidence. xPts is derived
    # purely from xG, so zero coverage does not degrade the output gracefully --
    # it produces a table where every side has 0.00 xPts and therefore looks
    # maximally lucky. Better to leave the previous run's correct data in place
    # and try again in an hour than to overwrite it with nonsense.
    coverage = sum(1 for m in played if m.get("home_xg") is not None)
    previous_meta = read_previous(league.key, "metadata.json") or {}
    if played and coverage == 0 and previous_meta.get("xg_coverage", 0) > 0:
        print(f"  ABORTING {league.key}: {len(played)} matches played but no "
              f"shot data for any of them (last build had "
              f"{previous_meta['xg_coverage']}). Leaving existing data.")
        return None

    print(f"  {len(matches)} fixtures, {len(played)} played, {len(teams)} teams")
    if len(teams) != league.teams:
        print(f"  Warning: expected {league.teams} teams, found {len(teams)}")

    # --- priors from last season -------------------------------------------
    previous = load_archive(start_year - 1, league.key)
    if previous:
        prev_ratings = M.fit(M.observations_from_matches(previous),
                             date(start_year, 6, 30))
        priors = M.carry_over_priors(prev_ratings, teams)
        # Home advantage and the low-score correlation are league properties
        # that barely move year to year, so last season's estimates are far
        # better starting points than a hard-coded constant.
        home_adv_prior = prev_ratings.home_adv
        fallback_rho = prev_ratings.rho
        promoted = [t for t in teams if t not in prev_ratings.attack]
        print(f"  Priors carried from {C.season_label(start_year - 1)}; "
              f"promoted sides on baseline prior: {', '.join(promoted) or 'none'}")
    else:
        priors, prev_ratings = None, None
        home_adv_prior, fallback_rho = C.HOME_ADV_PRIOR, -0.05
        print("  No archive for last season -- starting from flat priors")
        print("  (early-season ratings will be weak; run build_archive.py)")

    fit_kwargs = {"priors": priors, "teams": teams,
                  "home_adv_prior": home_adv_prior,
                  "fallback_rho": fallback_rho}

    # --- squads, fetched before predictions because they feed them ----------
    # Player data must never be able to break a build: if FotMob changes shape
    # or a squad page 404s, the league still ships its table and predictions,
    # just without the availability adjustment.
    rosters: Dict[str, List[Dict[str, Any]]] = {}
    boards: List[Dict[str, Any]] = []
    try:
        boards = players.leaderboards(league, payload.get("props")) or []
        rosters = players.squads(league, published_table) or {}
        if rosters:
            hurt = sum(1 for v in rosters.values() for p in v if p["injured"])
            print(f"  Players: {sum(len(v) for v in rosters.values())} in "
                  f"{len(rosters)} squads, {hurt} unavailable")
            availability.record_snapshot(league.key, rosters)
    except Exception as exc:  # noqa: BLE001 - never fail a build over this
        print(f"  Player data skipped: {exc}")

    # --- walk-forward predictions for played matches -----------------------
    by_day: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for m in played:
        by_day[m["date"]].append(m)

    predictions: List[Dict[str, Any]] = []
    history: List[Dict[str, Any]] = []
    prematch: Dict[tuple, Dict[str, Any]] = {}
    prematch_ratings: Dict[tuple, M.Ratings] = {}

    for day in sorted(by_day):
        ref = M._to_date(day)
        ratings = M.fit(M.observations_from_matches(history), ref, **fit_kwargs)
        for m in by_day[day]:
            key = (m["home"], m["away"])
            prematch[key] = M.predict_match(ratings, m["home"], m["away"])
            prematch_ratings[key] = ratings
        history.extend(by_day[day])

    # --- current ratings, used for every remaining fixture ------------------
    today = date.today()
    current = M.fit(M.observations_from_matches(played), today, **fit_kwargs)
    print(f"  Fitted: base {current.base:.3f} goals/team, "
          f"home advantage {current.home_adv:.3f}x, rho {current.rho:+.4f}")

    # --- assemble prediction records ---------------------------------------
    for m in matches:
        key = (m["home"], m["away"])
        finished = m.get("status") == "finished"
        ratings = prematch_ratings.get(key, current)
        probs = prematch.get(key) or M.predict_match(current, m["home"], m["away"])

        before = M._to_date(m["date"])
        hf = M.rolling_form(played, m["home"], before)
        af = M.rolling_form(played, m["away"], before)

        # Availability applies to fixtures not yet played, and only to those.
        # The injury list is a snapshot of today; feeding it into the
        # walk-forward prediction for a match in August would score the model
        # on information that did not exist at kick-off. That is the single
        # easiest way to fake a good backtest, so the guard is explicit.
        h_adj = a_adj = availability.NEUTRAL
        if not finished and rosters:
            h_adj = availability.for_fixture(rosters.get(m["home"]), before, today)
            a_adj = availability.for_fixture(rosters.get(m["away"]), before, today)
            if h_adj.active or a_adj.active:
                lh, la = availability.lambdas(current, m["home"], m["away"],
                                              h_adj, a_adj)
                probs = M.predict(lh, la, current.rho)

        record: Dict[str, Any] = {
            "date": m["date"],
            "kickoff_datetime": m.get("kickoff_iso"),
            "round": m.get("round"),
            "home": m["home"],
            "away": m["away"],
            "status": m.get("status"),
            "home_form": hf,
            "away_form": af,
            "home_goals": m.get("home_goals"),
            "away_goals": m.get("away_goals"),
            "season": season,
            **probs,
        }
        record["reasoning"] = reasoning.build(ratings, m, probs, hf, af,
                                              h_adj, a_adj)

        if finished and m.get("home_xg") is not None:
            xr = M.xresult(m["home_xg"], m["away_xg"], current.rho)
            record.update(xr)
            record["actual_xg_home"] = m["home_xg"]
            record["actual_xg_away"] = m["away_xg"]
            record.update(reasoning.verdict(m, xr))

        predictions.append(record)

    xr_by_key = {(p["home"], p["away"]): p for p in predictions
                 if "xresult_xpts_home" in p}
    table = standings(matches, teams, xr_by_key)

    played_rounds = [int(m["round"]) for m in played if m.get("round")]
    current_round = (max(played_rounds) if played_rounds else 0)
    upcoming = [m for m in matches if m.get("status") == "scheduled"]
    next_round = min((int(m["round"]) for m in upcoming if m.get("round")),
                     default=current_round)

    metadata = {
        "league_key": league.key,
        "league": league.name,
        "country": league.country,
        "season": season,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "match_count": len(matches),
        "played_count": len(played),
        "prediction_count": len(predictions),
        "teams": teams,
        "team_count": len(teams),
        "current_round": current_round,
        "next_round": next_round,
        "total_rounds": max((int(m["round"]) for m in matches if m.get("round")),
                            default=league.rounds),
        "xg_coverage": coverage,
        "source": "FotMob",
        "model": {
            "name": "Dixon-Coles bivariate Poisson",
            "base_goals": round(current.base, 3),
            "home_advantage": round(current.home_adv, 3),
            "rho": round(current.rho, 4),
            "time_decay_xi": C.TIME_DECAY_XI,
            "prior_strength": C.PRIOR_STRENGTH,
            "xg_rating_weight": C.XG_RATING_WEIGHT,
            "season_carryover": C.SEASON_CARRYOVER,
        },
    }

    print("  Writing:")
    write(league.key, "matches.json", matches)
    write(league.key, "predictions.json", predictions)
    write(league.key, "metadata.json", metadata)
    write(league.key, "standings.json", table)
    write(league.key, "power_rankings.json", power_rankings(current, teams))

    if boards:
        write(league.key, "players.json", boards)
    if rosters:
        write(league.key, "squads.json", rosters)

    if published_table:
        # FotMob's own table is the authority on points deductions, which no
        # amount of adding up results will ever reveal.
        write(league.key, "official_table.json", published_table)

    leader = table[0] if table else None
    if leader:
        print(f"  Leader: {leader['team']} "
              f"({leader['points']} pts, {leader['xpts']:.1f} xPts)")

    return {
        "key": league.key,
        "name": league.name,
        "country": league.country,
        "season": season,
        "teams": len(teams),
        "played": len(played),
        "matches": len(matches),
        "current_round": current_round,
        "next_round": next_round,
        "total_rounds": metadata["total_rounds"],
        "xg_coverage": coverage,
        "leader": leader["team"] if leader else None,
        "built_at": metadata["built_at"],
    }


def main() -> None:
    requested = sys.argv[1:] or [lg.key for lg in C.LEAGUES]
    leagues = [C.get_league(key) for key in requested]

    summaries: List[Dict[str, Any]] = []
    for league in leagues:
        summary = build_league(league)
        if summary:
            summaries.append(summary)

    if not summaries:
        print("\nNo league built successfully. Existing data left untouched.")
        sys.exit(1)

    # The index the frontend reads to know which leagues exist. Only rebuilt
    # from leagues that actually succeeded this run, merged over the previous
    # index so one league failing does not remove the others from the site.
    previous_index = read_previous("", "leagues.json") or []
    merged = {entry.get("key"): entry for entry in previous_index
              if isinstance(entry, dict)}
    for summary in summaries:
        merged[summary["key"]] = summary
    order = [lg.key for lg in C.LEAGUES]
    index = sorted(merged.values(),
                   key=lambda e: order.index(e["key"])
                   if e["key"] in order else 99)

    os.makedirs(C.DATA_PROCESSED_DIR, exist_ok=True)
    index_path = os.path.join(C.DATA_PROCESSED_DIR, "leagues.json")
    with open(index_path, "w") as fh:
        json.dump(index, fh, indent=1)

    print(f"\n{'=' * 62}")
    print(f"Built {len(summaries)}/{len(leagues)} leagues -> {index_path}")
    for summary in summaries:
        print(f"  {summary['name']:<16} {summary['played']:>3}/"
              f"{summary['matches']:<3} played  "
              f"xG {summary['xg_coverage']:>3}  "
              f"MW{summary['next_round']}  {summary['leader']}")


if __name__ == "__main__":
    main()
