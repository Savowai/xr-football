/**
 * lib/xr_data.ts
 * 
 * Load and interact with xR predictions and matches from generated JSON files.
 */

import fs from "fs";
import path from "path";

export interface XRMatch {
  date: string;
  round?: string;
  home: string;
  away: string;
  home_goals?: number | null;
  away_goals?: number | null;
  home_xg: number;
  away_xg: number;
  home_shots: number;
  away_shots: number;
  home_sot: number;
  away_sot: number;
  season: string;
}

export interface MatchupAdjustment {
  name: string;
  magnitude: number;
  [key: string]: any;
}

export interface XRPrediction {
  date: string;
  kickoff_datetime: string;
  home: string;
  away: string;
  round?: string;

  // Form stats
  home_form: {
    matches: number;
    xg_for: number;
    xg_against: number;
    goals: number;
    possession_pct: number;
    pass_completion_pct: number;
    ppda?: number;
  };
  away_form: {
    matches: number;
    xg_for: number;
    xg_against: number;
    goals: number;
    possession_pct: number;
    pass_completion_pct: number;
    ppda?: number;
  };

  // xG
  base_xg_home?: number;
  base_xg_away?: number;
  pred_xg_home: number;
  pred_xg_away: number;

  // Matchup adjustments
  matchup_adjustments: MatchupAdjustment[];

  // Probabilities
  win_home_pct: number;
  draw_pct: number;
  win_away_pct: number;
  xpts_home: number;
  xpts_away: number;
  most_likely_scoreline: [number, number];
  top_5_scorelines: Array<[number, number, number]>;

  // 72-hour unlock
  hours_until_kickoff: number;
  show_prediction: boolean;

  // Result
  home_goals?: number | null;
  away_goals?: number | null;

  // Post-match xResult (real Understat xG → Poisson)
  actual_xg_home?: number | null;
  actual_xg_away?: number | null;
  xresult_win_home_pct?: number;
  xresult_draw_pct?: number;
  xresult_win_away_pct?: number;
  xresult_xpts_home?: number;
  xresult_xpts_away?: number;
  xresult_most_likely_scoreline?: [number, number];
  xresult_top_5_scorelines?: Array<[number, number, number]>;
  xresult_verdict?: "justified" | "lucky_home" | "lucky_away";

  season: string;
}

export interface UnderstatTableEntry {
  team: string;
  played: number;
  xpts: number;
  xg_for: number;
  xg_against: number;
}

export interface SeasonMetadata {
  season: string;
  league: string;
  built_at: string;
  match_count: number;
  prediction_count: number;
  teams: string[];
  team_count: number;
}

function getDataDir(): string {
  return path.join(process.cwd(), "data", "processed");
}

/**
 * Load all matches for the season.
 * Returns empty array if files not found (graceful degradation).
 */
export function loadMatches(): XRMatch[] {
  try {
    const dataDir = getDataDir();
    const matchesPath = path.join(dataDir, "epl_matches.json");
    
    if (!fs.existsSync(matchesPath)) {
      console.warn(`Data file not found: ${matchesPath}`);
      return [];
    }
    
    const data = fs.readFileSync(matchesPath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error loading matches:", error);
    return [];
  }
}

/**
 * Load all predictions for the season.
 * Returns empty array if files not found (graceful degradation).
 */
export function loadPredictions(): XRPrediction[] {
  try {
    const dataDir = getDataDir();
    const predPath = path.join(dataDir, "epl_predictions.json");
    
    if (!fs.existsSync(predPath)) {
      console.warn(`Data file not found: ${predPath}`);
      return [];
    }
    
    const data = fs.readFileSync(predPath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error loading predictions:", error);
    return [];
  }
}

/**
 * Load season metadata.
 * Returns default metadata if files not found.
 */
export function loadSeasonMetadata(): SeasonMetadata {
  try {
    const dataDir = getDataDir();
    const metaPath = path.join(dataDir, "season_metadata.json");
    
    if (!fs.existsSync(metaPath)) {
      console.warn(`Metadata file not found: ${metaPath}`);
      // Return default metadata
      return {
        season: "2025-26",
        league: "Premier League",
        built_at: new Date().toISOString(),
        match_count: 0,
        prediction_count: 0,
        teams: [],
        team_count: 0,
      };
    }
    
    const data = fs.readFileSync(metaPath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error loading metadata:", error);
    return {
      season: "2025-26",
      league: "Premier League",
      built_at: new Date().toISOString(),
      match_count: 0,
      prediction_count: 0,
      teams: [],
      team_count: 0,
    };
  }
}

/**
 * Load Understat xPts table.
 * Returns empty array if file not found (graceful degradation).
 */
export function loadUnderstatTable(): UnderstatTableEntry[] {
  try {
    const dataDir = getDataDir();
    const tablePath = path.join(dataDir, "understat_table.json");
    if (!fs.existsSync(tablePath)) return [];
    const data = fs.readFileSync(tablePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

/**
 * Get prediction for a specific match by home and away team.
 */
export function getPredictionForMatch(
  predictions: XRPrediction[],
  homeTeam: string,
  awayTeam: string,
): XRPrediction | null {
  return predictions.find(
    (p) => p.home === homeTeam && p.away === awayTeam
  ) ?? null;
}

/**
 * Get all predictions for a team (home or away).
 */
export function getPredictionsForTeam(
  predictions: XRPrediction[],
  team: string,
): XRPrediction[] {
  return predictions.filter(
    (p) => p.home === team || p.away === team
  );
}

/**
 * Get upcoming predictions (kickoff in the future).
 */
export function getUpcomingPredictions(
  predictions: XRPrediction[],
  now: Date = new Date(),
): XRPrediction[] {
  return predictions.filter(
    (p) => new Date(p.kickoff_datetime) > now
  ).sort((a, b) => new Date(a.kickoff_datetime).getTime() - new Date(b.kickoff_datetime).getTime());
}

/**
 * Get predictions that should be shown (within 72 hours).
 */
export function getShowablePredictions(
  predictions: XRPrediction[],
): XRPrediction[] {
  return predictions.filter((p) => p.show_prediction);
}
