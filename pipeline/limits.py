"""Price-limit behaviour on Tadawul.

What happens to a stock after it closes at, touches, or nearly reaches its
±10% daily price limit?

Definitions (for each stock and trading day t, from actual traded prices):

* Previous close P = close on the previous Saudi trading day. A day is only
  studied if the stock also traded on that previous day, so the limit
  reference is really yesterday's close.
* Limit prices: the highest valid price ≤ P × 1.10 and the lowest valid price
  ≥ P × 0.90, where "valid" means on the tick grid of the price band the limit
  falls in (``config.TICK_SCHEDULES``). From a close of 24.98 (2017 schedule),
  the upper limit is 27.45 on the 0.05 grid, not 27.46.
* If P itself isn't on the tick grid, the history was rescaled by Yahoo for a
  later bonus issue or split and exact limit prices can't be rebuilt. Those
  days fall back to "within one tick of ±10%".
* lock_up    close at the upper limit               (closed locked)
* touch_up   high at the upper limit, close below   (hit the limit, fell back)
* near_up    close ≥ 8% but high below the limit    (comparison group)
* lock_down / touch_down / near_down are the mirror images.

Excluded days: a stock's first ``LIMIT_LISTING_EXCLUDE_DAYS`` sessions (IPO
limits differ), and any move beyond the limit by more than a tick, which
can't come from normal trading. Those are data errors or corporate actions
Yahoo didn't adjust for. An event is also dropped from a horizon if such a
move occurs inside its holding window.

Returns after an event use dividend-adjusted prices:

* cc_ab   close t → close t+h, minus the market's return over the same days
          (market = TASI, or the equal-weighted proxy when TASI is missing).
* oc      open t+1 → close t+h: what a trader could actually get, because a
          stock locked at +10% usually has no sellers at the close.
* gap     close t → open t+1.

Confidence intervals resample event *dates* (not events), because limit
events cluster on the same days (e.g. market-wide sell-offs) and aren't
independent. Nothing on day t uses information after the close of day t.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from pipeline import config
from pipeline.fetch import MarketData, RawStore, incomplete_session_date

log = logging.getLogger(__name__)

CATEGORIES = ("lock_up", "touch_up", "near_up", "lock_down", "touch_down", "near_down")
EPS = 1e-9


# --------------------------------------------------------------------------- #
# Universe and ticks
# --------------------------------------------------------------------------- #
def main_market_universe() -> pd.DataFrame:
    """The study universe: every main-market company in ``MAIN_MARKET_FILE``.

    Arabic names come from the core universe where available.
    """
    df = pd.read_csv(config.MAIN_MARKET_FILE, comment="#", dtype=str)
    core = config.stock_by_ticker()
    df["name_ar"] = [core[t].name_ar if t in core else "" for t in df["ticker"]]
    df["sector"] = [core[t].sector if t in core else "" for t in df["ticker"]]
    return df.drop_duplicates("ticker").reset_index(drop=True)


def limit_prices(prev_close: np.ndarray, dates: pd.DatetimeIndex) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Upper and lower limit levels for each (previous close, date).

    Returns:
        (upper level, lower level, match tolerance in SAR, on_grid mask).
        On-grid rows get exact limit prices and a tolerance of half a tick
        (for float noise). Off-grid rows get P x 1.10 / P x 0.90 and a
        tolerance of one tick.
    """
    prev = np.asarray(prev_close, dtype=float)
    lim = config.PRICE_LIMIT
    tick_prev = tick_size(prev, dates)
    with np.errstate(invalid="ignore", divide="ignore"):
        units = prev / tick_prev
        on_grid = np.abs(units - np.round(units)) < 1e-4
        raw_up, raw_dn = prev * (1 + lim), prev * (1 - lim)
        t_up = tick_size(raw_up, dates)
        t_dn = tick_size(raw_dn, dates)
        up_exact = np.floor(raw_up / t_up + 1e-9) * t_up
        dn_exact = np.ceil(raw_dn / t_dn - 1e-9) * t_dn
    up = np.where(on_grid, up_exact, raw_up)
    dn = np.where(on_grid, dn_exact, raw_dn)
    tol = np.where(on_grid, 0.5 * tick_prev, tick_prev)
    return up, dn, tol, on_grid


