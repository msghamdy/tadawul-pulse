import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../lib/data";
import { Gate } from "../components/States";
import Panel, { PageBar, Segmented } from "../components/Panel";
import { Chg, Val } from "../components/Num";
import TimeSeriesChart, { type Candle, type ChartLine } from "../components/TimeSeriesChart";
import { useI18n, type StringKey } from "../i18n";
import { stockPath } from "../lib/commands";
import { sectorColor } from "../lib/colors";
import type { Meta, Mover, Overview as OverviewData, Quality, StockInfo } from "../types";

type Range = "1y" | "3y" | "5y" | "all";
const RANGES: { id: Range; key: StringKey; years: number | null }[] = [
  { id: "1y", key: "range_1y", years: 1 },
  { id: "3y", key: "range_3y", years: 3 },
  { id: "5y", key: "range_5y", years: 5 },
  { id: "all", key: "range_all", years: null },
];

function cutoff(lastIso: string, years: number | null): string {
  if (!years) return "0000";
  const d = new Date(`${lastIso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

export default function Overview() {
  const overview = useData<OverviewData>("overview.json");
  const meta = useData<Meta>("meta.json");
  const quality = useData<Quality>("quality.json");
  const universe = useData<StockInfo[]>("universe.json");
  return (
    <Gate states={[overview, meta, quality, universe] as const}>
      {(o, m, q, u) => <OverviewBody o={o} m={m} q={q} u={u} />}
    </Gate>
  );
}

function OverviewBody({ o, m, q, u }: { o: OverviewData; m: Meta; q: Quality; u: StockInfo[] }) {
  const { t, date } = useI18n();
  const [range, setRange] = useState<Range>("1y");
  const years = RANGES.find((r) => r.id === range)!.years;

  const lastIso = o.tasi.length ? o.tasi[o.tasi.length - 1][0] : "";
  const candles = useMemo<Candle[]>(() => {
    const cut = cutoff(lastIso, years);
    return o.tasi_ohlc.filter((r) => r[0] >= cut).map(([time, open, high, low, close]) => ({ time, open, high, low, close }));
  }, [o.tasi_ohlc, lastIso, years]);

  const brent = useMemo(() => {
    const cut = cutoff(lastIso, years);
    return o.brent.filter(([d]) => d >= cut);
  }, [o.brent, lastIso, years]);
  const brentLines = useMemo<ChartLine[]>(() => {
    const up = brent.length > 1 && brent[brent.length - 1][1] >= brent[0][1];
    return [{ id: "brent", color: up ? "up" : "down", data: brent.map(([time, value]) => ({ time, value })) }];
  }, [brent]);

  const rangePicker = (
    <Segmented label={t("chart_range")} value={range} onChange={setRange} options={RANGES.map((r) => ({ id: r.id, label: t(r.key) }))} />
  );
  const lastBar = o.tasi_ohlc[o.tasi_ohlc.length - 1];
  const prevClose = o.tasi_ohlc.length > 1 ? o.tasi_ohlc[o.tasi_ohlc.length - 2][4] : null;

  return (
    <div className="space-y-1">
      <PageBar code="HOME" title={t("nav_overview")} right={<span className="num">{t("as_of")} {date(o.stats.date)}</span>} />

      <div className="grid grid-cols-1 gap-1 lg:grid-cols-12">
        <Panel title={t("tasi_long")} meta={rangePicker} className="lg:col-span-8">
          <QuoteLine
            code="TASI"
            last={o.stats.last}
            change={prevClose != null ? o.stats.last - prevClose : null}
            pctChange={o.stats.chg_1d}
            extra={
              lastBar && (
                <>
                  <OHL label="O" v={lastBar[1]} />
                  <OHL label="H" v={lastBar[2]} />
                  <OHL label="L" v={lastBar[3]} />
                </>
              )
            }
          />
          <TimeSeriesChart candles={candles} height={290} digits={0} label={t("tasi_long")} />
        </Panel>

        <Panel title={t("p_stats")} pad={false} className="lg:col-span-4">
          <table className="w-full text-sm">
            <tbody>
              <StatRow label={t("last")}>
                <Val value={o.stats.last} className="text-yellow font-semibold" />
              </StatRow>
              <StatRow label={t("chg_1d")}><Chg value={o.stats.chg_1d} /></StatRow>
              <StatRow label={t("chg_1m")}><Chg value={o.stats.chg_1m} /></StatRow>
              <StatRow label={t("chg_ytd")}><Chg value={o.stats.chg_ytd} /></StatRow>
              <StatRow label={t("chg_1y")}><Chg value={o.stats.chg_1y} /></StatRow>
              <StatRow label={t("vol_1y")}><Val value={o.stats.vol_1y != null ? o.stats.vol_1y * 100 : null} />%</StatRow>
              <StatRow label={t("max_dd_1y")}><Chg value={o.stats.max_dd_1y} /></StatRow>
              {o.oil.available && (
                <StatRow label={`${t("brent")} ${t("per_barrel")}`}>
                  <Val value={o.oil.last ?? null} className="text-yellow" /> <Chg value={o.oil.chg_1d} />
                </StatRow>
              )}
            </tbody>
          </table>
        </Panel>

        <Panel title={t("brent")} meta={<span className="num">BZ=F</span>} className="lg:col-span-4">
          {o.oil.available ? (
            <>
              <QuoteLine code="BRENT" last={o.oil.last ?? null} pctChange={o.oil.chg_1d ?? null} extra={<span className="text-muted">{t("per_barrel")}</span>} />
              <TimeSeriesChart lines={brentLines} height={170} label={t("brent")} />
            </>
          ) : (
            <p className="text-xs text-muted">--</p>
          )}
        </Panel>

        <Panel title={t("gainers")} pad={false} meta={<span className="num">{date(o.movers.date)}</span>} className="lg:col-span-4">
          <MoverTable items={o.movers.gainers} />
        </Panel>
        <Panel title={t("losers")} pad={false} meta={<span className="num">{date(o.movers.date)}</span>} className="lg:col-span-4">
          <MoverTable items={o.movers.losers} />
        </Panel>

        <Panel title={t("p_monitor")} pad={false} meta={<span className="num">{u.filter((x) => x.last_close != null).length}</span>} className="lg:col-span-8">
          <Monitor stocks={u} meta={m} />
        </Panel>

        <div className="grid gap-1 lg:col-span-4 lg:content-start">
          <Panel title={t("breadth")}>
            <Breadth up={o.breadth.up} down={o.breadth.down} flat={o.breadth.flat} />
          </Panel>
          <Panel title={t("p_quality")} pad={false}>
            <table className="w-full text-sm">
              <tbody>
                <StatRow label={t("q_loaded")}>
                  <span className="num text-text">{m.loaded}/{m.universe_size}</span>
                </StatRow>
                <StatRow label={t("q_failed")}>
                  <span className={`num ${m.failed.length ? "text-down" : "text-text"}`} title={m.failed.join(", ")}>
                    {m.failed.length ? m.failed.map((x) => x.replace(".SR", "")).join(" ") : "0"}
                  </span>
                </StatRow>
                <StatRow label={t("q_zero")}><Val value={q.summary.zero_volume_days_dropped} digits={0} /></StatRow>
                <StatRow label={t("q_bad")}><Val value={q.summary.bad_prints_removed} digits={0} /></StatRow>
                <StatRow label={t("q_flag")}><Val value={q.summary.suspicious_moves} digits={0} /></StatRow>
                <StatRow label={t("q_fill")}><Val value={q.summary.days_forward_filled} digits={0} /></StatRow>
              </tbody>
            </table>
            <p className="border-t border-border px-2 py-1 text-2xs text-muted">
              {t("source")}{" "}
              <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer" className="underline hover:text-amber">
                {t("charts_by")}
              </a>
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function QuoteLine({ code, last, change, pctChange, extra }: { code: string; last: number | null; change?: number | null; pctChange: number | null; extra?: ReactNode }) {
  const { num } = useI18n();
  const color = pctChange == null ? "text-muted" : pctChange > 0 ? "text-up" : pctChange < 0 ? "text-down" : "text-flat";
  return (
    <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm num" dir="ltr">
      <span className="font-semibold text-amber">{code}</span>
      <span className="text-lg font-semibold text-yellow">{num(last, 2)}</span>
      {change != null && (
        <span className={color}>
          {change > 0 ? "+" : ""}
          {num(change, 2)}
        </span>
      )}
      <Chg value={pctChange} />
      {extra && <span className="flex gap-3 text-xs">{extra}</span>}
    </div>
  );
}

function OHL({ label, v }: { label: string; v: number }) {
  const { num } = useI18n();
  return (
    <span>
      <span className="text-amber">{label}</span> <span className="text-dim">{num(v, 2)}</span>
    </span>
  );
}

function StatRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <th scope="row" className="px-2 py-[3px] text-start font-normal text-amber">{label}</th>
      <td className="px-2 py-[3px] text-end">{children}</td>
    </tr>
  );
}

function MoverTable({ items }: { items: Mover[] }) {
  const { t, pick } = useI18n();
  const navigate = useNavigate();
  if (items.length === 0) return <p className="p-2 text-xs text-muted">{t("no_movers")}</p>;
  return (
    <table className="w-full table-fixed text-sm">
      <colgroup>
        <col className="w-[3.5rem]" />
        <col />
        <col className="w-[5rem]" />
        <col className="w-[5rem]" />
      </colgroup>
      <thead>
        <tr className="border-b border-border text-2xs uppercase text-amber">
          <th className="px-2 py-0.5 text-start font-normal">{t("col_tkr")}</th>
          <th className="px-2 py-0.5 text-start font-normal">{t("col_name")}</th>
          <th className="px-2 py-0.5 text-end font-normal">{t("col_last")}</th>
          <th className="px-2 py-0.5 text-end font-normal">{t("col_chg")}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((m) => (
          <tr key={m.ticker} onClick={() => navigate(stockPath(m.ticker))} className="cursor-pointer border-b border-border/60 hover:bg-hover">
            <td className="px-2 py-[2px] font-semibold text-yellow num">{m.ticker.replace(".SR", "")}</td>
            <td className="truncate px-2 py-[2px] text-text">{pick(m)}</td>
            <td className="px-2 py-[2px] text-end"><Val value={m.close} /></td>
            <td className="px-2 py-[2px] text-end"><Chg value={m.chg} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Monitor({ stocks, meta }: { stocks: StockInfo[]; meta: Meta }) {
  const { t, pick, lang } = useI18n();
  const navigate = useNavigate();
  const rows = useMemo(
    () =>
      [...stocks]
        .filter((s) => s.last_close != null)
        .sort((a, b) => (a.sector === b.sector ? a.ticker.localeCompare(b.ticker) : a.sector.localeCompare(b.sector))),
    [stocks],
  );
  return (
    <div className="max-h-[360px] overflow-auto">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-[3.5rem]" />
          <col />
          <col className="hidden w-[14rem] sm:table-column" />
          <col className="w-[5rem]" />
          <col className="w-[5rem]" />
        </colgroup>
        <thead className="sticky top-0 bg-bg">
          <tr className="border-b border-border text-2xs uppercase text-amber">
            <th className="px-2 py-0.5 text-start font-normal">{t("col_tkr")}</th>
            <th className="px-2 py-0.5 text-start font-normal">{t("col_name")}</th>
            <th className="hidden px-2 py-0.5 text-start font-normal sm:table-cell">{t("sector")}</th>
            <th className="px-2 py-0.5 text-end font-normal">{t("col_last")}</th>
            <th className="px-2 py-0.5 text-end font-normal">{t("col_chg")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.ticker} onClick={() => navigate(stockPath(s.ticker))} className="cursor-pointer border-b border-border/60 hover:bg-hover">
              <td className="px-2 py-[2px] font-semibold text-yellow num">{s.ticker.replace(".SR", "")}</td>
              <td className="truncate px-2 py-[2px] text-text">{pick(s)}</td>
              <td className="hidden truncate px-2 py-[2px] text-dim sm:table-cell">
                <span className="me-1.5 inline-block h-2 w-2 align-middle" style={{ background: sectorColor(s.sector) }} aria-hidden="true" />
                {meta.sectors[s.sector]?.[lang] ?? s.sector}
              </td>
              <td className="px-2 py-[2px] text-end"><Val value={s.last_close} /></td>
              <td className="px-2 py-[2px] text-end"><Chg value={s.chg_1d} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Breadth({ up, down, flat }: { up: number; down: number; flat: number }) {
  const { t } = useI18n();
  const total = up + down + flat || 1;
  return (
    <div>
      <div className="flex h-3 border border-border" dir="ltr" aria-hidden="true">
        <div className="bg-up" style={{ width: `${(up / total) * 100}%` }} />
        <div className="bg-flat" style={{ width: `${(flat / total) * 100}%` }} />
        <div className="bg-down" style={{ width: `${(down / total) * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-sm num">
        <span className="text-up">{t("advancing")} {up}</span>
        <span className="text-flat">{t("unchanged")} {flat}</span>
        <span className="text-down">{t("declining")} {down}</span>
      </div>
    </div>
  );
}
