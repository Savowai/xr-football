"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Leaderboard } from "../../lib/xr_data";
import { teamSlug } from "../../components/ui";

/** Rows shown before "show all"; the data holds 20. */
const PREVIEW = 10;

export default function PlayerBoards({
  boards,
  league,
}: {
  boards: Leaderboard[];
  league: string;
}) {
  // Categories come from the source in a sensible order already, so take them
  // as they appear rather than imposing one of our own.
  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const b of boards) {
      const c = b.category ?? "Other";
      if (!seen.includes(c)) seen.push(c);
    }
    return seen;
  }, [boards]);

  const [active, setActive] = useState(categories[0] ?? "");
  const [expanded, setExpanded] = useState<string | null>(null);

  const shown = boards.filter((b) => (b.category ?? "Other") === active);

  return (
    <div className="stack">
      <div className="card">
        <div className="tabs" style={{ padding: "0 8px" }}>
          {categories.map((c) => (
            <button
              key={c}
              className={`tab ${c === active ? "tab-active" : ""}`}
              onClick={() => setActive(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="grid-3">
        {shown.map((board) => {
          const open = expanded === board.key;
          const rows = open ? board.players : board.players.slice(0, PREVIEW);
          return (
            <div key={board.key} className="card">
              <div className="card-header">
                <span className="section-title">{board.title}</span>
                {board.subtitle && (
                  <span className="small dim">{board.subtitle}</span>
                )}
              </div>
              <div>
                {rows.map((p) => (
                  <div
                    key={`${p.player_id}-${p.rank}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "22px 1fr auto",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 14px",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <span className="small dim tnum">{p.rank}</span>
                    <span style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {p.name}
                      </div>
                      <Link
                        href={`/${league}/clubs/${teamSlug(p.team)}`}
                        className="small dim"
                        style={{ display: "block" }}
                      >
                        {p.team}
                      </Link>
                    </span>
                    <span className="num-strong tnum" style={{ fontSize: 13 }}>
                      {p.value.toFixed(board.decimals ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
              {board.players.length > PREVIEW && (
                <button
                  className="small"
                  style={{
                    width: "100%",
                    padding: "8px 0",
                    color: "var(--accent)",
                  }}
                  onClick={() => setExpanded(open ? null : board.key)}
                >
                  {open ? "Show less" : `Show all ${board.players.length}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
