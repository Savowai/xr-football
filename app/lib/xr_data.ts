/**
 * Server-side loaders for the generated data files.
 *
 * Everything under data/processed/ is written by scripts/build.py and
 * committed by the hourly workflow, so these reads are cheap and always
 * present at build time. Each loader degrades to an empty value rather than
 * throwing: a missing file should render a quiet page, not a 500.
 *
 * Layout is one directory per league -- data/processed/{leagueKey}/*.json --
 * with a leagues.json index at the top. The index is the only file a page can
 * read without already knowing which league it wants, so it drives routing.
 */

import fs from "fs";
import path from "path";

export type MatchStatus =
  | "scheduled"
  | "live"
  | "finished"
  | "postponed"
  | "cancelled"
  | "abandoned";

export interface XRMatch {
  date: string;
  kickoff_iso?: string;
  round?: string;
  home: string;
  away: string;
  home_goals?: number | null;
  away_goals?: number | null;
  status?: MatchStatus;
  status_detail?: string | null;
  minute?: string | null;
  home_xg?: number | null;
  away_xg?: number | null;
  home_shots?: number | null;
  away_shots?: number | null;
  home_sot?: number | null;
  away_sot?: number | null;
  home_corners?: number | null;
  away_corners?: number | null;
  home_possession?: number | null;
  away_possession?: number | null;
  odds_home?: number | null;
  odds_draw?: number | null;
  odds_away?: number | null;
  season: string;
}

export interface TeamForm {
  matches: number;
  goals: number;
  goals_against: number;
  xg_for: number;
  xg_against: number;
  xg_diff_per_game: number;
  /** Goals minus xG per game. Positive means finishing above expectation. */
  finishing_delta: number;
  points: number;
  ppg: number;
  /** Oldest-to-newest result letters, e.g. "WWDLW". */
  form: string;
  possession_pct: number;
}

export interface ReasoningFactor {
  side: "home" | "away";
  label: string;
  detail: string;
  /** Effect on that side's predicted goals; factors sum to the prediction. */
  delta_goals: number;
}

/**
 * Squad availability as applied to one fixture. Multipliers are 1.0 when the
 * side is at full strength; absent entirely on matches built before the
 * availability layer existed, hence optional.
 */
export interface AvailabilitySnapshot {
  home_attack_mult: number;
  home_defence_mult: number;
  away_attack_mult: number;
  away_defence_mult: number;
  home_missing: string[];
  away_missing: string[];
}

export interface Reasoning {
  thesis: string;
  confidence: {
    level: "high" | "medium" | "low" | "very low";
    note: string;
    effective_matches_home: number;
    effective_matches_away: number;
  };
  factors: ReasoningFactor[];
  rating_snapshot: {
    home_attack: number;
    home_defence: number;
    away_attack: number;
    away_defence: number;
    league_base: number;
    home_advantage: number;
  };
  availability?: AvailabilitySnapshot;
}

export interface XRPrediction {
  date: string;
  kickoff_datetime: string;
  home: string;
  away: string;
  round?: string;
  status?: MatchStatus;

  home_form: TeamForm;
  away_form: TeamForm;

  pred_xg_home: number;
  pred_xg_away: number;
  win_home_pct: number;
  draw_pct: number;
  win_away_pct: number;
  xpts_home: number;
  xpts_away: number;
  most_likely_scoreline: [number, number];
  top_5_scorelines: Array<[number, number, number]>;
  over_2_5_pct: number;
  btts_pct: number;

  reasoning: Reasoning;

  home_goals?: number | null;
  away_goals?: number | null;

  /** Retrospective xR, computed from the xG the match actually produced. */
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
  xresult_note?: string;
  xpts_swing_home?: number;

  season: string;
}

export interface StandingsRow {
  position: number;
  xposition: number;
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  xg_for: number;
  xg_against: number;
  xg_diff: number;
  xpts: number;
  /** Points minus xPts. Positive means the table flatters them. */
  luck: number;
}

export interface PowerRanking {
  rank: number;
  team: string;
  attack: number;
  defence: number;
  expected_gf_per_game: number;
  expected_ga_per_game: number;
  net_rating: number;
  evidence_matches: number;
}

export interface SeasonMetadata {
  season: string;
  league: string;
  built_at: string;
  match_count: number;
  played_count: number;
  prediction_count: number;
  teams: string[];
  team_count: number;
  current_round: number;
  next_round: number;
  total_rounds: number;
  xg_coverage: number;
  source: string;
  model: {
    name: string;
    base_goals: number;
    home_advantage: number;
    rho: number;
    time_decay_xi: number;
    prior_strength: number;
    xg_rating_weight: number;
    season_carryover: number;
  };
}

/** One entry per league in data/processed/leagues.json. */
export interface LeagueSummary {
  key: string;
  name: string;
  country: string;
  season: string;
  teams: number;
  played: number;
  matches: number;
  current_round: number;
  next_round: number;
  total_rounds: number;
  xg_coverage: number;
  leader: string | null;
  built_at: string;
}

const PROCESSED = path.join(process.cwd(), "data", "processed");

