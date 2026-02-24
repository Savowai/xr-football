# The xRphilosophy

**Premier League analytics built on Expected Results — not the scoreline.**

Season: 2025-26 · Data via ESPN API · **Live at [xr-football.vercel.app](https://xr-football.vercel.app)**

---

## What is xR?

The **Expected Result** is what *should have happened* in a football match, based on the quality and quantity of chances created — not the final score. A team can dominate possession, create 3.1 xG, and still lose 1-0 to a breakaway goal. The scoreline lies. xR doesn't.

This app models the 2025-26 Premier League using:

- **Rolling Form** — last 10 matches, exponential-weighted (recent 4× heavier)
- **Matchup xG** — pressing vs. pass completion, crossing threat vs. aerial defence, possession dominance vs. counter threat
- **Poisson Model** — xG → probability distribution → Win/Draw/Loss % and top scoreline predictions
- **Expected Points (xPts)** — 3×P(Win) + 1×P(Draw), surfacing who is lucky and who is unlucky

---

## Features

| Page | What it shows |
|------|--------------|
| **Home** | Season snapshot, upcoming big games with predictions, latest results |
| **Matchweeks** | Expandable match cards — compact by default, click to reveal scorelines + form context |
| **League** | Actual table vs. Expected (xPts) table side by side |
| **Clubs** | Per-club season stats, last-5 form, match history, upcoming fixtures |
| **About** | Full methodology explanation |

---

## Stack

- **Next.js 15** — App Router, server components, TypeScript
- **Python 3** — ESPN API → xR model → JSON data files
- **CSS custom properties** — dark theme, single scarlet red accent (`#EF4444`)

---

## Run Locally

```bash
npm install
python3 scripts/fetch_espn_2526.py   # fetch real data
npm run dev                           # http://localhost:3000
```

## Update Data

```bash
python3 scripts/fetch_espn_2526.py
```

Fetches all 380 fixtures from the ESPN API, refreshes the last 30 days with live scores, runs the xR model, and saves to `data/processed/`.

---

## Project Structure

```
app/
├── page.tsx                    # Home — hero, big games, standings
├── matchweeks/page.tsx         # Matchweek browser with MW selector
├── matchweeks/components/
│   └── MatchweekCard.tsx       # Expandable match card (client component)
├── league/page.tsx             # Actual table vs xPts table
├── clubs/page.tsx              # Club grid
├── clubs/[team]/page.tsx       # Club profile — form, history, upcoming
├── about/page.tsx              # xR methodology
└── globals.css                 # CSS variables + base styles

scripts/
├── fetch_espn_2526.py          # Main data fetcher (ESPN API)
└── xr_model.py                 # Rolling form + Poisson predictions

data/processed/
├── epl_matches.json            # 380 fixtures with scores
├── epl_predictions.json        # xR predictions with form + probabilities
└── season_metadata.json        # Season info
```

---

*Built by [@adamsebhat](https://github.com/adamsebhat)*
