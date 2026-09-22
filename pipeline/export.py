"""Pipeline entry point: load data, run the analyses, write JSON for the site.

Usage::

    python -m pipeline.export              # real data from Yahoo Finance
    python -m pipeline.export --synthetic  # generated demo data, no network
    python -m pipeline.export --no-cache   # ignore cached downloads

Files written to ``config.DATA_DIR`` (``web/public/data``)::

    meta.json                      run info, sectors, parameters
    overview.json                  TASI (close and OHLC) and Brent series, key stats, movers
    universe.json                  stock list with status and last price
    quality.json                   cleaning report per ticker
    oil_beta.json                  current betas, sector stats, sector series
    oil_beta_series/<ticker>.json  rolling beta history for one stock
    limits.json                    price-limit study (LIMT page)
    limits_events.json             every limit event per stock (LIMT single-stock view)
    tickers.json                   all main-market tickers and names (command bar)
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipeline import config
from pipeline.fetch import MarketData, RawStore, load_market_data, synthetic_source, yahoo_store
from pipeline.limits import main_market_universe, run_study
from pipeline.oil_beta import OilBetaResult, compute_oil_betas, sector_average_series

log = logging.getLogger("pipeline")


# --------------------------------------------------------------------------- #
# JSON helpers
# --------------------------------------------------------------------------- #
def _clean(obj: Any, decimals: int = config.JSON_DECIMALS) -> Any:
    """Recursively convert numpy/pandas values; NaN and inf become None."""
    if isinstance(obj, dict):
        return {str(k): _clean(v, decimals) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v, decimals) for v in obj]
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        f = float(obj)
        return None if not math.isfinite(f) else round(f, decimals)
    if isinstance(obj, pd.Timestamp):
        return obj.strftime("%Y-%m-%d")
    return obj


def write_json(path: Path, data: Any) -> None:
    """Write JSON atomically (temp file, then rename) with compact separators."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(_clean(data), f, ensure_ascii=False, separators=(",", ":"))
    os.chmod(tmp, 0o644)  # mkstemp creates owner-only files; the site needs them world-readable
    os.replace(tmp, path)


def _series_pairs(s: pd.Series, decimals: int = 2) -> list[list]:
    s = s.dropna()
    return [[d.strftime("%Y-%m-%d"), round(float(v), decimals)] for d, v in s.items()]


def _date(ts: pd.Timestamp | None) -> str | None:
    return None if ts is None or pd.isna(ts) else ts.strftime("%Y-%m-%d")


# --------------------------------------------------------------------------- #
# Builders
# --------------------------------------------------------------------------- #
def _pct(a: float, b: float) -> float | None:
    return None if (b is None or not np.isfinite(b) or b == 0 or not np.isfinite(a)) else a / b - 1


def build_overview(md: MarketData) -> dict:
    """TASI and Brent series plus headline statistics."""
    idx = md.index_close.dropna()
    last = idx.iloc[-1]
    n = config.TRADING_DAYS_PER_YEAR

    def back(k: int) -> float:
        return idx.iloc[-1 - k] if len(idx) > k else np.nan

    prev_year = idx[idx.index.year < idx.index[-1].year]
    ytd_base = prev_year.iloc[-1] if len(prev_year) else np.nan
    r = np.log(idx).diff().where(md.index_return_ok.reindex(idx.index)).dropna()
    last_year = idx.iloc[-n:]
    dd = last_year / last_year.cummax() - 1

    stats = {
        "last": last,
        "date": _date(idx.index[-1]),
        "chg_1d": _pct(last, back(1)),
        "chg_1m": _pct(last, back(21)),
        "chg_ytd": _pct(last, ytd_base),
        "chg_1y": _pct(last, back(n)),
        "vol_1y": float(r.iloc[-n:].std() * math.sqrt(n)) if len(r) > 20 else None,
        "max_dd_1y": float(dd.min()),
    }

    oil = {"available": md.oil_close is not None}
    if md.oil_close is not None and len(md.oil_close.dropna()):
        o = md.oil_close.dropna()
        oil.update({"last": o.iloc[-1], "date": _date(o.index[-1]),
                    "chg_1d": _pct(o.iloc[-1], o.iloc[-2]) if len(o) > 1 else None,
                    "chg_1m": _pct(o.iloc[-1], o.iloc[-22]) if len(o) > 22 else None})

    # Movers and breadth on the last calendar day, only for usable returns.
    last_day = md.calendar[-1]
    day_r = md.close.pct_change(fill_method=None).loc[last_day].where(md.return_ok.loc[last_day]).dropna()
    by_ticker = config.stock_by_ticker()

    def mover(t: str) -> dict:
        return {"ticker": t, "name_en": by_ticker[t].name_en, "name_ar": by_ticker[t].name_ar,
                "sector": by_ticker[t].sector, "chg": day_r[t], "close": md.close.loc[last_day, t]}

    ranked = day_r.sort_values()
    k = config.MOVERS_COUNT
    return {
        "tasi": _series_pairs(md.index_close, 2),
        "tasi_ohlc": [[d.strftime("%Y-%m-%d"), *(round(float(v), 2) for v in row)]
                      for d, row in md.index_ohlc[["Open", "High", "Low", "Close"]].iterrows()],
        "brent": _series_pairs(md.oil_close, 2) if md.oil_close is not None else [],
        "stats": stats,
        "oil": oil,
        "movers": {
            "date": _date(last_day),
            "gainers": [mover(t) for t in ranked.index[::-1][:k] if day_r[t] > 0],
            "losers": [mover(t) for t in ranked.index[:k] if day_r[t] < 0],
        },
        "breadth": {"up": int((day_r > 0).sum()), "down": int((day_r < 0).sum()), "flat": int((day_r == 0).sum())},
    }


