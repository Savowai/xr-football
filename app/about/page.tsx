import Link from "next/link";

import {
  loadLeagues,
  loadSeasonMetadata,
  loadBacktest,
  DEFAULT_LEAGUE,
} from "../lib/xr_data";

export const metadata = {
  title: "What is xR? — Expected Result",
  description:
    "How the Expected Result model works: attack and defence ratings, time decay, " +
    "shrinkage, cross-season priors, Dixon-Coles scorelines, and its backtested record.",
};

// The scorecard below is read from data/processed/backtest.json, which
// `scripts/backtest.py --json` writes. It used to be a hand-copied constant
// here, and twice it drifted from what the code actually produces -- once when
// the model changed underneath it, once when the underlying data did. A
// published number that nothing regenerates is a claim nobody is checking.
//
// Only the prose stays in the page. Row labels and captions are editorial;
// every figure comes from the file.
const LABELS: Record<string, { name: string; note: string }> = {
  market: {
    name: "Closing betting market",
    note: "Benchmark only — never an input to the model",
  },
  xr: {
    name: "xR (current model)",
    note: "Dixon-Coles, time-decayed, xG-blended",
  },
  base_rate: {
    name: "League base rate",
    note: "The same three numbers for every fixture",
  },
  previous: {
    name: "xR (last season's model)",
    note: "The version this rebuild replaced",
  },
};