function read<T>(relative: string, fallback: T): T {
  try {
    const p = path.join(PROCESSED, relative);
    if (!fs.existsSync(p)) {
      console.warn(`Data file not found: ${p}`);
      return fallback;
    }
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch (error) {
    console.error(`Error loading ${relative}:`, error);
    return fallback;
  }
}

/**
 * The league index. Every route that needs to enumerate leagues -- the nav
 * switcher, generateStaticParams -- goes through here, so a league added to
 * scripts/config.py appears on the site without a frontend change.
 */
export const loadLeagues = (): LeagueSummary[] =>
  read<LeagueSummary[]>("leagues.json", []);

export const DEFAULT_LEAGUE = "epl";

export function getLeague(key: string): LeagueSummary | null {
  return loadLeagues().find((l) => l.key === key) ?? null;
}

const EMPTY_METADATA: SeasonMetadata = {
  season: "",
  league: "",
  built_at: new Date().toISOString(),
  match_count: 0,
  played_count: 0,
  prediction_count: 0,
  teams: [],
  team_count: 0,
  current_round: 0,
  next_round: 1,
  total_rounds: 38,
  xg_coverage: 0,
  source: "",
  model: {
    name: "",
    base_goals: 0,
    home_advantage: 0,
    rho: 0,
    time_decay_xi: 0,
    prior_strength: 0,
    xg_rating_weight: 0,
    season_carryover: 0,
  },
};

export const loadMatches = (league: string = DEFAULT_LEAGUE): XRMatch[] =>
  read<XRMatch[]>(`${league}/matches.json`, []);

export const loadPredictions = (league: string = DEFAULT_LEAGUE): XRPrediction[] =>
  read<XRPrediction[]>(`${league}/predictions.json`, []);

export const loadStandings = (league: string = DEFAULT_LEAGUE): StandingsRow[] =>
  read<StandingsRow[]>(`${league}/standings.json`, []);

export const loadPowerRankings = (league: string = DEFAULT_LEAGUE): PowerRanking[] =>
  read<PowerRanking[]>(`${league}/power_rankings.json`, []);

export const loadSeasonMetadata = (league: string = DEFAULT_LEAGUE): SeasonMetadata =>
  read<SeasonMetadata>(`${league}/metadata.json`, EMPTY_METADATA);

/** One row of a stat leaderboard. */
export interface LeaderboardPlayer {
  player_id: string | null;
  name: string;
  team: string;
  team_id: string | null;
  country: string | null;
  value: number;
  sub_value: number | null;
  matches: number | null;
  minutes: number | null;
  rank: number;
}

export interface Leaderboard {
  key: string;
  title: string;
  subtitle: string | null;
  category: string | null;
  /** "number" | "fraction" | ... — decides how `value` is rendered. */
  format: string | null;
  decimals: number;
  players: LeaderboardPlayer[];
}

export interface SquadPlayer {
  player_id: string | null;
  name: string;
  shirt: number | null;
  /** keepers | defenders | midfielders | attackers */
  group: string;
  position: string | null;
  country: string | null;
  age: number | null;
  height: number | null;
  rating: number | null;
  goals: number | null;
  assists: number | null;
  penalties: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  market_value: number | null;
  injured: boolean;
  /** Free text from the source: "Mid October 2026", "Doubtful", "Unknown". */
  expected_return: string | null;
}

/** Squads keyed by canonical team name. */
export type Squads = Record<string, SquadPlayer[]>;

export const loadPlayers = (league: string = DEFAULT_LEAGUE): Leaderboard[] =>
  read<Leaderboard[]>(`${league}/players.json`, []);

export const loadSquads = (league: string = DEFAULT_LEAGUE): Squads =>
  read<Squads>(`${league}/squads.json`, {});

/**
 * Walk-forward backtest results, written by `scripts/backtest.py --json`.
 *
 * These numbers used to be a hand-copied constant in the About page, and twice
 * they drifted from what the code actually produces. Reading them from the file
 * the scorer writes means the page can be wrong about many things, but no longer
 * about this one.
 */
export interface BacktestRow {
  key: "market" | "xr" | "previous" | "base_rate" | string;
  name: string;
  rps: number;
  log_loss: number;
  accuracy: number;
  n: number;
}

export interface BacktestReport {
  league: string;
  league_name: string;
  season: string;
  n: number;
  /** False when closing odds could not be sourced, so the market row is absent. */
  market_available: boolean;
  generated_at: string;
  rows: BacktestRow[];
}

const EMPTY_BACKTEST: BacktestReport = {
  league: DEFAULT_LEAGUE,
  league_name: "",
  season: "",
  n: 0,
  market_available: false,
  generated_at: "",
  rows: [],
};

export const loadBacktest = (): BacktestReport =>
  read<BacktestReport>("backtest.json", EMPTY_BACKTEST);

export function getPredictionForMatch(
  predictions: XRPrediction[],
  homeTeam: string,
  awayTeam: string,
): XRPrediction | null {
  return predictions.find((p) => p.home === homeTeam && p.away === awayTeam) ?? null;
}

export function getPredictionsForTeam(
  predictions: XRPrediction[],
  team: string,
): XRPrediction[] {
  return predictions.filter((p) => p.home === team || p.away === team);
}

export function isPlayed(m: { status?: MatchStatus; home_goals?: number | null }): boolean {
  return m.status === "finished" && m.home_goals !== null && m.home_goals !== undefined;
}

export function getUpcomingPredictions(
  predictions: XRPrediction[],
  now: Date = new Date(),
): XRPrediction[] {
  return predictions
    .filter((p) => p.status === "scheduled" && new Date(p.kickoff_datetime) > now)
    .sort(
      (a, b) =>
        new Date(a.kickoff_datetime).getTime() - new Date(b.kickoff_datetime).getTime(),
    );
}

/** Matches currently in play, for the live banner. */
export function getLiveMatches(matches: XRMatch[]): XRMatch[] {
  return matches.filter((m) => m.status === "live");
}
