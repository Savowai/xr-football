"""
xR (Expected Result) model - feature engineering and prediction.

Core logic:
1. Compute rolling team form features (last 10 matches, weighted)
2. Build matchup-aware xG predictions from form + style factors
3. Convert xG to Poisson-based P(W/D/L) and scoreline probabilities
"""

import numpy as np
from scipy.special import factorial
from typing import Dict, List, Any, Tuple
from dataclasses import dataclass
from datetime import datetime, timedelta
import math


@dataclass
class TeamFormStats:
    """Rolling form statistics for a team."""
    matches_count: int
    
    # Attack
    xg_for: float
    shots: float
    shots_on_target: float
    goals: float
    
    # Defense
    xg_against: float
    shots_against: float
    shots_on_target_against: float
    goals_against: float
    
    # Possession / Tempo
    possession_pct: float
    passes_completed: float
    passes_attempted: float
    progressive_passes: float
    progressive_carries: float
    
    # Pressing / Intensity
    pressures: float
    tackles_final_third: float
    interceptions: float
    
    # Set pieces / Crossing
    crosses: float
    corners: float

    # Pressing intensity (from Understat teamsData PPDA)
    # PPDA = passes_allowed / defensive_actions. Lower = more aggressive press.
    # Default 10.0 = league average. Range: ~5 (intense) to 15+ (passive/low block).
    ppda: float = 10.0

    # Set piece reliance: fraction of xG from set pieces (reserved for future data)
    set_piece_reliance: float = 0.0

    @property
    def xg_per_shot(self) -> float:
        """xG efficiency."""
        if self.shots < 1:
            return 0.1
        return self.xg_for / self.shots
    
    @property
    def possession_productivity(self) -> float:
        """xG per possession % (proxy for efficiency in possession)."""
        if self.possession_pct < 1:
            return 0.0
        return self.xg_for / max(self.possession_pct, 10)
    
    @property
    def pass_completion_pct(self) -> float:
        """Pass completion percentage."""
        if self.passes_attempted < 1:
            return 0.0
        return 100.0 * self.passes_completed / self.passes_attempted
    
    @property
    def defense_solidity(self) -> float:
        """Lower is better (fewer shots conceded per match)."""
        return self.shots_against


def exponential_weights(n: int, halflife: int) -> np.ndarray:
    """
    Create exponential decay weights for rolling window.
    Most recent matches get highest weight.
    
    Args:
        n: Window size
        halflife: Number of matches for weight to halve
    
    Returns:
        Array of weights (oldest to newest), normalized to sum to 1
    """
    if n <= 0:
        return np.array([])
    
    decay_rate = math.log(2) / halflife
    weights = np.array([math.exp(decay_rate * (i - n + 1)) for i in range(n)])
    return weights / weights.sum()