def tick_size(price: np.ndarray, dates: pd.DatetimeIndex) -> np.ndarray:
    """Tick size for each (previous close, date) pair.

    Dates before the first schedule get NaN (outside the study period).
    """
    price = np.asarray(price, dtype=float)
    out = np.full(price.shape, np.nan)
    dates = pd.DatetimeIndex(dates)
    schedules = [(pd.Timestamp(d), bands) for d, bands in config.TICK_SCHEDULES]
    for i, (start, bands) in enumerate(schedules):
        end = schedules[i + 1][0] if i + 1 < len(schedules) else pd.Timestamp.max
        in_period = (dates >= start) & (dates < end)
        lower = -np.inf
        for upper, tick in bands:
            m = in_period & (price >= lower) & (price < upper)
            out[m] = tick
            lower = upper
    return out


# --------------------------------------------------------------------------- #
# Per-stock panel
# --------------------------------------------------------------------------- #
@dataclass
class Panel:
    """Calendar-aligned arrays for all study stocks (dates x tickers)."""

    dates: pd.DatetimeIndex
    tickers: list[str]
    open: np.ndarray         # actual traded prices
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    volume: np.ndarray
    adj_open: np.ndarray     # dividend-adjusted, for returns
    adj_close: np.ndarray
    obs: np.ndarray          # bool: traded that day with clean data
    repaired: int            # rows where high/low were widened to contain open/close
    failed: list[str]


def build_panel(
    store: RawStore, tickers: list[str], calendar: pd.DatetimeIndex, drop_date: pd.Timestamp | None = None
) -> Panel:
    """Load raw bars for every ticker and align them to the Saudi calendar.

    Zero-volume days, Friday/Saturday rows, non-positive prices and the
    unfinished current session are dropped. No gaps are filled: a limit study
    must only use days on which the stock really traded.
    """
    cal = calendar[calendar >= pd.Timestamp(config.LIMITS_START) - pd.Timedelta(days=120)]
    n, k = len(cal), len(tickers)
    arr = {c: np.full((n, k), np.nan) for c in ("open", "high", "low", "close", "volume", "adj_open", "adj_close")}
    repaired, failed, kept = 0, [], []

    for j, t in enumerate(tickers):
        raw = store.get(t)
        if raw is None or raw.empty or not {"Open", "High", "Low", "Close", "Volume"} <= set(raw.columns):
            failed.append(t)
            continue
        df = raw.copy()
        df = df[df.index.dayofweek.isin(config.SAUDI_TRADING_WEEKDAYS)]
        if drop_date is not None:
            df = df[df.index != drop_date]
        px = df[["Open", "High", "Low", "Close"]].astype(float)
        good = np.isfinite(px).all(axis=1) & (px > 0).all(axis=1) & (df["Volume"].fillna(0) > 0)
        df = df[good]
        if df.empty:
            failed.append(t)
            continue
        hi = df[["High", "Open", "Close"]].max(axis=1)
        lo = df[["Low", "Open", "Close"]].min(axis=1)
        repaired += int((hi > df["High"]).sum() + (lo < df["Low"]).sum())
        factor = (df["Adj Close"] / df["Close"]) if "Adj Close" in df.columns else pd.Series(1.0, index=df.index)
        aligned = pd.DataFrame(
            {"open": df["Open"], "high": hi, "low": lo, "close": df["Close"], "volume": df["Volume"],
             "adj_open": df["Open"] * factor, "adj_close": df["Close"] * factor}
        ).reindex(cal)
        for c in arr:
            arr[c][:, j] = aligned[c].to_numpy(dtype=float)
        kept.append(t)

    obs = np.isfinite(arr["close"])
    log.info("limits panel: %d stocks, %d days, %d failed", len(kept), n, len(failed))
    return Panel(dates=cal, tickers=list(tickers), obs=obs, repaired=repaired, failed=failed, **arr)


