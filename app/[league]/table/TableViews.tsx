"use client";

import { useMemo, useState } from "react";
import type { StandingsRow } from "../../lib/xr_data";
import type { Band } from "../../lib/league_meta";
import { TeamCell, FormGuide, Signed } from "../../components/ui";

type Row = StandingsRow & { band: Band; form: string };

type SortKey =
  | "position"
  | "played"
  | "gd"
  | "points"
  | "xg_for"
  | "xg_against"
  | "xg_diff"
  | "xpts"
  | "luck";

const VIEWS = [
  { key: "actual", label: "Table" },
  { key: "expected", label: "Expected" },
] as const;

type View = (typeof VIEWS)[number]["key"];

export default function TableViews({ rows, league }: { rows: Row[]; league: string }) {
  const [view, setView] = useState<View>("actual");
  const [sort, setSort] = useState<SortKey>("position");
  const [asc, setAsc] = useState(true);

  // Switching view resets the sort to that view's natural order, otherwise the
  // expected table opens sorted by actual points, which is the one ordering it
  // exists to argue against.
  function changeView(next: View) {
    setView(next);
    setSort(next === "actual" ? "position" : "xpts");
    setAsc(next === "actual");
  }

  function toggleSort(key: SortKey) {
    if (sort === key) {
      setAsc((v) => !v);
    } else {
      setSort(key);
      // Position ascends (1st at top); every other column is "more is better",
      // so it should open descending.
      setAsc(key === "position");
    }
  }

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const diff = (a[sort] as number) - (b[sort] as number);
      if (diff !== 0) return asc ? diff : -diff;
      return a.position - b.position;
    });
    return copy;
  }, [rows, sort, asc]);

  const arrow = (key: SortKey) =>
    sort === key ? (asc ? " ↑" : " ↓") : "";

  const Th = ({
    k,
    label,
    title,
    left = false,
  }: {
    k: SortKey;
    label: string;
    title?: string;
    left?: boolean;
  }) => (
    <th
      className={left ? "left" : undefined}
      title={title}
      onClick={() => toggleSort(k)}
      style={{ cursor: "pointer", userSelect: "none" }}
    >
      {label}
      {arrow(k)}
    </th>
  );

  return (
    <div className="card">
      <div className="card-header">
        <div className="seg">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              className={`seg-item ${view === v.key ? "seg-active" : ""}`}
              onClick={() => changeView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="small dim">
          {view === "actual"
            ? "Sorted by points"
            : "What the underlying numbers say the table should be"}
        </span>
      </div>

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <Th k="position" label="#" />
              <th className="left">Team</th>
              <Th k="played" label="Pl" title="Played" />
              {view === "actual" ? (
                <>
                  <th title="Won">W</th>
                  <th title="Drawn">D</th>
                  <th title="Lost">L</th>
                  <th title="Goals for">GF</th>
                  <th title="Goals against">GA</th>
                  <Th k="gd" label="GD" title="Goal difference" />
                  <Th k="points" label="Pts" title="Points" />
                  <th className="left">Form</th>
                </>
              ) : (
                <>
                  <Th k="xg_for" label="xGF" title="Expected goals for" />
                  <Th k="xg_against" label="xGA" title="Expected goals against" />
                  <Th k="xg_diff" label="xGD" title="Expected goal difference" />
                  <Th k="points" label="Pts" title="Actual points" />
                  <Th k="xpts" label="xPts" title="Expected points" />
                  <Th k="luck" label="Luck" title="Points minus expected points" />
                  <th title="Position in the expected table">xPos</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.team} className={r.band ? `band-${r.band}` : undefined}>
                <td className="pos-cell">{r.position}</td>
                <td className="left">
                  <TeamCell name={r.team} league={league} />
                </td>
                <td className="num-weak">{r.played}</td>

                {view === "actual" ? (
                  <>
                    <td className="num-weak">{r.won}</td>
                    <td className="num-weak">{r.drawn}</td>
                    <td className="num-weak">{r.lost}</td>
                    <td className="num-weak">{r.gf}</td>
                    <td className="num-weak">{r.ga}</td>
                    <td>
                      <Signed value={r.gd} />
                    </td>
                    <td className="num-strong">{r.points}</td>
                    <td className="left">
                      <FormGuide form={r.form} />
                    </td>
                  </>
                ) : (
                  <>
                    <td className="num-weak">{r.xg_for.toFixed(1)}</td>
                    <td className="num-weak">{r.xg_against.toFixed(1)}</td>
                    <td>
                      <Signed value={r.xg_diff} digits={1} />
                    </td>
                    <td className="num-weak">{r.points}</td>
                    <td className="num-strong">{r.xpts.toFixed(1)}</td>
                    <td>
                      <Signed value={r.luck} digits={1} />
                    </td>
                    <td className="num-weak">
                      {r.xposition}
                      {r.xposition !== r.position && (
                        <span
                          className={r.xposition < r.position ? "pos" : "neg"}
                          style={{ marginLeft: 4, fontSize: 11 }}
                        >
                          {r.xposition < r.position ? "▲" : "▼"}
                          {Math.abs(r.xposition - r.position)}
                        </span>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
