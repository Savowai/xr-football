"""
Walk-forward evaluation of the xR model.

The only honest way to score a football model is to make it predict matches it
has not seen, in the order they happened. For every matchday the model is
refitted on strictly earlier results and then asked for the next day's fixtures.
No result is ever used to predict itself, and the season-start priors come from
the previous season's archive, exactly as they do in production.

Three reference points are scored alongside it:

  market     closing odds, overround removed. This is the number to beat and
             realistically the ceiling: it contains team news, weather and
             money that the model does not see.
  previous   the heuristic model this rewrite replaced.
  base rate  the league's long-run home/draw/away split, which is what any
             model must beat to have earned its complexity.

Primary metric is the ranked probability score. RPS is the standard for 1X2
football forecasting because it respects the ordering of the outcomes: calling
a home win when it finishes a draw is a smaller error than calling it when the
away side wins, and log-loss cannot see that distinction.

Usage:
    python3 scripts/backtest.py [season_start_year]
"""

from __future__ import annotations

import json
import math
import os
import sys
from collections import defaultdict
from datetime import date
from typing import Any, Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config as C
import odds
import xr_model as M
from build_archive import load_archive


def outcome(m: Dict[str, Any]) -> int:
    """0 = home win, 1 = draw, 2 = away win."""
    if m["home_goals"] > m["away_goals"]:
        return 0
    return 1 if m["home_goals"] == m["away_goals"] else 2


def rps(probs: Sequence[float], actual: int) -> float:
    """Ranked probability score for ordered outcomes (lower is better)."""
    cum_p = cum_e = 0.0
    total = 0.0
    for i in range(2):
        cum_p += probs[i]
        cum_e += 1.0 if i == actual else 0.0
        total += (cum_p - cum_e) ** 2
    return total / 2.0


def log_loss(probs: Sequence[float], actual: int) -> float:
    return -math.log(max(probs[actual], 1e-12))


def market_probs(m: Dict[str, Any]) -> Optional[List[float]]:
    o = [m.get("odds_home"), m.get("odds_draw"), m.get("odds_away")]
    if any(x is None or x <= 1.0 for x in o):
        return None
    raw = [1.0 / x for x in o]
    total = sum(raw)
    return [r / total for r in raw]


# ---------------------------------------------------------------------------
# Competing forecasters
# ---------------------------------------------------------------------------

def new_model_probs(history: List[Dict[str, Any]], fixtures: List[Dict[str, Any]],
                    ref: date, priors, teams,
                    params: Optional[Dict[str, float]] = None) -> Dict[int, List[float]]:
    p = params or {}
    ratings = M.fit(M.observations_from_matches(history), ref,
                    priors=priors, teams=teams,
                    xg_weight=p.get("xg_weight", C.XG_RATING_WEIGHT),
                    xi=p.get("xi", C.TIME_DECAY_XI),
                    prior_strength=p.get("prior_strength", C.PRIOR_STRENGTH))
    out = {}
    for i, m in fixtures:
        p = M.predict_match(ratings, m["home"], m["away"])
        out[i] = [p["win_home_pct"] / 100, p["draw_pct"] / 100, p["win_away_pct"] / 100]
    return out