# --------------------------------------------------------------------------- #
# Event classification
# --------------------------------------------------------------------------- #
@dataclass
class Events:
    """Boolean masks (dates x tickers) plus the daily move arrays."""

    masks: dict[str, np.ndarray]
    studied: np.ndarray      # day is inside the study and cleanly comparable to the previous day
    invalid: np.ndarray      # move beyond the limit: excluded, and poisons windows that include it
    r_close: np.ndarray
    up_level: np.ndarray     # upper limit price for the day (SAR)
    dn_level: np.ndarray
    tol: np.ndarray          # price tolerance used when matching a limit
    off_grid: int            # studied days that used the one-tick fallback


def classify(p: Panel) -> Events:
    """Label every stock-day. See the module docstring for definitions."""
    prev_close = np.vstack([np.full((1, p.close.shape[1]), np.nan), p.close[:-1]])
    prev_obs = np.vstack([np.zeros((1, p.obs.shape[1]), bool), p.obs[:-1]])
    both = p.obs & prev_obs

    with np.errstate(invalid="ignore", divide="ignore"):
        r_c = p.close / prev_close - 1
    dates_mat = pd.DatetimeIndex(np.repeat(p.dates.to_numpy()[:, None], p.close.shape[1], axis=1).ravel())
    up, dn, tol, on_grid = (x.reshape(prev_close.shape) for x in limit_prices(prev_close.ravel(), dates_mat))

    in_period = (p.dates >= pd.Timestamp(config.LIMITS_START))[:, None] & np.isfinite(up)
    seen = np.cumsum(p.obs, axis=0)  # skip each stock's first sessions after listing
    seasoned = seen > config.LIMIT_LISTING_EXCLUDE_DAYS

    candidate = both & in_period & seasoned
    with np.errstate(invalid="ignore"):
        beyond = (p.close > up + tol) | (p.close < dn - tol) | (p.high > up + tol) | (p.low < dn - tol)
        invalid = candidate & beyond
        studied = candidate & ~invalid
        at_up_close = p.close >= up - tol
        at_up_high = p.high >= up - tol
        at_dn_close = p.close <= dn + tol
        at_dn_low = p.low <= dn + tol
        lock_up = studied & at_up_close
        touch_up = studied & at_up_high & ~at_up_close
        near_up = studied & (r_c >= config.LIMIT_NEAR_MISS - EPS) & ~at_up_high
        lock_down = studied & at_dn_close
        touch_down = studied & at_dn_low & ~at_dn_close
        near_down = studied & (r_c <= -config.LIMIT_NEAR_MISS + EPS) & ~at_dn_low

    masks = {"lock_up": lock_up, "touch_up": touch_up, "near_up": near_up,
             "lock_down": lock_down, "touch_down": touch_down, "near_down": near_down}
    return Events(masks=masks, studied=studied, invalid=invalid, r_close=r_c, up_level=up, dn_level=dn,
                  tol=tol, off_grid=int((studied & ~on_grid).sum()))


# --------------------------------------------------------------------------- #
# Forward returns
# --------------------------------------------------------------------------- #
def market_simple_returns(md: MarketData, dates: pd.DatetimeIndex) -> np.ndarray:
    """Daily simple market returns on ``dates`` (NaN where unusable)."""
    r = md.index_close.pct_change(fill_method=None).where(md.index_return_ok)
    return r.reindex(dates).to_numpy(dtype=float)


