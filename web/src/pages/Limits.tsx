import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useData } from "../lib/data";
import { ErrorState, Gate, Loading } from "../components/States";
import Panel, { NumberedMenu, PageBar, Segmented } from "../components/Panel";
import { Chg } from "../components/Num";
import TimeSeriesChart, { type ChartLine } from "../components/TimeSeriesChart";
import { useI18n, type StringKey } from "../i18n";
import { token } from "../lib/colors";
import { rechartsTheme } from "../lib/chartTheme";
import { stockPath } from "../lib/commands";
import type { LimitCategory, LimitEventsFile, Limits as LimitsData, Num, Stat } from "../types";

type Side = "up" | "down";
const CATS: Record<Side, LimitCategory[]> = {
  up: ["lock_up", "touch_up", "near_up"],
  down: ["lock_down", "touch_down", "near_down"],
};
// Line colours per category rank: locked, touched, near miss.
const CAT_COLOR = ["amber", "mkt", "dim"] as const;

const IDS = {
  summary: "limt-summary",
  path: "limt-path",
  table: "limt-table",
  breakdown: "limt-breakdown",
  backtest: "limt-backtest",
  today: "limt-today",
  log: "limt-log",
  method: "limt-method",
  stock: "limt-stock",
};

export default function Limits() {
  const data = useData<LimitsData>("limits.json");
  return <Gate states={[data] as const}>{(d) => (d.error ? <StudyError message={d.error} /> : <LimitsBody d={d} />)}</Gate>;
}

function StudyError({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <div className="space-y-1">
      <PageBar code="LIMT" title={t("nav_limits")} />
      <ErrorState missing={false} message={t("l_error", { e: message })} />
    </div>
  );
}

