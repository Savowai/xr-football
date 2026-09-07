/**
 * Shared presentation primitives.
 *
 * These exist so that a team name, a form guide or a probability split looks
 * identical everywhere it appears. The previous version rebuilt each of these
 * inline on every page, which is how the same concept ended up with three
 * different paddings and two different colour scales.
 *
 * All server components -- none of them hold state.
 */

import Link from "next/link";

/* -------------------------------------------------------------------------
   Team
------------------------------------------------------------------------- */

/** "Manchester City" -> "MC". Two letters keeps the monogram legible at 20px. */
export function monogram(name: string): string {
  const words = name.split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return name.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function teamSlug(name: string): string {
  return encodeURIComponent(name.toLowerCase().replace(/\s+/g, "-"));
}

export function TeamCell({
  name,
  league,
  strong = false,
  link = true,
}: {
  name: string;
  league?: string;
  strong?: boolean;
  link?: boolean;
}) {
  const inner = (
    <>
      <span className="crest">{monogram(name)}</span>
      <span className="team-name" style={strong ? { fontWeight: 620 } : undefined}>
        {name}
      </span>
    </>
  );

  if (!link || !league) return <span className="team">{inner}</span>;

  return (
    <Link href={`/${league}/clubs/${teamSlug(name)}`} className="team">
      {inner}
    </Link>
  );
}

/* -------------------------------------------------------------------------
   Form guide
------------------------------------------------------------------------- */

/**
 * `form` arrives oldest-first from the pipeline. Displayed newest-last, which
 * matches how every scores site renders it -- reading left to right is reading
 * forward in time.
 */
export function FormGuide({ form, max = 5 }: { form: string; max?: number }) {
  if (!form) return <span className="dim small">—</span>;
  const letters = form.slice(-max).split("");
  return (
    <span className="form">
      {letters.map((letter, i) => (
        <span
          key={i}
          className={`pip pip-${letter.toLowerCase()}`}
          title={{ W: "Win", D: "Draw", L: "Loss" }[letter] ?? letter}
        >
          {letter}
        </span>
      ))}
    </span>
  );
}

/* -------------------------------------------------------------------------
   Probability split
------------------------------------------------------------------------- */

export function ProbBar({
  home,
  draw,
  away,
}: {
  home: number;
  draw: number;
  away: number;
}) {
  return (
    <div
      className="prob"
      title={`Home ${home.toFixed(0)}% · Draw ${draw.toFixed(0)}% · Away ${away.toFixed(0)}%`}
    >
      <div className="prob-h" style={{ width: `${home}%` }} />
      <div className="prob-d" style={{ width: `${draw}%` }} />
      <div className="prob-a" style={{ width: `${away}%` }} />
    </div>
  );
}

/* -------------------------------------------------------------------------
   Signed numbers
------------------------------------------------------------------------- */

/**
 * A signed figure where the sign is the point -- goal difference, luck, xG
 * delta. Zero is deliberately unstyled: colouring it would imply a direction
 * that isn't there.
 */
export function Signed({
  value,
  digits = 0,
  className = "",
}: {
  value: number;
  digits?: number;
  className?: string;
}) {
  const rounded = Number(value.toFixed(digits));
  const tone = rounded > 0 ? "pos" : rounded < 0 ? "neg" : "dim";
  const sign = rounded > 0 ? "+" : "";
  return (
    <span className={`${tone} ${className}`}>
      {sign}
      {rounded.toFixed(digits)}
    </span>
  );
}

/* -------------------------------------------------------------------------
   Status
------------------------------------------------------------------------- */

export function StatusBadge({
  status,
  detail,
  minute,
}: {
  status?: string;
  detail?: string | null;
  minute?: string | null;
}) {
  if (status === "live") {
    return (
      <span className="badge badge-live">
        <span className="live-dot" />
        {minute || "LIVE"}
      </span>
    );
  }
  if (status === "finished") return <span className="badge">FT</span>;
  if (status === "postponed") return <span className="badge">Postponed</span>;
  if (status === "cancelled") return <span className="badge">Cancelled</span>;
  if (detail) return <span className="badge">{detail}</span>;
  return null;
}

/* -------------------------------------------------------------------------
   Stat tile
------------------------------------------------------------------------- */

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="card card-pad">
      <div className="eyebrow">{label}</div>
      <div
        className="tnum"
        style={{
          fontSize: 22,
          fontWeight: 650,
          letterSpacing: "-0.02em",
          marginTop: 4,
        }}
      >
        {value}
      </div>
      {hint && (
        <div className="small dim" style={{ marginTop: 2 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
   Empty state
------------------------------------------------------------------------- */

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="card card-pad sub"
      style={{ textAlign: "center", padding: "32px 16px" }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------
   Dates
------------------------------------------------------------------------- */

/**
 * Rendered in Europe/London and pinned server-side. Letting the browser
 * localise kickoff times would make the server and client markup disagree,
 * and Next would blame us for a hydration mismatch.
 */
const LONDON = "Europe/London";

export function formatKickoff(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: LONDON,
  }).format(d);
}

export function formatDayLong(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: LONDON,
  }).format(d);
}

export function formatDayShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: LONDON,
  }).format(d);
}
