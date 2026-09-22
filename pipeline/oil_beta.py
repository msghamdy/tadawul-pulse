"""Rolling betas of each stock to Brent crude and to TASI.

Both are OLS slopes on daily log returns over rolling windows
(``config.BETA_WINDOWS``).

Market beta
    Univariate regression of the stock's return on the TASI return for the
    same Saudi trading day.

Oil beta
    Tadawul closes at 15:00 Riyadh time (12:00 UTC) while Brent settles around
    19:30 London time, so a Saudi return and the "same-day" Brent return only
    partly overlap. Some of today's Brent move reaches Saudi prices tomorrow.
    With ``OIL_BETA_METHOD = "dimson"`` the stock return is regressed on the
    same-day and prior-day Brent returns and the two slopes are summed
    (Dimson, 1979). ``"same_day"`` gives the plain univariate slope.

Brent trades Mon–Fri and Tadawul Sun–Thu. Brent is aligned "as of" each Saudi
date: the Brent return attached to a Saudi date is the change between the
latest Brent closes on or before the two consecutive Saudi dates. A Sunday
return therefore pairs with Brent's Thursday→Friday move.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from pipeline import config
from pipeline.fetch import MarketData

log = logging.getLogger(__name__)


@dataclass
class OilBetaResult:
    """Output of :func:`compute_oil_betas`.

    Attributes:
        oil: window -> DataFrame (dates x tickers) of rolling oil betas.
        mkt: window -> DataFrame (dates x tickers) of rolling market betas.
        n_obs: window -> DataFrame of usable observations in each window.
        current: one row per ticker with the latest betas per window.
        sector_stats: window -> sector -> summary statistics.
        method: the oil beta method that was used.
    """

    oil: dict[int, pd.DataFrame]
    mkt: dict[int, pd.DataFrame]
    n_obs: dict[int, pd.DataFrame]
    current: pd.DataFrame
    sector_stats: dict[int, dict[str, dict[str, float | int | None]]]
    method: str


# --------------------------------------------------------------------------- #
# Returns
# --------------------------------------------------------------------------- #
def stock_log_returns(md: MarketData) -> pd.DataFrame:
    """Daily log returns, NaN wherever the return is not usable."""
    r = np.log(md.close).diff()
    return r.where(md.return_ok)


def index_log_returns(md: MarketData) -> pd.Series:
    """Daily TASI log returns, NaN wherever the return is not usable."""
    r = np.log(md.index_close).diff()
    return r.where(md.index_return_ok)


def oil_returns_on_calendar(oil_close: pd.Series, calendar: pd.DatetimeIndex) -> pd.DataFrame:
    """Brent log returns aligned to the Saudi calendar.

    Returns:
        DataFrame with ``same_day`` (Brent change over the same interval as the
        Saudi return) and ``prior_day`` (the previous interval's change).
    """
    merged = oil_close.reindex(oil_close.index.union(calendar)).ffill()
    on_cal = merged.reindex(calendar)
    same = np.log(on_cal).diff()
    # Zero change means no new Brent close between the two Saudi dates
    # (e.g. a Brent holiday). Treat it as missing rather than a real 0% move.
    stale = on_cal.eq(on_cal.shift(1))
    same = same.mask(stale)
    return pd.DataFrame({"same_day": same, "prior_day": same.shift(1)}, index=calendar)


# --------------------------------------------------------------------------- #
# Vectorised rolling regressions
# --------------------------------------------------------------------------- #
def _min_obs(window: int) -> int:
    return int(math.ceil(window * config.BETA_MIN_OBS_FRACTION))


def rolling_beta(y: pd.DataFrame, x: pd.Series, window: int, min_obs: int | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Rolling OLS slope of each column of ``y`` on ``x``.

    Only rows where both ``y`` and ``x`` are present enter each window.

    Returns:
        (betas, number of observations used), both shaped like ``y``.
    """
    min_obs = _min_obs(window) if min_obs is None else min_obs
    xb = pd.DataFrame(np.repeat(x.to_numpy()[:, None], y.shape[1], axis=1), index=y.index, columns=y.columns)
    mask = y.notna() & xb.notna()
    Y, X = y.where(mask), xb.where(mask)

    def m(df: pd.DataFrame) -> pd.DataFrame:
        return df.rolling(window, min_periods=min_obs).mean()

    mx, my = m(X), m(Y)
    cov = m(X * Y) - mx * my
    var = m(X * X) - mx * mx
    beta = cov / var.where(var > 1e-12)
    n = mask.astype(float).rolling(window, min_periods=1).sum()
    return beta, n


def rolling_beta_dimson(
    y: pd.DataFrame, x0: pd.Series, x1: pd.Series, window: int, min_obs: int | None = None
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Rolling two-regressor OLS; returns the sum of both slopes.

    Solves the 2x2 normal equations in closed form for every window, which is
    fully vectorised across tickers and dates.
    """
    min_obs = _min_obs(window) if min_obs is None else min_obs

    def bcast(s: pd.Series) -> pd.DataFrame:
        return pd.DataFrame(np.repeat(s.to_numpy()[:, None], y.shape[1], axis=1), index=y.index, columns=y.columns)

    X0, X1 = bcast(x0), bcast(x1)
    mask = y.notna() & X0.notna() & X1.notna()
    Y, X0, X1 = y.where(mask), X0.where(mask), X1.where(mask)

    def m(df: pd.DataFrame) -> pd.DataFrame:
        return df.rolling(window, min_periods=min_obs).mean()

    m0, m1, my = m(X0), m(X1), m(Y)
    s00 = m(X0 * X0) - m0 * m0
    s11 = m(X1 * X1) - m1 * m1
    s01 = m(X0 * X1) - m0 * m1
    s0y = m(X0 * Y) - m0 * my
    s1y = m(X1 * Y) - m1 * my
    det = s00 * s11 - s01 * s01
    det = det.where(det.abs() > 1e-16)
    b0 = (s11 * s0y - s01 * s1y) / det
    b1 = (s00 * s1y - s01 * s0y) / det
    n = mask.astype(float).rolling(window, min_periods=1).sum()
    return b0 + b1, n


# --------------------------------------------------------------------------- #
# Main computation
# --------------------------------------------------------------------------- #
def _latest(df: pd.DataFrame, max_age: int) -> pd.Series:
    """Last non-NaN value per column, or NaN if older than ``max_age`` rows."""
    out = {}
    n = len(df)
    for col in df.columns:
        s = df[col]
        pos = s.notna().to_numpy().nonzero()[0]
        out[col] = s.iloc[pos[-1]] if len(pos) and (n - 1 - pos[-1]) <= max_age else np.nan
    return pd.Series(out, dtype=float)


def compute_oil_betas(md: MarketData, method: str = config.OIL_BETA_METHOD) -> OilBetaResult:
    """Compute rolling oil and market betas for every stock and window."""
    if method not in ("dimson", "same_day"):
        raise ValueError(f"unknown OIL_BETA_METHOD {method!r}")

    y = stock_log_returns(md)
    mkt_x = index_log_returns(md)
    oil_x = (
        oil_returns_on_calendar(md.oil_close, md.calendar)
        if md.oil_close is not None
        else pd.DataFrame({"same_day": np.nan, "prior_day": np.nan}, index=md.calendar)
    )

    oil, mkt, n_obs = {}, {}, {}
    for w in config.BETA_WINDOWS:
        mkt[w], _ = rolling_beta(y, mkt_x, w)
        if method == "dimson":
            oil[w], n_obs[w] = rolling_beta_dimson(y, oil_x["same_day"], oil_x["prior_day"], w)
        else:
            oil[w], n_obs[w] = rolling_beta(y, oil_x["same_day"], w)
        log.info("betas: window %d done", w)

    by_ticker = config.stock_by_ticker()
    rows = pd.DataFrame(index=pd.Index(md.tickers, name="ticker"))
    rows["sector"] = [by_ticker[t].sector for t in rows.index]
    for w in config.BETA_WINDOWS:
        rows[f"oil_{w}"] = _latest(oil[w], config.BETA_STALE_DAYS)
        rows[f"mkt_{w}"] = _latest(mkt[w], config.BETA_STALE_DAYS)
        rows[f"n_{w}"] = n_obs[w].iloc[-1].reindex(rows.index).fillna(0).astype(int)

    sector_stats: dict[int, dict[str, dict[str, float | int | None]]] = {}
    for w in config.BETA_WINDOWS:
        stats: dict[str, dict[str, float | int | None]] = {}
        for sector, g in rows.groupby("sector"):
            o, k = g[f"oil_{w}"].dropna(), g[f"mkt_{w}"].dropna()
            stats[str(sector)] = {
                "oil_mean": float(o.mean()) if len(o) else None,
                "oil_median": float(o.median()) if len(o) else None,
                "mkt_mean": float(k.mean()) if len(k) else None,
                "mkt_median": float(k.median()) if len(k) else None,
                "n": int(max(len(o), len(k))),
            }
        sector_stats[w] = stats

    return OilBetaResult(oil=oil, mkt=mkt, n_obs=n_obs, current=rows, sector_stats=sector_stats, method=method)


def sector_average_series(res: OilBetaResult, window: int) -> pd.DataFrame:
    """Mean rolling oil beta per sector over time (dates x sectors)."""
    by_ticker = config.stock_by_ticker()
    df = res.oil[window]
    groups = pd.Series({t: by_ticker[t].sector for t in df.columns})
    return df.T.groupby(groups).mean().T
