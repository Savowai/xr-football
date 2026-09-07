"""
xR (Expected Result) model.

The engine is a Dixon-Coles bivariate Poisson with three additions that matter
in practice:

  1. Team strength is estimated by time-decayed maximum likelihood rather than
     by averaging recent form. Every match a team has played contributes,
     weighted by recency, and each contribution is adjusted for the quality of
     the opponent it came against. Beating Arsenal away is not the same event
     as beating a promoted side at home, and a rolling average cannot tell
     those apart.

  2. Ratings are shrunk toward a prior via a conjugate Gamma posterior. With
     three matches played, the data cannot distinguish a genuinely elite side
     from one that has had three kind fixtures, so the model does not pretend
     otherwise: it stays near the prior until evidence accumulates. The prior
     is last season's rating, regressed toward the mean.

  3. Ratings are fitted twice, once against goals and once against xG, then
     blended. xG is the more stable estimator of underlying quality; goals
     still carry real information about finishing. The blend is geometric,
     i.e. linear in the log-strength space the model actually works in.

Everything is pure standard library: the likelihood has closed-form
multiplicative updates, so no optimiser (and no numpy/scipy) is needed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import config as C


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.fromisoformat(str(value)[:10]).date()


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def poisson_pmf(lam: float, k: int) -> float:
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    try:
        return math.exp(-lam + k * math.log(lam) - math.lgamma(k + 1))
    except (ValueError, OverflowError):
        return 0.0


# ---------------------------------------------------------------------------
# Observations and fitted state
# ---------------------------------------------------------------------------

@dataclass
class Obs:
    """One played match, reduced to what the rating model needs."""
    date: date
    home: str
    away: str
    home_goals: int
    away_goals: int
    home_xg: Optional[float] = None
    away_xg: Optional[float] = None

    def value(self, target: str) -> Optional[Tuple[float, float]]:
        if target == "goals":
            return float(self.home_goals), float(self.away_goals)
        if self.home_xg is None or self.away_xg is None:
            return None
        return float(self.home_xg), float(self.away_xg)


@dataclass
class Ratings:
    """Fitted league state as of a point in time."""
    attack: Dict[str, float] = field(default_factory=dict)
    defence: Dict[str, float] = field(default_factory=dict)
    base: float = 1.35          # league mean goals per team per match
    home_adv: float = 1.30      # multiplicative home factor
    rho: float = -0.05          # Dixon-Coles low-score correction
    evidence: Dict[str, float] = field(default_factory=dict)

    def attack_of(self, team: str) -> float:
        return self.attack.get(team, 1.0)

    def defence_of(self, team: str) -> float:
        return self.defence.get(team, 1.0)

    def lambdas(self, home: str, away: str) -> Tuple[float, float]:
        lh = self.base * self.attack_of(home) * self.defence_of(away) * self.home_adv
        la = self.base * self.attack_of(away) * self.defence_of(home)
        return (_clamp(lh, C.MIN_LAMBDA, C.MAX_LAMBDA),
                _clamp(la, C.MIN_LAMBDA, C.MAX_LAMBDA))


# ---------------------------------------------------------------------------
# Fitting
# ---------------------------------------------------------------------------

def _fit_target(
    observations: Sequence[Obs],
    ref_date: date,
    target: str,
    priors: Optional[Dict[str, Tuple[float, float]]] = None,
    teams: Optional[Iterable[str]] = None,
    xi: float = C.TIME_DECAY_XI,
    prior_strength: float = C.PRIOR_STRENGTH,
    home_adv_prior: float = C.HOME_ADV_PRIOR,
    max_iter: int = 200,
    tol: float = 1e-9,
) -> Ratings:
    """
    Weighted-MLE attack/defence ratings for one target ('goals' or 'xg').

        lambda_home = base * atk[home] * def[away] * home_adv
        lambda_away = base * atk[away] * def[home]

    'def' is defensive *leakiness*: above 1 means the team concedes more than
    average, so a high attack rating and a low defence rating are both good.

    Each parameter has a closed-form conditional MLE, because the Poisson
    score equation is linear in that parameter once the others are held fixed.
    Cycling the updates converges to the joint MLE. Shrinkage enters as a
    Gamma(k*m, k) conjugate prior, which in this parameterisation adds one term
    to each side of the update ratio.
    """
    rows: List[Tuple[float, str, str, float, float]] = []
    for o in observations:
        vals = o.value(target)
        if vals is None:
            continue
        days = (ref_date - o.date).days
        if days < 0:
            continue
        w = math.exp(-xi * days)
        if w < 1e-6:
            continue
        rows.append((w, o.home, o.away, vals[0], vals[1]))

    names = set(teams or [])
    for _, h, a, _, _ in rows:
        names.add(h)
        names.add(a)
    names_l = sorted(names)

    priors = priors or {}
    atk = {t: priors.get(t, (1.0, 1.0))[0] for t in names_l}
    dfn = {t: priors.get(t, (1.0, 1.0))[1] for t in names_l}
    evidence = {t: 0.0 for t in names_l}

    if not rows:
        return Ratings(attack=atk, defence=dfn, evidence=evidence)

    for w, h, a, _, _ in rows:
        evidence[h] += w
        evidence[a] += w

    total_w = sum(r[0] for r in rows)
    base = sum(r[3] + r[4] for r in rows) / (2.0 * total_w)
    home_adv = 1.30

    for _ in range(max_iter):
        prev = (base, home_adv,
                tuple(atk[t] for t in names_l),
                tuple(dfn[t] for t in names_l))

        # base rate
        num = sum(w * (gh + ga) for w, _, _, gh, ga in rows)
        den = sum(w * (atk[h] * dfn[a] * home_adv + atk[a] * dfn[h])
                  for w, h, a, _, _ in rows)
        if den > 0:
            base = num / den

        # Home advantage, shrunk toward the long-run league value. Twenty
        # matches is far too few to measure it: left unshrunk it swings between
        # 1.1 and 1.5 in August and drags every forecast with it.
        num = (sum(w * gh for w, _, _, gh, _ in rows)
               + C.HOME_ADV_PRIOR_STRENGTH * home_adv_prior)
        den = (sum(w * base * atk[h] * dfn[a] for w, h, a, _, _ in rows)
               + C.HOME_ADV_PRIOR_STRENGTH)
        if den > 0:
            home_adv = _clamp(num / den, 1.0, 1.9)

        # attack
        a_num = {t: 0.0 for t in names_l}
        a_den = {t: 0.0 for t in names_l}
        for w, h, a, gh, ga in rows:
            a_num[h] += w * gh
            a_den[h] += w * base * dfn[a] * home_adv
            a_num[a] += w * ga
            a_den[a] += w * base * dfn[h]
        for t in names_l:
            pm = priors.get(t, (1.0, 1.0))[0]
            atk[t] = (a_num[t] + prior_strength * pm) / (a_den[t] + prior_strength)

        # defence
        d_num = {t: 0.0 for t in names_l}
        d_den = {t: 0.0 for t in names_l}
        for w, h, a, gh, ga in rows:
            d_num[a] += w * gh
            d_den[a] += w * base * atk[h] * home_adv
            d_num[h] += w * ga
            d_den[h] += w * base * atk[a]
        for t in names_l:
            pm = priors.get(t, (1.0, 1.0))[1]
            dfn[t] = (d_num[t] + prior_strength * pm) / (d_den[t] + prior_strength)

        # identifiability: attack and defence are only defined up to a scale
        ma = sum(atk.values()) / len(atk)
        md = sum(dfn.values()) / len(dfn)
        if ma > 0 and md > 0:
            for t in names_l:
                atk[t] /= ma
                dfn[t] /= md
            base *= ma * md

        delta = (abs(prev[0] - base) + abs(prev[1] - home_adv)
                 + sum(abs(p - atk[t]) for p, t in zip(prev[2], names_l))
                 + sum(abs(p - dfn[t]) for p, t in zip(prev[3], names_l)))
        if delta < tol:
            break

    return Ratings(attack=atk, defence=dfn, base=base,
                   home_adv=home_adv, evidence=evidence)


def dc_tau(gh: int, ga: int, lh: float, la: float, rho: float) -> float:
    """
    Dixon-Coles dependence correction.

    Independent Poisson understates draws and 1-0/0-1 results, because goals
    in a real match are not independent events: the score state changes how
    both teams play. The correction reweights the four low-score cells, which
    is where essentially all of the dependence lives.
    """
    if gh == 0 and ga == 0:
        return 1.0 - lh * la * rho
    if gh == 0 and ga == 1:
        return 1.0 + lh * rho
    if gh == 1 and ga == 0:
        return 1.0 + la * rho
    if gh == 1 and ga == 1:
        return 1.0 - rho
    return 1.0


def _fit_rho(observations: Sequence[Obs], ratings: Ratings, ref_date: date,
             xi: float = C.TIME_DECAY_XI, fallback: float = -0.05) -> float:
    """Golden-section search for rho on the time-weighted log-likelihood."""
    rows = []
    for o in observations:
        days = (ref_date - o.date).days
        if days < 0:
            continue
        w = math.exp(-xi * days)
        if w < 1e-6:
            continue
        lh, la = ratings.lambdas(o.home, o.away)
        rows.append((w, o.home_goals, o.away_goals, lh, la))
    if len(rows) < 30:
        return fallback

    def nll(rho: float) -> float:
        total = 0.0
        for w, gh, ga, lh, la in rows:
            t = dc_tau(gh, ga, lh, la, rho)
            if t <= 1e-9:
                return float("inf")
            total -= w * math.log(t)
        return total

    lo, hi = -0.25, 0.10
    gr = (math.sqrt(5.0) - 1.0) / 2.0
    c, d = hi - gr * (hi - lo), lo + gr * (hi - lo)
    fc, fd = nll(c), nll(d)
    for _ in range(60):
        if fc < fd:
            hi, d, fd = d, c, fc
            c = hi - gr * (hi - lo)
            fc = nll(c)
        else:
            lo, c, fc = c, d, fd
            d = lo + gr * (hi - lo)
            fd = nll(d)
        if abs(hi - lo) < 1e-5:
            break
    return (lo + hi) / 2.0


def fit(
    observations: Sequence[Obs],
    ref_date: date,
    priors: Optional[Dict[str, Tuple[float, float]]] = None,
    teams: Optional[Iterable[str]] = None,
    xg_weight: float = C.XG_RATING_WEIGHT,
    xi: float = C.TIME_DECAY_XI,
    prior_strength: float = C.PRIOR_STRENGTH,
    home_adv_prior: float = C.HOME_ADV_PRIOR,
    fallback_rho: float = -0.05,
) -> Ratings:
    """
    Fit on goals and on xG, then blend geometrically.

    Geometric blending is the right operation because the model is
    multiplicative: a geometric mean of strengths is an arithmetic mean of
    log-strengths, and log-strength is where the model is linear.
    """
    goals_r = _fit_target(observations, ref_date, "goals", priors, teams,
                          xi, prior_strength, home_adv_prior)

    has_xg = any(o.value("xg") is not None for o in observations)
    if not has_xg or xg_weight <= 0:
        final = goals_r
    else:
        xg_r = _fit_target(observations, ref_date, "xg", priors, teams,
                           xi, prior_strength, home_adv_prior)
        w = xg_weight
        names = set(goals_r.attack) | set(xg_r.attack)
        atk, dfn = {}, {}
        for t in names:
            atk[t] = (xg_r.attack_of(t) ** w) * (goals_r.attack_of(t) ** (1 - w))
            dfn[t] = (xg_r.defence_of(t) ** w) * (goals_r.defence_of(t) ** (1 - w))
        # The base rate stays on the goals scale: season xG and season goal
        # totals differ slightly, and the model predicts goals.
        final = Ratings(attack=atk, defence=dfn, base=goals_r.base,
                        home_adv=goals_r.home_adv, evidence=goals_r.evidence)

    final.rho = _fit_rho(observations, final, ref_date, xi, fallback_rho)
    return final


# ---------------------------------------------------------------------------
# Prediction
# ---------------------------------------------------------------------------

MAX_GOALS = 10


def score_matrix(lh: float, la: float, rho: float,
                 max_goals: int = MAX_GOALS) -> List[List[float]]:
    ph = [poisson_pmf(lh, k) for k in range(max_goals + 1)]
    pa = [poisson_pmf(la, k) for k in range(max_goals + 1)]
    m = [[ph[h] * pa[a] * dc_tau(h, a, lh, la, rho)
          for a in range(max_goals + 1)] for h in range(max_goals + 1)]
    total = sum(sum(row) for row in m)
    if total > 0:
        m = [[v / total for v in row] for row in m]
    return m


def predict(lh: float, la: float, rho: float = -0.05) -> Dict[str, Any]:
    """Turn a pair of expected-goal rates into a full outcome distribution."""
    m = score_matrix(lh, la, rho)
    n = len(m)

    win_h = sum(m[h][a] for h in range(n) for a in range(n) if h > a)
    draw = sum(m[h][h] for h in range(n))
    win_a = sum(m[h][a] for h in range(n) for a in range(n) if h < a)

    flat = [(h, a, m[h][a]) for h in range(n) for a in range(n)]
    flat.sort(key=lambda x: x[2], reverse=True)
    top = [[h, a, round(p * 100, 2)] for h, a, p in flat[:5]]

    over25 = sum(m[h][a] for h in range(n) for a in range(n) if h + a > 2)
    btts = sum(m[h][a] for h in range(1, n) for a in range(1, n))

    return {
        "pred_xg_home": round(lh, 3),
        "pred_xg_away": round(la, 3),
        "win_home_pct": round(win_h * 100, 1),
        "draw_pct": round(draw * 100, 1),
        "win_away_pct": round(win_a * 100, 1),
        "xpts_home": round(3 * win_h + draw, 2),
        "xpts_away": round(3 * win_a + draw, 2),
        "most_likely_scoreline": [top[0][0], top[0][1]],
        "top_5_scorelines": top,
        "over_2_5_pct": round(over25 * 100, 1),
        "btts_pct": round(btts * 100, 1),
    }


def predict_match(ratings: Ratings, home: str, away: str) -> Dict[str, Any]:
    lh, la = ratings.lambdas(home, away)
    return predict(lh, la, ratings.rho)


def xresult(home_xg: float, away_xg: float, rho: float = -0.05) -> Dict[str, Any]:
    """
    The retrospective xR: what the chances created say should have happened.

    Deliberately the same Poisson machinery as the forecast, but fed the xG the
    match actually produced rather than the xG we projected. This is what
    separates "won" from "deserved to win".
    """
    out = predict(home_xg, away_xg, rho)
    return {
        "xresult_win_home_pct": out["win_home_pct"],
        "xresult_draw_pct": out["draw_pct"],
        "xresult_win_away_pct": out["win_away_pct"],
        "xresult_xpts_home": out["xpts_home"],
        "xresult_xpts_away": out["xpts_away"],
        "xresult_most_likely_scoreline": out["most_likely_scoreline"],
        "xresult_top_5_scorelines": out["top_5_scorelines"],
    }


# ---------------------------------------------------------------------------
# Season priors
# ---------------------------------------------------------------------------

def carry_over_priors(
    previous: Ratings,
    teams: Iterable[str],
    promoted_attack: float = 0.86,
    promoted_defence: float = 1.14,
    carryover: float = C.SEASON_CARRYOVER,
) -> Dict[str, Tuple[float, float]]:
    """
    Convert last season's fitted ratings into this season's priors.

    Two things happen over a summer. Every side regresses toward the mean, as
    squads and managers change and some of last season's rating was luck that
    will not repeat. And promoted sides arrive with no top-flight rating at
    all, so they take the historical promoted-team baseline rather than an
    assumption of average quality, which would badly overrate them.
    """
    out: Dict[str, Tuple[float, float]] = {}
    for t in teams:
        if t in previous.attack:
            a = 1.0 + carryover * (previous.attack_of(t) - 1.0)
            d = 1.0 + carryover * (previous.defence_of(t) - 1.0)
        else:
            a, d = promoted_attack, promoted_defence
        out[t] = (a, d)
    return out


def observations_from_matches(matches: Sequence[Dict[str, Any]]) -> List[Obs]:
    """Build model observations from played matches only."""
    out: List[Obs] = []
    for m in matches:
        if m.get("home_goals") is None or m.get("away_goals") is None:
            continue
        out.append(Obs(
            date=_to_date(m["date"]),
            home=m["home"],
            away=m["away"],
            home_goals=int(m["home_goals"]),
            away_goals=int(m["away_goals"]),
            home_xg=m.get("home_xg"),
            away_xg=m.get("away_xg"),
        ))
    return out


# ---------------------------------------------------------------------------
# Descriptive rolling form (narrative layer only; never feeds the ratings)
# ---------------------------------------------------------------------------

def rolling_form(matches: Sequence[Dict[str, Any]], team: str,
                 before: date, window: int = C.FORM_WINDOW) -> Dict[str, Any]:
    played = []
    for m in matches:
        if m.get("home_goals") is None or m.get("away_goals") is None:
            continue
        if _to_date(m["date"]) >= before:
            continue
        if m["home"] == team:
            played.append((m, True))
        elif m["away"] == team:
            played.append((m, False))
    played.sort(key=lambda x: x[0]["date"], reverse=True)
    played = played[:window]

    if not played:
        return {"matches": 0, "xg_for": 0.0, "xg_against": 0.0, "goals": 0.0,
                "goals_against": 0.0, "points": 0, "ppg": 0.0, "form": "",
                "xg_diff_per_game": 0.0, "finishing_delta": 0.0,
                "possession_pct": 50.0}

    gf = ga = xf = xa = 0.0
    pts = 0
    seq = []
    xg_seen = 0
    poss_sum = 0.0
    poss_seen = 0
    for m, is_home in played:
        f = m["home_goals"] if is_home else m["away_goals"]
        a = m["away_goals"] if is_home else m["home_goals"]
        gf += f
        ga += a
        poss = m.get("home_possession") if is_home else m.get("away_possession")
        if poss:
            poss_sum += poss
            poss_seen += 1
        hx, ax = m.get("home_xg"), m.get("away_xg")
        if hx is not None and ax is not None:
            xf += hx if is_home else ax
            xa += ax if is_home else hx
            xg_seen += 1
        if f > a:
            pts += 3
            seq.append("W")
        elif f == a:
            pts += 1
            seq.append("D")
        else:
            seq.append("L")

    n = len(played)
    nx = max(xg_seen, 1)
    return {
        "matches": n,
        "goals": round(gf / n, 2),
        "goals_against": round(ga / n, 2),
        "xg_for": round(xf / nx, 2) if xg_seen else 0.0,
        "xg_against": round(xa / nx, 2) if xg_seen else 0.0,
        "xg_diff_per_game": round((xf - xa) / nx, 2) if xg_seen else 0.0,
        # Positive means scoring more than the chances warranted.
        "finishing_delta": round((gf - xf) / nx, 2) if xg_seen else 0.0,
        "points": pts,
        "ppg": round(pts / n, 2),
        "form": "".join(reversed(seq)),
        "possession_pct": round(poss_sum / poss_seen, 1) if poss_seen else 50.0,
    }
