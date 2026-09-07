"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { LeagueSummary } from "../lib/xr_data";

const SECTIONS = [
  { seg: "", label: "Overview" },
  { seg: "matches", label: "Matches" },
  { seg: "table", label: "Table" },
  { seg: "clubs", label: "Clubs" },
  { seg: "players", label: "Players" },
];

/** Two-letter country tag, standing in for a flag. */
const TAG: Record<string, string> = {
  epl: "ENG",
  laliga: "ESP",
  seriea: "ITA",
  bundesliga: "GER",
  ligue1: "FRA",
};

export default function SiteNav({ leagues }: { leagues: LeagueSummary[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // The league in the URL is the source of truth; fall back to the first one
  // so the switcher still shows a sensible label on /about.
  const active =
    leagues.find((l) => pathname.startsWith(`/${l.key}`)) ?? leagues[0] ?? null;

  const section = active
    ? pathname.replace(`/${active.key}`, "").split("/").filter(Boolean)[0] ?? ""
    : "";

  // Close on outside click and on Escape, so the menu never strands the user.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Route changes should dismiss the menu.
  useEffect(() => setOpen(false), [pathname]);

  // The philosophy page is the only route not scoped to a league, so it sits
  // outside the segmented control rather than inside it -- but it still needs to
  // be in the header. It spent a season reachable only from a footer link, which
  // is why nobody knew the methodology existed.
  const onPhilosophy = pathname.startsWith("/philosophy");

  if (!active) {
    return (
      <nav className="row" style={{ gap: 14 }}>
        <Link href="/philosophy" className="sub">
          The philosophy
        </Link>
      </nav>
    );
  }

  return (
    <nav className="row" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 2 }}>
        {SECTIONS.map(({ seg, label }) => {
          const href = seg ? `/${active.key}/${seg}` : `/${active.key}`;
          const isActive = section === seg && !onPhilosophy;
          return (
            <Link
              key={seg || "overview"}
              href={href}
              className="seg-item"
              style={
                isActive
                  ? { background: "var(--accent-soft)", color: "var(--accent)" }
                  : undefined
              }
            >
              {label}
            </Link>
          );
        })}

        <Link
          href="/philosophy"
          className="seg-item"
          style={
            onPhilosophy
              ? { background: "var(--accent-soft)", color: "var(--accent)" }
              : undefined
          }
        >
          Philosophy
        </Link>
      </div>

      <div ref={boxRef} style={{ position: "relative" }}>
        <button
          className="btn"
          style={{ padding: "5px 10px", fontSize: 12 }}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="dim" style={{ fontSize: 10, fontWeight: 700 }}>
            {TAG[active.key] ?? ""}
          </span>
          {active.name}
          <span className="dim" style={{ fontSize: 9 }}>
            {open ? "▲" : "▼"}
          </span>
        </button>

        {open && (
          <div
            role="listbox"
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 6px)",
              minWidth: 208,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              boxShadow: "var(--shadow)",
              padding: 4,
              zIndex: 60,
            }}
          >
            {leagues.map((l) => {
              const isActive = l.key === active.key;
              // Keep the reader on the same section when they switch league --
              // going from one table to another is the common case.
              const href = section ? `/${l.key}/${section}` : `/${l.key}`;
              return (
                <Link
                  key={l.key}
                  href={href}
                  role="option"
                  aria-selected={isActive}
                  className="row-between"
                  style={{
                    padding: "7px 9px",
                    borderRadius: 5,
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 450,
                    color: isActive ? "var(--accent)" : "var(--text)",
                    background: isActive ? "var(--accent-soft)" : "transparent",
                  }}
                >
                  <span className="row" style={{ gap: 8 }}>
                    <span
                      className="dim"
                      style={{ fontSize: 10, fontWeight: 700, width: 24 }}
                    >
                      {TAG[l.key] ?? ""}
                    </span>
                    {l.name}
                  </span>
                  <span className="dim small tnum">{l.played}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
}
