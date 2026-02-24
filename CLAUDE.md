# The xRphilosophy — Claude Code Context

## What This Project Is
A Premier League analytics web app built on **Expected Results (xR)** — rolling form, matchup-aware xG modelling, and Poisson scoreline probabilities for the 2025-26 EPL season.

**Live URL:** https://xrphilosophy.vercel.app (also works: xr-football.vercel.app)

## Tech Stack
- **Frontend:** Next.js 15+ App Router, TypeScript, inline styles (no Tailwind in page logic)
- **Data pipeline:** Python 3, ESPN hidden API, custom xR model (`scripts/xr_model.py`)
- **Styling:** CSS custom properties in `app/globals.css` — black/dark background + **scarlet red accent (`#EF4444`)**
- **Data source:** ESPN API only (`scripts/fetch_espn_2526.py`)

## CSS Variables (app/globals.css)
```
--bg, --surface, --surface-2, --surface-3   (backgrounds: #0a0a0a → #222)
--border, --border-2                         (borders)
--red, --red-dim, --red-border               (accent: #EF4444)
--text (#fff), --muted (#888), --dim (#444)
```
**Never use `--pl-*` variables** — those were the old purple design and have been removed.

## Pages
| Route | File | Description |
|-------|------|-------------|
| `/` | `app/page.tsx` | Home: hero + upcoming big games + standings + recent results |
| `/matchweeks` | `app/matchweeks/page.tsx` | MW selector (red = current/selected) + expandable match cards |
| `/league` | `app/league/page.tsx` | Actual table + Expected (xPts) table side by side |
| `/clubs` | `app/clubs/page.tsx` | Club grid ranked by points |
| `/clubs/[team]` | `app/clubs/[team]/page.tsx` | Club profile: stats, form dots, results, upcoming, season log |
| `/about` | `app/about/page.tsx` | xR philosophy explanation (6 sections) |

## Data Pipeline
```bash
# Fetch fresh data (run this whenever you want updated scores)
python3 scripts/fetch_espn_2526.py
```
- Fetches season-wide schedule + refreshes last 30 days individually (to get live scores)
- Outputs to `data/processed/epl_matches.json`, `epl_predictions.json`, `season_metadata.json`
- ESPN doesn't provide xG data — `home_xg`/`away_xg` fields are always `null`, handle with `?? 0` or null guards

## Key Design Decisions
- **Expandable match cards:** MatchweekCard is "use client" with `useState(false)` for expand/collapse
- **Date formatting:** Use `fmtDate()` / manual UTC-based formatter — never `toLocaleDateString()` (causes hydration mismatch between Node and browser)
- **"Big Games" on home page:** Upcoming fixtures ranked by sum of table positions (lower = higher-profile)
- **Round assignment:** Groups every 10 matches chronologically — do not use date-gap detection (breaks at international breaks)

## 2025-26 EPL Teams (20)
Arsenal, Aston Villa, Bournemouth, Brentford, Brighton, Burnley, Chelsea, Crystal Palace, Everton, Fulham, Leeds United, Liverpool, Manchester City, Manchester United, Newcastle United, Nottingham Forest, Sunderland, Tottenham Hotspur, West Ham United, Wolves

## Common Bugs Already Fixed
- Null xG crashes: ESPN provides no xG → always guard `.toFixed()` calls with `?? 0` or `!= null`
- Hydration mismatch: `toLocaleDateString` differs between Node/browser — use manual UTC formatter
- Stale match statuses: season-wide ESPN URL returns frozen scores — fixed by fetching last 30 days individually
- Old `--pl-*` CSS vars: all replaced with `--red`, `--surface`, etc.
