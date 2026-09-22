"""Download, clean, cache and align price data.

Flow
----
1. ``download_raw`` pulls daily bars from Yahoo Finance (with retries and a
   short-lived CSV cache). A failed ticker returns ``None``; it never raises.
2. ``clean_series`` removes bad values, off-calendar rows, zero-volume days and
   one-day bad prints, and flags moves beyond the Tadawul price limit.
3. ``build_calendar`` derives the Saudi trading calendar (Sun–Thu) from the
   TASI index plus dates most of the universe traded on.
4. ``align_to_calendar`` reindexes each stock onto that calendar and
   forward-fills only short gaps.

Everything that was changed is recorded in a ``CleaningReport`` so the site
can show what the pipeline did to the data.
"""
from __future__ import annotations

import logging
import time
from dataclasses import asdict, dataclass, field
from typing import Callable, Literal

import numpy as np
import pandas as pd

from pipeline import config

log = logging.getLogger(__name__)

Kind = Literal["equity", "index", "oil"]
RawSource = Callable[[str], "pd.DataFrame | None"]


# --------------------------------------------------------------------------- #
# Data containers
# --------------------------------------------------------------------------- #
@dataclass
class CleaningReport:
    """What the cleaning step did to one ticker."""

    ticker: str
    kind: str
    status: str = "ok"  # ok | short_history | failed
    raw_rows: int = 0
    clean_rows: int = 0
    dropped_bad_values: int = 0
    dropped_off_calendar: int = 0
    dropped_zero_volume: int = 0
    bad_prints_removed: int = 0
    suspicious_moves: list[dict] = field(default_factory=list)
    forward_filled: int = 0
    long_gaps: int = 0
    first_date: str | None = None
    last_date: str | None = None
    message: str = ""

    def to_dict(self) -> dict:
        """Return a JSON-serialisable dict."""
        return asdict(self)


@dataclass
class MarketData:
    """Cleaned, calendar-aligned market data used by every analysis module.

    Attributes:
        calendar: Saudi trading days (Sun–Thu), ascending.
        close: Adjusted closes, one column per ticker, short gaps filled.
        volume: Volumes; NaN on filled or missing days.
        observed: True where the close is an original (not filled) observation.
        return_ok: True where the daily return ending on that date is usable:
            both endpoints observed and the move was not flagged.
        dividends: Cash dividends per share on ex-dates (0 elsewhere).
        index_close: TASI on the calendar, short gaps filled.
        index_return_ok: Same meaning as ``return_ok`` for the index.
        index_ohlc: TASI open/high/low/close on observed calendar days only
            (no filling), for candlestick charts.
        oil_close: Brent on its own (Mon–Fri) calendar, or None if unavailable.
        reports: Cleaning report per ticker, including failed downloads.
        synthetic: True when the data was generated, not downloaded.
        index_source: "yahoo" for real TASI data, "proxy" for the equal-weighted
            stand-in used when Yahoo's TASI history is too short.
        warnings: Plain-language problems the site should show.
    """

    calendar: pd.DatetimeIndex
    close: pd.DataFrame
    volume: pd.DataFrame
    observed: pd.DataFrame
    return_ok: pd.DataFrame
    dividends: pd.DataFrame
    index_close: pd.Series
    index_return_ok: pd.Series
    index_ohlc: pd.DataFrame
    oil_close: pd.Series | None
    reports: dict[str, CleaningReport]
    synthetic: bool = False
    index_source: str = "yahoo"  # "yahoo" or "proxy"
    warnings: list[str] = field(default_factory=list)

    @property
    def tickers(self) -> list[str]:
        """Tickers that made it through download and cleaning."""
        return list(self.close.columns)


# --------------------------------------------------------------------------- #
# Download with cache
# --------------------------------------------------------------------------- #
def _cache_path(ticker: str):
    safe = ticker.replace("^", "_").replace("=", "_").replace("/", "_")
    return config.CACHE_DIR / f"{safe}.csv"


def _normalize_yahoo(df: pd.DataFrame) -> pd.DataFrame:
    """Turn a yfinance frame into a naive-date index with standard columns."""
    idx = pd.DatetimeIndex(df.index)
    if idx.tz is not None:
        # Keep the exchange's wall-clock date, then drop the time zone.
        idx = idx.tz_localize(None)
    df = df.copy()
    df.index = idx.normalize()
    df.index.name = "date"
    keep = [c for c in ("Open", "High", "Low", "Close", "Volume", "Dividends") if c in df.columns]
    df = df[keep]
    df = df[~df.index.duplicated(keep="last")].sort_index()
    return df


