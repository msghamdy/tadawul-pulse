import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { useData } from "../lib/data";
import { stockPath } from "../lib/commands";
import type { Overview, StockInfo } from "../types";

interface Item {
  key: string;
  code: string;
  name: string;
  last: number | null;
  chg: number | null;
  to: string;
}

/** Scrolling strip of TASI and every stock's last price and daily change. Pauses on hover. */
export default function TickerTape() {
  const { num, pct, lang } = useI18n();
  const uni = useData<StockInfo[]>("universe.json");
  const ov = useData<Overview>("overview.json");

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (ov.status === "ready") {
      const s = ov.data.stats;
      out.push({ key: "TASI", code: "TASI", name: "", last: s.last, chg: s.chg_1d, to: "/" });
    }
    if (uni.status === "ready") {
      for (const x of uni.data) {
        if (x.last_close == null) continue;
        const name = lang === "ar" ? x.name_ar : x.name_en.toUpperCase().slice(0, 14).trim();
        out.push({ key: x.ticker, code: x.ticker.replace(".SR", ""), name, last: x.last_close, chg: x.chg_1d, to: stockPath(x.ticker) });
      }
    }
    return out;
  }, [uni, ov, lang]);

  if (items.length === 0) return <div className="h-[20px] border-y border-border" />;

  const row = (hidden: boolean) =>
    items.map((it) => {
      const color = it.chg == null ? "text-muted" : it.chg > 0 ? "text-up" : it.chg < 0 ? "text-down" : "text-flat";
      const arrow = it.chg == null ? "" : it.chg > 0 ? "▲" : it.chg < 0 ? "▼" : "■";
      return (
        <Link
          key={`${hidden ? "b" : "a"}-${it.key}`}
          to={it.to}
          tabIndex={hidden ? -1 : 0}
          aria-hidden={hidden || undefined}
          className="flex shrink-0 items-baseline gap-1.5 px-3 hover:bg-hover"
        >
          <span className="font-semibold text-yellow num">{it.code}</span>
          {it.name && <span className="text-dim">{it.name}</span>}
          <span className="text-text num">{num(it.last, 2)}</span>
          <span className={`num ${color}`} dir="ltr">
            {arrow}
            {pct(it.chg, 2)}
          </span>
        </Link>
      );
    });

  return (
    <div className="tape relative overflow-hidden border-y border-border text-xs leading-[18px] motion-reduce:overflow-x-auto" dir="ltr">
      <div className="tape-track flex w-max" style={{ ["--tape-duration" as string]: `${Math.max(40, items.length * 3)}s` }}>
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
