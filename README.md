# The xR philosophy

**Europe's top five leagues, analysed on Expected Results — not the scoreline.**

Premier League · LaLiga · Serie A · Bundesliga · Ligue 1 · Data via FotMob · Rebuilt hourly · Season rolls over automatically each July · **Live at [xrphilosophy.vercel.app](https://xrphilosophy.vercel.app)**

---

## What is xR?

The **Expected Result** is what *should have happened* in a football match, based on the rate at which each side creates and concedes chances — not the final score. A team can dominate, create 3.1 xG, and still lose 1-0 to a breakaway. The scoreline lies.

Every team carries an attack rating and a defence rating, both as multipliers of the league average. A fixture's expected goal rates are:

```
λ_home = base × attack[home] × defence[away] × home_adv
λ_away = base × attack[away] × defence[home]
```

Those two rates go through a Dixon-Coles bivariate Poisson to produce a full scoreline grid, and from there win/draw/loss probabilities, expected points, and goals markets.

The model is:

- **Time-decayed** — every match weighted `exp(−0.0045 × days_ago)`, so recent form dominates without an arbitrary "last 10 games" cut-off
- **Shrunk** — conjugate Gamma priors in expected-goal units stop three good results from producing an absurd rating in August
- **Cross-season** — last season's ratings carry over, regressed 30% toward the mean; promoted clubs start from a fitted promoted-team baseline
- **xG-blended** — separate ratings fitted on goals and on shot quality, blended geometrically at 65% weight on xG
- **Dixon-Coles corrected** — ρ fitted from data, fixing plain Poisson's well-known mispricing of 0-0, 1-1, 1-0 and 0-1
- **Availability-adjusted** — squad and injury data shift a club's ratings for each individual fixture, measured against replacement so squad depth is priced (see the caveat below)

Each league is fitted independently. Nothing is shared but the code, which is why the fitted parameters come out looking like the leagues they describe — Bundesliga the highest-scoring at 1.70 goals per team, Serie A the lowest home advantage at 1.11×.

## Does it work?

Walk-forward backtest, every forecast made using only fixtures played before that kick-off:

| Model | RPS ↓ | LogLoss ↓ | Accuracy |
|---|---|---|---|
| **xR (current)** | **0.2069** | **1.0281** | **49.4%** |
| League base rate | 0.2271 | 1.0843 | 42.0% |
| xR (previous version) | 0.2326 | 1.1164 | 40.9% |

350 scored matches of the 2025-26 Premier League, priors from 2024-25. The previous version of this model scored **worse than the league base rate** — you would have done better guessing the same three numbers for every fixture. That is what prompted the rebuild, which improved RPS by 11.0%.

These figures are generated, not typed. `scripts/backtest.py --json` writes `data/processed/backtest.json` and the About page renders from that file, because this table was hand-maintained twice and drifted from the code both times.

**The closing-market row is currently withheld.** It is the benchmark worth having — the market prices in team news and money that public data cannot see — but the odds source is a separate feed from the match data and was unreachable at the last run. Rather than quote a stale figure, the row is omitted and the About page says so. Restore it with `npm run backtest:publish` once the source is back.

Reproduce with `npm run backtest`.

---

## Features

| Page | What it shows |
|------|--------------|
| **Overview** | Live matches, season snapshot, upcoming fixtures with predictions, latest results |
| **Matches** | Matchweek browser; expand any fixture for the written read and the goal-rate decomposition |
| **Table** | Actual table vs. Expected (xPts) table, plus who is over- and under-performing |
| **Clubs** | Per-club ratings, luck swing, expected position, form, results, and full squad |
| **Players** | Leaderboards by category, and every club's current injury list |
| **About** | Full methodology and the honest backtest scorecard |

Every fixture carries a written read whose factors come from decomposing the predicted goal rate one term at a time, so the stated contributions sum exactly to the prediction — and the panel prints the running total so you can check that on screen rather than take it on faith.

## On the availability adjustment

Squad lists and injuries are read from FotMob and turned into per-fixture multipliers on each club's attack and defence. Two things make it more than a blunt penalty: loss is measured **against replacement**, so losing a fourth-choice defender costs nothing while losing three of your top four is severe; and it is applied **per fixture** using the published return date, so a player out until mid-October is missing this weekend and back in November.

**The strength of the effect is not fitted, and that matters.** Fitting it needs a history of injury snapshots and this project had exactly one, taken the day the feature was written. The magnitude was chosen so a typical injury list moves a forecast 1–3%, capped at 12% — deliberately smaller than published estimates of the real effect, on the principle that an unfitted parameter should not be allowed to overrule ratings that were fitted. Every build appends a dated snapshot to `data/history/availability.jsonl`, so this becomes a question a backtest can answer in a few months.

The adjustment applies only to fixtures that have not been played. Applying today's injury list to a match from August would score the model on information that did not exist at kick-off, so the build guards against it explicitly.

---

## Stack

- **Next.js 16** — App Router, server components, TypeScript, React 19, fully static
- **Python 3, standard library only** — no numpy, no scipy, no pip install in CI
- **CSS custom properties** — light, neutral, dense; one restrained accent

---

## Run locally

```bash
npm install
python3 scripts/build.py    # fetch data and rebuild every JSON file
npm run dev                 # http://localhost:3000
```

## Update data

```bash
npm run build:data          # python3 scripts/build.py
```

Fetches all five leagues from FotMob, refits ratings per league, and rewrites everything under `data/processed/`. Nothing is incrementally patched, so there is no state to drift. A league that fails to fetch is skipped and keeps its last good data rather than being overwritten with something worse.

Finished matches are scored **walk-forward**: the prediction stored against a played fixture is the one the model would genuinely have made beforehand, fitted only on matches played before that kick-off. Nothing is predicted with hindsight.

```bash
npm run build:archive       # rebuild data/archive/ season files (used as priors)
npm run backtest            # print the evaluation
npm run backtest:publish    # and write data/processed/backtest.json
```

## Automation

`.github/workflows/data-refresh.yml` runs `scripts/build.py` **hourly** and commits only when the data actually changed, which redeploys the site. Live scores appear while matches are in progress; the tables settle within an hour of full time.

The season is derived from the current date with a **1 July rollover** — there is no hardcoded season anywhere in the pipeline, which was the bug that left the previous version frozen on 2025-26 after the campaign ended.

---

## Project structure

```
app/
├── page.tsx                    # Root — redirects into the default league
├── [league]/page.tsx           # Overview — live banner, fixtures, standings
├── [league]/matches/           # Matchweek browser + factor decomposition panel
├── [league]/table/             # Actual table vs xPts table + luck panels
├── [league]/clubs/             # Club grid, and per-club profile with squad
├── [league]/players/           # Stat leaderboards + injury list
├── about/page.tsx              # Methodology + generated backtest scorecard
├── components/                 # SiteNav (league switcher) + shared UI
├── lib/xr_data.ts              # Typed loaders for data/processed/**.json
└── globals.css                 # CSS variables + base styles

scripts/
├── build.py                    # Orchestrator — fetch, fit, predict, write
├── fotmob.py                   # FotMob adapter (fixtures, xG, league props)
├── players.py                  # Leaderboards and squads, with injury status
├── availability.py             # Per-fixture squad-strength adjustment
├── xr_model.py                 # Dixon-Coles fit, scoreline grid, xResult
├── reasoning.py                # Exact factor decomposition + written read
├── odds.py                     # Closing odds — backtest benchmark only
├── build_archive.py            # Historical season files used as priors
├── backtest.py                 # Walk-forward evaluation
└── config.py                   # Date-derived season, leagues, hyperparams

data/
├── processed/                  # Committed hourly by CI
│   ├── leagues.json            # League index — drives routing and the nav
│   ├── backtest.json           # Generated scorecard read by the About page
│   └── {league}/               # One directory per league
│       ├── matches.json        # Every fixture, scores, live state
│       ├── predictions.json    # Predictions, reasoning, xResult
│       ├── standings.json      # Actual + expected table
│       ├── power_rankings.json # Attack/defence ratings
│       ├── players.json        # Stat leaderboards
│       ├── squads.json         # Rosters with injury status
│       └── metadata.json       # Season, rounds, fitted model parameters
├── cache/                      # Fetched pages; played-match xG never changes
├── history/                    # Dated injury snapshots, append-only
└── archive/                    # Completed seasons, used as cross-season priors
```

---

*Built by [Adam Sebhat](https://github.com/Savowai)*