def download_raw(ticker: str, start: str = config.START_DATE, use_cache: bool = True) -> pd.DataFrame | None:
    """Download daily adjusted bars for one ticker.

    Args:
        ticker: Yahoo ticker, e.g. ``"2222.SR"``.
        start: First date to request.
        use_cache: Reuse a cached CSV younger than ``CACHE_TTL_HOURS``.

    Returns:
        DataFrame indexed by date, or ``None`` if every attempt failed.
    """
    path = _cache_path(ticker)
    if use_cache and path.exists():
        age_h = (time.time() - path.stat().st_mtime) / 3600
        if age_h < config.CACHE_TTL_HOURS:
            log.debug("cache hit %s (%.1fh old)", ticker, age_h)
            return pd.read_csv(path, index_col=0, parse_dates=True)

    import yfinance as yf  # imported lazily so tests and synthetic runs don't need network

    for attempt in range(1, config.DOWNLOAD_RETRIES + 1):
        try:
            df = yf.Ticker(ticker).history(start=start, auto_adjust=True, actions=True)
            if df is None or df.empty or "Close" not in df.columns:
                raise ValueError("empty response")
            df = _normalize_yahoo(df)
            path.parent.mkdir(parents=True, exist_ok=True)
            df.to_csv(path)
            time.sleep(config.PAUSE_BETWEEN_TICKERS_SECONDS)
            return df
        except Exception as exc:  # noqa: BLE001 - any failure is retried then logged
            log.warning("download %s failed (attempt %d/%d): %s", ticker, attempt, config.DOWNLOAD_RETRIES, exc)
            time.sleep(config.RETRY_BACKOFF_SECONDS * attempt)
    log.error("giving up on %s", ticker)
    return None


# --------------------------------------------------------------------------- #
# Cleaning
# --------------------------------------------------------------------------- #
def _move_threshold(kind: Kind) -> float:
    if kind == "oil":
        return config.OIL_SUSPICIOUS_MOVE
    return config.PRICE_LIMIT + config.PRICE_LIMIT_TOLERANCE


def _remove_bad_prints(close: pd.Series, threshold: float) -> tuple[pd.Series, list[pd.Timestamp]]:
    """Remove single-day spikes that reverse the next day.

    A print is treated as bad when the move into it and the move out of it both
    exceed ``threshold`` in opposite directions. That pattern can't come from a
    legitimate limit move followed by trading, but it is exactly what a stray
    bad tick on Yahoo looks like.
    """
    r = close.pct_change()
    r_next = r.shift(-1)
    bad = (r.abs() > threshold) & (r_next.abs() > threshold) & (np.sign(r) != np.sign(r_next))
    dates = list(close.index[bad.fillna(False).to_numpy()])
    return close[~bad.fillna(False)], dates


