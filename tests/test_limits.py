"""Tests for pipeline.limits: tick sizes, limit prices, event labels, returns, backtest rules."""
import numpy as np
import pandas as pd
import pytest

from pipeline import config
from pipeline.limits import (
    Panel,
    backtest,
    classify,
    clustered_stats,
    forward_returns,
    limit_prices,
    liquidity_tiers,
    main_market_universe,
    tick_size,
)

D = pd.Timestamp


# --------------------------------------------------------------------------- #
# Ticks and limit prices
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "price,date,tick",
    [
        (9.99, "2018-01-10", 0.01), (10.00, "2018-01-10", 0.02), (24.98, "2018-01-10", 0.02),
        (25.00, "2018-01-10", 0.05), (99.90, "2018-01-10", 0.10), (100.0, "2018-01-10", 0.20),
        (600.0, "2018-01-10", 0.20),
        (24.99, "2025-06-29", 0.01), (25.00, "2025-06-29", 0.02), (99.95, "2025-06-29", 0.05),
        (100.0, "2025-06-29", 0.10), (250.0, "2025-06-29", 0.20), (500.0, "2025-06-29", 0.50),
        (24.99, "2025-06-26", 0.02),  # the last session before the 2025 schedule
    ],
)
def test_tick_schedule(price, date, tick):
    assert tick_size(np.array([price]), pd.DatetimeIndex([date]))[0] == pytest.approx(tick)


def test_no_tick_before_the_documented_schedule():
    assert np.isnan(tick_size(np.array([20.0]), pd.DatetimeIndex(["2016-05-01"]))[0])


@pytest.mark.parametrize(
    "prev,date,up,dn",
    [
        (20.00, "2018-01-10", 22.00, 18.00),
        (24.98, "2018-01-10", 27.45, 22.50),   # upper limit falls in the 0.05 band
        (9.99, "2018-01-10", 10.98, 9.00),     # 10.989 -> 0.02 grid -> 10.98
        (24.99, "2025-07-01", 27.48, 22.50),
        (123.40, "2025-07-01", 135.70, 111.10),
    ],
)
def test_exact_limit_prices(prev, date, up, dn):
    u, d, tol, on_grid = limit_prices(np.array([prev]), pd.DatetimeIndex([date]))
    assert on_grid[0]
    assert u[0] == pytest.approx(up)
    assert d[0] == pytest.approx(dn)


def test_off_grid_history_falls_back_to_one_tick_tolerance():
    u, d, tol, on_grid = limit_prices(np.array([20.013]), pd.DatetimeIndex(["2018-01-10"]))
    assert not on_grid[0]
    assert u[0] == pytest.approx(20.013 * 1.1)
    assert tol[0] == pytest.approx(0.02)


# --------------------------------------------------------------------------- #
# A hand-built panel
# --------------------------------------------------------------------------- #
def saudi_days(n, start="2018-01-07"):
    d = pd.date_range(start, periods=n * 2, freq="D")
    return d[d.dayofweek.isin(config.SAUDI_TRADING_WEEKDAYS)][:n]


def make_panel(closes, highs=None, lows=None, opens=None, obs=None, start="2018-01-07"):
    """One-stock panel. Unlisted days can be marked with obs=False."""
    c = np.asarray(closes, float)[:, None]
    n = len(c)
    h = np.asarray(highs if highs is not None else closes, float)[:, None]
    lo = np.asarray(lows if lows is not None else closes, float)[:, None]
    o = np.asarray(opens if opens is not None else closes, float)[:, None]
    ob = np.ones((n, 1), bool) if obs is None else np.asarray(obs, bool)[:, None]
    nanify = lambda a: np.where(ob, a, np.nan)  # noqa: E731
    return Panel(
        dates=saudi_days(n, start), tickers=["TEST.SR"], open=nanify(o), high=nanify(h), low=nanify(lo),
        close=nanify(c), volume=nanify(np.full((n, 1), 1e5)), adj_open=nanify(o), adj_close=nanify(c),
        obs=ob, repaired=0, failed=[],
    )


