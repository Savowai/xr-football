import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getLeague,
  loadLeagues,
  loadStandings,
  loadMatches,
  loadPredictions,
  loadPowerRankings,
} from "../../../lib/xr_data";
import {
  TeamCell,
  FormGuide,
  Signed,
  Stat,
  ProbBar,
  formatDayShort,
  teamSlug,
} from "../../../components/ui";

export const dynamic = "force-static";

export function generateStaticParams() {
  const params: Array<{ league: string; team: string }> = [];
  for (const l of loadLeagues()) {
    for (const row of loadStandings(l.key)) {
      params.push({ league: l.key, team: teamSlug(row.team) });
    }
  }
  return params;
}

/** Reverse of teamSlug -- match against the real names rather than un-slugging. */
function resolveTeam(slug: string, names: string[]): string | null {
  const wanted = decodeURIComponent(slug).toLowerCase();
  return names.find((n) => n.toLowerCase().replace(/\s+/g, "-") === wanted) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string; team: string }>;
}) {
  const { league, team } = await params;
  const names = loadStandings(league).map((r) => r.team);
  const name = resolveTeam(team, names);
  return { title: name ? `${name} — xR` : "Club — xR" };
}

export default async function ClubPage({
  params,
}: {
  params: Promise<{ league: string; team: string }>;
}) {
  const { league, team } = await params;
  const info = getLeague(league);
  if (!info) notFound();

  const standings = loadStandings(league);
  const name = resolveTeam(team, standings.map((r) => r.team));
  if (!name) notFound();

  const row = standings.find((r) => r.team === name)!;
  const rating = loadPowerRankings(league).find((p) => p.team === name);
  const matches = loadMatches(league);
  const predictions = loadPredictions(league);

  const theirs = matches
    .filter((m) => m.home === name || m.away === name)
    .sort((a, b) => (a.kickoff_iso || a.date).localeCompare(b.kickoff_iso || b.date));

  const played = theirs.filter(
    (m) => m.status === "finished" && m.home_goals != null && m.away_goals != null,
  );
  const form = played
    .slice(-6)
    .map((m) => {
      const home = m.home === name;
      const gf = (home ? m.home_goals : m.away_goals) ?? 0;
      const ga = (home ? m.away_goals : m.home_goals) ?? 0;
      return gf > ga ? "W" : gf === ga ? "D" : "L";
    })
    .join("");

  const next = predictions
    .filter((p) => (p.home === name || p.away === name) && p.status === "scheduled")
    .sort((a, b) => a.kickoff_datetime.localeCompare(b.kickoff_datetime))
    .slice(0, 5);

  return (
    <div className="wrap stack-l" style={{ paddingTop: 24 }}>
      <div>
        <div className="row small dim" style={{ gap: 6, marginBottom: 8 }}>
          <Link href={`/${league}`} style={{ color: "var(--accent)" }}>
            {info.name}
          </Link>
          <span>/</span>
          <Link href={`/${league}/clubs`} style={{ color: "var(--accent)" }}>
            Clubs
          </Link>
        </div>
        <div className="row-between" style={{ flexWrap: "wrap" }}>
          <h1 className="page-title row" style={{ gap: 10 }}>
            <TeamCell name={name} link={false} strong />
          </h1>
          <FormGuide form={form} max={6} />
        </div>
      </div>

      <div className="grid-4">
        <Stat label="Position" value={row.position} hint={`xPos ${row.xposition}`} />
        <Stat label="Points" value={row.points} hint={`${row.played} played`} />
        <Stat
          label="Expected points"
          value={row.xpts.toFixed(1)}
          hint={`${row.luck > 0 ? "+" : ""}${row.luck.toFixed(1)} vs actual`}
        />
        <Stat
          label="xG difference"
          value={<Signed value={row.xg_diff} digits={1} />}
          hint={`${row.xg_for.toFixed(1)} for, ${row.xg_against.toFixed(1)} against`}
        />
      </div>

      {rating && (
        <div className="card card-pad">
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Model rating
          </div>
          <p className="sub">
            Rated {rating.rank}
            {rating.rank === 1 ? "st" : rating.rank === 2 ? "nd" : rating.rank === 3 ? "rd" : "th"}{" "}
            in {info.name}. Against an average side on neutral ground the model expects
            them to create{" "}
            <strong className="tnum">{rating.expected_gf_per_game.toFixed(2)}</strong> and
            concede{" "}
            <strong className="tnum">{rating.expected_ga_per_game.toFixed(2)}</strong> per
            game, a net rating of{" "}
            <Signed value={rating.net_rating} digits={2} />. Fitted on{" "}
            {rating.evidence_matches.toFixed(1)} effective matches of evidence.
          </p>
        </div>
      )}

      {next.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="section-title">Upcoming</span>
          </div>
          {next.map((p) => {
            const home = p.home === name;
            const opponent = home ? p.away : p.home;
            return (
              <div
                key={`${p.home}|${p.away}`}
                style={{ padding: "11px 16px", borderBottom: "1px solid var(--border)" }}
              >
                <div className="row-between" style={{ marginBottom: 7 }}>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="small dim tnum" style={{ width: 52 }}>
                      {formatDayShort(p.kickoff_datetime)}
                    </span>
                    <span className="badge">{home ? "H" : "A"}</span>
                    <TeamCell name={opponent} league={league} />
                  </span>
                  <span className="badge badge-accent tnum">
                    {home
                      ? `${p.most_likely_scoreline[0]} – ${p.most_likely_scoreline[1]}`
                      : `${p.most_likely_scoreline[0]} – ${p.most_likely_scoreline[1]}`}
                  </span>
                </div>
                <ProbBar home={p.win_home_pct} draw={p.draw_pct} away={p.win_away_pct} />
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <span className="section-title">Results</span>
          <span className="small dim">{played.length} played</span>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th className="left">Date</th>
                <th className="left">Opponent</th>
                <th>H/A</th>
                <th>Result</th>
                <th title="Expected goals for">xGF</th>
                <th title="Expected goals against">xGA</th>
              </tr>
            </thead>
            <tbody>
              {[...played].reverse().map((m, i) => {
                const home = m.home === name;
                const gf = (home ? m.home_goals : m.away_goals) ?? 0;
                const ga = (home ? m.away_goals : m.home_goals) ?? 0;
                const xgf = home ? m.home_xg : m.away_xg;
                const xga = home ? m.away_xg : m.home_xg;
                const outcome = gf > ga ? "W" : gf === ga ? "D" : "L";
                return (
                  <tr key={i}>
                    <td className="left num-weak">
                      {formatDayShort(m.kickoff_iso || m.date)}
                    </td>
                    <td className="left">
                      <TeamCell name={home ? m.away : m.home} league={league} />
                    </td>
                    <td className="num-weak">{home ? "H" : "A"}</td>
                    <td>
                      <span className={`pip pip-${outcome.toLowerCase()}`} style={{ marginRight: 6 }}>
                        {outcome}
                      </span>
                      <span className="num-strong tnum">
                        {gf}–{ga}
                      </span>
                    </td>
                    <td className="num-weak">{xgf != null ? xgf.toFixed(2) : "—"}</td>
                    <td className="num-weak">{xga != null ? xga.toFixed(2) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
