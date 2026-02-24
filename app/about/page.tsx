import Link from "next/link";

export default function AboutPage() {
  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "48px 24px" }}>

      {/* ── Title ── */}
      <div style={{ marginBottom: 48 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
          <div style={{ width: 4, height: 44, background: "var(--red)", borderRadius: 2, flexShrink: 0, marginTop: 2 }} />
          <div>
            <h1 style={{ fontSize: 40, fontWeight: 900, color: "#fff", margin: 0, letterSpacing: -1.5, lineHeight: 1 }}>
              What is xR?
            </h1>
            <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 14 }}>
              The philosophy behind Expected Results
            </p>
          </div>
        </div>
        <p style={{ fontSize: 16, color: "var(--muted)", lineHeight: 1.85, maxWidth: 700 }}>
          Football rewards outcomes. But outcomes are noisy. A goalkeeper pulls off a wonder save,
          a shot clips the post, a referee awards a soft penalty — and a dominant performance
          ends in a loss. The <strong style={{ color: "#fff" }}>Expected Result</strong> is our
          best estimate of what{" "}
          <em style={{ color: "var(--red)" }}>should have happened</em>, built from the
          quality and quantity of chances created, not the final scoreline.
        </p>
      </div>

      {/* ── Sections ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 48 }}>

        <Section
          number="01"
          title="Rolling Form"
          body={[
            `We look at the last 10 matches for each team. Not just wins and losses — we track the
             quality of their performances: how many good chances they created (xGF) and conceded (xGA),
             their possession share, crossing threat, press intensity, and defensive solidity.`,
            `Recent form is weighted more heavily using an exponential decay: the most recent
             4 games count roughly 4× as much as games from 10 fixtures ago. This captures
             current momentum — an injury to a key striker, a new manager's tactical change,
             a run of easy opponents — without ignoring the broader context.`,
          ]}
        />

        <Section
          number="02"
          title="Matchup xG Model"
          body={[
            `Expected Goals (xG) measures the probability that a shot results in a goal, based on
             its location, angle, assist type, and body part. A tap-in from 6 yards has an xG of ~0.8;
             a speculative long-range effort might be 0.04.`,
            `Our matchup model builds on top of raw xG. We compare how each team's attacking
             profile meets the opponent's defensive profile. A team with high crossing threat
             playing against a team with poor aerial defence generates higher xG than the
             raw numbers would suggest. We adjust for:`,
          ]}
          bullets={[
            "Pressing intensity vs pass completion under pressure",
            "Crossing volume vs aerial duel win rate",
            "Possession dominance vs counter-attacking threat",
            "Set piece delivery vs defensive organisation",
          ]}
        />

        <Section
          number="03"
          title="Poisson Scoreline Probabilities"
          body={[
            `Once we have a predicted xG for each team, we use a Poisson distribution to model
             the scoreline. If Liverpool are expected to score 2.1 goals, the Poisson distribution
             tells us the probability of them scoring exactly 0, 1, 2, 3… goals in this match.`,
            `We compute this for both teams independently (assuming goals are roughly independent
             events — a simplification, but a good one). Multiplying the two distributions gives
             us a full grid of scoreline probabilities:`,
          ]}
          bullets={[
            "Win/Draw/Loss percentages for each side",
            "Top 5 most likely scorelines with their individual probabilities",
            "Expected Points (xPts = 3×P(Win) + 1×P(Draw)) for the Expected Table",
          ]}
        />

        <Section
          number="04"
          title="The Expected Table (xPts)"
          body={[
            `The standard league table rewards actual results. The Expected Table (xPts table) rewards
             performance. Each team's xPts total is the sum of expected points from every match —
             computed from the Poisson model, not from actual outcomes.`,
            `A team sitting 5th in the actual table but 2nd in the xPts table is likely
             underperforming their shot quality — they are creating good chances but not finishing
             them. Expect them to climb. A team sitting 2nd but 9th in xPts has been getting lucky:
             over-performing their xG, or winning matches they probably shouldn't have.`,
          ]}
        />

        <Section
          number="05"
          title="Limitations & Honesty"
          body={[
            `This model is a starting point, not an oracle. There are real limits to what it can capture:`,
          ]}
          bullets={[
            "xG data is sourced from Understat's shot-level model — more accurate than goal-based approximations, but still subject to modelling assumptions",
            "Poisson assumes independence between goals — in reality, teams change tactics after going ahead or behind",
            "Squad depth, injuries, and rotation are not explicitly modelled",
            "Home advantage is partially captured through form data but not explicitly weighted",
            "Sample sizes are small early in the season — predictions improve as more matches are played",
          ]}
          footer="Despite these limitations, the xR approach consistently identifies teams getting lucky and teams being unlucky — which is exactly what a good model should do."
        />

        <Section
          number="06"
          title="Set Pieces: The xR Breakers"
          body={[
            `Set piece specialists — Brentford under Thomas Frank, Dyche-era teams, Sheffield United under Wilder
             — routinely generate 30–40% of their xG from dead balls, compared to the league average of around
             20%. Standard xG assigns modest values to individual deliveries (~0.05–0.12 per chance), reflecting
             the average conversion rate across all teams. But elite aerial duellers and precision routines
             convert consistently above this baseline.`,
            `xR tracks set_piece_reliance per team and adjusts pre-match xG predictions accordingly. However,
             systematic over-conversion of set piece xG appears in the post-match xResult as a "justified"
             verdict even when the team outperformed their shot quality — because the real conversion rate
             for that team isn't random variation, it's a regime effect. The verdict badges are a starting
             point, not the final word: context matters.`,
          ]}
        />

        <Section
          number="07"
          title="Post-Match xResult"
          body={[
            `The xR model operates in two modes. Before a match, it uses each team's rolling form xG
             (last 10 games, exponentially weighted) fed through a matchup adjustment and Poisson
             distribution to produce pre-match win/draw/loss probabilities and predicted scorelines.`,
            `After a match, xR switches to post-match mode: the same Poisson model runs again, but
             this time fed with the actual Understat xG from that specific game — the shot-by-shot
             expected goals accumulated over 90 minutes. This tells you what should have happened
             given the chances that were actually created.`,
            `The verdict badge summarises the gap between actual outcome and xResult:`,
          ]}
          bullets={[
            "JUSTIFIED — result consistent with xG (margin < 0.4, or xG winner = actual winner)",
            "LUCKY H — home team won despite xG favouring the away side",
            "LUCKY A — away team won despite xG favouring the home side",
          ]}
          footer={`Example: Arsenal lose 0-1 to a team with 0.3 xG while Arsenal created 2.4 xG.
                   The xResult gives Arsenal a ~72% win probability based on their chances. The badge
                   reads "lucky A" — not because the away team cheated, but because they likely won't
                   repeat that over 38 games.`}
        />

        <Section
          number="08"
          title="Data Sources"
          body={[
            `Match fixtures, scores, and basic statistics are sourced from the ESPN API for the
             2025-26 Premier League season. Shot-level xG data and per-team PPDA (Passes per
             Defensive Action) are scraped from Understat, which maintains shot coordinates and
             xG values for every Premier League match. The pipeline runs daily via GitHub Actions
             and automatically generates all 380 fixture predictions.`,
          ]}
        />

      </div>

      {/* ── Footer CTA ── */}
      <div style={{
        marginTop: 56, padding: "28px 32px",
        background: "var(--surface)", border: "1px solid var(--border)",
        borderLeft: "3px solid var(--red)",
        borderRadius: 10,
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginBottom: 8 }}>
          Ready to explore?
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 18, lineHeight: 1.6 }}>
          Check the current matchweek predictions, the full league table with xPts rankings,
          or dive into any club's season performance.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/matchweeks" style={{
            padding: "9px 20px", borderRadius: 8,
            background: "var(--red)", color: "#fff",
            fontWeight: 700, fontSize: 13, textDecoration: "none",
          }}>Matchweeks</Link>
          <Link href="/league" style={{
            padding: "9px 20px", borderRadius: 8,
            background: "transparent", color: "var(--muted)",
            fontWeight: 600, fontSize: 13, textDecoration: "none",
            border: "1px solid var(--border-2)",
          }}>League Table</Link>
          <Link href="/clubs" style={{
            padding: "9px 20px", borderRadius: 8,
            background: "transparent", color: "var(--muted)",
            fontWeight: 600, fontSize: 13, textDecoration: "none",
            border: "1px solid var(--border-2)",
          }}>All Clubs</Link>
        </div>
      </div>

    </div>
  );
}

// ─── Section component ────────────────────────────────────────────────────────

function Section({
  number, title, body, bullets, footer,
}: {
  number: string;
  title: string;
  body: string[];
  bullets?: string[];
  footer?: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "var(--red)", letterSpacing: 2 }}>
          {number}
        </span>
        <h2 style={{
          fontSize: 22, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: -0.5,
        }}>{title}</h2>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {body.map((para, i) => (
          <p key={i} style={{
            fontSize: 14, color: "var(--muted)", lineHeight: 1.85, margin: 0,
          }}>{para}</p>
        ))}
        {bullets && (
          <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            {bullets.map((b, i) => (
              <li key={i} style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.7 }}>
                {b}
              </li>
            ))}
          </ul>
        )}
        {footer && (
          <p style={{
            fontSize: 14, color: "var(--muted)", lineHeight: 1.85, margin: 0,
            borderLeft: "2px solid var(--red)",
            paddingLeft: 14,
          }}>{footer}</p>
        )}
      </div>
    </div>
  );
}
