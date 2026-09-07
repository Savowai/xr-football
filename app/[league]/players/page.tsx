import { notFound } from "next/navigation";
import { getLeague, loadPlayers, loadSquads } from "../../lib/xr_data";
import { Empty } from "../../components/ui";
import PlayerBoards from "./PlayerBoards";

export const dynamic = "force-static";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const meta = getLeague(league);
  return { title: meta ? `${meta.name} players — xR` : "Players — xR" };
}

export default async function PlayersPage({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const info = getLeague(league);
  if (!info) notFound();

  const boards = loadPlayers(league);
  const squads = loadSquads(league);

  const players = Object.values(squads).reduce((n, s) => n + s.length, 0);
  const unavailable = Object.values(squads)
    .flat()
    .filter((p) => p.injured);

  return (
    <div className="wrap stack-l" style={{ paddingTop: 24 }}>
      <div className="row-between" style={{ flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">Players</h1>
          <p className="sub">
            {info.name} · {info.season} · {boards.length} stat categories
            {players > 0 ? ` · ${players} players` : ""}
          </p>
        </div>
      </div>

      {unavailable.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="section-title">Currently unavailable</span>
            <span className="small dim">
              {unavailable.length} across {Object.keys(squads).length} clubs
            </span>
          </div>
          {/* Availability is the largest thing the betting market can see that
              a public-data model cannot, so it is surfaced rather than buried
              on individual club pages. */}
          <div className="card-pad">
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              {unavailable.slice(0, 40).map((p) => (
                <span
                  key={`${p.player_id}-${p.name}`}
                  className="badge"
                  title={p.expected_return ?? undefined}
                >
                  {p.name}
                  {p.expected_return && (
                    <span className="dim" style={{ fontWeight: 400 }}>
                      {" "}
                      · {p.expected_return}
                    </span>
                  )}
                </span>
              ))}
            </div>
            {unavailable.length > 40 && (
              <p className="small dim" style={{ marginTop: 8 }}>
                and {unavailable.length - 40} more
              </p>
            )}
          </div>
        </div>
      )}

      {boards.length === 0 ? (
        <Empty>No player data for this league yet.</Empty>
      ) : (
        <PlayerBoards boards={boards} league={league} />
      )}

      <p className="small dim">
        Player statistics via FotMob. Injuries and expected return dates are as
        published by the source and are not used by the prediction model.
      </p>
    </div>
  );
}
