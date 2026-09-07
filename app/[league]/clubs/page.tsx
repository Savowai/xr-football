import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeague, loadStandings, loadPowerRankings } from "../../lib/xr_data";
import { TeamCell, Signed, Empty, teamSlug } from "../../components/ui";

export const dynamic = "force-static";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const meta = getLeague(league);
  return { title: meta ? `${meta.name} clubs — xR` : "Clubs — xR" };
}

export default async function ClubsPage({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const info = getLeague(league);
  if (!info) notFound();

  const standings = loadStandings(league);
  const power = loadPowerRankings(league);
  const rating = new Map(power.map((p) => [p.team, p]));

  if (standings.length === 0) {
    return (
      <div className="wrap" style={{ paddingTop: 24 }}>
        <Empty>No clubs yet for {info.name}.</Empty>
      </div>
    );
  }

  const clubs = [...standings].sort((a, b) => a.team.localeCompare(b.team));

  return (
    <div className="wrap stack" style={{ paddingTop: 24 }}>
      <div>
        <h1 className="page-title">{info.name} clubs</h1>
        <p className="sub">
          {clubs.length} clubs · sorted alphabetically · ratings from the current model
          fit
        </p>
      </div>

      <div className="grid-3">
        {clubs.map((c) => {
          const r = rating.get(c.team);
          return (
            <Link
              key={c.team}
              href={`/${league}/clubs/${teamSlug(c.team)}`}
              className="card card-pad"
              style={{ display: "block" }}
            >
              <div className="row-between" style={{ marginBottom: 10 }}>
                <TeamCell name={c.team} link={false} strong />
                <span className="badge">{c.position}</span>
              </div>
              <div className="row" style={{ gap: 16 }}>
                <span className="small">
                  <span className="dim">Pts </span>
                  <span className="tnum" style={{ fontWeight: 620 }}>
                    {c.points}
                  </span>
                </span>
                <span className="small">
                  <span className="dim">xPts </span>
                  <span className="tnum">{c.xpts.toFixed(1)}</span>
                </span>
                <span className="small">
                  <span className="dim">Luck </span>
                  <Signed value={c.luck} digits={1} className="tnum" />
                </span>
              </div>
              {r && (
                <div className="small dim" style={{ marginTop: 6 }}>
                  Rating {r.expected_gf_per_game.toFixed(2)} xGF /{" "}
                  {r.expected_ga_per_game.toFixed(2)} xGA per game
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
