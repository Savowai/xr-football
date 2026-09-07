import { notFound } from "next/navigation";
import { getLeague, loadStandings, loadMatches, loadSeasonMetadata } from "../../lib/xr_data";
import { bandFor, BAND_LABELS } from "../../lib/league_meta";
import { TeamCell, FormGuide, Signed, Empty } from "../../components/ui";
import TableViews from "./TableViews";

export const dynamic = "force-static";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const meta = getLeague(league);
  return { title: meta ? `${meta.name} table — xR` : "Table — xR" };
}

/** Oldest-to-newest result letters for a team, from played matches. */
function formFor(team: string, matches: ReturnType<typeof loadMatches>): string {
  return matches
    .filter(
      (m) =>
        m.status === "finished" &&
        m.home_goals != null &&
        m.away_goals != null &&
        (m.home === team || m.away === team),
    )
    .slice(-6)
    .map((m) => {
      const home = m.home === team;
      const gf = (home ? m.home_goals : m.away_goals) ?? 0;
      const ga = (home ? m.away_goals : m.home_goals) ?? 0;
      return gf > ga ? "W" : gf === ga ? "D" : "L";
    })
    .join("");
}

export default async function TablePage({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const info = getLeague(league);
  if (!info) notFound();

  const standings = loadStandings(league);
  const matches = loadMatches(league);
  const meta = loadSeasonMetadata(league);

  if (standings.length === 0) {
    return (
      <div className="wrap" style={{ paddingTop: 24 }}>
        <Empty>No table yet for {info.name}.</Empty>
      </div>
    );
  }

  const rows = standings.map((r) => ({
    ...r,
    band: bandFor(league, r.position, info.teams),
    form: formFor(r.team, matches),
  }));

  return (
    <div className="wrap stack" style={{ paddingTop: 24 }}>
      <div className="row-between" style={{ flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">{info.name} table</h1>
          <p className="sub">
            {info.played} of {info.matches} played · matchweek {info.current_round} of{" "}
            {info.total_rounds} · xG on {meta.xg_coverage} matches
          </p>
        </div>
      </div>

      {/* The actual/expected toggle lives client-side so switching between the
          two tables is instant and keeps the reader's scroll position. */}
      <TableViews rows={rows} league={league} />

      <div className="card card-pad">
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          Reading this table
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 16, marginBottom: 12 }}>
          {BAND_LABELS.map(({ band, label }) => (
            <span key={band} className="row small muted" style={{ gap: 6 }}>
              <span
                style={{
                  width: 3,
                  height: 12,
                  borderRadius: 2,
                  background: `var(--band-${band})`,
                }}
              />
              {label}
            </span>
          ))}
        </div>
        <p className="sub">
          <strong>xPts</strong> is the points a side would have averaged given the
          chances created and conceded, simulating each match from its xG rather than
          its scoreline. <strong>Luck</strong> is points minus xPts:{" "}
          <span className="pos">positive</span> means the table currently flatters
          them, <span className="neg">negative</span> means results have lagged the
          underlying performance.
        </p>
      </div>
    </div>
  );
}
