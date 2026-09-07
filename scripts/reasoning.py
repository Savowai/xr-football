"""
The reasoning layer: why the model thinks what it thinks.

A probability with no explanation is not analysis, it is a number. Everything
here is derived from the fitted model itself rather than written to sound
plausible -- each factor is an exact decomposition of the predicted goal rate,
so the parts add up to the whole and the prose cannot drift away from the
maths.

The forecast is decomposed sequentially:

    lambda_home = base * attack(home) * defence(away) * home_advantage

Taking the running product one term at a time gives each factor's effect in
goals, and those effects sum exactly to the predicted total. That is the
difference between an explanation and a rationalisation.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional, Sequence

import config as C
import xr_model as M


def _sign(x: float) -> str:
    return f"+{x:.2f}" if x >= 0 else f"{x:.2f}"


def _strength_word(rating: float) -> str:
    if rating >= 1.25:
        return "excellent"
    if rating >= 1.10:
        return "strong"
    if rating >= 0.95:
        return "solid"
    if rating >= 0.82:
        return "modest"
    return "poor"


def _defence_word(rating: float) -> str:
    """Defence ratings are leakiness: lower is better."""
    if rating <= 0.80:
        return "excellent"
    if rating <= 0.92:
        return "strong"
    if rating <= 1.05:
        return "solid"
    if rating <= 1.18:
        return "leaky"
    return "poor"


# ---------------------------------------------------------------------------
# Factor decomposition
# ---------------------------------------------------------------------------

def decompose(ratings: M.Ratings, home: str, away: str) -> List[Dict[str, Any]]:
    base = ratings.base
    ha, hd = ratings.attack_of(home), ratings.defence_of(home)
    aa, ad = ratings.attack_of(away), ratings.defence_of(away)

    factors: List[Dict[str, Any]] = []

    # Home goal rate, built up one term at a time.
    step = base
    after_atk = base * ha
    factors.append({
        "side": "home",
        "label": f"{C.short(home)} attack",
        "detail": f"{_strength_word(ha)} ({ha:.2f}x league average)",
        "delta_goals": round(after_atk - step, 3),
    })
    after_def = after_atk * ad
    factors.append({
        "side": "home",
        "label": f"{C.short(away)} defence",
        "detail": f"{_defence_word(ad)} ({ad:.2f}x league average conceded)",
        "delta_goals": round(after_def - after_atk, 3),
    })
    after_ha = after_def * ratings.home_adv
    factors.append({
        "side": "home",
        "label": "Home advantage",
        "detail": f"{ratings.home_adv:.2f}x, fitted league-wide and carried across seasons",
        "delta_goals": round(after_ha - after_def, 3),
    })

    step = base
    after_atk = base * aa
    factors.append({
        "side": "away",
        "label": f"{C.short(away)} attack",
        "detail": f"{_strength_word(aa)} ({aa:.2f}x league average)",
        "delta_goals": round(after_atk - step, 3),
    })
    after_def = after_atk * hd
    factors.append({
        "side": "away",
        "label": f"{C.short(home)} defence",
        "detail": f"{_defence_word(hd)} ({hd:.2f}x league average conceded)",
        "delta_goals": round(after_def - after_atk, 3),
    })
    return factors


def confidence(ratings: M.Ratings, home: str, away: str) -> Dict[str, Any]:
    """
    How much the forecast rests on evidence rather than on the prior.

    Evidence is measured in time-decayed matches, so a side that played six
    matches four months ago counts for less than one that played six last
    month. Below roughly six effective matches each the ratings are still
    mostly inherited from last season and the model says so.
    """
    eh = ratings.evidence.get(home, 0.0)
    ea = ratings.evidence.get(away, 0.0)
    eff = min(eh, ea)
    if eff >= 12:
        level, note = ("high",
                       "both sides have a full season of evidence behind their ratings")
    elif eff >= 6:
        level, note = ("medium",
                       "ratings are mostly driven by this season, with last season "
                       "still contributing")
    elif eff >= 2.5:
        level, note = ("low",
                       "only a handful of matches played, so ratings still lean on "
                       "last season's baseline")
    else:
        level, note = ("very low",
                       "too few matches played to move the ratings much; these are "
                       "close to last season's, regressed toward the mean")
    return {
        "level": level,
        "note": note,
        "effective_matches_home": round(eh, 1),
        "effective_matches_away": round(ea, 1),
    }


# ---------------------------------------------------------------------------
# Thesis
# ---------------------------------------------------------------------------

def _edge_clause(home: str, away: str, lh: float, la: float,
                 probs: Dict[str, Any]) -> str:
    diff = lh - la
    fav, dog = (home, away) if diff >= 0 else (away, home)
    fav_pct = probs["win_home_pct"] if diff >= 0 else probs["win_away_pct"]
    margin = abs(diff)

    if margin < 0.15:
        return (f"There is almost nothing between these teams on current form: "
                f"the model splits them by {margin:.2f} goals, and the most "
                f"likely single outcome is a draw at {probs['draw_pct']:.0f}%.")
    if margin < 0.45:
        return (f"{C.short(fav)} are marginal favourites, worth about "
                f"{margin:.2f} goals of edge and a {fav_pct:.0f}% win "
                f"probability -- a lean, not a call.")
    if margin < 0.9:
        return (f"{C.short(fav)} are clear favourites, projected {margin:.2f} "
                f"goals better than {C.short(dog)} on the day, which prices "
                f"the win at {fav_pct:.0f}%.")
    return (f"{C.short(fav)} should win comfortably. The model has them "
            f"{margin:.2f} goals clear of {C.short(dog)}, a "
            f"{fav_pct:.0f}% win probability.")


def _form_clause(team: str, form: Dict[str, Any], ratings: M.Ratings) -> Optional[str]:
    """
    Flag where recent results and underlying quality disagree.

    This is the most useful thing the model can say, because it is where the
    table is about to be wrong. A side taking points it has not deserved will
    regress, and one creating chances it has not converted will improve.
    """
    if form.get("matches", 0) < 3:
        return None
    fin = form.get("finishing_delta", 0.0)
    xgd = form.get("xg_diff_per_game", 0.0)

    if fin >= 0.45:
        return (f"{C.short(team)} are scoring {fin:.2f} goals a game more than "
                f"their chances warrant, which historically does not hold; the "
                f"model discounts that finishing rather than projecting it.")
    if fin <= -0.45:
        return (f"{C.short(team)} are converting {abs(fin):.2f} goals a game "
                f"fewer than their chances deserve, so their table position "
                f"understates them and the model rates them above their results.")
    if xgd >= 0.6:
        return (f"{C.short(team)} are creating {_sign(xgd)} xG per game more "
                f"than they concede over their last {form['matches']}, the "
                f"profile of a side controlling matches.")
    if xgd <= -0.6:
        return (f"{C.short(team)} are being outcreated by {abs(xgd):.2f} xG per "
                f"game over their last {form['matches']}, which is why the "
                f"model is cautious regardless of recent results.")
    return None


def build(ratings: M.Ratings, match: Dict[str, Any], probs: Dict[str, Any],
          home_form: Dict[str, Any], away_form: Dict[str, Any]) -> Dict[str, Any]:
    home, away = match["home"], match["away"]
    lh, la = probs["pred_xg_home"], probs["pred_xg_away"]
    conf = confidence(ratings, home, away)

    parts = [_edge_clause(home, away, lh, la, probs)]

    # At most one form note per side, and only where it actually says something.
    for team, form in ((home, home_form), (away, away_form)):
        clause = _form_clause(team, form, ratings)
        if clause:
            parts.append(clause)

    scoreline = probs["most_likely_scoreline"]
    parts.append(
        f"Projected {lh:.2f}-{la:.2f} on expected goals, with "
        f"{scoreline[0]}-{scoreline[1]} the single most likely scoreline at "
        f"{probs['top_5_scorelines'][0][2]:.1f}%.")

    if conf["level"] in ("low", "very low"):
        parts.append(f"Confidence is {conf['level']}: {conf['note']}.")

    return {
        "thesis": " ".join(parts),
        "confidence": conf,
        "factors": decompose(ratings, home, away),
        "rating_snapshot": {
            "home_attack": round(ratings.attack_of(home), 3),
            "home_defence": round(ratings.defence_of(home), 3),
            "away_attack": round(ratings.attack_of(away), 3),
            "away_defence": round(ratings.defence_of(away), 3),
            "league_base": round(ratings.base, 3),
            "home_advantage": round(ratings.home_adv, 3),
        },
    }


# ---------------------------------------------------------------------------
# Retrospective verdict
# ---------------------------------------------------------------------------

def verdict(match: Dict[str, Any], xr: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compare what happened with what the chances deserved.

    The xR verdict is decided on expected points from the match's own xG, not
    on the scoreline, which is the entire premise of the project: a side can
    win and still have been outplayed.
    """
    hg, ag = match["home_goals"], match["away_goals"]
    hx, ax = match.get("home_xg"), match.get("away_xg")
    if hg is None or hx is None or ax is None:
        return {}

    actual_home = 3 if hg > ag else (1 if hg == ag else 0)
    actual_away = 3 if ag > hg else (1 if hg == ag else 0)
    swing = actual_home - xr["xresult_xpts_home"]

    if swing >= 1.0:
        tag, who = "lucky_home", match["home"]
    elif swing <= -1.0:
        tag, who = "lucky_away", match["away"]
    else:
        tag, who = "justified", None

    margin = abs(hx - ax)
    if tag == "justified":
        note = (f"The result matched the chances: {hx:.2f}-{ax:.2f} on xG "
                f"against a {hg}-{ag} scoreline.")
    else:
        note = (f"{C.short(who)} took {abs(swing):.1f} points more than the "
                f"chances warranted -- {hx:.2f}-{ax:.2f} on xG finished "
                f"{hg}-{ag}.")
        if margin < 0.25:
            note += " The underlying performance was close to even."

    return {
        "xresult_verdict": tag,
        "xresult_note": note,
        "xpts_swing_home": round(swing, 2),
        "actual_points_home": actual_home,
        "actual_points_away": actual_away,
    }