def clean_series(
    raw: pd.DataFrame, ticker: str, kind: Kind, drop_date: pd.Timestamp | None = None
) -> tuple[pd.DataFrame, CleaningReport]:
    """Clean one ticker's raw bars (before calendar alignment).

    Steps: drop non-finite or non-positive closes; for Saudi instruments drop
    rows that fall outside Sun–Thu; for equities drop zero-volume days; remove
    one-day bad prints; flag remaining moves beyond the price limit.

    Args:
        drop_date: A date whose row should be removed first (an unfinished
            trading session; see ``incomplete_session_date``).

    Returns:
        The cleaned frame (with a boolean ``suspicious`` column) and a report.
    """
    rep = CleaningReport(ticker=ticker, kind=kind, raw_rows=len(raw))
    df = raw.copy()
    if drop_date is not None and kind != "oil":
        df = df[df.index != drop_date]

    bad = ~np.isfinite(df["Close"].astype(float)) | (df["Close"] <= 0)
    rep.dropped_bad_values = int(bad.sum())
    df = df[~bad]

    if kind in ("equity", "index"):
        off = ~df.index.dayofweek.isin(config.SAUDI_TRADING_WEEKDAYS)
        rep.dropped_off_calendar = int(off.sum())
        df = df[~off]

    if kind == "equity" and config.DROP_ZERO_VOLUME and "Volume" in df.columns:
        zero = df["Volume"].fillna(0) <= 0
        rep.dropped_zero_volume = int(zero.sum())
        df = df[~zero]

    threshold = _move_threshold(kind)
    kept_close, bad_dates = _remove_bad_prints(df["Close"], threshold)
    rep.bad_prints_removed = len(bad_dates)
    df = df.loc[kept_close.index].copy()

    r = df["Close"].pct_change()
    suspicious = r.abs() > threshold
    df["suspicious"] = suspicious.fillna(False)
    rep.suspicious_moves = [
        {"date": d.strftime("%Y-%m-%d"), "return": round(float(v), 4)} for d, v in r[suspicious].items()
    ]

    rep.clean_rows = len(df)
    if len(df):
        rep.first_date = df.index[0].strftime("%Y-%m-%d")
        rep.last_date = df.index[-1].strftime("%Y-%m-%d")
    for d in bad_dates:
        log.debug("%s: removed bad print on %s", ticker, d.date())
    for m in rep.suspicious_moves:
        log.debug("%s: flagged %+.1f%% move on %s", ticker, 100 * m["return"], m["date"])
    return df, rep


def fill_short_gaps(s: pd.Series, max_gap: int) -> tuple[pd.Series, pd.Series, int]:
    """Forward-fill interior gaps of at most ``max_gap`` consecutive NaNs.

    Gaps longer than ``max_gap`` are left entirely empty (not partly filled),
    and so are leading and trailing gaps: filling a trailing gap would invent a
    stale price for a day the stock may simply not have been updated for yet.

    Returns:
        (filled series, boolean mask of filled positions, number of long gaps)
    """
    isna = s.isna()
    if s.notna().sum() == 0:
        return s, pd.Series(False, index=s.index), 0
    first, last = s.first_valid_index(), s.last_valid_index()
    interior = (s.index > first) & (s.index < last)
    run_id = (isna != isna.shift()).cumsum()
    run_len = isna.groupby(run_id).transform("sum")
    fillable = isna & interior & (run_len <= max_gap)
    filled = s.ffill().where(fillable | ~isna)
    long_runs = run_id[isna & interior & (run_len > max_gap)].nunique()
    return filled, fillable, int(long_runs)


def build_calendar(index_dates: pd.DatetimeIndex, equity_dates: list[pd.DatetimeIndex]) -> pd.DatetimeIndex:
    """Build the Saudi trading calendar.

    Uses every Sun–Thu date on which at least ``CALENDAR_MIN_COVERAGE`` of the
    universe has a cleaned observation, plus every TASI date. The calendar
    starts at the earliest such busy date, so it doesn't depend on how much
    index history Yahoo returns.
    """
    counts = (
        pd.Series(np.concatenate([np.asarray(d) for d in equity_dates])).value_counts()
        if equity_dates else pd.Series(dtype=int)
    )
    n = max(len(equity_dates), 1)
    busy = counts.index[(counts / n) >= config.CALENDAR_MIN_COVERAGE]
    cal = pd.DatetimeIndex(index_dates).union(pd.DatetimeIndex(busy))
    cal = cal[cal.dayofweek.isin(config.SAUDI_TRADING_WEEKDAYS)]
    starts = [d for d in (busy.min() if len(busy) else None, pd.DatetimeIndex(index_dates).min() if len(index_dates) else None) if d is not None and not pd.isna(d)]
    if not starts:
        return pd.DatetimeIndex([])
    return cal[cal >= min(starts)].sort_values()


def incomplete_session_date(now: pd.Timestamp | None = None) -> pd.Timestamp | None:
    """Today's date in Riyadh if its session isn't final yet, else None.

    A run before ``SESSION_FINAL_TIME`` on a trading day would otherwise treat
    the partial session as a closing price.
    """
    now = now if now is not None else pd.Timestamp.now(tz=config.RIYADH_TZ)
    if now.tzinfo is None:
        now = now.tz_localize(config.RIYADH_TZ)
    local = now.tz_convert(config.RIYADH_TZ)
    hh, mm = (int(x) for x in config.SESSION_FINAL_TIME.split(":"))
    if local.dayofweek in config.SAUDI_TRADING_WEEKDAYS and (local.hour, local.minute) < (hh, mm):
        return local.normalize().tz_localize(None)
    return None


