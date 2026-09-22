// Shapes of the JSON files written by pipeline/export.py.

export type Num = number | null;

export interface Meta {
  generated_at: string;
  run_seconds: number;
  last_trading_date: string | null;
  synthetic: boolean;
  version: string;
  universe_size: number;
  loaded: number;
  failed: string[];
  oil_available: boolean;
  /** "proxy" when Yahoo's TASI history was too short and an equal-weighted index was used */
  index_source: "yahoo" | "proxy";
  warnings: string[];
  sectors: Record<string, { en: string; ar: string }>;
  params: {
    index: string;
    oil: string;
    start: string;
    beta_windows: number[];
    oil_beta_method: "dimson" | "same_day";
    price_limit: number;
    max_ffill_days: number;
  };
}

export interface Mover {
  ticker: string;
  name_en: string;
  name_ar: string;
  sector: string;
  chg: number;
  close: number;
}

export interface Overview {
  tasi: [string, number][];
  /** [date, open, high, low, close] */
  tasi_ohlc: [string, number, number, number, number][];
  brent: [string, number][];
  stats: {
    last: number;
    date: string;
    chg_1d: Num;
    chg_1m: Num;
    chg_ytd: Num;
    chg_1y: Num;
    vol_1y: Num;
    max_dd_1y: Num;
  };
  oil: { available: boolean; last?: number; date?: string; chg_1d?: Num; chg_1m?: Num };
  movers: { date: string; gainers: Mover[]; losers: Mover[] };
  breadth: { up: number; down: number; flat: number };
}

export interface StockInfo {
  ticker: string;
  name_en: string;
  name_ar: string;
  sector: string;
  shariah: boolean;
  status: "ok" | "short_history" | "failed";
  first_date: string | null;
  last_close: Num;
  last_date: string | null;
  chg_1d: Num;
}

export interface QualitySummary {
  tickers: number;
  failed: number;
  short_history: number;
  zero_volume_days_dropped: number;
  bad_prints_removed: number;
  suspicious_moves: number;
  days_forward_filled: number;
}

export interface Quality {
  summary: QualitySummary;
}

export interface BetaPair {
  oil: Num;
  mkt: Num;
  n: number;
}

export interface OilBetaRow {
  ticker: string;
  sector: string;
  betas: Record<string, BetaPair>;
}

export interface SectorStat {
  oil_mean: Num;
  oil_median: Num;
  mkt_mean: Num;
  mkt_median: Num;
  n: number;
}

export interface OilBeta {
  as_of: string;
  method: "dimson" | "same_day";
  windows: number[];
  rows: OilBetaRow[];
  sectors: Record<string, Record<string, SectorStat>>;
  sector_series: { window: number; dates: string[]; values: Record<string, Num[]> };
}

export interface BetaSeries {
  ticker: string;
  dates: string[];
  series: Record<string, { oil: Num[]; mkt: Num[] }>;
}

export interface TickerInfo {
  ticker: string;
  name_en: string;
  name_ar: string;
  /** Has an oil-beta page (part of the core research universe). */
  core: boolean;
}

// ---- limits.json (price-limit study) ----

export type LimitCategory = "lock_up" | "touch_up" | "near_up" | "lock_down" | "touch_down" | "near_down";

export interface Stat {
  n: number;
  dates: number;
  mean: Num;
  lo: Num;
  hi: Num;
  median: Num;
  hit: Num;
  significant: boolean;
}

export interface Backtest {
  signal: LimitCategory;
  hold: number;
  cost_bps: number;
  trades: number;
  skipped_locked_open: number;
  avg_net: Num;
  median_net: Num;
  hit: Num;
  total: Num;
  cagr: Num;
  max_dd: Num;
  exposure: Num;
  bench_total: Num;
  equity: [string, number][];
  bench: [string, number][];
}

export interface Continuation {
  p_next_lock: Num;
  p_lock_any_day: Num;
  lock_ratio: Num;
  streaks: Record<string, number>;
}

export interface LimitEvent {
  date: string;
  ticker: string;
  category: LimitCategory;
  chg: number;
  next1_ab: Num;
  next5_ab: Num;
  gap: Num;
}

export interface Limits {
  error?: string;
  as_of: string;
  period: { start: string | null; end: string };
  universe: { configured: number; loaded: number; failed: string[] };
  market: "yahoo" | "proxy";
  params: {
    limit: number;
    near_miss: number;
    horizons: number[];
    hold: number;
    cost_bps: number;
    listing_exclude: number;
    bootstrap: number;
    car_window: [number, number];
    start: string;
  };
  data_checks: { excluded_beyond_limit: number; high_low_repaired: number; stock_days_studied: number; off_grid_fallback: number };
  counts: Record<LimitCategory, number>;
  baseline: { by_h: Record<string, { cc_ab: Num; oc: Num }>; gap: Num };
  stats: Record<LimitCategory, Record<string, { cc_ab: Stat; oc: Stat }> & { gap: Stat }>;
  car: { k: number[] } & Record<LimitCategory, { mean: Num[]; lo: Num[]; hi: Num[]; n: number[] }>;
  continuation: { up: Continuation; down: Continuation };
  breakdown: {
    liquidity: Record<string, Record<string, Record<"low" | "mid" | "high", Stat>>>;
    year: Record<string, Record<string, Record<string, Stat>>>;
  };
  backtests: Backtest[];
  today: { date: string; events: { ticker: string; category: LimitCategory; chg: number; close: number; high: number; low: number }[] };
  log: LimitEvent[];
  names: Record<string, { en: string; ar: string }>;
  warnings: string[];
}

export interface LimitEventsFile {
  columns: ["date", "category", "chg", "next1_ab", "next5_ab", "gap"];
  /** [date, category, chg, next1_ab, next5_ab, gap] per event, newest first */
  tickers: Record<string, [string, LimitCategory, number, Num, Num, Num][]>;
}
