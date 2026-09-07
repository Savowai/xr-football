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

/**
 * The factor breakdown: how the league's average goal rate becomes this
 * fixture's prediction, one term at a time.
 *
 * The deltas come straight from the model's own sequential decomposition, so
 * base + every delta on a side equals that side's predicted goals exactly.
 * The running total is printed at the bottom precisely so that claim is
 * checkable on screen rather than merely asserted in the methodology page.
 */
function FactorPanel({ fixture }: { fixture: Fixture }) {
  const { factors, base } = fixture;
  if (!factors || factors.length === 0 || base == null) return null;

  const sides: Array<{ key: "home" | "away"; team: string; total?: number }> = [
    { key: "home", team: fixture.home, total: fixture.pred_home },
    { key: "away", team: fixture.away, total: fixture.pred_away },
  ];

  // The widest bar in the panel sets the scale, so the columns stay
  // comparable between the two sides instead of each self-normalising.
  const peak = Math.max(...factors.map((f) => Math.abs(f.delta_goals)), 0.01);

  return (
    <div style={{ marginTop: 14 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        How the model gets there
      </div>
      <div className="grid-2" style={{ gap: 14 }}>
        {sides.map(({ key, team, total }) => (
          <div key={key}>
            <div className="small muted" style={{ marginBottom: 6 }}>
              {team}
            </div>
            <div
              className="row-between small dim"
              style={{ padding: "3px 0", borderBottom: "1px solid var(--border)" }}
            >
              <span>League average</span>
              <span className="tnum">{base.toFixed(2)}</span>
            </div>
            {factors
              .filter((f) => f.side === key)
              .map((f, i) => {
                const up = f.delta_goals >= 0;
                return (
                  <div
                    key={i}
                    style={{
                      padding: "5px 0",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <div className="row-between small">
                      <span title={f.detail} style={{ minWidth: 0 }}>
                        {f.label}
                      </span>
                      <span
                        className="tnum"
                        style={{
                          color: up ? "var(--win)" : "var(--loss)",
                          fontWeight: 550,
                        }}
                      >
                        {up ? "+" : ""}
                        {f.delta_goals.toFixed(2)}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 3,
                        marginTop: 3,
                        borderRadius: 2,
                        width: `${(Math.abs(f.delta_goals) / peak) * 100}%`,
                        background: up ? "var(--win)" : "var(--loss)",
                        opacity: 0.55,
                      }}
                    />
                    <div className="small dim" style={{ marginTop: 1 }}>
                      {f.detail}
                    </div>
                  </div>
                );
              })}
            <div
              className="row-between small"
              style={{ padding: "6px 0 0", fontWeight: 600 }}
            >
              <span>Predicted goals</span>
              <span className="tnum">{total?.toFixed(2) ?? "—"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
                      <FactorPanel fixture={f} />
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