def compute_rolling_form(
    matches: List[Dict[str, Any]],
    team: str,
    date_before: datetime,
    window_size: int = 10,
    halflife: int = 4,
) -> Tuple[TeamFormStats, List[Dict]]:
    """
    Compute rolling team form statistics for matches up to (not including) date_before.
    
    Args:
        matches: List of match dicts with keys:
                 {date, home, away, home_goals, away_goals, home_xg, away_xg,
                  home_shots, away_shots, home_sot, away_sot,
                  home_possession, away_possession, home_passes_comp, away_passes_comp,
                  home_passes_att, away_passes_att, home_progressive_passes, away_progressive_passes,
                  home_progressive_carries, away_progressive_carries,
                  home_pressures, away_pressures, home_tackles_final_3rd, away_tackles_final_3rd,
                  home_interceptions, away_interceptions,
                  home_crosses, away_crosses, home_corners, away_corners}
        team: Team name
        date_before: Only include matches strictly before this date
        window_size: Max number of recent matches to consider
        halflife: Exponential weight halflife in matches
    
    Returns:
        (TeamFormStats, list_of_recent_matches_used)
    """
    # Filter matches for team, before date
    recent_matches = []
    for m in matches:
        match_date = datetime.fromisoformat(m["date"])
        if match_date < date_before:
            is_home = (m["home"] == team)
            is_away = (m["away"] == team)
            if is_home or is_away:
                recent_matches.append((m, is_home))
    
    # Sort by date descending (most recent first)
    recent_matches.sort(key=lambda x: x[0]["date"], reverse=True)
    recent_matches = recent_matches[:window_size]
    
    # Reverse back to chronological order
    recent_matches = list(reversed(recent_matches))
    
    if not recent_matches:
        # Return empty stats
        return TeamFormStats(
            matches_count=0,
            xg_for=0, shots=0, shots_on_target=0, goals=0,
            xg_against=0, shots_against=0, shots_on_target_against=0, goals_against=0,
            possession_pct=50, passes_completed=0, passes_attempted=1,
            progressive_passes=0, progressive_carries=0,
            pressures=0, tackles_final_third=0, interceptions=0,
            crosses=0, corners=0,
            ppda=10.0, set_piece_reliance=0.0,
        ), []
    
    # Compute weights
    weights = exponential_weights(len(recent_matches), halflife)
    
    # Aggregate with weights
    xg_for = 0.0
    shots = 0.0
    sot = 0.0
    goals = 0.0
    xg_against = 0.0
    shots_against = 0.0
    sot_against = 0.0
    goals_against = 0.0
    possession_pct = 0.0
    passes_completed = 0.0
    passes_attempted = 0.0
    progressive_passes = 0.0
    progressive_carries = 0.0
    pressures = 0.0
    tackles_final_3rd = 0.0
    interceptions = 0.0
    crosses = 0.0
    corners = 0.0
    ppda = 0.0

    for w, (match, is_home) in zip(weights, recent_matches):
        if is_home:
            xg_for += w * (match.get("home_xg") or 0)
            shots += w * (match.get("home_shots") or 0)
            sot += w * (match.get("home_sot") or 0)
            goals += w * (match.get("home_goals") or 0)
            xg_against += w * (match.get("away_xg") or 0)
            shots_against += w * (match.get("away_shots") or 0)
            sot_against += w * (match.get("away_sot") or 0)
            goals_against += w * (match.get("away_goals") or 0)
            possession_pct += w * (match.get("home_possession") or 50)
            passes_completed += w * (match.get("home_passes_comp") or 0)
            passes_attempted += w * (match.get("home_passes_att") or 1)
            progressive_passes += w * (match.get("home_progressive_passes") or 0)
            progressive_carries += w * (match.get("home_progressive_carries") or 0)
            pressures += w * (match.get("home_pressures") or 0)
            tackles_final_3rd += w * (match.get("home_tackles_final_3rd") or 0)
            interceptions += w * (match.get("home_interceptions") or 0)
            crosses += w * (match.get("home_crosses") or 0)
            corners += w * (match.get("home_corners") or 0)
            ppda += w * (match.get("home_ppda") or 10.0)
        else:
            xg_for += w * (match.get("away_xg") or 0)
            shots += w * (match.get("away_shots") or 0)
            sot += w * (match.get("away_sot") or 0)
            goals += w * (match.get("away_goals") or 0)
            xg_against += w * (match.get("home_xg") or 0)
            shots_against += w * (match.get("home_shots") or 0)
            sot_against += w * (match.get("home_sot") or 0)
            goals_against += w * (match.get("home_goals") or 0)
            possession_pct += w * (100 - (match.get("home_possession") or 50))
            passes_completed += w * (match.get("away_passes_comp") or 0)
            passes_attempted += w * (match.get("away_passes_att") or 1)
            progressive_passes += w * (match.get("away_progressive_passes") or 0)
            progressive_carries += w * (match.get("away_progressive_carries") or 0)
            pressures += w * (match.get("away_pressures") or 0)
            tackles_final_3rd += w * (match.get("away_tackles_final_3rd") or 0)
            interceptions += w * (match.get("away_interceptions") or 0)
            crosses += w * (match.get("away_crosses") or 0)
            corners += w * (match.get("away_corners") or 0)
            ppda += w * (match.get("away_ppda") or 10.0)
    
    form = TeamFormStats(
        matches_count=len(recent_matches),
        xg_for=xg_for,
        shots=shots,
        shots_on_target=sot,
        goals=goals,
        xg_against=xg_against,
        shots_against=shots_against,
        shots_on_target_against=sot_against,
        goals_against=goals_against,
        possession_pct=possession_pct,
        passes_completed=passes_completed,
        passes_attempted=passes_attempted,
        progressive_passes=progressive_passes,
        progressive_carries=progressive_carries,
        pressures=pressures,
        tackles_final_third=tackles_final_3rd,
        interceptions=interceptions,
        crosses=crosses,
        corners=corners,
        ppda=ppda,
        set_piece_reliance=0.0,
    )
    
    return form, [m for m, _ in recent_matches]