export default function AboutPage() {
  const leagues = loadLeagues();
  // Model hyperparameters are shared across leagues; the fitted values quoted
  // below come from the default league's most recent build.
  const meta = loadSeasonMetadata(DEFAULT_LEAGUE);
  const model = meta.model;

  const backtest = loadBacktest();
  const rows = backtest.rows;
  const xr = rows.find((r) => r.key === "xr");
  const market = rows.find((r) => r.key === "market");
  const previous = rows.find((r) => r.key === "previous");
  const baseRate = rows.find((r) => r.key === "base_rate");
  // Stated rather than assumed: the rebuild is only an improvement if the
  // numbers say so, and the page should not claim it when they do not.
  const beatsBaseRate = !!(previous && baseRate && previous.rps > baseRate.rps);
  const marketGap = xr && market ? xr.rps - market.rps : null;

  return (
    <div className="wrap-narrow stack-l" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="page-title" style={{ fontSize: 30, marginBottom: 6 }}>
          What is xR?
        </h1>
        <p className="eyebrow" style={{ marginBottom: 14 }}>
          The method behind Expected Results
        </p>
        <p style={{ fontSize: 15, color: "var(--text-2)", lineHeight: 1.8 }}>
          Football rewards outcomes. But outcomes are noisy. A goalkeeper pulls off a
          wonder save, a shot clips the post, a referee awards a soft penalty — and a
          dominant performance ends in a loss. The{" "}
          <strong style={{ color: "var(--text)" }}>Expected Result</strong> is our best
          estimate of what <em>should have happened</em>, built from the rate at which
          each side creates and concedes chances, not from the final scoreline.
        </p>
      </div>

      {/* ── Scorecard ── */}
      <div className="card">
        <div className="card-header">
          <span className="section-title">The honest scorecard</span>
          <span className="small dim">{backtest.n} matches, out of sample</span>
        </div>
        <div className="card-pad">
          <p className="sub" style={{ lineHeight: 1.75, marginBottom: 16 }}>
            A prediction model that never shows its record is a horoscope. Below is the
            model graded on{" "}
            <strong style={{ color: "var(--text)" }}>Ranked Probability Score</strong> —
            the standard measure for football forecasts, which punishes confident wrong
            answers harder than cautious ones. Lower is better. Scored across{" "}
            {backtest.n} matches of the {backtest.season} {backtest.league_name}, each one
            predicted using only the fixtures that had been played before it.
          </p>

          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th className="left">Model</th>
                  <th>RPS</th>
                  <th>Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const label = LABELS[row.key] ?? { name: row.name, note: "" };
                  const highlight = row.key === "xr";
                  return (
                    <tr
                      key={row.key}
                      style={highlight ? { background: "var(--accent-soft)" } : undefined}
                    >
                      <td className="left" style={{ height: "auto", padding: "9px 8px" }}>
                        <div
                          style={{
                            fontWeight: highlight ? 650 : 500,
                            color: highlight ? "var(--accent)" : "var(--text)",
                          }}
                        >
                          {label.name}
                        </div>
                        <div className="small dim">{label.note}</div>
                      </td>
                      <td
                        className="num-strong"
                        style={highlight ? { color: "var(--accent)" } : undefined}
                      >
                        {row.rps.toFixed(4)}
                      </td>
                      <td className="num-weak">{row.accuracy.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p
            className="sub"
            style={{
              lineHeight: 1.8,
              marginTop: 16,
              borderLeft: "2px solid var(--accent-line)",
              paddingLeft: 14,
            }}
          >
            {beatsBaseRate && (
              <>
                The thing worth sitting with is the bottom row: the previous version of
                this model scored{" "}
                <strong style={{ color: "var(--text)" }}>
                  worse than the league base rate
                </strong>{" "}
                — you would have done better guessing the same three numbers for all{" "}
                {backtest.n} fixtures. That is the reason for the rebuild.{" "}
              </>
            )}
            {marketGap !== null ? (
              <>
                The current model lands within {Math.abs(marketGap).toFixed(4)} RPS of the
                closing betting market, which prices in team news, weather and money that
                public data alone cannot see. Being close to the market is the realistic
                ceiling here; beating it consistently is not a claim this page will make.
              </>
            ) : (
              <>
                One caveat on what is <em>not</em> in the table: the closing betting
                market. It is the benchmark worth having — it prices in team news,
                injuries and money that public data cannot see — but the odds source this
                site used was retired when the pipeline moved to FotMob, which carries no
                prices. Rather than quote a stale figure from a previous run, the row is
                withheld until it can be recomputed. Every comparison above is therefore
                against baselines of my own choosing, which is a weaker test than an
                external one, and should be read that way.
              </>
            )}
          </p>
        </div>
      </div>

      {/* ── Sections ── */}
      <div className="stack-l">
        <Section
          number="01"
          title="Attack and defence ratings"
          body={[
            `Every team carries two numbers: an attack rating and a defence rating, both expressed
             as multipliers of the league average. An attack of 1.30 means a side scores 30% more
             than a typical team against a typical opponent. A defence of 1.15 means it concedes
             15% more — for defence, lower is better.`,
            `The expected goal rate for a fixture is then simply the league base rate multiplied
             by the attacker's rating, the defender's leakiness, and — for the home side — home
             advantage:`,
          ]}
          formula={[
            "λ_home = base × attack[home] × defence[away] × home_adv",
            "λ_away = base × attack[away] × defence[home]",
          ]}
          bullets={[
            `Premier League base rate: ${model.base_goals?.toFixed(2) ?? "—"} goals per team per match`,
            `Premier League home advantage: ${model.home_advantage?.toFixed(2) ?? "—"}× on the home side's rate`,
            `Both are fitted per league — Serie A and the Bundesliga do not share England's numbers`,
          ]}
          footer="The ratings are fitted jointly by weighted maximum likelihood, so a team is not
                  rewarded for scoring freely against defences that leak against everyone. Beating
                  a bad team 4-0 moves the ratings far less than beating a good one 2-0."
        />

        <Section
          number="02"
          title="Recent matches count for more"
          body={[
            `A result from last August tells you less about a team today than a result from last
             week. Rather than picking an arbitrary cut-off — "last 10 games" — every match is
             weighted by how long ago it was played, decaying smoothly:`,
          ]}
          formula={[`weight = exp(−${model.time_decay_xi ?? 0.0045} × days_ago)`]}
          body2={[
            `A match from a month ago counts about 87% as much as yesterday's; one from six months
             ago counts about 45%. Nothing is ever fully discarded and nothing falls off a cliff.
             The decay rate was chosen by backtest, not by taste — it is the value that minimised
             out-of-sample RPS across the season.`,
          ]}
        />

        <Section
          number="03"
          title="Shrinkage: not pretending to know things"
          body={[
            `Three matches into a season, a team that has scored six goals has not proven it is
             twice as good as average. It has proven very little. Ratings are therefore pulled
             toward a sensible prior using a conjugate Gamma update, applied in units of expected
             goals rather than raw counts:`,
          ]}
          formula={["rating = (Σ w·observed + k · prior) / (Σ w·expected + k)"]}
          body2={[
            `The prior strength k is currently ${model.prior_strength ?? 8}, meaning a team needs
             roughly that many matches of evidence before its own record outweighs the prior.
             This is the single most important guard against the August problem, where small
             samples produce absurd ratings and absurd forecasts.`,
            `Home advantage gets the same treatment, and needs it more: measured on twenty matches
             it swings between 1.1 and 1.5 and drags every fixture on the site with it. Shrunk
             toward the long-run league value, it both behaves sensibly and improves backtest
             accuracy.`,
          ]}
        />

        <Section
          number="04"
          title="Last season doesn't vanish in July"
          body={[
            `Most public models restart from zero each August, which is why their early-season
             output is close to noise. Here, each team's end-of-season ratings are carried into
             the new campaign and regressed toward the mean by
             ${Math.round((1 - (model.season_carryover ?? 0.7)) * 100)}% — acknowledging both that
             squads change and that Manchester City did not become an average side over the
             summer.`,
            `Promoted clubs have no top-flight record to carry, so they start from a baseline
             fitted to how promoted teams have historically performed, rather than from league
             average. Removing cross-season priors entirely costs 0.00115 RPS over a full
             backtest — small in aggregate, but concentrated almost entirely in the opening
             weeks, which is exactly when people most want to read the site.`,
          ]}
        />

        <Section
          number="05"
          title="Blending goals with shot quality"
          body={[
            `Goals are the outcome that matters but a noisy signal of ability. Expected goals —
             the accumulated probability of every shot a team took — is a less noisy signal of the
             same thing. So the model fits two complete sets of ratings, one on goals and one on
             xG, then blends them geometrically at
             ${Math.round((model.xg_rating_weight ?? 0.65) * 100)}% weight on the xG version.`,
            `The blend is deliberately not 100% xG. Some sides genuinely finish above their shot
             quality — elite set-piece routines and elite forwards are real, repeatable effects,
             not luck — and a pure xG model refuses to believe it, year after year. Turning the
             xG blend off entirely costs 0.00196 RPS, the largest single contribution of any
             design choice in the model.`,
          ]}
        />

        <Section
          number="06"
          title="From goal rates to scorelines"
          body={[
            `Two expected goal rates are turned into a full grid of scoreline probabilities using
             a bivariate Poisson, then corrected. Plain independent Poisson is known to
             misprice low-scoring games: it produces too few 0-0 and 1-1 draws and too many 1-0
             and 0-1 results. The Dixon-Coles τ correction adjusts exactly those four cells, with
             the strength of the correction (ρ, currently ${model.rho?.toFixed(3) ?? "—"}) fitted
             from data rather than assumed.`,
            `Summing the grid produces everything the site displays:`,
          ]}
          bullets={[
            "Win, draw and loss probabilities for each side",
            "The most likely individual scorelines, ranked",
            "Expected points (xPts = 3·P(win) + 1·P(draw)) which drives the Expected Table",
            "Over/under 2.5 goals and both-teams-to-score markets",
          ]}
          footer="Fixture rows lead with the expected goal rate rather than the single likeliest
                  scoreline, because that scoreline is 1-1 in the great majority of matches and
                  carries roughly an 11% chance. The rate is what actually separates one fixture
                  from another; the modal scoreline is shown beside it, with its probability."
        />

        <Section
          number="07"
          title="Who is actually available"
          body={[
            `The ratings describe a club, but a club does not play matches — eleven players do.
             The largest thing the betting market can see that a public-data model cannot is
             that a side is without its first-choice striker. So squad lists and injury status
             are read from FotMob and turned into a pair of multipliers on each club's attack
             and defence for each individual fixture.`,
            `Two details do most of the work. Loss is measured against replacement rather than
             in absolute terms: each positional group is scored as the best available eleven
             against the best possible eleven, so losing a fourth-choice centre-back costs
             nothing while losing three of your top four is severe. And it is applied per
             fixture, using the published return date — a player out until mid-October is
             missing this weekend and present in November, which matters because club pages
             show fixtures two months ahead.`,
            `This parameter is not fitted, and that should be said plainly. Fitting it needs a
             history of injury snapshots and this project has one snapshot, taken today. The
             strength was chosen so a typical injury list moves a forecast one to three percent,
             capped at twelve — smaller than the published estimates of the effect, because an
             unfitted parameter should not be allowed to overrule ratings that were fitted.
             Every build now appends a dated snapshot, so in a few months this becomes a
             question that can be answered with a backtest instead of a judgement.`,
          ]}
          footer="The adjustment applies only to fixtures that have not been played. Applying
                  today's injury list to a match from August would score the model on
                  information that did not exist at kick-off, which is the easiest way there is
                  to fake a good backtest."
        />

        <Section
          number="08"
          title="The reasoning is the maths, not a caption"
          body={[
            `Most model write-ups are prose bolted onto a number, free to drift from what the
             model actually did. The read attached to every fixture here is generated by
             decomposing the predicted goal rate sequentially — starting from the league base
             rate and applying one factor at a time, recording the goals each step adds or
             removes.`,
            `Because the factors are built by construction rather than estimated separately, the
             deltas sum exactly to the prediction. If the panel says home advantage is worth
             +0.18 goals and the attacking matchup +0.31, those numbers add up to the forecast
             shown above them. The prose cannot say one thing while the model does another.`,
          ]}
          bullets={[
            "Every fixture states its confidence, graded on how much evidence actually exists",
            "Confidence is measured in time-decayed effective matches, not calendar fixtures",
            "Early-season predictions are labelled low or very low confidence, and should be read that way",
          ]}
        />

        <Section
          number="09"
          title="After the whistle: the xResult"
          body={[
            `Once a match is played, the same scoreline model is re-run on the chances that were
             actually created — the shot-by-shot expected goals accumulated over ninety minutes.
             That produces the expected points each side deserved from the performance, which is
             then compared against the points they took.`,
            `The verdict badge summarises the gap:`,
          ]}
          bullets={[
            "JUSTIFIED — the result broadly matches the chances (xPts swing under 1.0)",
            "LUCKY H — the home side took materially more points than the performance deserved",
            "LUCKY A — the away side did the same",
          ]}
          footer={`Sustained "lucky" verdicts are the site's most useful output: they are the
                   clearest available signal that a league position is not stable, and that the
                   table is about to move.`}
        />

        <Section
          number="10"
          title="Limitations, stated plainly"
          body={[
            `This is a statistical model of a game played by people. Real things it does not know:`,
          ]}
          bullets={[
            "Availability is adjusted for, but by an unfitted parameter (section 07) — the size of the effect is a reasoned choice, not a measured one",
            "Suspensions and rotation are still invisible; only published injuries are read, so a benched star counts as available",
            "Managerial changes are absorbed only gradually, through time decay",
            "Goals are treated as conditionally independent; in reality teams change how they play once ahead or behind",
            "Motivation is invisible: a dead rubber in May is priced identically to a title decider",
            "Promoted clubs are the weakest case, priced from a historical baseline until they build a top-flight record",
            "In the opening weeks of a season, priors are doing most of the work — which the confidence labels say out loud",
            "The backtest above was run on the Premier League; the other four leagues use the same model and hyperparameters but have not been separately validated",
          ]}
          footer="None of these are fixed by adding more parameters to a single season of data. The
                  hyperparameters here were validated by sweep and deliberately left at values that
                  were optimal or statistically indistinguishable from it — chasing differences of
                  ±0.0002 RPS on one season is how models get overfitted, not improved."
        />

        <Section
          number="11"
          title="Data and refresh cadence"
          body={[
            `Fixtures, live scores, results and shot quality all come from FotMob, which publishes
             per-match expected goals — including the open-play, set-piece and on-target splits —
             for every match in the five leagues covered here. Ratings, predictions, standings and
             power rankings are recomputed from scratch on every run, so there is no incremental
             state to drift.`,
            `The pipeline runs hourly via GitHub Actions and commits only when something actually
             changed, so live scores appear while matches are in progress and the table settles
             within an hour of full time. A played match's expected goals never change, so each
             match page is fetched once and cached permanently — an hourly run costs almost
             nothing.`,
          ]}
        />
      </div>

      {/* ── Coverage ── */}
      <div className="card">
        <div className="card-header">
          <span className="section-title">Current coverage</span>
          <span className="small dim">Rebuilt {formatBuiltAt(meta.built_at)}</span>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th className="left">League</th>
                <th className="left">Country</th>
                <th>Played</th>
                <th>Fixtures</th>
                <th title="Played matches with expected-goals data">xG</th>
              </tr>
            </thead>
            <tbody>
              {leagues.map((l) => (
                <tr key={l.key}>
                  <td className="left">
                    <Link href={`/${l.key}`} style={{ color: "var(--accent)", fontWeight: 550 }}>
                      {l.name}
                    </Link>
                  </td>
                  <td className="left num-weak">{l.country}</td>
                  <td className="num-strong">{l.played}</td>
                  <td className="num-weak">{l.matches}</td>
                  <td className="num-weak">{l.xg_coverage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-pad">
          <p className="sub">
            Finished matches on this site display the prediction the model would genuinely
            have made beforehand, fitted only on matches played before that kick-off.
            Nothing is scored with hindsight.
          </p>
        </div>
      </div>
    </div>
  );
}

/** "2026-09-03T09:32:32Z" -> "3 Sep 2026, 09:32 UTC". Em dash if unparseable. */
function formatBuiltAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${date}, ${time} UTC`;
}

// ─── Section ─────────────────────────────────────────────────────────────────

function Section({
  number,
  title,
  body,
  formula,
  body2,
  bullets,
  footer,
}: {
  number: string;
  title: string;
  body: string[];
  /** Monospace display lines, rendered between `body` and `body2`. */
  formula?: string[];
  body2?: string[];
  bullets?: string[];
  footer?: string;
}) {
  const paragraph = {
    fontSize: 14,
    color: "var(--text-2)",
    lineHeight: 1.85,
    margin: 0,
  } as const;

  return (
    <section>
      <div className="row" style={{ alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <span className="eyebrow" style={{ color: "var(--accent)" }}>
          {number}
        </span>
        <h2 style={{ fontSize: 19, fontWeight: 640, letterSpacing: "-0.02em" }}>
          {title}
        </h2>
      </div>

      <div className="stack" style={{ gap: 13 }}>
        {body.map((para, i) => (
          <p key={i} style={paragraph}>
            {para}
          </p>
        ))}

        {formula && (
          <div
            style={{
              padding: "13px 15px",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: 7,
              overflowX: "auto",
            }}
          >
            {formula.map((line, i) => (
              <code
                key={i}
                className="mono"
                style={{ fontSize: 12.5, color: "var(--text)", whiteSpace: "pre" }}
              >
                {line}
              </code>
            ))}
          </div>
        )}

        {body2?.map((para, i) => (
          <p key={i} style={paragraph}>
            {para}
          </p>
        ))}

        {bullets && (
          <ul
            style={{
              margin: 0,
              paddingLeft: 20,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {bullets.map((b, i) => (
              <li key={i} style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.7 }}>
                {b}
              </li>
            ))}
          </ul>
        )}

        {footer && (
          <p
            style={{
              ...paragraph,
              borderLeft: "2px solid var(--accent-line)",
              paddingLeft: 14,
            }}
          >
            {footer}
          </p>
        )}
      </div>
    </section>
  );
}
