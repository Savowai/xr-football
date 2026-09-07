"""
Centralised configuration for the xR pipeline.

Season handling is DYNAMIC: the season that is "current" is derived from
today's date, so the pipeline rolls over on its own instead of needing a code
change every August.

Nothing here assumes 20 teams or 38 matchweeks. Bundesliga and Ligue 1 have 18
teams and 306 fixtures, and hard-coding the English shape of a season was one
of the bugs that broke the previous version.
"""

from dataclasses import dataclass
from datetime import date
from typing import Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Leagues
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class League:
    key: str            # stable slug used in filenames and URLs
    name: str           # display name
    country: str
    fotmob_id: int
    fotmob_slug: str
    teams: int
    tier_note: str = ""

    @property
    def matches_per_season(self) -> int:
        return self.teams * (self.teams - 1)

    @property
    def rounds(self) -> int:
        return (self.teams - 1) * 2


LEAGUES: List[League] = [
    League("epl", "Premier League", "England", 47, "premier-league", 20),
    League("laliga", "LaLiga", "Spain", 87, "laliga", 20),
    League("seriea", "Serie A", "Italy", 55, "serie-a", 20),
    League("bundesliga", "Bundesliga", "Germany", 54, "bundesliga", 18),
    League("ligue1", "Ligue 1", "France", 53, "ligue-1", 18),
]

LEAGUES_BY_KEY: Dict[str, League] = {lg.key: lg for lg in LEAGUES}
DEFAULT_LEAGUE = "epl"


def get_league(key: str) -> League:
    try:
        return LEAGUES_BY_KEY[key]
    except KeyError:
        raise SystemExit(
            f"Unknown league '{key}'. Known: {', '.join(LEAGUES_BY_KEY)}"
        )


# Kept so older single-league code paths still read sensibly.
LEAGUE = "Premier League"

# ---------------------------------------------------------------------------
# Season
# ---------------------------------------------------------------------------
# A PL season starting in year Y runs Y-08 .. (Y+1)-05. We treat 1 July as the
# rollover point: before July we are still in the season that began last year.
SEASON_ROLLOVER_MONTH = 7


def current_season_start_year(today: Optional[date] = None) -> int:
    today = today or date.today()
    return today.year if today.month >= SEASON_ROLLOVER_MONTH else today.year - 1


def season_label(start_year: int) -> str:
    """2026 -> '2026-27'"""
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def season_key(start_year: int) -> str:
    """2026 -> '2627' (football-data.co.uk directory key)"""
    return f"{str(start_year)[-2:]}{str(start_year + 1)[-2:]}"


def season_window(start_year: int) -> Tuple[str, str]:
    """ESPN scoreboard date range, YYYYMMDD."""
    return f"{start_year}0701", f"{start_year + 1}0630"


SEASON_START_YEAR = current_season_start_year()
SEASON_LABEL = season_label(SEASON_START_YEAR)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
DATA_PROCESSED_DIR = "data/processed"
DATA_ARCHIVE_DIR = "data/archive"
# Per-match stats, fetched once and kept forever. A played match's xG never
# changes, so this is what keeps an hourly job from re-fetching 1,700 pages.
DATA_CACHE_DIR = "data/cache"

# ---------------------------------------------------------------------------
# Team name canonicalisation
# ---------------------------------------------------------------------------
# Sources disagree: ESPN says "Brighton & Hove Albion", football-data.co.uk
# says "Brighton". Everything is mapped to one canonical display name.
CANONICAL_TEAMS = {
    # ESPN display names
    "AFC Bournemouth": "Bournemouth",
    "Brighton & Hove Albion": "Brighton",
    "Brighton and Hove Albion": "Brighton",
    "Wolverhampton Wanderers": "Wolves",
    # football-data.co.uk short names
    "Man City": "Manchester City",
    "Man United": "Manchester United",
    "Newcastle": "Newcastle United",
    "Tottenham": "Tottenham Hotspur",
    "Nott'm Forest": "Nottingham Forest",
    "Nottm Forest": "Nottingham Forest",
    "West Ham": "West Ham United",
    "Leeds": "Leeds United",
    "Ipswich": "Ipswich Town",
    "Leicester": "Leicester City",
    "Coventry": "Coventry City",
    "Hull": "Hull City",
    "Sheffield Utd": "Sheffield United",
    "Sheffield Weds": "Sheffield Wednesday",
    "Luton": "Luton Town",
    "Norwich": "Norwich City",
    "West Brom": "West Bromwich Albion",
    "Wolverhampton": "Wolves",
    "Birmingham": "Birmingham City",
    "Stoke": "Stoke City",
    "Swansea": "Swansea City",
    "Cardiff": "Cardiff City",
    "Huddersfield": "Huddersfield Town",
}


def canon(name: str) -> str:
    if not name:
        return name
    return CANONICAL_TEAMS.get(name.strip(), name.strip())


# Short label used in compact UI contexts
SHORT_NAMES = {
    "Manchester City": "Man City",
    "Manchester United": "Man Utd",
    "Newcastle United": "Newcastle",
    "Tottenham Hotspur": "Spurs",
    "Nottingham Forest": "Forest",
    "West Ham United": "West Ham",
    "Leeds United": "Leeds",
    "Ipswich Town": "Ipswich",
    "Leicester City": "Leicester",
    "Coventry City": "Coventry",
    "Hull City": "Hull",
    "Crystal Palace": "Palace",
    "Aston Villa": "Villa",
    "Sheffield United": "Sheffield Utd",
}


def short(name: str) -> str:
    return SHORT_NAMES.get(name, name)


def short_player(name: str) -> str:
    """
    Surname only, for prose that lists several players at once.

    Kept deliberately simple: strip a leading given name and keep everything
    after it, so compound surnames ("van Dijk", "De Bruyne") survive intact.
    Single-token names are left alone, which is what the mononym convention in
    Brazilian and Portuguese squads needs.
    """
    parts = name.split()
    if len(parts) < 2:
        return name
    return " ".join(parts[1:])


# ---------------------------------------------------------------------------
# Model hyper-parameters  (tuned via scripts/backtest.py)
# ---------------------------------------------------------------------------
# Time decay: weight = exp(-XI * days_ago).
TIME_DECAY_XI = 0.0045

# Gamma-prior strength, in units of expected goals. A team generates roughly
# 1.4 xG per match, so PRIOR_STRENGTH=8.0 means the prior carries about the
# same weight as six matches of evidence.
PRIOR_STRENGTH = 8.0

# How much of a team's rating carries into the next season.
SEASON_CARRYOVER = 0.70

# Weight on xG-derived ratings vs goals-derived ratings when blending.
XG_RATING_WEIGHT = 0.65

# Home advantage is a slow-moving league property, not a per-season one, so it
# is shrunk toward this value. The strength is in expected-goal units: a full
# season of home goals is ~700, so 60 is a mild pull late on but a decisive one
# in August, which is exactly the intent.
HOME_ADV_PRIOR = 1.28
HOME_ADV_PRIOR_STRENGTH = 60.0

# Prediction clamps
MIN_LAMBDA = 0.15
MAX_LAMBDA = 4.0

# Rolling form window used for the narrative/thesis layer (not the ratings)
FORM_WINDOW = 6
