"""Tests for the cleaning and calendar logic in pipeline.fetch."""
import numpy as np
import pandas as pd

from pipeline import config
from pipeline.fetch import build_calendar, clean_series, fill_short_gaps


def _saudi_days(n: int, start: str = "2024-01-07") -> pd.DatetimeIndex:  # 2024-01-07 is a Sunday
    days = pd.date_range(start, periods=n * 2, freq="D")
    return days[days.dayofweek.isin(config.SAUDI_TRADING_WEEKDAYS)][:n]


def _bars(close, index, volume=1000.0) -> pd.DataFrame:
    return pd.DataFrame({"Close": close, "Volume": volume}, index=index)


def test_calendar_is_sunday_to_thursday():
    idx = _saudi_days(20)
    cal = build_calendar(idx, [idx])
    assert set(cal.dayofweek) <= set(config.SAUDI_TRADING_WEEKDAYS)
    assert 4 not in set(cal.dayofweek) and 5 not in set(cal.dayofweek)  # no Friday or Saturday


def test_friday_rows_and_zero_volume_days_are_dropped():
    days = pd.date_range("2024-01-07", periods=14, freq="D")  # includes Fri/Sat
    df = _bars(np.linspace(10, 11, len(days)), days)
    df.iloc[1, df.columns.get_loc("Volume")] = 0  # a Monday with no trades
    out, rep = clean_series(df, "TEST.SR", "equity")
    assert rep.dropped_off_calendar == 4  # two Fridays, two Saturdays
    assert rep.dropped_zero_volume == 1
    assert set(out.index.dayofweek) <= set(config.SAUDI_TRADING_WEEKDAYS)


def test_single_day_spike_is_removed_but_real_limit_move_is_only_flagged():
    idx = _saudi_days(10)
    close = np.full(10, 100.0)
    close[3] = 150.0            # bad print: +50% then -33%
    close[7:] = 88.0            # a genuine -12% move that sticks
    out, rep = clean_series(_bars(close, idx), "TEST.SR", "equity")
    assert rep.bad_prints_removed == 1
    assert idx[3] not in out.index
    assert [m["date"] for m in rep.suspicious_moves] == [idx[7].strftime("%Y-%m-%d")]
    assert bool(out.loc[idx[7], "suspicious"])


def test_only_short_interior_gaps_are_filled():
    idx = _saudi_days(15)
    s = pd.Series(np.arange(15, dtype=float), index=idx)
    s.iloc[2:4] = np.nan     # 2-day gap -> filled
    s.iloc[6:11] = np.nan    # 5-day gap -> left empty, not partly filled
    s.iloc[14] = np.nan      # trailing gap -> left empty
    filled, mask, long_gaps = fill_short_gaps(s, max_gap=3)
    assert filled.iloc[2] == 1.0 and filled.iloc[3] == 1.0
    assert filled.iloc[6:11].isna().all()
    assert np.isnan(filled.iloc[14])
    assert int(mask.sum()) == 2
    assert long_gaps == 1