SEASON = [20.00] * (config.LIMIT_LISTING_EXCLUDE_DAYS + 2)


def labels(ev, i):
    return {k for k, m in ev.masks.items() if m[i, 0]}


def test_event_labels():
    closes = SEASON + [22.00, 23.00, 24.90, 21.98]
    highs = SEASON + [22.00, 24.20, 25.00, 21.98]
    # day 0: 20.00 -> 22.00 = lock_up
    # day 1: 22.00 -> high 24.20 (limit), close 23.00 = touch_up
    # day 2: 23.00 -> close 24.90 (+8.3%), high 25.00 below limit 25.30 = near_up
    # day 3: 24.90 -> 21.98 (-11.7%): beyond the -10% limit (22.45) = invalid
    p = make_panel(closes, highs=highs, lows=[min(a, b) for a, b in zip(closes, highs)])
    ev = classify(p)
    i0 = len(SEASON)
    assert labels(ev, i0) == {"lock_up"}
    assert labels(ev, i0 + 1) == {"touch_up"}
    assert labels(ev, i0 + 2) == {"near_up"}
    assert ev.invalid[i0 + 3, 0] and not ev.studied[i0 + 3, 0]


def test_one_tick_below_the_limit_is_not_a_lock():
    p = make_panel(SEASON + [21.98])  # limit is 22.00
    ev = classify(p)
    assert labels(ev, len(SEASON)) == {"near_up"}


def test_lock_down_and_touch_down():
    closes = SEASON + [18.00, 17.00]
    lows = SEASON + [18.00, 16.20]  # 18.00 * 0.9 = 16.20
    p = make_panel(closes, lows=lows)
    ev = classify(p)
    assert labels(ev, len(SEASON)) == {"lock_down"}
    assert labels(ev, len(SEASON) + 1) == {"touch_down"}


def test_first_sessions_after_listing_and_gaps_are_not_studied():
    closes = [20.00, 22.00] + [22.0] * 12 + [22.0, 24.20]
    obs = [True] * 14 + [False, True]  # missing day right before the last move
    p = make_panel(closes, obs=obs)
    ev = classify(p)
    assert not ev.studied[1, 0]   # second session ever: still inside the listing window
    assert not ev.studied[15, 0]  # previous day missing: yesterday's close is unknown


def test_nothing_is_studied_before_the_documented_tick_schedule():
    p = make_panel(SEASON + [22.00], start="2016-01-03")
    ev = classify(p)
    assert not ev.studied.any()


# --------------------------------------------------------------------------- #
# Forward returns
# --------------------------------------------------------------------------- #
def test_forward_returns_and_poisoned_windows():
    closes = SEASON + [22.00, 22.50, 23.00, 30.00]  # the last move is beyond the limit
    opens = SEASON + [22.00, 22.20, 22.80, 30.00]
    p = make_panel(closes, opens=opens, highs=closes, lows=[min(a, b) for a, b in zip(closes, opens)])
    ev = classify(p)
    mkt = np.zeros(len(closes))
    t = len(SEASON)
    f1 = forward_returns(p, ev, mkt, 1)
    f2 = forward_returns(p, ev, mkt, 2)
    f3 = forward_returns(p, ev, mkt, 3)
    assert f1["cc"][t, 0] == pytest.approx(22.50 / 22.00 - 1)
    assert f1["oc"][t, 0] == pytest.approx(22.50 / 22.20 - 1)
    assert f1["gap"][t, 0] == pytest.approx(22.20 / 22.00 - 1)
    assert f2["cc_ab"][t, 0] == pytest.approx(23.00 / 22.00 - 1)  # market flat
    assert np.isnan(f3["cc"][t, 0])  # window includes the beyond-limit day


def test_market_adjustment():
    closes = SEASON + [22.00, 22.44]
    p = make_panel(closes)
    ev = classify(p)
    mkt = np.zeros(len(closes))
    mkt[-1] = 0.01
    f1 = forward_returns(p, ev, mkt, 1)
    assert f1["cc_ab"][len(SEASON), 0] == pytest.approx(0.02 - 0.01)