def compute_matchup_xg(
    home_form: TeamFormStats,
    away_form: TeamFormStats,
    min_xg: float = 0.2,
    max_xg: float = 3.5,
    home_advantage: float = 0.3,
) -> Tuple[float, float, List[Dict[str, Any]]]:
    """
    Predict xG for both teams based on form + matchup adjustments.
    
    Matchup factors:
    - Pressing intensity vs turnover rate
    - Crossing threat vs aerial defense
    - Possession control vs counter threat
    
    Returns:
        (home_xg, away_xg, adjustments_breakdown)
    """
    adjustments = []
    
    # Base xG: blend of attack form and opponent defense form
    base_home_xg = (home_form.xg_for * 0.6 + (1 - away_form.xg_against / max(home_form.xg_for, 1)) * home_form.xg_for * 0.4)
    base_away_xg = (away_form.xg_for * 0.6 + (1 - home_form.xg_against / max(away_form.xg_for, 1)) * away_form.xg_for * 0.4)
    
    # Fallback to 1.0 if form data too sparse
    if home_form.matches_count < 2:
        base_home_xg = 1.0
    if away_form.matches_count < 2:
        base_away_xg = 1.0
    
    home_xg = base_home_xg
    away_xg = base_away_xg
    
    # Matchup adjustment 1: PPDA-based pressing intensity
    # Real PPDA from Understat teamsData. Lower PPDA = more aggressive press.
    # A pressing team vs a possession-dominant team = more turnovers = more xG.
    # League average PPDA ≈ 10. Elite press: <8. Passive/low-block: >12.
    PPDA_LEAGUE_AVG = 10.0

    if home_form.ppda < PPDA_LEAGUE_AVG:
        press_strength = (PPDA_LEAGUE_AVG - home_form.ppda) / PPDA_LEAGUE_AVG
        possession_exposure = max(0.0, away_form.possession_pct - 45.0) / 55.0
        adjustment = round(min(0.2, press_strength * possession_exposure * 0.35), 3)
        if adjustment > 0.01:
            home_xg += adjustment
            adjustments.append({
                "name": "Pressing advantage (home)",
                "magnitude": adjustment,
                "home_ppda": home_form.ppda,
            })

    if away_form.ppda < PPDA_LEAGUE_AVG:
        press_strength = (PPDA_LEAGUE_AVG - away_form.ppda) / PPDA_LEAGUE_AVG
        possession_exposure = max(0.0, home_form.possession_pct - 45.0) / 55.0
        adjustment = round(min(0.2, press_strength * possession_exposure * 0.35), 3)
        if adjustment > 0.01:
            away_xg += adjustment
            adjustments.append({
                "name": "Pressing advantage (away)",
                "magnitude": adjustment,
                "away_ppda": away_form.ppda,
            })
    
    # Matchup adjustment 2: Crossing threat vs aerial/box defense
    # High crosses + progressive passes vs low defensive presence = higher xG
    home_crossing_threat = home_form.crosses + home_form.progressive_passes * 0.1
    away_crossing_threat = away_form.crosses + away_form.progressive_passes * 0.1
    
    home_defensive_presence = home_form.tackles_final_third + home_form.interceptions
    away_defensive_presence = away_form.tackles_final_third + away_form.interceptions
    
    if home_crossing_threat > 30 and away_defensive_presence < 15:
        adjustment = min(0.25, (home_crossing_threat - 30) * 0.01)
        home_xg += adjustment
        adjustments.append({
            "name": "Home crossing threat vs Away weak defense",
            "magnitude": adjustment,
            "home_crosses": home_form.crosses,
            "away_defensive_presence": away_defensive_presence,
        })
    
    if away_crossing_threat > 30 and home_defensive_presence < 15:
        adjustment = min(0.25, (away_crossing_threat - 30) * 0.01)
        away_xg += adjustment
        adjustments.append({
            "name": "Away crossing threat vs Home weak defense",
            "magnitude": adjustment,
            "away_crosses": away_form.crosses,
            "home_defensive_presence": home_defensive_presence,
        })
    
    # Matchup adjustment 3: Possession control with low defensive activity (counter risk)
    # High possession + low defensive intensity = vulnerability to counters
    home_possession_dominance = home_form.possession_pct - away_form.possession_pct
    away_counter_threat = away_form.xg_for / max(away_form.shots, 1) if away_form.shots > 0 else 0.1
    
    if home_possession_dominance > 15 and away_counter_threat > 0.15:
        # Away team might be dangerous on counters despite possession deficit
        adjustment = min(0.2, (home_possession_dominance / 20) * away_counter_threat)
        away_xg += adjustment
        adjustments.append({
            "name": "Away counter threat vs Home possession dominance",
            "magnitude": adjustment,
            "possession_diff": home_possession_dominance,
            "away_xg_per_shot": away_counter_threat,
        })
    
    # Home advantage
    home_xg += home_advantage
    adjustments.append({
        "name": "Home advantage",
        "magnitude": home_advantage,
    })
    
    # Clamp to sane range
    home_xg = max(min_xg, min(max_xg, home_xg))
    away_xg = max(min_xg, min(max_xg, away_xg))
    
    return home_xg, away_xg, adjustments


