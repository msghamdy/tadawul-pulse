// Page codes shared by the command bar and the function-key bar.
import type { StringKey } from "../i18n";

export interface PageCode {
  code: string;
  fkey: string;
  path: string;
  label: StringKey;
  /** Build phase that ships this page; undefined when it exists already. */
  phase?: number;
  /** The page can show a single stock (CODE + ticker). */
  takesTicker?: boolean;
}

export const PAGES: PageCode[] = [
  { code: "HOME", fkey: "F1", path: "/", label: "nav_overview" },
  { code: "BETA", fkey: "F2", path: "/oil-beta", label: "nav_oil", takesTicker: true },
  { code: "FACT", fkey: "F3", path: "/factors", label: "nav_factors", phase: 3 },
  { code: "SEAS", fkey: "F4", path: "/seasonality", label: "nav_seasonality", phase: 4 },
  { code: "PAIR", fkey: "F5", path: "/pairs", label: "nav_pairs", phase: 5 },
  { code: "LIMT", fkey: "F6", path: "/limits", label: "nav_limits", takesTicker: true },
];

/** Default page for a bare ticker: its oil and market betas. */
export function stockPath(ticker: string, code = "BETA"): string {
  const page = PAGES.find((p) => p.code === code && p.takesTicker) ?? PAGES[1];
  return `${page.path}/${encodeURIComponent(ticker)}`;
}

/**
 * Parse "2222", "2222 LIMT", "LIMT 2222", "2222 <GO>" or "BETA".
 * Returns the target path, or null if the command isn't understood.
 */
export function parseCommand(input: string, tickers: string[]): string | null {
  const tokens = input
    .toUpperCase()
    .replace(/<?GO>?/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const findTicker = (t: string) => tickers.find((x) => x === t || x === `${t}.SR`);
  const findPage = (t: string) => PAGES.find((p) => p.code === t);

  if (tokens.length === 1) {
    const page = findPage(tokens[0]);
    if (page) return page.path;
    const tk = findTicker(tokens[0]);
    return tk ? stockPath(tk) : null;
  }
  if (tokens.length === 2) {
    const [a, b] = tokens;
    const tk = findTicker(a) ?? findTicker(b);
    const page = findPage(a) ?? findPage(b);
    if (tk && page) return page.takesTicker ? stockPath(tk, page.code) : page.path;
  }
  return null;
}