def forward_returns(p: Panel, ev: Events, mkt: np.ndarray, h: int) -> dict[str, np.ndarray]:
    """Returns from day t to t+h for every stock-day (NaN where not computable).

    A value is NaN when the stock didn't trade on t+h (or t+1 for open-based
    measures), or when a beyond-limit move occurs in (t, t+h].
    """
    n, k = p.close.shape
    nan = np.full((n, k), np.nan)
    cc, oc, gap, cc_ab = nan.copy(), nan.copy(), nan.copy(), nan.copy()
    if h >= n:
        return {"cc": cc, "cc_ab": cc_ab, "oc": oc, "gap": gap}

    # Poisoned windows: any invalid move strictly after t and up to t+h.
    inv = ev.invalid.astype(int)
    csum = np.vstack([np.zeros((1, k), int), np.cumsum(inv, axis=0)])
    bad = np.zeros((n, k), bool)
    bad[: n - h] = (csum[h + 1 : n + 1] - csum[1 : n - h + 1]) > 0

    end_ok = np.zeros((n, k), bool)
    end_ok[: n - h] = p.obs[h:]
    next_ok = np.zeros((n, k), bool)
    next_ok[: n - 1] = p.obs[1:]

    valid_cc = p.obs & end_ok & ~bad
    with np.errstate(invalid="ignore", divide="ignore"):
        cc[: n - h] = p.adj_close[h:] / p.adj_close[: n - h] - 1
        oc[: n - h] = p.adj_close[h:] / p.adj_open[1 : n - h + 1] - 1
        gap[: n - 1] = p.adj_open[1:] / p.adj_close[:-1] - 1

    # Market return over (t, t+h], requiring every day to be usable.
    m = np.full(n, np.nan)
    lm = np.log1p(mkt)
    lm_c = np.concatenate([[0.0], np.nancumsum(lm)])
    cnt = np.concatenate([[0], np.cumsum(np.isfinite(lm))])
    for t in range(n - h):
        if cnt[t + h + 1] - cnt[t + 1] == h:
            m[t] = math.expm1(lm_c[t + h + 1] - lm_c[t + 1])
    cc_ab = cc - m[:, None]

    cc = np.where(valid_cc, cc, np.nan)
    cc_ab = np.where(valid_cc, cc_ab, np.nan)
    oc = np.where(valid_cc & next_ok, oc, np.nan)
    gap_bad = np.zeros((n, k), bool)
    gap_bad[: n - 1] = ev.invalid[1:]
    gap = np.where(p.obs & next_ok & ~gap_bad, gap, np.nan)
    return {"cc": cc, "cc_ab": cc_ab, "oc": oc, "gap": gap}


# --------------------------------------------------------------------------- #
# Statistics
# --------------------------------------------------------------------------- #
def clustered_stats(values: np.ndarray, date_idx: np.ndarray, rng: np.random.Generator, baseline: float | None = None) -> dict:
    """Mean with a 95% CI from resampling dates, plus median and hit rate.

    Args:
        values: One value per event.
        date_idx: Event date position for each value (the resampling cluster).
        baseline: If given, ``significant`` means the CI excludes it; else 0.
    """
    ok = np.isfinite(values)
    v, d = values[ok], date_idx[ok]
    ref = 0.0 if baseline is None else baseline
    if len(v) == 0:
        return {"n": 0, "dates": 0, "mean": None, "lo": None, "hi": None, "median": None, "hit": None, "significant": False}
    uniq, inv = np.unique(d, return_inverse=True)
    sums = np.bincount(inv, weights=v)
    counts = np.bincount(inv).astype(float)
    mean = float(v.mean())
    lo = hi = None
    if len(uniq) >= 5:
        draws = rng.integers(0, len(uniq), size=(config.LIMIT_BOOTSTRAP, len(uniq)))
        boot = sums[draws].sum(axis=1) / counts[draws].sum(axis=1)
        lo, hi = (float(x) for x in np.percentile(boot, [2.5, 97.5]))
    return {
        "n": int(len(v)),
        "dates": int(len(uniq)),
        "mean": mean,
        "lo": lo,
        "hi": hi,
        "median": float(np.median(v)),
        "hit": float((v > 0).mean()),
        "significant": bool(lo is not None and (lo > ref or hi < ref)),
    }