def old_model_probs(history: List[Dict[str, Any]], fixtures: List[Dict[str, Any]],
                    ref: date) -> Dict[int, List[float]]:
    """The previous heuristic: rolling form averages plus additive tweaks."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("old_xr", "/tmp/old_xr_model.py")
    old = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(old)

    from datetime import datetime
    ref_dt = datetime.combine(ref, datetime.min.time())
    out = {}
    for i, m in fixtures:
        hf, _ = old.compute_rolling_form(history, m["home"], ref_dt)
        af, _ = old.compute_rolling_form(history, m["away"], ref_dt)
        hx, ax, _ = old.compute_matchup_xg(hf, af)
        r = old.compute_match_probabilities(hx, ax)
        out[i] = [r["win_home_pct"] / 100, r["draw_pct"] / 100, r["win_away_pct"] / 100]
    return out


def run(season_start: int, burn_in_matches: int = 30,
        use_old: bool = True, params: Optional[Dict[str, float]] = None,
        quiet: bool = False,
        league_key: str = "epl") -> Dict[str, Dict[str, float]]:
    matches = [m for m in load_archive(season_start, league_key)
               if m.get("home_goals") is not None]
    if not matches:
        raise SystemExit(f"No archive for {C.season_label(season_start)} -- "
                         f"run: python3 scripts/build_archive.py {season_start}")
    matches.sort(key=lambda m: (m["date"], m["home"]))
    teams = sorted({m["home"] for m in matches} | {m["away"] for m in matches})

    # Closing odds are merged in here and nowhere else. They are scored as a
    # rival forecaster and never reach the model -- see scripts/odds.py.
    #
    # A partial merge is worse than none: scoring the market on whichever 60%
    # of fixtures happened to match would compare it against xR on a different
    # sample and call the two numbers comparable. So it is all or nothing.
    market_coverage = 0.0
    got, total = odds.attach(matches, league_key, season_start, verbose=not quiet)
    if total:
        market_coverage = got / total
    if market_coverage < 0.95:
        for m in matches:
            m.pop("odds_home", None)
            m.pop("odds_draw", None)
            m.pop("odds_away", None)
        if not quiet and got:
            print(f"Odds matched only {got}/{total} fixtures "
                  f"({market_coverage:.0%}) -- market benchmark withheld")
        elif not quiet:
            print("No closing odds available -- market benchmark withheld")
    elif not quiet:
        print(f"Closing odds on {got}/{total} fixtures ({market_coverage:.0%})")

    params = params or {}
    prev = load_archive(season_start - 1, league_key)
    if prev:
        prev_ratings = M.fit(M.observations_from_matches(prev),
                             date(season_start, 6, 30))
        priors = M.carry_over_priors(
            prev_ratings, teams,
            carryover=params.get("carryover", C.SEASON_CARRYOVER))
        if not quiet:
            print(f"Priors from {C.season_label(season_start - 1)} "
                  f"({len(prev)} matches)")
    else:
        priors = None
        if not quiet:
            print("No previous season available -- flat priors")

    by_day: Dict[str, List[Tuple[int, Dict]]] = defaultdict(list)
    for i, m in enumerate(matches):
        by_day[m["date"]].append((i, m))

    preds: Dict[str, Dict[int, List[float]]] = {"xR": {}, "previous": {}}
    played: List[Dict[str, Any]] = []

    for day in sorted(by_day):
        fixtures = by_day[day]
        if len(played) >= burn_in_matches:
            ref = M._to_date(day)
            preds["xR"].update(
                new_model_probs(played, fixtures, ref, priors, teams, params))
            if use_old:
                preds["previous"].update(old_model_probs(played, fixtures, ref))
        played.extend(m for _, m in fixtures)

    scored = sorted(preds["xR"])
    if not quiet:
        print(f"Scored {len(scored)} of {len(matches)} matches "
              f"(first {burn_in_matches} withheld as burn-in)\n")

    base = [0.44, 0.25, 0.31]
    results: Dict[str, Dict[str, float]] = {}

    def score(name: str, get: Any) -> None:
        r = l = 0.0
        hits = n = 0
        for i in scored:
            p = get(i)
            if p is None:
                continue
            a = outcome(matches[i])
            r += rps(p, a)
            l += log_loss(p, a)
            hits += 1 if max(range(3), key=lambda k: p[k]) == a else 0
            n += 1
        if n:
            results[name] = {"rps": r / n, "log_loss": l / n,
                             "accuracy": 100.0 * hits / n, "n": n}

    score("Market (closing odds)", lambda i: market_probs(matches[i]))
    score("xR model (new)", lambda i: preds["xR"].get(i))
    if use_old:
        score("xR model (previous)", lambda i: preds["previous"].get(i))
    score("League base rate", lambda i: base)

    if not quiet:
        print(f"{'':26} {'RPS':>8} {'LogLoss':>9} {'Acc %':>7} {'n':>5}")
        print("-" * 60)
        for name, s in sorted(results.items(), key=lambda kv: kv[1]["rps"]):
            print(f"{name:26} {s['rps']:8.4f} {s['log_loss']:9.4f} "
                  f"{s['accuracy']:7.1f} {s['n']:5d}")

        if "xR model (new)" in results and "Market (closing odds)" in results:
            gap = results["xR model (new)"]["rps"] - results["Market (closing odds)"]["rps"]
            print(f"\nGap to market: {gap:+.4f} RPS")
        if "xR model (previous)" in results and "xR model (new)" in results:
            old_r = results["xR model (previous)"]["rps"]
            new_r = results["xR model (new)"]["rps"]
            print(f"Improvement over previous model: "
                  f"{old_r - new_r:+.4f} RPS ({100 * (old_r - new_r) / old_r:+.1f}%)")
    return results


# Stable keys for the About page. The display names above are prose and may be
# reworded; these are the contract.
ROW_KEYS = {
    "Market (closing odds)": "market",
    "xR model (new)": "xr",
    "xR model (previous)": "previous",
    "League base rate": "base_rate",
}


def export(season_start: int, league_key: str = "epl") -> str:
    """
    Write the scored table to data/processed/ so the About page can render it.

    The numbers used to live as a hand-copied constant in the page, and twice
    they drifted from what the code actually produces -- once because the model
    changed underneath them and once because the data did. A published figure
    that nothing regenerates is a claim nobody is checking, so the page now
    reads this file and the constant is gone.
    """
    from datetime import datetime, timezone

    results = run(season_start, league_key=league_key)
    league = C.get_league(league_key)

    rows = [
        {
            "key": ROW_KEYS.get(name, name),
            "name": name,
            "rps": round(s["rps"], 4),
            "log_loss": round(s["log_loss"], 4),
            "accuracy": round(s["accuracy"], 1),
            "n": s["n"],
        }
        for name, s in sorted(results.items(), key=lambda kv: kv[1]["rps"])
    ]

    payload = {
        "league": league_key,
        "league_name": league.name,
        "season": C.season_label(season_start),
        "n": max((r["n"] for r in rows), default=0),
        "market_available": any(r["key"] == "market" for r in rows),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rows": rows,
    }

    os.makedirs(C.DATA_PROCESSED_DIR, exist_ok=True)
    path = os.path.join(C.DATA_PROCESSED_DIR, "backtest.json")
    with open(path, "w") as fh:
        json.dump(payload, fh, indent=1)
    print(f"\nWrote {path}")
    return path


def sweep(season_start: int) -> None:
    """
    Grid search the four hyper-parameters against out-of-sample RPS.

    Reported as a sanity check on the defaults in config.py, not as an
    automatic tuner: this optimises on one season, so a result that only wins
    by a rounding error is noise and should not be chased.
    """
    grid = {
        "xi": [0.0, 0.002, 0.0045, 0.008, 0.015],
        "prior_strength": [2.0, 4.0, 8.0, 14.0, 22.0],
        "xg_weight": [0.0, 0.35, 0.5, 0.65, 0.85, 1.0],
        "carryover": [0.0, 0.4, 0.55, 0.7, 0.85],
    }
    current = {"xi": C.TIME_DECAY_XI, "prior_strength": C.PRIOR_STRENGTH,
               "xg_weight": C.XG_RATING_WEIGHT, "carryover": C.SEASON_CARRYOVER}
    baseline = run(season_start, use_old=False, params=current,
                   quiet=True)["xR model (new)"]["rps"]
    print(f"baseline RPS {baseline:.5f} with {current}\n")

    for key, values in grid.items():
        print(f"{key}:")
        for v in values:
            p = dict(current)
            p[key] = v
            r = run(season_start, use_old=False, params=p,
                    quiet=True)["xR model (new)"]["rps"]
            mark = "  <- current" if v == current[key] else ""
            print(f"  {v:>8} -> RPS {r:.5f}  ({r - baseline:+.5f}){mark}")
        print()


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    year = int(args[0]) if args else C.SEASON_START_YEAR - 1
    if "--sweep" in sys.argv:
        sweep(year)
    elif "--json" in sys.argv:
        export(year)
    else:
        run(year)
