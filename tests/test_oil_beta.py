"""Tests for Brent alignment and the rolling regressions in pipeline.oil_beta."""
import numpy as np
import pandas as pd

from pipeline.oil_beta import oil_returns_on_calendar, rolling_beta, rolling_beta_dimson


def test_sunday_return_pairs_with_thursday_to_friday_brent_move():
    oil = pd.Series([80.0, 82.0], index=pd.to_datetime(["2024-01-11", "2024-01-12"]))  # Thu, Fri
    cal = pd.to_datetime(["2024-01-11", "2024-01-14"])                                   # Thu, Sun
    r = oil_returns_on_calendar(oil, pd.DatetimeIndex(cal))
    assert np.isclose(r.loc["2024-01-14", "same_day"], np.log(82 / 80))


def test_rolling_beta_recovers_known_slope():
    rng = np.random.default_rng(0)
    idx = pd.RangeIndex(500)
    x = pd.Series(rng.normal(0, 0.01, 500), index=idx)
    y = pd.DataFrame({"a": 1.5 * x + rng.normal(0, 0.002, 500), "b": -0.5 * x + rng.normal(0, 0.002, 500)})
    beta, n = rolling_beta(y, x, 120)
    assert abs(beta["a"].iloc[-1] - 1.5) < 0.05
    assert abs(beta["b"].iloc[-1] + 0.5) < 0.05
    assert n["a"].iloc[-1] == 120


def test_dimson_beta_captures_lagged_response():
    rng = np.random.default_rng(1)
    n = 600
    x0 = pd.Series(rng.normal(0, 0.02, n))
    x1 = x0.shift(1)
    y = pd.DataFrame({"s": 0.3 * x0 + 0.2 * x1 + rng.normal(0, 0.003, n)})
    dimson, _ = rolling_beta_dimson(y, x0, x1, 120)
    same_day, _ = rolling_beta(y, x0, 120)
    assert abs(dimson["s"].iloc[-1] - 0.5) < 0.05       # total response
    assert abs(same_day["s"].iloc[-1] - 0.3) < 0.05     # misses the lagged part
