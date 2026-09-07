"use client";

import { useMemo, useState } from "react";
import type { Fixture } from "./page";
import {
  TeamCell,
  ProbBar,
  StatusBadge,
  formatKickoff,
  formatDayLong,
} from "../../components/ui";

export default function MatchweekBrowser({
  fixtures,
  league,
  initialRound,
  totalRounds,
}: {
  fixtures: Fixture[];
  league: string;
  initialRound: number;
  totalRounds: number;
}) {
  const rounds = useMemo(
    () => Array.from(new Set(fixtures.map((f) => f.round))).sort((a, b) => a - b),
    [fixtures],
  );

  const [round, setRound] = useState(
    rounds.includes(initialRound) ? initialRound : (rounds[0] ?? 1),
  );
  const [expanded, setExpanded] = useState<string | null>(null);

  const inRound = useMemo(
    () =>
      fixtures
        .filter((f) => f.round === round)
        .sort((a, b) => a.kickoff.localeCompare(b.kickoff)),
    [fixtures, round],
  );

  // Fixtures in a matchweek span several days; grouping by day is how the
  // reader actually thinks about a weekend.
  const byDay = useMemo(() => {
    const groups = new Map<string, Fixture[]>();
    for (const f of inRound) {
      const day = f.kickoff.slice(0, 10);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day)!.push(f);
    }
    return [...groups.entries()];
  }, [inRound]);

  const idx = rounds.indexOf(round);

  return (
    <div className="stack">
      <div className="card">
        <div className="card-header">
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn"
              style={{ padding: "5px 9px" }}
              disabled={idx <= 0}
              onClick={() => setRound(rounds[idx - 1])}
              aria-label="Previous matchweek"
            >
              ←
            </button>
            <span className="section-title" style={{ minWidth: 118, textAlign: "center" }}>
              Matchweek {round}
              <span className="dim" style={{ fontWeight: 400 }}> / {totalRounds}</span>
            </span>
            <button
              className="btn"
              style={{ padding: "5px 9px" }}
              disabled={idx >= rounds.length - 1}
              onClick={() => setRound(rounds[idx + 1])}
              aria-label="Next matchweek"
            >
              →
            </button>
          </div>
          <span className="small dim">{inRound.length} fixtures</span>
        </div>

        <div className="tabs" style={{ padding: "0 8px" }}>
          {rounds.map((r) => (
            <button
              key={r}
              className={`tab ${r === round ? "tab-active" : ""}`}
              onClick={() => setRound(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {byDay.map(([day, dayFixtures]) => (
        <div key={day} className="card">
          <div className="card-header">
            <span className="section-title">{formatDayLong(day)}</span>
          </div>
          <div>
            {dayFixtures.map((f) => {
              const key = `${f.home}|${f.away}`;
              const isOpen = expanded === key;
              const played =
                f.status === "finished" && f.home_goals != null && f.away_goals != null;

              return (
                <div key={key} style={{ borderBottom: "1px solid var(--border)" }}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : key)}
                    style={{
                      width: "100%",
                      display: "grid",
                      gridTemplateColumns: "56px 1fr auto 1fr 92px",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 16px",
                      textAlign: "left",
                    }}
                    aria-expanded={isOpen}
                  >
                    <span className="small dim tnum">
                      {f.status === "live" || played ? (
                        <StatusBadge status={f.status} minute={f.minute} />
                      ) : (
                        formatKickoff(f.kickoff)
                      )}
                    </span>

                    <span style={{ justifySelf: "end", minWidth: 0 }}>
                      <TeamCell name={f.home} league={league} link={false} />
                    </span>

                    <span
                      className="tnum"
                      style={{
                        fontWeight: 700,
                        fontSize: 15,
                        minWidth: 48,
                        textAlign: "center",
                        color: played ? "var(--text)" : "var(--text-3)",
                      }}
                    >
                      {/* Played matches show the real score; upcoming ones show
                          the expected goal rate rather than the modal
                          scoreline, which comes out 1-1 for nearly every
                          fixture and so distinguishes none of them. */}
                      {played
                        ? `${f.home_goals} – ${f.away_goals}`
                        : f.pred_home != null
                          ? `${f.pred_home.toFixed(2)} – ${f.pred_away?.toFixed(2)}`
                          : "–"}
                    </span>

                    <span style={{ minWidth: 0 }}>
                      <TeamCell name={f.away} league={league} link={false} />
                    </span>

                    <span className="small dim tnum" style={{ justifySelf: "end" }}>
                      {played && f.home_xg != null
                        ? `xG ${f.home_xg.toFixed(2)}–${f.away_xg?.toFixed(2)}`
                        : !played && f.scoreline
                          ? `${f.scoreline[0]}–${f.scoreline[1]} likeliest`
                          : ""}
                    </span>
                  </button>

                  {isOpen && (
                    <div
                      style={{
                        padding: "12px 16px 16px",
                        background: "var(--bg-subtle)",
                        borderTop: "1px solid var(--border)",
                      }}
                    >
                      {f.win_home != null && (
                        <div style={{ marginBottom: 12 }}>
                          <div
                            className="row-between small muted"
                            style={{ marginBottom: 5 }}
                          >
                            <span>{f.home} {f.win_home.toFixed(0)}%</span>
                            <span>Draw {f.draw?.toFixed(0)}%</span>
                            <span>{f.win_away?.toFixed(0)}% {f.away}</span>
                          </div>
                          <ProbBar
                            home={f.win_home}
                            draw={f.draw ?? 0}
                            away={f.win_away ?? 0}
                          />
                        </div>
                      )}
                      {f.thesis && <p className="sub">{f.thesis}</p>}
                      {!f.thesis && <p className="sub dim">No model note for this fixture.</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