function LimitsBody({ d }: { d: LimitsData }) {
  const { t, date } = useI18n();
  const params = useParams();
  const ticker = params.ticker ? decodeURIComponent(params.ticker) : null;
  const [side, setSide] = useState<Side>("up");
  const stockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ticker) stockRef.current?.scrollIntoView({ block: "start" });
  }, [ticker]);

  const sideOptions = [
    { id: "up" as Side, label: t("side_up") },
    { id: "down" as Side, label: t("side_down") },
  ];
  const menu = [
    { n: 1, label: t("l_m_summary"), target: IDS.summary },
    { n: 2, label: t("l_m_path"), target: IDS.path },
    { n: 3, label: t("l_m_table"), target: IDS.table },
    { n: 4, label: t("l_m_break"), target: IDS.breakdown },
    { n: 5, label: t("l_m_bt"), target: IDS.backtest },
    { n: 6, label: t("l_m_today"), target: IDS.today },
    { n: 7, label: t("l_m_log"), target: IDS.log },
    { n: 8, label: t("l_m_method"), target: IDS.method },
  ];

  return (
    <div className="space-y-1">
      <PageBar code="LIMT" title={t("nav_limits")} right={<span className="num">{t("data_as_of", { date: date(d.as_of) })}</span>} />
      <div className="flex flex-wrap items-center justify-between gap-2 border border-border px-1.5 py-1">
        <NumberedMenu items={menu} label={t("l_menu")} />
        <Segmented label={t("side_up")} value={side} onChange={setSide} options={sideOptions} />
      </div>
      <p className="px-1 text-sm text-text">{t("l_title")}</p>

      {ticker && (
        <div ref={stockRef} className="scroll-mt-24">
          <StockHistory ticker={ticker} d={d} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-1 lg:grid-cols-12">
        <Panel id={IDS.summary} n={1} title={t("l_m_summary")} pad={false} className="lg:col-span-4">
          <Summary d={d} side={side} />
        </Panel>
        <Panel id={IDS.path} n={2} title={t("l_path_title")} className="lg:col-span-8">
          <p className="mb-1 text-2xs text-dim">{t("l_path_hint")}</p>
          <PathChart d={d} side={side} />
        </Panel>

        <Panel id={IDS.table} n={3} title={t("l_table_title")} pad={false} className="lg:col-span-12">
          <ReturnsTable d={d} side={side} />
        </Panel>

        <Panel id={IDS.breakdown} n={4} title={t("l_break_title", { cat: t(CATS[side][0]).toLowerCase() })} pad={false} className="lg:col-span-12">
          <Breakdown d={d} side={side} />
        </Panel>

        <Panel id={IDS.backtest} n={5} title={t("l_bt_title", { h: d.params.hold })} className="lg:col-span-8">
          <BacktestView d={d} side={side} />
        </Panel>
        <Panel id={IDS.today} n={6} title={t("l_today_title")} pad={false} meta={<span className="num">{date(d.today.date)}</span>} className="lg:col-span-4">
          <Today d={d} />
        </Panel>

        <Panel id={IDS.log} n={7} title={t("l_log_title")} pad={false} className="lg:col-span-8">
          <EventLog d={d} />
        </Panel>
        <Panel id={IDS.method} n={8} title={t("l_m_method")} className="lg:col-span-4">
          <Method d={d} />
        </Panel>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Formatting helpers

function Pct({ v, digits = 2 }: { v: Num | undefined; digits?: number }) {
  return <Chg value={v ?? null} digits={digits} />;
}

/** A formatted number that keeps its left-to-right order inside Arabic text. */
function N({ children }: { children: ReactNode }) {
  return (
    <span dir="ltr" className="num">
      {children}
    </span>
  );
}

function Range({ s }: { s: Stat }) {
  const { pct } = useI18n();
  if (s.lo == null || s.hi == null) return <span className="text-muted">--</span>;
  return (
    <span className="text-dim num" dir="ltr">
      [{pct(s.lo, 2)}, {pct(s.hi, 2)}]
    </span>
  );
}

function SigMark({ s, refLabel }: { s: Stat; refLabel: string }) {
  const { t } = useI18n();
  return s.significant ? (
    <span className="text-yellow" title={t("l_sig", { ref: refLabel })} aria-label={t("l_sig", { ref: refLabel })}>
      ■
    </span>
  ) : (
    <span className="text-muted" title={t("l_not_sig")} aria-label={t("l_not_sig")}>
      □
    </span>
  );
}

function Row({ label, children, labelClass = "text-amber" }: { label: ReactNode; children: ReactNode; labelClass?: string }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <th scope="row" className={`px-1.5 py-[2px] text-start font-normal ${labelClass}`}>{label}</th>
      <td className="px-1.5 py-[2px] text-end">{children}</td>
    </tr>
  );
}

// --------------------------------------------------------------------------- //

function Summary({ d, side }: { d: LimitsData; side: Side }) {
  const { t, date, pct } = useI18n();
  const c = d.continuation[side];
  const cats = CATS[side];
  const streakKeys = ["1", "2", "3", "4", "5+"];
  return (
    <table className="w-full text-sm">
      <tbody>
        <Row label={t("l_period")}>
          <span className="text-text num">{date(d.period.start)} – {date(d.period.end)}</span>
        </Row>
        <Row label={t("l_universe")}>
          <span className="text-text num">{d.universe.loaded}/{d.universe.configured}</span>
        </Row>
        {cats.map((k, i) => (
          <Row key={k} label={<span title={t(`${k}_d` as StringKey)}>{t(k)}</span>} labelClass={i === 0 ? "text-yellow" : "text-amber"}>
            <span className="text-text num">{d.counts[k].toLocaleString("en-US")}</span>
          </Row>
        ))}
        <Row label={t("l_lock_ratio")}>
          <span className="text-text num" dir="ltr">{pct(c.lock_ratio, 1, false)}</span>
        </Row>
        <Row label={t("l_next_lock")}>
          <span className="text-text num" dir="ltr">{pct(c.p_next_lock, 1, false)}</span>
          <span className="ms-2 text-muted num">
            {t("l_any_day")} <N>{pct(c.p_lock_any_day, 2, false)}</N>
          </span>
        </Row>
        <Row label={t("l_streaks")}>
          <span className="flex justify-end gap-2 num" dir="ltr">
            {streakKeys.map((k) => (
              <span key={k}>
                <span className="text-muted">{k}:</span>
                <span className="text-text">{c.streaks[k] ?? 0}</span>
              </span>
            ))}
          </span>
        </Row>
      </tbody>
    </table>
  );
}

function PathChart({ d, side }: { d: LimitsData; side: Side }) {
  const { t, pct } = useI18n();
  const th = rechartsTheme();
  const cats = CATS[side];
  const rows = d.car.k.map((k, i) => {
    const r: Record<string, number | null | [number, number]> = { k };
    cats.forEach((c) => {
      const m = d.car[c].mean[i];
      r[c] = m == null ? null : m * 100;
    });
    const lo = d.car[cats[0]].lo[i];
    const hi = d.car[cats[0]].hi[i];
    r.band = k > 0 && lo != null && hi != null ? [lo * 100, hi * 100] : null;
    return r;
  });
  return (
    <div>
    <div dir="ltr" className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 6, right: 12, bottom: 14, left: 0 }}>
          <CartesianGrid {...th.grid} />
          <XAxis dataKey="k" type="number" domain={["dataMin", "dataMax"]} ticks={d.car.k} {...th.axis}
            label={{ value: t("l_day").toUpperCase(), position: "insideBottom", offset: -8, ...th.label(token("amber")) }} />
          <YAxis {...th.axis} width={44} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
          <ReferenceLine y={0} stroke={th.ref} />
          <ReferenceLine x={0} stroke={token("yellow")} strokeDasharray="2 3" />
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: token("muted"), strokeDasharray: "3 3" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="border border-amber bg-bg px-2 py-1 text-xs">
                  <p className="text-amber num">
                    {t("l_day")} {label}
                  </p>
                  {cats.map((c, i) => {
                    const v = payload.find((p) => p.dataKey === c)?.value as number | undefined;
                    return (
                      <p key={c} className="num" style={{ color: token(CAT_COLOR[i]) }}>
                        {t(c)} <N>{v == null ? "--" : pct(v / 100, 2)}</N>
                      </p>
                    );
                  })}
                </div>
              );
            }}
          />
          <Area dataKey="band" stroke="none" fill={token("amber", 0.18)} isAnimationActive={false} connectNulls={false} />
          {cats.map((c, i) => (
            <Line key={c} dataKey={c} stroke={token(CAT_COLOR[i])} strokeWidth={i === 0 ? 2 : 1.5} dot={false} isAnimationActive={false} connectNulls />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
      <p className="mt-1 flex flex-wrap gap-x-3 text-2xs">
        {cats.map((c, i) => (
          <span key={c} style={{ color: token(CAT_COLOR[i]) }}>
            ■ {t(c)}
          </span>
        ))}
      </p>
    </div>
  );
}

function ReturnsTable({ d, side }: { d: LimitsData; side: Side }) {
  const { t, pct } = useI18n();
  const cats = CATS[side];
  const hs = d.params.horizons.map(String);
  const measures: { key: "cc_ab" | "oc"; label: StringKey }[] = [
    { key: "cc_ab", label: "m_cc_ab" },
    { key: "oc", label: "m_oc" },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <tr className="border-b border-border bg-titlebar/60 text-2xs uppercase text-amber">
            <th className="px-1.5 py-0.5 text-start font-normal">{t("l_events")}</th>
            <th className="px-1.5 py-0.5 text-start font-normal">{t("l_measure")}</th>
            {hs.map((h) => (
              <th key={h} className="px-1.5 py-0.5 text-end font-normal num">{t("l_h", { n: h })}</th>
            ))}
            <th className="px-1.5 py-0.5 text-end font-normal">{t("l_gap")}</th>
          </tr>
        </thead>
        <tbody>
          {cats.flatMap((c, ci) =>
            measures.map((m, mi) => (
              <tr key={`${c}-${m.key}`} className={`border-b ${mi === 1 ? "border-border" : "border-border/40"} hover:bg-hover align-top`}>
                {mi === 0 && (
                  <th rowSpan={2} scope="rowgroup" className={`px-1.5 py-1 text-start font-semibold ${ci === 0 ? "text-yellow" : "text-text"}`}>
                    {t(c)}
                    <span className="block text-2xs font-normal text-dim">{t(`${c}_d` as StringKey)}</span>
                    <span className="block text-2xs font-normal text-muted num">n={d.counts[c].toLocaleString("en-US")}</span>
                  </th>
                )}
                <td className="px-1.5 py-1 text-dim">{t(m.label)}</td>
                {hs.map((h) => {
                  const s = d.stats[c][h][m.key];
                  const base = d.baseline.by_h[h]?.[m.key];
                  return (
                    <td key={h} className="px-1.5 py-1 text-end">
                      <span className="inline-flex items-baseline gap-1">
                        <SigMark s={s} refLabel={m.key === "oc" ? t("l_base") : "0"} />
                        <Pct v={s.mean} />
                      </span>
                      <span className="block text-2xs"><Range s={s} /></span>
                      <span className="block text-2xs text-muted num">
                        {t("l_hit")} <N>{pct(s.hit, 0, false)}</N>
                        {m.key === "oc" && base != null && (
                          <span className="ms-2">
                            {t("l_base")} <N>{pct(base, 2)}</N>
                          </span>
                        )}
                      </span>
                    </td>
                  );
                })}
                <td className="px-1.5 py-1 text-end">
                  {mi === 0 ? (
                    <>
                      <span className="inline-flex items-baseline gap-1">
                        <SigMark s={d.stats[c].gap} refLabel={t("l_base")} />
                        <Pct v={d.stats[c].gap.mean} />
                      </span>
                      <span className="block text-2xs"><Range s={d.stats[c].gap} /></span>
                      <span className="block text-2xs text-muted num">
                        {t("l_base")} <N>{pct(d.baseline.gap, 2)}</N>
                      </span>
                    </>
                  ) : null}
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

function Breakdown({ d, side }: { d: LimitsData; side: Side }) {
  const { t } = useI18n();
  const cat = CATS[side][0];
  const liq = d.breakdown.liquidity[cat] ?? {};
  const yr = d.breakdown.year[cat] ?? {};
  const years = Object.keys(yr["1"] ?? {});
  const tiers: { key: "low" | "mid" | "high"; label: StringKey }[] = [
    { key: "low", label: "l_liq_low" },
    { key: "mid", label: "l_liq_mid" },
    { key: "high", label: "l_liq_high" },
  ];
  const Cell = ({ s }: { s: Stat | undefined }) =>
    s && s.n > 0 ? (
      <td className="px-1.5 py-[2px] text-end">
        <span className="inline-flex items-baseline gap-1">
          <SigMark s={s} refLabel="0" />
          <Pct v={s.mean} />
        </span>
        <span className="ms-2 text-2xs text-muted num">n={s.n}</span>
      </td>
    ) : (
      <td className="px-1.5 py-[2px] text-end text-muted">--</td>
    );
  const Head = ({ first }: { first: string }) => (
    <thead>
      <tr className="border-b border-border bg-titlebar/60 text-2xs uppercase text-amber">
        <th className="px-1.5 py-0.5 text-start font-normal">{first}</th>
        <th className="px-1.5 py-0.5 text-end font-normal num">{t("l_h", { n: 1 })}</th>
        <th className="px-1.5 py-0.5 text-end font-normal num">{t("l_h", { n: 5 })}</th>
      </tr>
    </thead>
  );
  return (
    <div className="grid gap-px bg-border md:grid-cols-2">
      <div className="bg-bg">
        <table className="w-full text-sm">
          <Head first={t("l_liq")} />
          <tbody>
            {tiers.map((tier) => (
              <tr key={tier.key} className="border-b border-border/40 hover:bg-hover">
                <th scope="row" className="px-1.5 py-[2px] text-start font-normal text-text">{t(tier.label)}</th>
                <Cell s={liq["1"]?.[tier.key]} />
                <Cell s={liq["5"]?.[tier.key]} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="max-h-[260px] overflow-auto bg-bg">
        <table className="w-full text-sm">
          <Head first={t("l_year")} />
          <tbody>
            {years.map((y) => (
              <tr key={y} className="border-b border-border/40 hover:bg-hover">
                <th scope="row" className="px-1.5 py-[2px] text-start font-normal text-text num">{y}</th>
                <Cell s={yr["1"]?.[y]} />
                <Cell s={yr["5"]?.[y]} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BacktestView({ d, side }: { d: LimitsData; side: Side }) {
  const { t, pct } = useI18n();
  const bt = d.backtests.find((b) => b.signal === CATS[side][0]);
  const lines = useMemo<ChartLine[]>(() => {
    if (!bt) return [];
    const up = bt.total != null && bt.total >= 0;
    return [
      { id: "strategy", color: up ? "up" : "down", data: bt.equity.map(([time, value]) => ({ time, value })) },
      { id: "market", color: "mkt", width: 1, data: bt.bench.map(([time, value]) => ({ time, value })) },
    ];
  }, [bt]);
  if (!bt) return <p className="text-xs text-muted">--</p>;
  return (
    <div className="grid gap-1.5 md:grid-cols-[1fr_15rem]">
      <div className="min-w-0">
        <p className="mb-1 text-2xs text-dim">{t("l_bt_hint", { c: bt.cost_bps })}</p>
        <TimeSeriesChart lines={lines} height={230} baseline={1} label={t("l_bt_title", { h: bt.hold })} />
        <p className="flex gap-3 text-2xs">
          <span className={bt.total != null && bt.total >= 0 ? "text-up" : "text-down"}>■ {t("l_bt_strategy")}: {t(bt.signal)}</span>
          <span className="text-mkt">■ {t("l_bt_market")}</span>
        </p>
      </div>
      <table className="w-full self-start text-sm">
        <tbody>
          <Row label={t("l_bt_trades")}><span className="text-text num">{bt.trades.toLocaleString("en-US")}</span></Row>
          <Row label={t("l_bt_skipped")}><span className="text-text num">{bt.skipped_locked_open.toLocaleString("en-US")}</span></Row>
          <Row label={t("l_bt_avg")}><Pct v={bt.avg_net} /></Row>
          <Row label={t("l_bt_hit")}><span className="text-text num" dir="ltr">{pct(bt.hit, 1, false)}</span></Row>
          <Row label={t("l_bt_total")}><Pct v={bt.total} digits={1} /></Row>
          <Row label={t("l_bt_cagr")}><Pct v={bt.cagr} digits={1} /></Row>
          <Row label={t("l_bt_dd")}><Pct v={bt.max_dd} digits={1} /></Row>
          <Row label={t("l_bt_exp")}><span className="text-text num" dir="ltr">{pct(bt.exposure, 0, false)}</span></Row>
          <Row label={t("l_bt_bench")}><Pct v={bt.bench_total} digits={1} /></Row>
        </tbody>
      </table>
    </div>
  );
}

function stockName(d: LimitsData, ticker: string, lang: "en" | "ar") {
  const n = d.names[ticker];
  if (!n) return ticker;
  return lang === "ar" && n.ar ? n.ar : n.en;
}

function Today({ d }: { d: LimitsData }) {
  const { t, date, num, lang } = useI18n();
  const navigate = useNavigate();
  if (d.today.events.length === 0) return <p className="p-1.5 text-xs text-dim">{t("l_today_none", { date: date(d.today.date) })}</p>;
  return (
    <table className="w-full table-fixed text-sm">
      <colgroup>
        <col className="w-[3.2rem]" />
        <col />
        <col className="w-[5.5rem]" />
        <col className="w-[4.5rem]" />
      </colgroup>
      <tbody>
        {d.today.events.map((e) => (
          <tr key={`${e.ticker}-${e.category}`} onClick={() => navigate(stockPath(e.ticker, "LIMT"))} className="cursor-pointer border-b border-border/40 hover:bg-hover">
            <td className="px-1.5 py-[2px] font-semibold text-yellow num">{e.ticker.replace(".SR", "")}</td>
            <td className="truncate px-1.5 py-[2px] text-text">{stockName(d, e.ticker, lang)}</td>
            <td className="truncate px-1.5 py-[2px] text-2xs text-amber">{t(e.category)}</td>
            <td className="px-1.5 py-[2px] text-end">
              <Chg value={e.chg} />
              <span className="block text-2xs text-dim num">{num(e.close, 2)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EventLog({ d }: { d: LimitsData }) {
  const { t, date, lang } = useI18n();
  const navigate = useNavigate();
  const [cat, setCat] = useState<"all" | LimitCategory>("all");
  const rows = d.log.filter((e) => cat === "all" || e.category === cat);
  const opts = ["all", "lock_up", "touch_up", "lock_down", "touch_down"] as const;
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border px-1.5 py-1 text-xs">
        <span className="uppercase text-amber">{t("l_log_filter")}</span>
        <Segmented label={t("l_log_filter")} value={cat} onChange={(v) => setCat(v)} options={opts.map((o) => ({ id: o, label: o === "all" ? t("l_all") : t(o) }))} />
      </div>
      <div className="max-h-[340px] overflow-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="sticky top-0 bg-bg">
            <tr className="border-b border-border text-2xs uppercase text-amber">
              <th className="px-1.5 py-0.5 text-start font-normal">{t("as_of")}</th>
              <th className="px-1.5 py-0.5 text-start font-normal">{t("col_stock")}</th>
              <th className="px-1.5 py-0.5 text-start font-normal">{t("l_events")}</th>
              <th className="px-1.5 py-0.5 text-end font-normal">{t("l_col_move")}</th>
              <th className="px-1.5 py-0.5 text-end font-normal">{t("l_next1")}</th>
              <th className="px-1.5 py-0.5 text-end font-normal">{t("l_next5")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              <tr key={`${e.date}-${e.ticker}-${i}`} onClick={() => navigate(stockPath(e.ticker, "LIMT"))} className="cursor-pointer border-b border-border/40 hover:bg-hover">
                <td className="whitespace-nowrap px-1.5 py-[2px] text-dim num">{date(e.date)}</td>
                <td className="truncate px-1.5 py-[2px]">
                  <span className="me-2 font-semibold text-yellow num">{e.ticker.replace(".SR", "")}</span>
                  <span className="text-text">{stockName(d, e.ticker, lang)}</span>
                </td>
                <td className="whitespace-nowrap px-1.5 py-[2px] text-2xs text-amber">{t(e.category)}</td>
                <td className="px-1.5 py-[2px] text-end"><Chg value={e.chg} /></td>
                <td className="px-1.5 py-[2px] text-end"><Chg value={e.next1_ab} /></td>
                <td className="px-1.5 py-[2px] text-end"><Chg value={e.next5_ab} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StockHistory({ ticker, d }: { ticker: string; d: LimitsData }) {
  const { t, date, lang } = useI18n();
  const navigate = useNavigate();
  const file = useData<LimitEventsFile>("limits_events.json");
  const name = stockName(d, ticker, lang);
  const clear = (
    <button onClick={() => navigate("/limits")} className="bg-menu px-1.5 text-text hover:bg-select">
      {t("l_clear")}
    </button>
  );
  return (
    <Panel id={IDS.stock} title={`${ticker.replace(".SR", "")} ${name}`} pad={false} meta={clear}>
      {file.status === "loading" && <Loading />}
      {file.status === "error" && <ErrorState missing={file.missing} message={file.message} />}
      {file.status === "ready" &&
        (() => {
          const rows = file.data.tickers[ticker] ?? [];
          if (rows.length === 0) return <p className="p-1.5 text-xs text-dim">{t("no_rows")}</p>;
          const counts = rows.reduce<Record<string, number>>((acc, r) => ((acc[r[1]] = (acc[r[1]] ?? 0) + 1), acc), {});
          return (
            <div>
              <p className="flex flex-wrap gap-x-4 border-b border-border px-1.5 py-1 text-xs">
                {(["lock_up", "touch_up", "lock_down", "touch_down"] as const).map((c) => (
                  <span key={c}>
                    <span className="text-amber">{t(c)}</span> <span className="text-text num">{counts[c] ?? 0}</span>
                  </span>
                ))}
              </p>
              <div className="max-h-[260px] overflow-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead className="sticky top-0 bg-bg">
                    <tr className="border-b border-border text-2xs uppercase text-amber">
                      <th className="px-1.5 py-0.5 text-start font-normal">{t("as_of")}</th>
                      <th className="px-1.5 py-0.5 text-start font-normal">{t("l_events")}</th>
                      <th className="px-1.5 py-0.5 text-end font-normal">{t("l_col_move")}</th>
                      <th className="px-1.5 py-0.5 text-end font-normal">{t("l_next1")}</th>
                      <th className="px-1.5 py-0.5 text-end font-normal">{t("l_next5")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={`${r[0]}-${i}`} className="border-b border-border/40 hover:bg-hover">
                        <td className="whitespace-nowrap px-1.5 py-[2px] text-dim num">{date(r[0])}</td>
                        <td className="px-1.5 py-[2px] text-2xs text-amber">{t(r[1])}</td>
                        <td className="px-1.5 py-[2px] text-end"><Chg value={r[2]} /></td>
                        <td className="px-1.5 py-[2px] text-end"><Chg value={r[3]} /></td>
                        <td className="px-1.5 py-[2px] text-end"><Chg value={r[4]} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
    </Panel>
  );
}

function Method({ d }: { d: LimitsData }) {
  const { t } = useI18n();
  const c = d.data_checks;
  return (
    <div className="space-y-1.5 text-xs leading-relaxed text-dim">
      <p>{t("l_method_1")}</p>
      <p>{t("l_method_2", { n: d.params.listing_exclude })}</p>
      <p>{t("l_method_3", { b: d.params.bootstrap.toLocaleString("en-US") })}</p>
      <p>{t("l_method_4")}</p>
      <p className="border-t border-border pt-1.5 text-muted num">
        {t("l_checks", {
          s: c.stock_days_studied.toLocaleString("en-US"),
          x: c.excluded_beyond_limit.toLocaleString("en-US"),
          g: c.off_grid_fallback.toLocaleString("en-US"),
        })}
      </p>
      {d.market === "proxy" && <p className="text-yellow">{t("proxy_note")}</p>}
      {d.universe.failed.length > 0 && (
        <p className="text-down num">{t("failed_list_short", { n: d.universe.failed.length, list: d.universe.failed.map((x) => x.replace(".SR", "")).join(" ") })}</p>
      )}
    </div>
  );
}
