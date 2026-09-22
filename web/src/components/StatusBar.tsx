import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { useData } from "../lib/data";
import { riyadhNow } from "../lib/riyadh";
import type { Meta } from "../types";

/** Riyadh clock, schedule-based market status, data timestamps and the disclaimer. */
export default function StatusBar() {
  const { t, date, dateTime } = useI18n();
  const meta = useData<Meta>("meta.json");
  const [now, setNow] = useState(() => riyadhNow());

  useEffect(() => {
    const id = window.setInterval(() => setNow(riyadhNow()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const m = meta.status === "ready" ? meta.data : null;

  return (
    <div className="border-t border-border px-2 py-[3px] text-2xs uppercase">
      <div className="flex items-center gap-x-4 overflow-x-auto whitespace-nowrap">
        <span className="text-dim">
          {t("riyadh")} <span className="text-text num">{now.hms}</span> <span className="num">{now.weekday.toUpperCase()}</span>
        </span>
        <span title={t("market_hint")} className={`flex items-center gap-1 font-semibold ${now.open ? "text-up" : "text-down"}`}>
          <span className={`inline-block h-2 w-2 ${now.open ? "bg-up" : "bg-down"}`} aria-hidden="true" />
          {now.open ? t("market_open") : t("market_closed")}
        </span>
        {m && (
          <span className="text-dim">
            {t("data_updated")} <span className="text-text num">{date(m.last_trading_date)}</span>
            <span className="ms-2 text-muted">
              {t("upd")} <span className="num">{dateTime(m.generated_at)}</span>
            </span>
          </span>
        )}
        <span role="note" className="hidden normal-case text-amber md:ms-auto md:inline">
          {t("disclaimer")}
        </span>
        <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer" className="hidden normal-case text-muted hover:text-amber md:inline">
          {t("charts_by")}
        </a>
      </div>
      <p role="note" className="normal-case text-amber md:hidden">
        {t("disclaimer")}
      </p>
    </div>
  );
}