def equal_weight_proxy(close: pd.DataFrame, return_ok: pd.DataFrame, anchor: float | None) -> tuple[pd.Series, pd.Series]:
    """Equal-weighted index of the universe, used when TASI history is missing.

    Daily return = mean of usable stock log returns (needs ``PROXY_MIN_STOCKS``).
    The level is scaled so its last value equals ``anchor`` (the real TASI's
    latest close) when given, otherwise it ends at 1000.

    Returns:
        (level series, boolean mask of days with a usable proxy return)
    """
    r = np.log(close).diff().where(return_ok)
    enough = r.notna().sum(axis=1) >= config.PROXY_MIN_STOCKS
    mean_r = r.mean(axis=1).where(enough)
    cum = mean_r.fillna(0).cumsum()
    end = anchor if anchor and np.isfinite(anchor) else 1000.0
    level = end * np.exp(cum - cum.iloc[-1])
    first = enough.idxmax() if enough.any() else None
    if first is not None:
        level[level.index < first] = np.nan
    return level, enough


def align_to_calendar(
    df: pd.DataFrame, calendar: pd.DatetimeIndex, rep: CleaningReport
) -> dict[str, pd.Series]:
    """Reindex a cleaned frame onto the calendar and fill short gaps.

    Returns a dict with ``close``, ``volume``, ``observed``, ``return_ok`` and
    ``dividends`` series, all indexed by ``calendar``.
    """
    off = ~df.index.isin(calendar)
    if off.any():
        rep.dropped_off_calendar += int(off.sum())
        df = df[~off]

    close = df["Close"].reindex(calendar)
    observed = close.notna()
    close_f, filled, long_gaps = fill_short_gaps(close, config.MAX_FFILL_DAYS)
    rep.forward_filled = int(filled.sum())
    rep.long_gaps = long_gaps

    suspicious = df["suspicious"].reindex(calendar, fill_value=False).astype(bool)
    return_ok = observed & observed.shift(1, fill_value=False) & ~suspicious

    volume = df["Volume"].reindex(calendar) if "Volume" in df.columns else pd.Series(np.nan, index=calendar)
    divs = df["Dividends"].reindex(calendar).fillna(0.0) if "Dividends" in df.columns else pd.Series(0.0, index=calendar)

    if int(observed.sum()) < config.MIN_HISTORY_DAYS:
        rep.status = "short_history"
    return {"close": close_f, "volume": volume, "observed": observed, "return_ok": return_ok, "dividends": divs}


