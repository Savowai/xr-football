/**
 * League-specific presentation facts that aren't in the data files.
 *
 * Qualification cut-offs genuinely differ -- the Bundesliga plays a relegation
 * play-off for 16th, LaLiga does not -- and hard-coding the English shape here
 * would reintroduce exactly the bug that config.py warns about.
 *
 * Band counts reflect the 2026-27 UEFA allocation.
 */

export type Band = "ucl" | "uel" | "conf" | "rel" | null;

interface Bands {
  ucl: number;
  uel: number;
  conf: number;
  /** Positions from the bottom that go down (including any play-off place). */
  rel: number;
  teams: number;
}

const BANDS: Record<string, Bands> = {
  epl:        { ucl: 5, uel: 1, conf: 1, rel: 3, teams: 20 },
  laliga:     { ucl: 5, uel: 1, conf: 1, rel: 3, teams: 20 },
  seriea:     { ucl: 5, uel: 1, conf: 1, rel: 3, teams: 20 },
  bundesliga: { ucl: 4, uel: 2, conf: 1, rel: 3, teams: 18 },
  ligue1:     { ucl: 4, uel: 1, conf: 1, rel: 3, teams: 18 },
};

export function bandFor(leagueKey: string, position: number, teams: number): Band {
  const b = BANDS[leagueKey];
  if (!b) return null;
  const size = teams || b.teams;

  if (position <= b.ucl) return "ucl";
  if (position <= b.ucl + b.uel) return "uel";
  if (position <= b.ucl + b.uel + b.conf) return "conf";
  if (position > size - b.rel) return "rel";
  return null;
}

export const BAND_LABELS: Array<{ band: Exclude<Band, null>; label: string }> = [
  { band: "ucl", label: "Champions League" },
  { band: "uel", label: "Europa League" },
  { band: "conf", label: "Conference League" },
  { band: "rel", label: "Relegation" },
];

/** Two/three-letter country tag used where a flag would normally go. */
export const COUNTRY_TAG: Record<string, string> = {
  epl: "ENG",
  laliga: "ESP",
  seriea: "ITA",
  bundesliga: "GER",
  ligue1: "FRA",
};