def build_universe(md: MarketData) -> list[dict]:
    """One entry per configured stock, including ones that failed."""
    out = []
    chg = md.close.pct_change(fill_method=None).where(md.return_ok)
    for s in config.UNIVERSE:
        rep = md.reports.get(s.ticker)
        entry = {"ticker": s.ticker, "name_en": s.name_en, "name_ar": s.name_ar, "sector": s.sector,
                 "shariah": s.shariah, "status": rep.status if rep else "failed",
                 "first_date": rep.first_date if rep else None, "last_close": None, "last_date": None, "chg_1d": None}
        if s.ticker in md.close.columns:
            c = md.close[s.ticker].dropna()
            if len(c):
                entry.update({"last_close": c.iloc[-1], "last_date": _date(c.index[-1]),
                              "chg_1d": chg[s.ticker].iloc[-1]})
        out.append(entry)
    return out


def build_tickers(md: MarketData) -> list[dict]:
    """Every main-market ticker with names, for the command bar's autocomplete.

    ``core`` marks the stocks that have oil-beta pages.
    """
    uni = main_market_universe()
    core = set(md.tickers)
    return [{"ticker": r.ticker, "name_en": r.name_en, "name_ar": r.name_ar or r.name_en, "core": r.ticker in core}
            for r in uni.itertuples()]


def build_quality(md: MarketData) -> dict:
    """Cleaning reports plus a summary."""
    reps = [r.to_dict() for r in md.reports.values()]
    return {
        "summary": {
            "tickers": len(reps),
            "failed": sum(r["status"] == "failed" for r in reps),
            "short_history": sum(r["status"] == "short_history" for r in reps),
            "zero_volume_days_dropped": sum(r["dropped_zero_volume"] for r in reps),
            "bad_prints_removed": sum(r["bad_prints_removed"] for r in reps),
            "suspicious_moves": sum(len(r["suspicious_moves"]) for r in reps),
            "days_forward_filled": sum(r["forward_filled"] for r in reps),
        },
        "tickers": reps,
    }


def _downsample_index(idx: pd.DatetimeIndex) -> pd.DatetimeIndex:
    start = idx[-1] - pd.DateOffset(years=config.SERIES_YEARS)
    recent = idx[idx >= start]
    picked = recent[::-1][:: config.SERIES_STEP][::-1]  # step back from the latest date
    return picked


def build_oil_beta(md: MarketData, res: OilBetaResult) -> dict:
    """Current betas, sector statistics and sector-average history."""
    rows = []
    for t, r in res.current.iterrows():
        rows.append({
            "ticker": t,
            "sector": r["sector"],
            "betas": {str(w): {"oil": r[f"oil_{w}"], "mkt": r[f"mkt_{w}"], "n": int(r[f"n_{w}"])}
                      for w in config.BETA_WINDOWS},
        })
    sec = sector_average_series(res, config.SECTOR_SERIES_WINDOW)
    dates = _downsample_index(md.calendar)
    sec = sec.reindex(dates)
    return {
        "as_of": _date(md.calendar[-1]),
        "method": res.method,
        "windows": list(config.BETA_WINDOWS),
        "rows": rows,
        "sectors": {str(w): res.sector_stats[w] for w in config.BETA_WINDOWS},
        "sector_series": {
            "window": config.SECTOR_SERIES_WINDOW,
            "dates": [_date(d) for d in dates],
            "values": {c: [None if pd.isna(v) else round(float(v), 3) for v in sec[c]] for c in sec.columns},
        },
    }


