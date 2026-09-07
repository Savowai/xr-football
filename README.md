# The xR philosophy

**Premier League analytics built on Expected Results — not the scoreline.**

Season rolls over automatically each July · Data via ESPN + football-data.co.uk · Rebuilt hourly · **Live at [xrphilosophy.vercel.app](https://xrphilosophy.vercel.app)**

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

## Does it work?

Walk-forward backtest over the previous season, 350 scored matches, every forecast made using only fixtures played before that kick-off:

| Model | RPS ↓ | LogLoss ↓ | Accuracy |
|---|---|---|---|
| Closing betting market | 0.2041 | 1.0162 | 49.7% |
| **xR (current)** | **0.2063** | **1.0262** | **51.4%** |
| League base rate | 0.2271 | 1.0843 | 42.0% |
| xR (previous version) | 0.2305 | 1.1102 | 41.7% |

Two things worth noting. The previous version of this model scored **worse than the league base rate** — you would have done better guessing the same three numbers for all 380 fixtures. That is what prompted the rebuild, which improved RPS by 10.5%. And the current model sits within 0.0023 RPS of the closing market while edging it on raw accuracy; market odds are used as a benchmark only and are never an input.

Reproduce with `npm run backtest`.

---

## Features

| Page | What it shows |
|------|--------------|
| **Home** | Live matches, season snapshot, upcoming fixtures with predictions, latest results |
| **Matchweeks** | Expandable match cards — the read, the goal-rate decomposition, form context, xResult |
| **League** | Actual table vs. Expected (xPts) table, plus who is over- and under-performing |
| **Clubs** | Per-club ratings, luck swing, expected position, form, history, fixtures |
| **About** | Full methodology and the honest backtest scorecard |

Every fixture carries a written read whose factors are derived by decomposing the predicted goal rate one term at a time, so the stated contributions sum exactly to the prediction. The prose cannot drift from the maths.

---

## Stack

- **Next.js 16** — App Router, server components, TypeScript, React 19
- **Python 3, standard library only** — no numpy, no scipy, no pip install in CI
- **CSS custom properties** — dark theme, single scarlet red accent (`#EF4444`)

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

Fetches the full season from ESPN, merges shot quality and odds from football-data.co.uk, refits ratings, and rewrites everything in `data/processed/`. Nothing is incrementally patched, so there is no state to drift.

Finished matches are scored **walk-forward**: the prediction stored against a played fixture is the one the model would genuinely have made beforehand, fitted only on matches played before that kick-off. Nothing is predicted with hindsight.

```bash
npm run build:archive       # rebuild data/archive/ season files (used as priors)
npm run backtest            # regenerate the numbers in the table above
```

## Automation

`.github/workflows/data-refresh.yml` runs `scripts/build.py` **hourly** and commits only when the data actually changed, which redeploys the site. Live scores appear while matches are in progress; the table settles within an hour of full time.

The season is derived from the current date with a **1 July rollover** — there is no hardcoded season anywhere in the pipeline, which was the bug that left the previous version frozen on 2025-26 after the campaign ended.

---

## Project structure

```
app/
├── page.tsx                    # Home — live banner, fixtures, standings
├── matchweeks/page.tsx         # Matchweek browser, defaults to the live MW
├── matchweeks/components/
│   └── MatchweekCard.tsx       # Expandable card: read, factors, form, xResult
├── league/page.tsx             # Actual table vs xPts table + luck panels
├── clubs/page.tsx              # Club grid with ratings and luck
├── clubs/[team]/page.tsx       # Club profile — what the model sees
├── about/page.tsx              # Methodology + backtest scorecard
├── lib/xr_data.ts              # Typed loaders for data/processed/*.json
└── globals.css                 # CSS variables + base styles

scripts/
├── build.py                    # Orchestrator — fetch, fit, predict, write
├── sources.py                  # ESPN + football-data.co.uk adapters
├── xr_model.py                 # Dixon-Coles fit, scoreline grid, xResult
├── reasoning.py                # Exact factor decomposition + written read
├── build_archive.py            # Historical season files used as priors
├── backtest.py                 # Walk-forward evaluation vs market
└── config.py                   # Date-derived season, team names, hyperparams

data/
├── processed/                  # Committed hourly by CI
│   ├── epl_matches.json        # Every fixture, scores, live state
│   ├── epl_predictions.json    # Predictions, reasoning, xResult
│   ├── standings.json          # Actual + expected table
│   ├── power_rankings.json     # Attack/defence ratings
│   └── season_metadata.json    # Season, rounds, fitted model parameters
└── archive/                    # Completed seasons, used as cross-season priors
```

---

*Built by [@adamsebhat](https://github.com/adamsebhat)*