def _event_values(mask: np.ndarray, arr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    rows, cols = np.nonzero(mask)
    return arr[rows, cols], rows


# --------------------------------------------------------------------------- #
# Liquidity tiers (point in time)
# --------------------------------------------------------------------------- #
def liquidity_tiers(p: Panel) -> np.ndarray:
    """0/1/2 = low/mid/high liquidity tier for each stock-day (-1 = unknown).

    Uses the average traded value (close x volume) over the previous
    ``LIMIT_LIQUIDITY_LOOKBACK`` sessions, ranked across stocks on that date.
    Only information before day t is used.
    """
    value = pd.DataFrame(np.where(p.obs, p.close * p.volume, np.nan))
    trailing = value.shift(1).rolling(config.LIMIT_LIQUIDITY_LOOKBACK, min_periods=config.LIMIT_LIQUIDITY_MIN_OBS).mean()
    pct = trailing.rank(axis=1, pct=True)
    tiers = np.full(p.close.shape, -1)
    x = pct.to_numpy()
    tiers[x <= 1 / 3] = 0
    tiers[(x > 1 / 3) & (x <= 2 / 3)] = 1
    tiers[x > 2 / 3] = 2
    return tiers


# --------------------------------------------------------------------------- #
# Backtests
# --------------------------------------------------------------------------- #
def backtest(p: Panel, ev: Events, mkt: np.ndarray, signal: str, hold: int, cost_bps: float) -> dict:
    """Buy at the next open after each signal day, sell at the close ``hold`` sessions later.

    * Entry at open t+1. If the stock opens locked at its upper limit that day,
      the trade is skipped (there would be no sellers).
    * Exit at the close of day t+hold, or the last session the stock traded
      before that.
    * ``cost_bps`` is charged on entry and on exit.
    * The portfolio holds all open trades in equal weights; days with no
      trades earn zero (cash). Long only: short selling is restricted on Tadawul.
    """
    n, k = p.close.shape
    c = cost_bps / 1e4
    sig = ev.masks[signal]
    day_ret = [[] for _ in range(n)]  # per day: list of position returns
    trades, skipped = [], 0

    with np.errstate(invalid="ignore"):
        opened_locked_up = p.open >= ev.up_level - ev.tol

    rows, cols = np.nonzero(sig)
    for t, j in zip(rows, cols):
        e = t + 1
        if e >= n or not p.obs[e, j]:
            continue
        if opened_locked_up[e, j]:  # opened at the upper limit: no sellers, can't buy
            skipped += 1
            continue
        last = min(t + hold, n - 1)
        seg = np.nonzero(p.obs[e : last + 1, j])[0] + e
        if np.any(ev.invalid[e : last + 1, j]):  # a beyond-limit move while holding: bad data
            continue
        x = seg[-1]
        entry, exit_ = p.adj_open[e, j], p.adj_close[x, j]
        net = exit_ * (1 - c) / (entry * (1 + c)) - 1
        trades.append({"t": int(t), "j": int(j), "exit": int(x), "net": float(net)})
        prev_px = entry
        for d in seg:
            r = p.adj_close[d, j] / prev_px - 1
            if d == e:
                r = (1 + r) / (1 + c) - 1
            if d == x:
                r = (1 + r) * (1 - c) - 1
            day_ret[d].append(r)
            prev_px = p.adj_close[d, j]

    port = np.array([np.mean(r) if r else 0.0 for r in day_ret])
    start = int(np.argmax(p.dates >= pd.Timestamp(config.LIMITS_START)))
    port = port[start:]
    dates = p.dates[start:]
    equity = np.cumprod(1 + port)
    mk = np.nan_to_num(mkt[start:], nan=0.0)
    bench = np.cumprod(1 + mk)
    years = max(len(port) / config.TRADING_DAYS_PER_YEAR, 1e-9)
    dd = equity / np.maximum.accumulate(equity) - 1
    nets = np.array([tr["net"] for tr in trades])
    step = config.LIMIT_SERIES_STEP
    idx = np.unique(np.concatenate([np.arange(0, len(dates), step), [len(dates) - 1]])) if len(dates) else np.array([], int)
    return {
        "signal": signal,
        "hold": hold,
        "cost_bps": cost_bps,
        "trades": int(len(trades)),
        "skipped_locked_open": int(skipped),
        "avg_net": float(nets.mean()) if len(nets) else None,
        "median_net": float(np.median(nets)) if len(nets) else None,
        "hit": float((nets > 0).mean()) if len(nets) else None,
        "total": float(equity[-1] - 1) if len(equity) else None,
        "cagr": float(equity[-1] ** (1 / years) - 1) if len(equity) else None,
        "max_dd": float(dd.min()) if len(dd) else None,
        "exposure": float(np.mean([bool(r) for r in day_ret[start:]])) if len(port) else None,
        "bench_total": float(bench[-1] - 1) if len(bench) else None,
        "equity": [[dates[i].strftime("%Y-%m-%d"), round(float(equity[i]), 4)] for i in idx],
        "bench": [[dates[i].strftime("%Y-%m-%d"), round(float(bench[i]), 4)] for i in idx],
    }


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
def run_study(md: MarketData, store: RawStore) -> dict:
    """Run the whole study and return a JSON-ready dict for limits.json."""
    uni = main_market_universe()
    tickers = uni["ticker"].tolist()
    p = build_panel(store, tickers, md.calendar, None if md.synthetic else incomplete_session_date())
    ev = classify(p)
    mkt = market_simple_returns(md, p.dates)
    rng = np.random.default_rng(config.LIMIT_BOOTSTRAP_SEED)
    horizons = list(config.LIMIT_HORIZONS)

    fwd = {h: forward_returns(p, ev, mkt, h) for h in horizons}
    counts = {c: int(ev.masks[c].sum()) for c in CATEGORIES}

    # Baseline: every studied stock-day, for comparison.
    def studied_mean(arr: np.ndarray) -> float | None:
        x = np.where(ev.studied, arr, np.nan)
        return float(np.nanmean(x)) if np.isfinite(x).any() else None

    base = {str(h): {m: studied_mean(fwd[h][m]) for m in ("cc_ab", "oc")} for h in horizons}
    base_gap = studied_mean(fwd[1]["gap"])

    stats: dict[str, dict] = {}
    for cat in CATEGORIES:
        mask = ev.masks[cat]
        stats[cat] = {}
        for h in horizons:
            stats[cat][str(h)] = {}
            for m in ("cc_ab", "oc"):
                v, d = _event_values(mask, fwd[h][m])
                ref = base[str(h)][m] if m == "oc" else 0.0
                stats[cat][str(h)][m] = clustered_stats(v, d, rng, baseline=ref)
        v, d = _event_values(mask, fwd[1]["gap"])
        stats[cat]["gap"] = clustered_stats(v, d, rng, baseline=base_gap)

    # Average abnormal path around events, anchored at 0 on the event close.
    lo_k, hi_k = config.LIMIT_CAR_WINDOW
    ks = list(range(lo_k, hi_k + 1))
    n = len(p.dates)
    mk = pd.Series(mkt)
    log_m = np.log1p(mk).to_numpy()
    cum_m = np.concatenate([[0.0], np.nancumsum(log_m)])
    cnt_m = np.concatenate([[0], np.cumsum(np.isfinite(log_m))])
    inv_c = np.vstack([np.zeros((1, p.obs.shape[1]), int), np.cumsum(ev.invalid, axis=0)])
    car: dict[str, dict] = {}
    for cat in ("lock_up", "touch_up", "near_up", "lock_down", "touch_down", "near_down"):
        rows, cols = np.nonzero(ev.masks[cat])
        means, lows, highs, ns = [], [], [], []
        for kk in ks:
            if kk == 0:
                means.append(0.0)
                lows.append(0.0)
                highs.append(0.0)
                ns.append(int(len(rows)))
                continue
            a, b = (rows, rows + kk) if kk > 0 else (rows + kk, rows)
            ok = (a >= 0) & (b < n)
            a, b, c_ = a[ok], b[ok], cols[ok]
            ok2 = p.obs[a, c_] & p.obs[b, c_]
            a, b, c_ = a[ok2], b[ok2], c_[ok2]
            clean = (inv_c[b + 1, c_] - inv_c[a + 1, c_]) == 0
            a, b, c_ = a[clean], b[clean], c_[clean]
            full_m = (cnt_m[b + 1] - cnt_m[a + 1]) == (b - a)
            stock = np.log(p.adj_close[b, c_] / p.adj_close[a, c_])
            market = cum_m[b + 1] - cum_m[a + 1]
            ab = np.where(full_m, np.expm1(stock) - np.expm1(market), np.nan)
            if kk < 0:
                ab = -ab  # path value at k<0 is minus the move from k to 0
            dates_idx = rows[ok][ok2][clean]
            s = clustered_stats(ab, dates_idx, rng)
            means.append(s["mean"])
            lows.append(s["lo"])
            highs.append(s["hi"])
            ns.append(s["n"])
        car[cat] = {"mean": means, "lo": lows, "hi": highs, "n": ns}

    # Continuation, lock ratio, streaks.
    def continuation(side: str) -> dict:
        lock = ev.masks[f"lock_{side}"]
        touch = ev.masks[f"touch_{side}"]
        nxt_lock = np.zeros_like(lock)
        nxt_lock[:-1] = lock[1:]
        nxt_studied = np.zeros_like(lock)
        nxt_studied[:-1] = ev.studied[1:]
        both = lock & nxt_studied
        streaks: dict[str, int] = {}
        for j in range(lock.shape[1]):
            run = 0
            for i in range(lock.shape[0]):
                if lock[i, j]:
                    run += 1
                elif run:
                    key = str(run) if run < 5 else "5+"
                    streaks[key] = streaks.get(key, 0) + 1
                    run = 0
            if run:
                key = str(run) if run < 5 else "5+"
                streaks[key] = streaks.get(key, 0) + 1
        studied_n = int(ev.studied.sum())
        return {
            "p_next_lock": float(nxt_lock[both].mean()) if both.any() else None,
            "p_lock_any_day": float(lock.sum() / studied_n) if studied_n else None,
            "lock_ratio": float(lock.sum() / (lock.sum() + touch.sum())) if (lock.sum() + touch.sum()) else None,
            "streaks": {k: streaks.get(k, 0) for k in ("1", "2", "3", "4", "5+")},
        }

    # Breakdowns for the headline categories.
    tiers = liquidity_tiers(p)
    years = np.repeat(p.dates.year.to_numpy()[:, None], p.close.shape[1], axis=1)
    breakdown: dict[str, dict] = {"liquidity": {}, "year": {}}
    for cat in ("lock_up", "touch_up", "lock_down", "touch_down"):
        breakdown["liquidity"][cat], breakdown["year"][cat] = {}, {}
        for h in (1, 5):
            if h not in fwd:
                continue
            breakdown["liquidity"][cat][str(h)] = {}
            for tier, name in ((0, "low"), (1, "mid"), (2, "high")):
                v, d = _event_values(ev.masks[cat] & (tiers == tier), fwd[h]["cc_ab"])
                breakdown["liquidity"][cat][str(h)][name] = clustered_stats(v, d, rng)
            breakdown["year"][cat][str(h)] = {}
            for y in sorted(set(p.dates[p.dates >= pd.Timestamp(config.LIMITS_START)].year)):
                v, d = _event_values(ev.masks[cat] & (years == y), fwd[h]["cc_ab"])
                breakdown["year"][cat][str(h)][str(y)] = clustered_stats(v, d, rng)

    backtests = [
        backtest(p, ev, mkt, "lock_up", config.LIMIT_HOLD_DAYS, config.LIMIT_COST_BPS),
        backtest(p, ev, mkt, "lock_down", config.LIMIT_HOLD_DAYS, config.LIMIT_COST_BPS),
    ]

    # Today and the recent event log.
    names = {r.ticker: {"en": r.name_en, "ar": r.name_ar} for r in uni.itertuples()}
    last = len(p.dates) - 1
    today = []
    for cat in ("lock_up", "touch_up", "lock_down", "touch_down"):
        for j in np.nonzero(ev.masks[cat][last])[0]:
            today.append({"ticker": p.tickers[j], "category": cat, "chg": ev.r_close[last, j],
                          "close": p.close[last, j], "high": p.high[last, j], "low": p.low[last, j]})

    log_rows = []
    rows, cols = np.nonzero(np.logical_or.reduce([ev.masks[c] for c in ("lock_up", "touch_up", "lock_down", "touch_down")]))
    order = np.argsort(rows)[::-1][: config.LIMIT_LOG_ROWS]
    for i in order:
        t, j = rows[i], cols[i]
        cat = next(c for c in ("lock_up", "lock_down", "touch_up", "touch_down") if ev.masks[c][t, j])
        log_rows.append({
            "date": p.dates[t].strftime("%Y-%m-%d"), "ticker": p.tickers[j], "category": cat,
            "chg": ev.r_close[t, j], "next1_ab": fwd[1]["cc_ab"][t, j],
            "next5_ab": fwd[5]["cc_ab"][t, j] if 5 in fwd else None, "gap": fwd[1]["gap"][t, j],
        })

    # Every lock/touch event per stock, for the single-stock view (limits_events.json).
    by_ticker: dict[str, list] = {}
    all_rows, all_cols = np.nonzero(np.logical_or.reduce([ev.masks[c] for c in ("lock_up", "touch_up", "lock_down", "touch_down")]))
    for t, j in sorted(zip(all_rows, all_cols), key=lambda x: (x[1], -x[0])):
        cat = next(c for c in ("lock_up", "lock_down", "touch_up", "touch_down") if ev.masks[c][t, j])
        by_ticker.setdefault(p.tickers[j], []).append([
            p.dates[t].strftime("%Y-%m-%d"), cat, ev.r_close[t, j], fwd[1]["cc_ab"][t, j],
            fwd[5]["cc_ab"][t, j] if 5 in fwd else None, fwd[1]["gap"][t, j],
        ])

    first = p.dates[p.dates >= pd.Timestamp(config.LIMITS_START)]
    loaded = len(tickers) - len(p.failed)
    warnings = list(md.warnings)
    if p.failed:
        warnings.append(f"{len(p.failed)} of {len(tickers)} main-market stocks couldn't be loaded for the limit study.")
    log.info("limit events: %s", counts)
    return {
        "as_of": p.dates[-1].strftime("%Y-%m-%d"),
        "period": {"start": first[0].strftime("%Y-%m-%d") if len(first) else None, "end": p.dates[-1].strftime("%Y-%m-%d")},
        "universe": {"configured": len(tickers), "loaded": loaded, "failed": p.failed},
        "market": md.index_source,
        "params": {
            "limit": config.PRICE_LIMIT, "near_miss": config.LIMIT_NEAR_MISS, "horizons": horizons,
            "hold": config.LIMIT_HOLD_DAYS, "cost_bps": config.LIMIT_COST_BPS,
            "listing_exclude": config.LIMIT_LISTING_EXCLUDE_DAYS, "bootstrap": config.LIMIT_BOOTSTRAP,
            "car_window": list(config.LIMIT_CAR_WINDOW), "start": config.LIMITS_START,
        },
        "data_checks": {"excluded_beyond_limit": int(ev.invalid.sum()), "high_low_repaired": p.repaired,
                        "stock_days_studied": int(ev.studied.sum()), "off_grid_fallback": ev.off_grid},
        "counts": counts,
        "baseline": {"by_h": base, "gap": base_gap},
        "stats": stats,
        "car": {"k": ks, **car},
        "continuation": {"up": continuation("up"), "down": continuation("down")},
        "breakdown": breakdown,
        "backtests": backtests,
        "today": {"date": p.dates[-1].strftime("%Y-%m-%d"), "events": today},
        "log": log_rows,
        "names": names,
        "warnings": warnings,
        "by_ticker": by_ticker,  # written to limits_events.json by export.py
    }