def build_beta_series(md: MarketData, res: OilBetaResult, ticker: str) -> dict:
    """Downsampled rolling-beta history for one stock."""
    dates = _downsample_index(md.calendar)

    def vals(df: pd.DataFrame) -> list:
        return [None if pd.isna(v) else round(float(v), 3) for v in df[ticker].reindex(dates)]

    return {
        "ticker": ticker,
        "dates": [_date(d) for d in dates],
        "series": {str(w): {"oil": vals(res.oil[w]), "mkt": vals(res.mkt[w])} for w in config.BETA_WINDOWS},
    }


def build_meta(md: MarketData, started: datetime) -> dict:
    """Run metadata, sector labels and the parameters the site displays."""
    universe = {s.ticker for s in config.UNIVERSE}
    failed = sorted(t for t, r in md.reports.items() if r.status == "failed" and t in universe)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "run_seconds": round((datetime.now(timezone.utc) - started).total_seconds(), 1),
        "last_trading_date": _date(md.calendar[-1]),
        "synthetic": md.synthetic,
        "version": config.PIPELINE_VERSION,
        "universe_size": len(config.UNIVERSE),
        "loaded": len(md.tickers),
        "failed": failed,
        "oil_available": md.oil_close is not None,
        "index_source": md.index_source,
        "warnings": md.warnings,
        "sectors": {k: {"en": s.name_en, "ar": s.name_ar} for k, s in config.SECTORS.items()},
        "params": {
            "index": config.INDEX_TICKER,
            "oil": config.OIL_TICKER,
            "start": config.START_DATE,
            "beta_windows": list(config.BETA_WINDOWS),
            "oil_beta_method": config.OIL_BETA_METHOD,
            "price_limit": config.PRICE_LIMIT,
            "max_ffill_days": config.MAX_FFILL_DAYS,
        },
    }


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def run(out_dir: Path = config.DATA_DIR, synthetic: bool = False, use_cache: bool = True) -> None:
    """Run the full pipeline and write every JSON file to ``out_dir``."""
    started = datetime.now(timezone.utc)
    store = RawStore(synthetic_source()) if synthetic else yahoo_store(use_cache)
    md = load_market_data(synthetic=synthetic, store=store)
    res = compute_oil_betas(md)

    # The limit study downloads ~250 stocks. If it fails, the other pages still
    # publish and the LIMT page shows the error instead of stale numbers.
    try:
        limits = run_study(md, store)
    except Exception as exc:  # noqa: BLE001
        log.exception("price-limit study failed")
        limits = {"error": f"{type(exc).__name__}: {exc}"}
        md.warnings.append(f"The price-limit study failed: {type(exc).__name__}: {exc}")

    series_dir = out_dir / "oil_beta_series"
    if series_dir.exists():
        shutil.rmtree(series_dir)  # drop files for tickers that left the universe

    write_json(out_dir / "overview.json", build_overview(md))
    write_json(out_dir / "universe.json", build_universe(md))
    write_json(out_dir / "quality.json", build_quality(md))
    write_json(out_dir / "oil_beta.json", build_oil_beta(md, res))
    events = limits.pop("by_ticker", {})
    write_json(out_dir / "limits.json", limits)
    write_json(out_dir / "limits_events.json", {"columns": ["date", "category", "chg", "next1_ab", "next5_ab", "gap"],
                                                  "tickers": events})
    write_json(out_dir / "tickers.json", build_tickers(md))
    for t in md.tickers:
        write_json(series_dir / f"{t}.json", build_beta_series(md, res, t))
    write_json(out_dir / "meta.json", build_meta(md, started))  # last, so it marks a complete run

    q = build_quality(md)["summary"]
    log.info("wrote data to %s", out_dir)
    log.info("cleaning summary: %s", q)


def main(argv: list[str] | None = None) -> None:
    """Command-line entry point."""
    p = argparse.ArgumentParser(description="Build Tadawul Pulse data files.")
    p.add_argument("--synthetic", action="store_true", help="use generated demo data instead of Yahoo Finance")
    p.add_argument("--no-cache", action="store_true", help="ignore cached downloads")
    p.add_argument("--out", type=Path, default=config.DATA_DIR, help="output directory")
    p.add_argument("-v", "--verbose", action="store_true", help="log every individual cleaning action")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("pipeline").setLevel(logging.DEBUG if args.verbose else logging.INFO)
    run(out_dir=args.out, synthetic=args.synthetic, use_cache=not args.no_cache)


if __name__ == "__main__":
    main()