def poisson_probability(lam: float, k: int) -> float:
    """
    Poisson probability: P(X = k) where X ~ Poisson(λ).
    """
    if lam <= 0 or k < 0:
        return 0.0
    try:
        return (math.exp(-lam) * (lam ** k)) / factorial(k)
    except (OverflowError, ValueError):
        return 0.0


def compute_match_probabilities(
    home_xg: float,
    away_xg: float,
    max_goals: int = 10,
) -> Dict[str, Any]:
    """
    Convert xG to Poisson-based match outcome probabilities.
    
    Returns:
        {
            "win_home_pct": float,
            "win_away_pct": float,
            "draw_pct": float,
            "xpts_home": float,  # Expected points (3*win + 1*draw)
            "xpts_away": float,
            "scoreline_probs": [(h, a, prob), ...],  # Top 5 most likely
            "most_likely_scoreline": (h, a),
        }
    """
    # Compute scoreline probabilities
    scoreline_probs = []
    for h in range(max_goals + 1):
        for a in range(max_goals + 1):
            prob = poisson_probability(home_xg, h) * poisson_probability(away_xg, a)
            if prob > 0:
                scoreline_probs.append((h, a, prob))
    
    # Aggregate outcomes
    win_home = sum(p for h, a, p in scoreline_probs if h > a)
    draw = sum(p for h, a, p in scoreline_probs if h == a)
    win_away = sum(p for h, a, p in scoreline_probs if h < a)
    
    # Normalize (sometimes minor rounding errors)
    total = win_home + draw + win_away
    if total > 0:
        win_home /= total
        draw /= total
        win_away /= total
    
    # xPoints
    xpts_home = 3 * win_home + 1 * draw
    xpts_away = 3 * win_away + 1 * draw
    
    # Most likely scorelines (top 5)
    scoreline_probs.sort(key=lambda x: x[2], reverse=True)
    top_5 = [(h, a, round(p * 100, 2)) for h, a, p in scoreline_probs[:5]]
    most_likely = (top_5[0][0], top_5[0][1]) if top_5 else (0, 0)
    
    return {
        "win_home_pct": round(win_home * 100, 1),
        "draw_pct": round(draw * 100, 1),
        "win_away_pct": round(win_away * 100, 1),
        "xpts_home": round(xpts_home, 2),
        "xpts_away": round(xpts_away, 2),
        "top_5_scorelines": top_5,
        "most_likely_scoreline": most_likely,
    }
