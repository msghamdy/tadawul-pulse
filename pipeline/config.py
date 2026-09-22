"""Central configuration for the Tadawul Pulse pipeline.

Every tunable parameter lives here. Modules import from this file rather than
hard-coding values.

Verify before relying on it
---------------------------
* Shariah flags differ between screening standards (AAOIFI, Al Rajhi Capital,
  Albilad Capital, ...) and are revised quarterly. Treat every flag as a
  starting point and check it against the list you want to follow.
* Sector assignments follow Tadawul's GICS-based sectors to the best of my
  knowledge. Items marked TODO are the ones I am least sure about.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "web" / "public" / "data"
CACHE_DIR = ROOT / ".cache" / "prices"

PIPELINE_VERSION = "0.1.0"

# --------------------------------------------------------------------------- #
# Market-wide tickers
# --------------------------------------------------------------------------- #
INDEX_TICKER = "^TASI.SR"
OIL_TICKER = "BZ=F"  # Brent crude front-month future

START_DATE = "2015-01-01"  # after the June 2013 switch to a Sun–Thu week

# --------------------------------------------------------------------------- #
# Calendar
# --------------------------------------------------------------------------- #
# pandas dayofweek: Monday=0 ... Sunday=6. Tadawul trades Sunday–Thursday.
SAUDI_TRADING_WEEKDAYS: tuple[int, ...] = (6, 0, 1, 2, 3)
TRADING_DAYS_PER_YEAR = 250
# A Sun–Thu date is added to the calendar if at least this share of the
# universe traded on it, even when the index row is missing on Yahoo.
CALENDAR_MIN_COVERAGE = 0.5

# --------------------------------------------------------------------------- #
# Download
# --------------------------------------------------------------------------- #
DOWNLOAD_RETRIES = 3
RETRY_BACKOFF_SECONDS = 2.0
PAUSE_BETWEEN_TICKERS_SECONDS = 0.3
CACHE_TTL_HOURS = 12.0

# --------------------------------------------------------------------------- #
# Cleaning
# --------------------------------------------------------------------------- #
PRICE_LIMIT = 0.10             # Tadawul daily price limit (±10%)
PRICE_LIMIT_TOLERANCE = 0.005  # tick rounding can push a limit move slightly past 10%
OIL_SUSPICIOUS_MOVE = 0.20     # Brent has no limit; flag anything larger than this
DROP_ZERO_VOLUME = True
MAX_FFILL_DAYS = 3             # only gaps of this many trading days or fewer are filled
MIN_HISTORY_DAYS = 250         # fewer observed days marks a stock as "short_history"
# Yahoo sometimes returns only a few days of ^TASI.SR history. Below this many
# observed days, TASI is replaced by an equal-weighted index of the universe
# (anchored to the real TASI's latest close) and the site labels it as a proxy.
INDEX_MIN_HISTORY_DAYS = 250
PROXY_MIN_STOCKS = 10          # proxy needs at least this many usable returns on a day
# A run during trading hours would store today's unfinished session as if it
# were a close. Rows dated today are dropped until this Riyadh time.
SESSION_FINAL_TIME = "15:30"
RIYADH_TZ = "Asia/Riyadh"

# --------------------------------------------------------------------------- #
# Oil beta
# --------------------------------------------------------------------------- #
BETA_WINDOWS: tuple[int, ...] = (60, 120)
BETA_MIN_OBS_FRACTION = 0.8    # need 80% of the window as usable returns
# "dimson":   oil beta = coefficient on same-day + prior-day Brent return.
#             Corrects for Brent settling hours after Tadawul closes.
# "same_day": plain univariate regression on the same-day Brent return.
OIL_BETA_METHOD = "dimson"
BETA_STALE_DAYS = 10           # a current beta older than this many trading days is reported as null

# --------------------------------------------------------------------------- #
# Export
# --------------------------------------------------------------------------- #
SERIES_YEARS = 3               # history kept in the per-stock beta series files
SERIES_STEP = 5                # keep every 5th trading day (~weekly) to keep files small
SECTOR_SERIES_WINDOW = 120
MOVERS_COUNT = 5
JSON_DECIMALS = 4

# --------------------------------------------------------------------------- #
# Price-limit study (LIMT page)
# --------------------------------------------------------------------------- #
MAIN_MARKET_FILE = ROOT / "pipeline" / "data" / "main_market.csv"
# The study starts when the 2017 tick-size schedule took effect. The schedule
# before it isn't clearly documented, and tick sizes decide what counts as a
# close "at the limit".
LIMITS_START = "2017-06-04"
# Tadawul tick sizes (SAR), as (effective_from, [(price_below, tick), ...]).
# Sources: Argaam, 23 May 2017 (effective 4 Jun 2017); Saudi Exchange
# announcement reported by EnterpriseAM, 30 Jun 2025 (effective 29 Jun 2025).
TICK_SCHEDULES: tuple[tuple[str, tuple[tuple[float, float], ...]], ...] = (
    ("2017-06-04", ((10.0, 0.01), (25.0, 0.02), (50.0, 0.05), (100.0, 0.10), (float("inf"), 0.20))),
    ("2025-06-29", ((25.0, 0.01), (50.0, 0.02), (100.0, 0.05), (250.0, 0.10), (500.0, 0.20), (float("inf"), 0.50))),
)
# A close counts as "at the limit" when it is within one tick of ±PRICE_LIMIT,
# because limit prices are rounded to the tick grid.
LIMIT_NEAR_MISS = 0.08         # closes between 8% and the limit, never touching it: the comparison group
LIMIT_HORIZONS: tuple[int, ...] = (1, 2, 3, 5, 10)
LIMIT_CAR_WINDOW = (-5, 10)    # days around the event for the average path chart
LIMIT_LISTING_EXCLUDE_DAYS = 10  # skip a stock's first sessions (wider IPO limits)
LIMIT_LIQUIDITY_LOOKBACK = 60  # trading days of traded value for the liquidity tiers
LIMIT_LIQUIDITY_MIN_OBS = 20
LIMIT_BOOTSTRAP = 2000         # resamples for confidence intervals (resampling dates)
LIMIT_BOOTSTRAP_SEED = 11
LIMIT_HOLD_DAYS = 5            # backtest holding period
LIMIT_COST_BPS = 15            # per side, in basis points  # TODO: set to your broker's commission incl. VAT
LIMIT_LOG_ROWS = 400           # recent events kept for the event log
LIMIT_SERIES_STEP = 5          # keep every 5th point of backtest equity curves

# --------------------------------------------------------------------------- #
# Synthetic demo data (python -m pipeline.export --synthetic)
# --------------------------------------------------------------------------- #
SYNTHETIC_START = "2019-01-01"
SYNTHETIC_SEED = 7


# --------------------------------------------------------------------------- #
# Universe
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Sector:
    """A Tadawul sector with English and Arabic labels."""

    key: str
    name_en: str
    name_ar: str


@dataclass(frozen=True)
class Stock:
    """One stock in the research universe."""

    ticker: str
    name_en: str
    name_ar: str
    sector: str
    shariah: bool


SECTORS: dict[str, Sector] = {
    s.key: s
    for s in (
        Sector("energy", "Energy", "الطاقة"),
        Sector("materials", "Materials", "المواد الأساسية"),
        Sector("banks", "Banks", "البنوك"),
        Sector("telecom", "Telecommunication", "الاتصالات"),
        Sector("utilities", "Utilities", "المرافق العامة"),
        Sector("healthcare", "Health Care", "الرعاية الصحية"),
        Sector("pharma", "Pharma & Biotech", "الأدوية"),
        Sector("food", "Food & Beverages", "إنتاج الأغذية"),
        Sector("staples_retail", "Consumer Staples Retail", "تجزئة السلع الأساسية"),
        Sector("discretionary_retail", "Consumer Discretionary Retail", "تجزئة السلع الكمالية"),
        Sector("real_estate", "Real Estate", "إدارة وتطوير العقارات"),
        Sector("insurance", "Insurance", "التأمين"),
        Sector("financials", "Financial Services", "الخدمات المالية"),
        Sector("capital_goods", "Capital Goods", "السلع الرأسمالية"),
        Sector("transport", "Transportation", "النقل"),
        Sector("software", "Software & Services", "التطبيقات وخدمات التقنية"),
    )
}

UNIVERSE: tuple[Stock, ...] = (
    # Energy
    Stock("2222.SR", "Saudi Aramco", "أرامكو السعودية", "energy", True),
    Stock("2030.SR", "Saudi Arabia Refineries", "المصافي", "energy", True),  # TODO: verify Shariah
    Stock("2380.SR", "Petro Rabigh", "بترو رابغ", "energy", True),  # TODO: verify Shariah (high leverage)
    Stock("2381.SR", "Arabian Drilling", "الحفر العربية", "energy", True),  # TODO: verify ticker (listed 2023)
    Stock("2382.SR", "ADES Holding", "أديس", "energy", True),  # TODO: verify ticker (listed 2023)
    Stock("4030.SR", "Bahri", "البحري", "energy", True),  # TODO: verify sector (Energy vs Transportation)
    # Materials
    Stock("2010.SR", "SABIC", "سابك", "materials", True),
    Stock("1211.SR", "Ma'aden", "معادن", "materials", True),
    Stock("2020.SR", "SABIC Agri-Nutrients", "سابك للمغذيات الزراعية", "materials", True),
    Stock("2350.SR", "Saudi Kayan", "كيان السعودية", "materials", True),
    Stock("2290.SR", "Yansab", "ينساب", "materials", True),
    Stock("2310.SR", "Sipchem", "سبكيم العالمية", "materials", True),
    Stock("2060.SR", "Tasnee", "التصنيع", "materials", True),  # TODO: verify Shariah
    Stock("2330.SR", "Advanced Petrochemical", "المتقدمة", "materials", True),
    Stock("3030.SR", "Saudi Cement", "اسمنت السعودية", "materials", True),
    Stock("3020.SR", "Yamama Cement", "اسمنت اليمامة", "materials", True),
    Stock("3050.SR", "Southern Province Cement", "اسمنت الجنوب", "materials", True),
    # Banks: Islamic banks True, conventional banks False by default
    Stock("1120.SR", "Al Rajhi Bank", "الراجحي", "banks", True),
    Stock("1180.SR", "Saudi National Bank", "الأهلي", "banks", False),  # TODO: verify Shariah
    Stock("1010.SR", "Riyad Bank", "بنك الرياض", "banks", False),  # TODO: verify Shariah
    Stock("1060.SR", "Saudi Awwal Bank", "البنك الأول", "banks", False),  # TODO: verify Shariah
    Stock("1050.SR", "Banque Saudi Fransi", "البنك السعودي الفرنسي", "banks", False),  # TODO: verify Shariah
    Stock("1080.SR", "Arab National Bank", "البنك العربي الوطني", "banks", False),  # TODO: verify Shariah
    Stock("1150.SR", "Alinma Bank", "مصرف الإنماء", "banks", True),
    Stock("1140.SR", "Bank Albilad", "بنك البلاد", "banks", True),
    Stock("1020.SR", "Bank Aljazira", "بنك الجزيرة", "banks", True),
    Stock("1030.SR", "Saudi Investment Bank", "البنك السعودي للاستثمار", "banks", False),  # TODO: verify Shariah
    # Telecommunication
    Stock("7010.SR", "stc", "اس تي سي", "telecom", True),
    Stock("7020.SR", "Mobily", "موبايلي", "telecom", True),  # TODO: verify Shariah
    Stock("7030.SR", "Zain KSA", "زين السعودية", "telecom", True),  # TODO: verify Shariah (leverage)
    # Utilities
    Stock("5110.SR", "Saudi Electricity", "كهرباء السعودية", "utilities", False),  # TODO: verify Shariah (leverage)
    Stock("2082.SR", "ACWA Power", "أكوا باور", "utilities", True),  # TODO: verify Shariah
    Stock("2083.SR", "Marafiq", "مرافق", "utilities", True),  # TODO: verify ticker and Shariah
    # Health care and pharma
    Stock("4013.SR", "Dr. Sulaiman Al Habib", "سليمان الحبيب", "healthcare", True),
    Stock("4002.SR", "Mouwasat", "المواساة", "healthcare", True),
    Stock("4004.SR", "Dallah Healthcare", "دله الصحية", "healthcare", True),
    Stock("4007.SR", "Al Hammadi", "الحمادي", "healthcare", True),
    Stock("2070.SR", "SPIMACO", "الدوائية", "pharma", True),
    # Food & beverages
    Stock("2280.SR", "Almarai", "المراعي", "food", True),
    Stock("2050.SR", "Savola", "صافولا", "food", True),  # TODO: verify sector (holding company)
    Stock("2270.SR", "SADAFCO", "سدافكو", "food", True),
    # Consumer staples retail
    Stock("4001.SR", "Abdullah Al Othaim Markets", "أسواق العثيم", "staples_retail", True),
    Stock("4164.SR", "Nahdi Medical", "النهدي", "staples_retail", True),  # TODO: verify sector
    Stock("4161.SR", "BinDawood", "بن داود", "staples_retail", True),
    # Consumer discretionary retail
    Stock("4190.SR", "Jarir Marketing", "جرير", "discretionary_retail", True),
    Stock("4003.SR", "United Electronics (eXtra)", "إكسترا", "discretionary_retail", True),
    # Real estate
    Stock("4300.SR", "Dar Al Arkan", "دار الأركان", "real_estate", True),  # TODO: verify Shariah
    Stock("4020.SR", "Saudi Real Estate", "العقارية", "real_estate", True),
    Stock("4250.SR", "Jabal Omar", "جبل عمر", "real_estate", True),  # TODO: verify Shariah (leverage)
    Stock("4322.SR", "Retal Urban Development", "رتال", "real_estate", True),
    Stock("4321.SR", "Cenomi Centers", "سينومي سنترز", "real_estate", True),  # TODO: verify Shariah
    # Insurance
    Stock("8210.SR", "Bupa Arabia", "بوبا العربية", "insurance", True),
    Stock("8010.SR", "Tawuniya", "التعاونية", "insurance", True),
    # Financial services
    Stock("1111.SR", "Saudi Tadawul Group", "مجموعة تداول السعودية", "financials", True),  # TODO: verify Shariah
    Stock("4280.SR", "Kingdom Holding", "المملكة القابضة", "financials", False),  # TODO: verify sector and Shariah
    # Capital goods
    Stock("4142.SR", "Riyadh Cables", "كابلات الرياض", "capital_goods", True),
    Stock("2320.SR", "Al Babtain Power & Telecom", "البابطين", "capital_goods", True),  # TODO: verify Shariah
    # Transportation
    Stock("4031.SR", "Saudi Ground Services", "الخدمات الأرضية", "transport", True),
    Stock("4263.SR", "SAL Saudi Logistics", "سال", "transport", True),  # TODO: verify ticker
    # Software & services
    Stock("7203.SR", "Elm", "علم", "software", True),
    Stock("7202.SR", "Arabian Internet & Communications", "حلول", "software", True),  # TODO: verify Arabic short name
)


def stock_by_ticker() -> dict[str, Stock]:
    """Return the universe keyed by ticker."""
    return {s.ticker: s for s in UNIVERSE}
