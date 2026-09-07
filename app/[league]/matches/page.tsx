import { notFound } from "next/navigation";
import { getLeague, loadPredictions, loadMatches } from "../../lib/xr_data";
import { Empty } from "../../components/ui";
import MatchweekBrowser from "./MatchweekBrowser";

export const dynamic = "force-static";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const meta = getLeague(league);
  return { title: meta ? `${meta.name} matches — xR` : "Matches — xR" };
}

export interface Fixture {
  home: string;
  away: string;
  kickoff: string;
  round: number;
  status?: string;
  minute?: string | null;
  home_goals?: number | null;
  away_goals?: number | null;
  home_xg?: number | null;
  away_xg?: number | null;
  pred_home?: number;
  pred_away?: number;
  win_home?: number;
  draw?: number;
  win_away?: number;
  scoreline?: [number, number];
  thesis?: string;
  verdict?: string | null;
}

export default async function MatchesPage({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const info = getLeague(league);
  if (!info) notFound();

  const matches = loadMatches(league);
  const predictions = loadPredictions(league);

  // Predictions carry the model output; matches carry live state. Join on the
  // fixture pair -- a pairing is unique within a round.
  const predByKey = new Map(predictions.map((p) => [`${p.home}|${p.away}`, p]));

  const fixtures: Fixture[] = matches.map((m) => {
    const p = predByKey.get(`${m.home}|${m.away}`);
    return {
      home: m.home,
      away: m.away,
      kickoff: m.kickoff_iso || m.date,
      round: Number(m.round ?? 0),
      status: m.status,
      minute: m.minute,
      home_goals: m.home_goals,
      away_goals: m.away_goals,
      home_xg: m.home_xg,
      away_xg: m.away_xg,
      pred_home: p?.pred_xg_home,
      pred_away: p?.pred_xg_away,
      win_home: p?.win_home_pct,
      draw: p?.draw_pct,
      win_away: p?.win_away_pct,
      scoreline: p?.most_likely_scoreline,
      thesis: p?.reasoning?.thesis,
      verdict: p?.xresult_verdict ?? null,
    };
  });

  if (fixtures.length === 0) {
    return (
      <div className="wrap" style={{ paddingTop: 24 }}>
        <Empty>No fixtures yet for {info.name}.</Empty>
      </div>
    );
  }

  return (
    <div className="wrap stack" style={{ paddingTop: 24 }}>
      <div>
        <h1 className="page-title">{info.name} matches</h1>
        <p className="sub">
          Every fixture with its predicted scoreline. Played matches show what the
          chances actually said.
        </p>
      </div>

      <MatchweekBrowser
        fixtures={fixtures}
        league={league}
        initialRound={info.current_round || 1}
        totalRounds={info.total_rounds}
      />
    </div>
  );
}