def _ohlc(df: pd.DataFrame, calendar: pd.DatetimeIndex) -> pd.DataFrame:
    """OHLC on calendar dates, with high/low widened to contain open and close.

    Yahoo sometimes reports a TASI high or low that doesn't contain the open or
    close; widening keeps candles well-formed without inventing new extremes.
    """
    cols = ["Open", "High", "Low", "Close"]
    if not set(cols) <= set(df.columns):
        c = df["Close"]
        out = pd.DataFrame({k: c for k in cols})
    else:
        out = df[cols].astype(float).copy()
        out["Open"] = out["Open"].where(out["Open"] > 0, out["Close"])
        out["High"] = out[["High", "Open", "Close"]].max(axis=1)
        out["Low"] = out[["Low", "Open", "Close"]].min(axis=1)
    return out[out.index.isin(calendar)].dropna()


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
def load_market_data(use_cache: bool = True, source: RawSource | None = None, synthetic: bool = False) -> MarketData:
    """Download (or generate), clean and align everything.

    Args:
        use_cache: Pass through to ``download_raw``.
        source: Optional function ticker -> raw frame; defaults to Yahoo.
        synthetic: Only used to label the result.

    Raises:
        RuntimeError: if the TASI index can't be loaded, since the calendar and
            market betas depend on it. Individual stocks and Brent may fail
            without stopping the run.
    """
    if source is None:
        def source(t: str) -> pd.DataFrame | None:  # noqa: E306
            return download_raw(t, use_cache=use_cache)

    reports: dict[str, CleaningReport] = {}
    warnings: list[str] = []
    drop_date = None if synthetic else incomplete_session_date()
    if drop_date is not None:
        log.info("run during trading hours: ignoring the unfinished %s session", drop_date.date())

    # Index. Missing or short history is handled below with a proxy.
    raw_idx = source(config.INDEX_TICKER)
    if raw_idx is None or raw_idx.empty:
        raw_idx = pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"], index=pd.DatetimeIndex([]), dtype=float)
    idx_df, idx_rep = clean_series(raw_idx, config.INDEX_TICKER, "index", drop_date)
    reports[config.INDEX_TICKER] = idx_rep

    # Brent (optional)
    oil_close: pd.Series | None = None
    raw_oil = source(config.OIL_TICKER)
    if raw_oil is None or raw_oil.empty:
        reports[config.OIL_TICKER] = CleaningReport(config.OIL_TICKER, "oil", status="failed", message="download failed")
        log.error("Brent unavailable; oil betas will be empty")
    else:
        oil_df, oil_rep = clean_series(raw_oil, config.OIL_TICKER, "oil")
        oil_close = oil_df["Close"].astype(float)
        reports[config.OIL_TICKER] = oil_rep

    # Equities (each may fail independently)
    cleaned: dict[str, pd.DataFrame] = {}
    for stock in config.UNIVERSE:
        try:
            raw = source(stock.ticker)
            if raw is None or raw.empty:
                reports[stock.ticker] = CleaningReport(stock.ticker, "equity", status="failed", message="download failed")
                continue
            df, rep = clean_series(raw, stock.ticker, "equity", drop_date)
            if df.empty:
                rep.status, rep.message = "failed", "no rows left after cleaning"
                reports[stock.ticker] = rep
                continue
            cleaned[stock.ticker] = df
            reports[stock.ticker] = rep
        except Exception as exc:  # noqa: BLE001 - one ticker must never break the run
            log.exception("unexpected error on %s", stock.ticker)
            reports[stock.ticker] = CleaningReport(stock.ticker, "equity", status="failed", message=str(exc))

    if not cleaned:
        raise RuntimeError("No stock in the universe could be loaded; check the Yahoo connection.")
    calendar = build_calendar(idx_df.index, [d.index for d in cleaned.values()])
    log.info("calendar: %d Saudi trading days, %s to %s", len(calendar), calendar[0].date(), calendar[-1].date())

    cols: dict[str, dict[str, pd.Series]] = {}
    for t, df in cleaned.items():
        cols[t] = align_to_calendar(df, calendar, reports[t])

    def frame(key: str) -> pd.DataFrame:
        return pd.DataFrame({t: c[key] for t, c in cols.items()}, index=calendar)

    close, return_ok = frame("close"), frame("return_ok").astype(bool)

    # TASI, or an equal-weighted proxy if Yahoo's history is too short.
    index_source = "yahoo"
    if len(idx_df):
        idx_aligned = align_to_calendar(idx_df, calendar, idx_rep)
        idx_close, idx_ok = idx_aligned["close"], idx_aligned["return_ok"]
        n_idx = int(idx_aligned["observed"].sum())
    else:
        idx_close, idx_ok, n_idx = pd.Series(np.nan, index=calendar), pd.Series(False, index=calendar), 0
    idx_rep.status = "ok" if n_idx >= config.INDEX_MIN_HISTORY_DAYS else "short_history"
    index_ohlc = _ohlc(idx_df, calendar) if len(idx_df) else pd.DataFrame(columns=["Open", "High", "Low", "Close"])
    if n_idx < config.INDEX_MIN_HISTORY_DAYS:
        anchor = float(idx_df["Close"].iloc[-1]) if len(idx_df) else None
        idx_close, idx_ok = equal_weight_proxy(close, return_ok, anchor)
        index_source = "proxy"
        index_ohlc = pd.DataFrame(columns=["Open", "High", "Low", "Close"])
        msg = (f"Yahoo returned only {n_idx} day(s) of {config.INDEX_TICKER} history. TASI is shown as an "
               f"equal-weighted index of the {len(cleaned)} stocks, scaled to end at the latest TASI close, "
               f"and market betas are measured against it.")
        idx_rep.message = msg
        warnings.append(msg)
        log.warning(msg)

    ok = sum(r.status != "failed" for t, r in reports.items() if t in {s.ticker for s in config.UNIVERSE})
    log.info("universe: %d/%d stocks loaded", ok, len(config.UNIVERSE))
    return MarketData(
        calendar=calendar,
        close=frame("close"),
        volume=frame("volume"),
        observed=frame("observed").astype(bool),
        return_ok=return_ok,
        dividends=frame("dividends"),
        index_close=idx_close,
        index_return_ok=idx_ok,
        index_ohlc=index_ohlc,
        oil_close=oil_close,
        reports=reports,
        synthetic=synthetic,
        index_source=index_source,
        warnings=warnings,
    )


