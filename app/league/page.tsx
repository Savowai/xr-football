import { loadMatches, loadPredictions, loadSeasonMetadata, loadUnderstatTable } from "../lib/xr_data";
import StandingsTable from "./components/StandingsTable";

export default async function LeaguePage() {
  const matches = loadMatches();
  const predictions = loadPredictions();
  const metadata = loadSeasonMetadata();
  const understatTable = loadUnderstatTable();

  if (!matches || matches.length === 0) {
    return (
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 24px", color: "#fff" }}>
          League Standings
        </h1>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 32, textAlign: "center" }}>
          <p style={{ color: "var(--muted)", marginBottom: 8 }}>Data not yet built.</p>
          <code style={{ display: "block", background: "var(--surface-2)", padding: "10px 16px", borderRadius: 6, color: "#fff", fontSize: 13 }}>
            python3 scripts/fetch_espn_2526.py
          </code>
        </div>
      </div>
    );
  }

  const actualTable = computeTable(matches, "actual");

  // Use Understat shot-level xPts when available; fall back to Poisson-computed xPts
  const useUnderstat = understatTable.length > 0;
  const expectedTable = useUnderstat
    ? understatTable.map(row => ({
        team: row.team,
        played: row.played,
        points: row.xpts,
        gf: row.xg_for,
        ga: row.xg_against,
        gd: Math.round((row.xg_for - row.xg_against) * 10) / 10,
      })).sort((a, b) => b.points - a.points || b.gd - a.gd)
    : computeTable(predictions, "expected");

  const xptsLabel = useUnderstat ? "Expected Table (xPts*)" : "Expected Table (xPts)";
  const xptsDesc = useUnderstat
    ? "Shot-level xPts from Understat. Computed from every shot's probability of scoring — not just goals. (* Understat model)"
    : "Projected table using xPoints: 3×P(Win) + 1×P(Draw) per match. Tells you if a team is getting lucky.";

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 4px", color: "#fff" }}>
          League Standings
        </h1>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
          {metadata.season} · Actual vs Expected Points
          {useUnderstat && (
            <span style={{ marginLeft: 8, color: "var(--accent)", fontSize: 11, fontWeight: 600 }}>
              · xPts via Understat
            </span>
          )}
        </p>
      </div>

      {/* Dual table */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 10 }}>
            Actual Table
          </div>
          <StandingsTable teams={actualTable} type="actual" />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", marginBottom: 10 }}>
            {xptsLabel}
          </div>
          <StandingsTable teams={expectedTable} type="expected" />
        </div>
      </div>

      {/* Explainer */}
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 10, padding: 20,
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20,
      }}>
        {[
          {
            title: "Actual Table",
            desc: "Current PL standings based on match results. 3 pts for a win, 1 for a draw.",
          },
          {
            title: xptsLabel,
            desc: xptsDesc,
          },
          {
            title: "Divergence",
            desc: "Big gaps between actual and expected rank indicate luck or consistent over/under-performance relative to shot quality.",
          },
        ].map(({ title, desc }) => (
          <div key={title}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", marginBottom: 4 }}>{title}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>{desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

type TableRow = { team: string; played: number; points: number; gf: number; ga: number; gd: number };

function computeTable(data: any[], type: "actual" | "expected"): TableRow[] {
  const teams = new Map<string, any>();

  for (const match of data) {
    if (!teams.has(match.home)) teams.set(match.home, { team: match.home, played: 0, points: 0, gf: 0, ga: 0 });
    if (!teams.has(match.away)) teams.set(match.away, { team: match.away, played: 0, points: 0, gf: 0, ga: 0 });
  }

  for (const match of data) {
    const h = teams.get(match.home)!;
    const a = teams.get(match.away)!;

    if (type === "actual") {
      if (match.home_goals !== null && match.away_goals !== null) {
        h.played++; a.played++;
        h.gf += match.home_goals; h.ga += match.away_goals;
        a.gf += match.away_goals; a.ga += match.home_goals;
        if (match.home_goals > match.away_goals) { h.points += 3; }
        else if (match.home_goals < match.away_goals) { a.points += 3; }
        else { h.points++; a.points++; }
      }
    } else {
      h.played++; a.played++;
      if (match.home_goals !== null && match.away_goals !== null) {
        h.gf += match.home_goals; h.ga += match.away_goals;
        a.gf += match.away_goals; a.ga += match.home_goals;
        if (match.home_goals > match.away_goals) { h.points += 3; }
        else if (match.home_goals < match.away_goals) { a.points += 3; }
        else { h.points++; a.points++; }
      } else {
        h.points += match.xpts_home ?? 0;
        a.points += match.xpts_away ?? 0;
        h.gf += match.pred_xg_home ?? 0;
        h.ga += match.pred_xg_away ?? 0;
        a.gf += match.pred_xg_away ?? 0;
        a.ga += match.pred_xg_home ?? 0;
      }
    }
  }

  return Array.from(teams.values())
    .map(t => ({
      team: t.team,
      played: t.played,
      points: Math.round(t.points * 10) / 10,
      gf: Math.round(t.gf * 10) / 10,
      ga: Math.round(t.ga * 10) / 10,
      gd: Math.round((t.gf - t.ga) * 10) / 10,
    }))
    .sort((a, b) => b.points - a.points || b.gd - a.gd);
}
