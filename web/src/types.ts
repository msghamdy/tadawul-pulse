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