# --------------------------------------------------------------------------- #
# Synthetic data (for local development and CI without network access)
# --------------------------------------------------------------------------- #
_SECTOR_OIL_LOADING = {
    "energy": 0.55, "materials": 0.45, "banks": 0.15, "utilities": 0.10, "insurance": 0.05,
    "real_estate": 0.12, "capital_goods": 0.20, "transport": 0.15,
}


def synthetic_source(seed: int = config.SYNTHETIC_SEED) -> RawSource:
    """Return a ``source`` function that generates realistic-looking raw data.

    Brent is generated on a Mon–Fri calendar and stocks on Sun–Thu, with
    sector-dependent oil and market loadings. A few zero-volume days, a bad
    print and a limit move are injected so the cleaning step has work to do.
    """
    rng = np.random.default_rng(seed)
    days = pd.date_range(config.SYNTHETIC_START, pd.Timestamp.today().normalize(), freq="D")
    oil_days = days[days.dayofweek < 5]
    sa_days = days[days.dayofweek.isin(config.SAUDI_TRADING_WEEKDAYS)]

    oil_r = pd.Series(rng.normal(0.0002, 0.022, len(oil_days)), index=oil_days)
    oil_px = 70 * np.exp(oil_r.cumsum())
    # Brent move as seen from each Saudi date (as-of alignment)
    oil_on_sa = np.log(oil_px.reindex(oil_px.index.union(sa_days)).ffill().reindex(sa_days)).diff().fillna(0)
    mkt_r = 0.35 * oil_on_sa + pd.Series(rng.normal(0.0002, 0.009, len(sa_days)), index=sa_days)

    frames: dict[str, pd.DataFrame] = {}

    def bars(r: pd.Series, start_px: float, vol_scale: float) -> pd.DataFrame:
        close = start_px * np.exp(r.cumsum())
        opn = close.shift(1).fillna(close.iloc[0]) * np.exp(rng.normal(0, 0.002, len(r)))
        wick = np.abs(rng.normal(0, 0.004, len(r)))
        high = np.maximum(opn, close) * (1 + wick)
        low = np.minimum(opn, close) * (1 - wick)
        vol = rng.lognormal(13, 0.5, len(r)) * vol_scale
        return pd.DataFrame({"Open": opn, "High": high, "Low": low, "Close": close, "Volume": vol,
                             "Dividends": 0.0}, index=r.index)

    frames[config.INDEX_TICKER] = bars(mkt_r, 10000, 1.0)
    frames[config.OIL_TICKER] = bars(oil_r, 70, 0.1)

    for i, s in enumerate(config.UNIVERSE):
        b_oil = _SECTOR_OIL_LOADING.get(s.sector, 0.05) + rng.normal(0, 0.1)
        b_mkt = rng.uniform(0.6, 1.3)
        idio = rng.normal(0, rng.uniform(0.010, 0.020), len(sa_days))
        r = b_mkt * (mkt_r - 0.35 * oil_on_sa) + b_oil * oil_on_sa + idio
        r = r.clip(-0.095, 0.095)
        df = bars(pd.Series(r, index=sa_days), rng.uniform(10, 150), 1.0)
        # listing date variety, zero-volume days, one bad print, one limit move
        df = df.iloc[int(rng.integers(0, 400)):]
        zero = rng.choice(len(df), size=5, replace=False)
        df.iloc[zero, df.columns.get_loc("Volume")] = 0
        if i % 7 == 0:
            j = len(df) // 2
            df.iloc[j, df.columns.get_loc("Close")] *= 1.6
        if i % 11 == 0:
            j = len(df) // 3
            df.iloc[j:, df.columns.get_loc("Close")] *= 0.8  # an unadjusted corporate action
        frames[s.ticker] = df

    def source(ticker: str) -> pd.DataFrame | None:
        return frames.get(ticker)

    return source
