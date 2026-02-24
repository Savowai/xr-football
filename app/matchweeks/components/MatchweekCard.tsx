"use client";

import { useState } from "react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(d: string): string {
  // Parse as noon UTC to avoid timezone day-shift issues
  const dt = new Date(d.length === 10 ? d + "T12:00:00Z" : d);
  return `${DAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}
import Link from "next/link";
import type { XRMatch, XRPrediction } from "../../lib/xr_data";

interface Props {
  match: XRMatch;
  prediction?: XRPrediction;
  currentMW: number;
  selectedMW: number;
}

export default function MatchweekCard({ match, prediction }: Props) {
  const [expanded, setExpanded] = useState(false);

  const isPlayed = match.home_goals !== null && match.away_goals !== null;
  const homeWon = isPlayed && (match.home_goals ?? 0) > (match.away_goals ?? 0);
  const awayWon = isPlayed && (match.away_goals ?? 0) > (match.home_goals ?? 0);

  const fmt = (d: string) => fmtDate(d);

  const hasProbData = !!prediction;
  const hasDetails = hasProbData && (
    (prediction!.top_5_scorelines && prediction!.top_5_scorelines.length > 0) ||
    prediction!.home_form ||
    !isPlayed
  );

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      overflow: "hidden",
    }}>
      {/* ── Compact row (always visible) ── */}
      <div
        onClick={() => hasDetails && setExpanded(e => !e)}
        style={{ cursor: hasDetails ? "pointer" : "default" }}
      >
        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "8px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11, color: "var(--muted)",
        }}>
          <span>{fmt(match.date || prediction?.date || "")}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
              background: isPlayed ? "rgba(255,255,255,0.06)" : "var(--red-dim)",
              color: isPlayed ? "var(--muted)" : "var(--red)",
              border: isPlayed ? "1px solid var(--border-2)" : "1px solid var(--red-border)",
            }}>
              {isPlayed ? "FT" : "Upcoming"}
            </span>
            {isPlayed && prediction?.xresult_verdict && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                background: prediction.xresult_verdict === "justified"
                  ? "rgba(255,255,255,0.04)"
                  : "rgba(255,149,0,0.12)",
                color: prediction.xresult_verdict === "justified"
                  ? "var(--dim)"
                  : "#ff9500",
                border: `1px solid ${prediction.xresult_verdict === "justified"
                  ? "var(--border)"
                  : "rgba(255,149,0,0.3)"}`,
              }}>
                {prediction.xresult_verdict === "justified"
                  ? "justified"
                  : prediction.xresult_verdict === "lucky_home"
                  ? "lucky H"
                  : "lucky A"}
              </span>
            )}
            {hasDetails && (
              <span style={{
                fontSize: 14, color: "var(--dim)", lineHeight: 1,
                transform: expanded ? "rotate(180deg)" : "rotate(0)",
                display: "inline-block", transition: "transform 0.2s",
              }}>▾</span>
            )}
          </div>
        </div>

        {/* Teams + score */}
        <div style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Home team */}
            <div style={{ flex: 1 }}>
              <Link
                href={`/clubs/${encodeURIComponent(match.home)}`}
                onClick={e => e.stopPropagation()}
                style={{ textDecoration: "none" }}
              >
                <div style={{
                  fontWeight: 800, fontSize: 14,
                  color: homeWon ? "#fff" : isPlayed ? "var(--muted)" : "#fff",
                }}>{match.home}</div>
              </Link>
              {!isPlayed && prediction && (
                <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 2 }}>
                  xG pred: {prediction.pred_xg_home.toFixed(2)}
                </div>
              )}
              {isPlayed && match.home_xg != null && (
                <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 2 }}>
                  xG: {match.home_xg.toFixed(2)}
                </div>
              )}
            </div>

            {/* Score / vs */}
            <div style={{
              minWidth: 68, textAlign: "center",
              background: "var(--surface-2)", borderRadius: 8, padding: "6px 10px",
            }}>
              {isPlayed ? (
                <span style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>
                  {match.home_goals} – {match.away_goals}
                </span>
              ) : (
                <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>vs</span>
              )}
            </div>

            {/* Away team */}
            <div style={{ flex: 1, textAlign: "right" }}>
              <Link
                href={`/clubs/${encodeURIComponent(match.away)}`}
                onClick={e => e.stopPropagation()}
                style={{ textDecoration: "none" }}
              >
                <div style={{
                  fontWeight: 800, fontSize: 14,
                  color: awayWon ? "#fff" : isPlayed ? "var(--muted)" : "#fff",
                }}>{match.away}</div>
              </Link>
              {!isPlayed && prediction && (
                <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 2 }}>
                  xG pred: {prediction.pred_xg_away.toFixed(2)}
                </div>
              )}
              {isPlayed && match.away_xg != null && (
                <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 2 }}>
                  xG: {match.away_xg.toFixed(2)}
                </div>
              )}
            </div>
          </div>

          {/* Stats row (played matches) */}
          {isPlayed && (match.home_shots != null || match.home_xg != null) && (
            <div style={{
              display: "flex", gap: 8, marginTop: 12, justifyContent: "center",
            }}>
              {match.home_shots != null && (
                <StatChip label="Shots" value={`${match.home_shots} – ${match.away_shots}`} />
              )}
              {match.home_sot != null && (
                <StatChip label="SOT" value={`${match.home_sot} – ${match.away_sot}`} />
              )}
              {match.home_xg != null && (
                <StatChip label="xG" value={`${match.home_xg.toFixed(1)} – ${(match.away_xg ?? 0).toFixed(1)}`} />
              )}
            </div>
          )}

          {/* Win probability bar (always visible when available) */}
          {prediction && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", height: 5, borderRadius: 3, overflow: "hidden", gap: 1 }}>
                <div style={{
                  flex: prediction.win_home_pct,
                  background: "var(--red)", opacity: 0.85,
                  minWidth: 4, borderRadius: "3px 0 0 3px",
                }} />
                <div style={{ flex: prediction.draw_pct, background: "var(--surface-3)", minWidth: 4 }} />
                <div style={{
                  flex: prediction.win_away_pct, background: "var(--border-2)",
                  minWidth: 4, borderRadius: "0 3px 3px 0",
                }} />
              </div>
              <div style={{
                display: "flex", justifyContent: "space-between",
                marginTop: 5, fontSize: 10,
              }}>
                <span style={{ color: "var(--red)", fontWeight: 700 }}>
                  {prediction.win_home_pct.toFixed(0)}% H
                </span>
                <span style={{ color: "var(--muted)" }}>
                  {prediction.draw_pct.toFixed(0)}% D
                </span>
                <span style={{ color: "var(--muted)" }}>
                  {prediction.win_away_pct.toFixed(0)}% A
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Expanded details ── */}
      {expanded && prediction && (
        <div style={{
          borderTop: "1px solid var(--border)",
          padding: "14px 16px",
          background: "var(--surface-2)",
        }}>
          {/* Post-match xResult panel (played + real Understat xG) */}
          {isPlayed && prediction.actual_xg_home != null ? (
            <div style={{ marginBottom: 14 }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: "var(--dim)",
                textTransform: "uppercase", letterSpacing: 1, marginBottom: 4,
              }}>
                xResult — What Should Have Happened
              </div>
              <div style={{ fontSize: 11, color: "var(--dim)", marginBottom: 8 }}>
                xG: {prediction.actual_xg_home?.toFixed(1)} – {prediction.actual_xg_away?.toFixed(1)}
              </div>
              {/* xResult probability bar */}
              <div style={{ display: "flex", height: 5, borderRadius: 3, overflow: "hidden", gap: 1, marginBottom: 4 }}>
                <div style={{
                  flex: prediction.xresult_win_home_pct ?? 33,
                  background: "var(--red)", opacity: 0.85,
                  minWidth: 4, borderRadius: "3px 0 0 3px",
                }} />
                <div style={{ flex: prediction.xresult_draw_pct ?? 33, background: "var(--surface-3)", minWidth: 4 }} />
                <div style={{
                  flex: prediction.xresult_win_away_pct ?? 33,
                  background: "var(--border-2)", minWidth: 4, borderRadius: "0 3px 3px 0",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 8 }}>
                <span style={{ color: "var(--red)", fontWeight: 700 }}>
                  {(prediction.xresult_win_home_pct ?? 0).toFixed(0)}% H
                </span>
                <span style={{ color: "var(--muted)" }}>
                  {(prediction.xresult_draw_pct ?? 0).toFixed(0)}% D
                </span>
                <span style={{ color: "var(--muted)" }}>
                  {(prediction.xresult_win_away_pct ?? 0).toFixed(0)}% A
                </span>
              </div>
              {/* Top 3 xResult scorelines */}
              {prediction.xresult_top_5_scorelines && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {prediction.xresult_top_5_scorelines.slice(0, 3).map((sl, i) => (
                    <span key={i} style={{
                      fontSize: 12, fontWeight: 700,
                      padding: "4px 10px", borderRadius: 6,
                      background: i === 0 ? "var(--red-dim)" : "var(--surface)",
                      color: i === 0 ? "var(--red)" : "var(--muted)",
                      border: `1px solid ${i === 0 ? "var(--red-border)" : "var(--border)"}`,
                    }}>
                      {sl[0]}-{sl[1]}
                      <span style={{ opacity: 0.6, fontWeight: 500, marginLeft: 4, fontSize: 10 }}>
                        {sl[2].toFixed(1)}%
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Pre-match scorelines */
            prediction.top_5_scorelines && prediction.top_5_scorelines.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: "var(--dim)",
                  textTransform: "uppercase", letterSpacing: 1, marginBottom: 8,
                }}>
                  Most Likely Scorelines
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {prediction.top_5_scorelines.slice(0, 5).map((sl, i) => (
                    <span key={i} style={{
                      fontSize: 12, fontWeight: 700,
                      padding: "4px 10px", borderRadius: 6,
                      background: i === 0 ? "var(--red-dim)" : "var(--surface)",
                      color: i === 0 ? "var(--red)" : "var(--muted)",
                      border: `1px solid ${i === 0 ? "var(--red-border)" : "var(--border)"}`,
                    }}>
                      {sl[0]}-{sl[1]}
                      <span style={{ opacity: 0.6, fontWeight: 500, marginLeft: 4, fontSize: 10 }}>
                        {sl[2].toFixed(1)}%
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )
          )}

          {/* Form context */}
          {prediction.home_form && prediction.away_form && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <FormBar
                label={match.home}
                xgFor={prediction.home_form.xg_for}
                xgAgainst={prediction.home_form.xg_against}
                poss={prediction.home_form.possession_pct}
              />
              <FormBar
                label={match.away}
                xgFor={prediction.away_form.xg_for}
                xgAgainst={prediction.away_form.xg_against}
                poss={prediction.away_form.possession_pct}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: "var(--surface-3)", borderRadius: 6, padding: "5px 10px",
      textAlign: "center", border: "1px solid var(--border)",
    }}>
      <div style={{ fontSize: 10, color: "var(--dim)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{value}</div>
    </div>
  );
}

function FormBar({
  label, xgFor, xgAgainst, poss,
}: {
  label: string; xgFor: number; xgAgainst: number; poss: number;
}) {
  return (
    <div style={{
      background: "var(--surface)", borderRadius: 8, padding: "10px 12px",
      border: "1px solid var(--border)",
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: "var(--muted)",
        marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 2 }}>
        xGF{" "}
        <strong style={{ color: "#fff" }}>{xgFor.toFixed(2)}</strong>
        {" · "}
        xGA{" "}
        <strong style={{ color: "var(--muted)" }}>{xgAgainst.toFixed(2)}</strong>
      </div>
      <div style={{ fontSize: 10, color: "var(--dim)" }}>Poss: {poss.toFixed(0)}%</div>
    </div>
  );
}