# --------------------------------------------------------------------------- #
# Backtest rules
# --------------------------------------------------------------------------- #
def test_backtest_enters_next_open_and_skips_locked_opens():
    hold = 2
    # t1: 20.00 -> 22.00 lock-up. Next day opens 22.40 (limit 24.20): buy; exit at the close of t1+2 (23.00).
    # t2: 23.00 -> 25.30 lock-up (limit 25.30 on the 0.05 grid). Next day opens at its limit 27.80: skipped.
    closes = SEASON + [22.00, 22.60, 23.00, 23.00, 25.30, 27.00]
    opens = SEASON + [20.50, 22.40, 22.70, 23.00, 23.10, 27.80]
    highs = [max(a, b) for a, b in zip(closes, opens)]
    lows = [min(a, b) for a, b in zip(closes, opens)]
    p = make_panel(closes, highs=highs, lows=lows, opens=opens)
    ev = classify(p)
    t1, t2 = len(SEASON), len(SEASON) + 4
    assert ev.masks["lock_up"][t1, 0] and ev.masks["lock_up"][t2, 0]
    assert ev.masks["lock_up"].sum() == 2
    res = backtest(p, ev, np.zeros(len(closes)), "lock_up", hold, cost_bps=10)
    c = 10 / 1e4
    assert res["skipped_locked_open"] == 1
    assert res["trades"] == 1
    assert res["avg_net"] == pytest.approx(23.00 * (1 - c) / (22.40 * (1 + c)) - 1)
    # The equity curve compounds to the same result.
    assert res["total"] == pytest.approx(res["avg_net"], abs=1e-9)


def test_signal_does_not_use_future_prices():
    t = len(SEASON)
    calm = SEASON + [22.00, 22.40, 22.60, 22.80]
    crash = SEASON + [22.00, 19.80, 17.82, 16.04]
    ev1 = classify(make_panel(calm))
    ev2 = classify(make_panel(crash, lows=crash))
    for k in ev1.masks:
        assert ev1.masks[k][: t + 1, 0].tolist() == ev2.masks[k][: t + 1, 0].tolist()
    assert ev1.masks["lock_up"][t, 0]


def test_liquidity_tier_uses_only_past_volume():
    n = 90
    closes = np.full((n, 3), 20.0)
    vol = np.tile([1e4, 1e5, 1e6], (n, 1)).astype(float)
    p = Panel(dates=saudi_days(n), tickers=["A", "B", "C"], open=closes, high=closes, low=closes, close=closes,
              volume=vol, adj_open=closes, adj_close=closes, obs=np.ones((n, 3), bool), repaired=0, failed=[])
    t1 = liquidity_tiers(p)
    vol2 = vol.copy()
    vol2[-1] = [1e9, 1, 1]  # change only the last day's volume
    p.volume = vol2
    t2 = liquidity_tiers(p)
    assert (t1[-1] == t2[-1]).all()
    assert list(t1[-1]) == [0, 1, 2]


# --------------------------------------------------------------------------- #
# Statistics and universe
# --------------------------------------------------------------------------- #
def test_clustered_stats_basics():
    rng = np.random.default_rng(0)
    vals = np.r_[np.full(50, 0.01), np.full(50, 0.03)]
    dates = np.repeat(np.arange(20), 5)
    s = clustered_stats(vals, dates, rng)
    assert s["n"] == 100 and s["dates"] == 20
    assert s["mean"] == pytest.approx(0.02)
    assert s["lo"] <= s["mean"] <= s["hi"]
    assert s["significant"]  # every value is positive


def test_main_market_universe():
    uni = main_market_universe()
    codes = uni["ticker"].str.replace(".SR", "", regex=False)
    assert len(uni) >= 240
    assert codes.str.match(r"^[1-8]\d{3}$").all()          # no Nomu (9xxx)
    assert not codes.astype(int).between(4330, 4349).any()  # no REIT funds
    assert {s.ticker for s in config.UNIVERSE} <= set(uni["ticker"])
