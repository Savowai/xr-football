import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getLeague,
  loadStandings,
  loadPredictions,
  loadMatches,
  loadPowerRankings,
  loadSeasonMetadata,
  getUpcomingPredictions,
} from "../lib/xr_data";
import { bandFor } from "../lib/league_meta";
import {
  TeamCell,
  ProbBar,
  Signed,
  Stat,
  Empty,
  StatusBadge,
  formatKickoff,
  formatDayShort,
} from "../components/ui";

export const dynamic = "force-static";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const meta = getLeague(league);
  return { title: meta ? `${meta.name} — xR` : "xR" };
}

export default async function LeagueOverview({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const info = getLeague(league);
  if (!info) notFound();

  const standings = loadStandings(league);
  const predictions = loadPredictions(league);
  const matches = loadMatches(league);
  const power = loadPowerRankings(league);
  const meta = loadSeasonMetadata(league);

  const live = matches.filter((m) => m.status === "live");
  const upcoming = getUpcomingPredictions(predictions).slice(0, 6);
  const top = standings.slice(0, 6);

  // The most over- and under-performing sides are the single most interesting
  // thing the model has to say about a league at a glance.
  const byLuck = [...standings].sort((a, b) => b.luck - a.luck);
  const luckiest = byLuck[0];
  const unluckiest = byLuck[byLuck.length - 1];

  return (
    <div className="wrap stack-l" style={{ paddingTop: 24 }}>
      <div className="row-between" style={{ flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">{info.name}</h1>
          <p className="sub">
            {info.country} · {info.season} · matchweek {info.current_round} of{" "}
            {info.total_rounds}
          </p>
        </div>
        {live.length > 0 && (
          <span className="badge badge-live">
            <span className="live-dot" />
            {live.length} live
          </span>
        )}
      </div>

      <div className="grid-4">
        <Stat label="Played" value={`${info.played}`} hint={`of ${info.matches}`} />
        <Stat
          label="Leader"
          value={
            <span style={{ fontSize: 16 }}>{info.leader ?? "—"}</span>
          }
          hint={top[0] ? `${top[0].points} pts` : undefined}
        />
        <Stat
          label="Overperforming"
          value={<span style={{ fontSize: 16 }}>{luckiest?.team ?? "—"}</span>}
          hint={luckiest ? `${luckiest.luck > 0 ? "+" : ""}${luckiest.luck.toFixed(1)} pts vs xPts` : undefined}
        />
        <Stat
          label="Underperforming"
          value={<span style={{ fontSize: 16 }}>{unluckiest?.team ?? "—"}</span>}
          hint={unluckiest ? `${unluckiest.luck.toFixed(1)} pts vs xPts` : undefined}
        />
      </div>

      <div className="grid-2">
        {/* Table snapshot */}
        <div className="card">
          <div className="card-header">
            <span className="section-title">Table</span>
            <Link href={`/${league}/table`} className="small" style={{ color: "var(--accent)" }}>
              Full table →
            </Link>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="left">Team</th>
                  <th>Pl</th>
                  <th>GD</th>
                  <th>Pts</th>
                  <th>xPts</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r) => {
                  const band = bandFor(league, r.position, info.teams);
                  return (
                    <tr key={r.team} className={band ? `band-${band}` : undefined}>
                      <td className="pos-cell">{r.position}</td>
                      <td className="left">
                        <TeamCell name={r.team} league={league} />
                      </td>
                      <td className="num-weak">{r.played}</td>
                      <td>
                        <Signed value={r.gd} />
                      </td>
                      <td className="num-strong">{r.points}</td>
                      <td className="num-weak">{r.xpts.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Power ratings */}
        <div className="card">
          <div className="card-header">
            <span className="section-title">Power ratings</span>
            <span className="small dim">Model strength, not points</span>
          </div>
          {power.length === 0 ? (
            <div className="card-pad sub dim">Not enough data yet.</div>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th className="left">Team</th>
                    <th title="Expected goals scored per game">xGF/g</th>
                    <th title="Expected goals conceded per game">xGA/g</th>
                    <th title="Net rating">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {power.slice(0, 6).map((p) => (
                    <tr key={p.team}>
                      <td className="pos-cell">{p.rank}</td>
                      <td className="left">
                        <TeamCell name={p.team} league={league} />
                      </td>
                      <td className="num-weak">{p.expected_gf_per_game.toFixed(2)}</td>
                      <td className="num-weak">{p.expected_ga_per_game.toFixed(2)}</td>
                      <td>
                        <Signed value={p.net_rating} digits={2} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Upcoming */}
      <div className="card">
        <div className="card-header">
          <span className="section-title">Next fixtures</span>
          <Link href={`/${league}/matches`} className="small" style={{ color: "var(--accent)" }}>
            All matches →
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <div className="card-pad sub dim">No scheduled fixtures.</div>
        ) : (
          <div>
            {upcoming.map((p) => (
              <div
                key={`${p.home}|${p.away}`}
                style={{
                  padding: "11px 16px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "88px 1fr auto 1fr 64px",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span className="small dim tnum">
                    {formatDayShort(p.kickoff_datetime)} {formatKickoff(p.kickoff_datetime)}
                  </span>
                  <span style={{ justifySelf: "end", minWidth: 0 }}>
                    <TeamCell name={p.home} league={league} />
                  </span>
                  {/* The expected goal rate leads, not the modal scoreline.
                      1-1 is the single most likely exact score in almost every
                      low-scoring fixture, so printing it large makes six
                      different matches look identical -- and it is only ever
                      ~11% likely. The rates are what actually differ. */}
                  <span
                    className="tnum badge badge-accent"
                    style={{ fontSize: 13, fontWeight: 700 }}
                  >
                    {p.pred_xg_home.toFixed(2)} – {p.pred_xg_away.toFixed(2)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <TeamCell name={p.away} league={league} />
                  </span>
                  <span className="small dim tnum" style={{ justifySelf: "end" }}>
                    {p.most_likely_scoreline[0]}–{p.most_likely_scoreline[1]}{" "}
                    {p.top_5_scorelines?.[0]
                      ? `${p.top_5_scorelines[0][2].toFixed(0)}%`
                      : ""}
                  </span>
                </div>
                <div style={{ marginTop: 8, maxWidth: 460, marginLeft: 98 }}>
                  <ProbBar
                    home={p.win_home_pct}
                    draw={p.draw_pct}
                    away={p.win_away_pct}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="small dim">
        Model: {meta.model.name || "Dixon-Coles"} · base {meta.model.base_goals?.toFixed(2)}{" "}
        goals/team · home advantage {meta.model.home_advantage?.toFixed(3)}× · xG on{" "}
        {meta.xg_coverage} of {info.played} played matches ·{" "}
        <Link href="/about" style={{ color: "var(--accent)" }}>
          how this works
        </Link>
      </p>
    </div>
  );
}
