// Page codes shared by the command bar and the function-key bar.
import type { StringKey } from "../i18n";

export interface PageCode {
  code: string;
  fkey: string;
  path: string;
  label: StringKey;
  /** Build phase that ships this page; undefined when it exists already. */
  phase?: number;
}

export const PAGES: PageCode[] = [
  { code: "HOME", fkey: "F1", path: "/", label: "nav_overview" },
  { code: "BETA", fkey: "F2", path: "/oil-beta", label: "nav_oil" },
  { code: "FACT", fkey: "F3", path: "/factors", label: "nav_factors", phase: 2 },
  { code: "SEAS", fkey: "F4", path: "/seasonality", label: "nav_seasonality", phase: 3 },
  { code: "PAIR", fkey: "F5", path: "/pairs", label: "nav_pairs", phase: 4 },
];

/** Path for a stock: its history on the oil beta page. */
export function stockPath(ticker: string): string {
  return `/oil-beta/${encodeURIComponent(ticker)}`;
}
