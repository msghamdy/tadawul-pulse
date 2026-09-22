import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { useData } from "../lib/data";
import { Gate, Loading, ErrorState } from "../components/States";
import Panel, { PageBar, Segmented } from "../components/Panel";
import { Chg, Val } from "../components/Num";
import TimeSeriesChart, { type ChartLine } from "../components/TimeSeriesChart";
import { useI18n } from "../i18n";
import { sectorColor, token } from "../lib/colors";
import { rechartsTheme } from "../lib/chartTheme";
import { stockPath } from "../lib/commands";
import type { BetaSeries, Meta, Num, OilBeta as OilBetaData, StockInfo } from "../types";

interface Row {
  ticker: string;
  name: string;
  sector: string;
  sectorName: string;
  shariah: boolean;
  info: StockInfo | undefined;
  oil: Record<string, Num>;
  mkt: Record<string, Num>;
  n: Record<string, number>;
}

type SortKey = "name" | "sector" | `oil_${number}` | `mkt_${number}`;

export default function OilBeta() {
  const ob = useData<OilBetaData>("oil_beta.json");
  const uni = useData<StockInfo[]>("universe.json");
  const meta = useData<Meta>("meta.json");
  return (
    <Gate states={[ob, uni, meta] as const}>
      {(o, u, m) => <OilBetaBody ob={o} universe={u} meta={m} />}
    </Gate>
  );
}

function OilBetaBody({ ob, universe, meta }: { ob: OilBetaData; universe: StockInfo[]; meta: Meta }) {
  const { t, lang, date } = useI18n();
  const navigate = useNavigate();
  const params = useParams();
  const windows = ob.windows.map(String);
  const longest = windows[windows.length - 1];
  const [win, setWin] = useState(longest);
  const [sector, setSector] = useState<string>("all");
  const [shariahOnly, setShariahOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: `oil_${Number(longest)}`, desc: true });

  // The selected stock lives in the URL (/oil-beta/2222.SR) so the command bar and ticker tape can link to it.
  const fallback = ob.rows.find((r) => r.ticker === "2222.SR")?.ticker ?? ob.rows[0]?.ticker ?? null;
  const requested = params.ticker ? decodeURIComponent(params.ticker) : null;
  const selected = requested && ob.rows.some((r) => r.ticker === requested) ? requested : fallback;

  const secName = (k: string) => meta.sectors[k]?.[lang] ?? k;

  const allRows = useMemo<Row[]>(() => {
    const info = new Map(universe.map((s) => [s.ticker, s]));
    const byWin = <T,>(f: (w: string) => T) => Object.fromEntries(windows.map((w) => [w, f(w)]));
    return ob.rows.map((r) => {
      const s = info.get(r.ticker);
      return {
        ticker: r.ticker,
        name: s ? (lang === "ar" ? s.name_ar : s.name_en) : r.ticker,
        sector: r.sector,
        sectorName: meta.sectors[r.sector]?.[lang] ?? r.sector,
        shariah: s?.shariah ?? false,
        info: s,
        oil: byWin((w) => r.betas[w]?.oil ?? null),
        mkt: byWin((w) => r.betas[w]?.mkt ?? null),
        n: byWin((w) => r.betas[w]?.n ?? 0),
      };
    });
  }, [ob.rows, universe, lang, meta.sectors, windows]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter(
      (r) =>
        (sector === "all" || r.sector === sector) &&
        (!shariahOnly || r.shariah) &&
        (!q || r.name.toLowerCase().includes(q) || r.ticker.toLowerCase().includes(q)),
    );
  }, [allRows, sector, shariahOnly, query]);

  const sorted = useMemo(() => {
    const val = (r: Row): string | number | null => {
      if (sort.key === "name") return r.name;
      if (sort.key === "sector") return r.sectorName;
      const [kind, w] = sort.key.split("_");
      return kind === "oil" ? r.oil[w] : r.mkt[w];
    };
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const c = typeof va === "string" ? va.localeCompare(vb as string, lang) : va - (vb as number);
      return sort.desc ? -c : c;
    });
  }, [rows, sort, lang]);

  const sectorsPresent = useMemo(
    () => [...new Set(allRows.map((r) => r.sector))].sort((a, b) => secName(a).localeCompare(secName(b), lang)),
    [allRows, lang],
  );

  const sectorBars = useMemo(() => {
    const groups = new Map<string, number[]>();
    for (const r of rows) {
      const v = r.oil[win];
      if (v != null) groups.set(r.sector, [...(groups.get(r.sector) ?? []), v]);
    }
    return [...groups.entries()]
      .map(([k, vs]) => ({ key: k, name: secName(k), value: vs.reduce((a, b) => a + b, 0) / vs.length, n: vs.length }))
      .sort((a, b) => b.value - a.value);
  }, [rows, win, lang]);

  const selectedRow = allRows.find((r) => r.ticker === selected) ?? null;
  const historyRef = useRef<HTMLDivElement>(null);

  const pickStock = (ticker: string) => navigate(stockPath(ticker), { replace: true });

  // Bring the history panel into view when a stock is chosen from further down the page.
  useEffect(() => {
    const el = historyRef.current;
    if (el && requested && el.getBoundingClientRect().top < 0) {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    }
  }, [requested]);

  const winOptions = windows.map((w) => ({ id: w, label: t("days", { n: w }) }));

  return (
    <div className="space-y-1">
      <PageBar code="BETA" title={t("nav_oil")} right={<span className="num">{t("data_as_of", { date: date(ob.as_of) })}</span>} />

      {/* Parameters: apply to the scatter, sector bars and table */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-border px-2 py-1 text-xs uppercase">
        <label className="flex items-center gap-1.5 text-amber">
          {t("window")}
          <Segmented label={t("window")} value={win} onChange={setWin} options={winOptions} />
        </label>
        <label className="flex items-center gap-1.5 text-amber">
          {t("sector")}
          <select value={sector} onChange={(e) => setSector(e.target.value)} className="border border-border bg-bg px-1 py-0 text-xs normal-case text-text">
            <option value="all">{t("all_sectors")}</option>
            {sectorsPresent.map((k) => (
              <option key={k} value={k}>
                {secName(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-amber">
          <input type="checkbox" checked={shariahOnly} onChange={(e) => setShariahOnly(e.target.checked)} className="h-3 w-3 accent-[rgb(var(--c-amber))]" />
          {t("shariah_only")}
        </label>
        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-amber sm:flex-none">
          {t("search")}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 border border-border bg-bg px-1 text-xs normal-case text-yellow sm:w-40"
          />
        </label>
        <span className="text-muted num sm:ms-auto">{rows.length}/{allRows.length}</span>
      </div>

      <div className="grid grid-cols-1 gap-1 lg:grid-cols-12">
        <Panel title={t("scatter_title")} meta={<span className="num">{t("days_long", { n: win })}</span>} className="lg:col-span-8">
          <p className="text-2xs text-dim">{t("scatter_hint")}</p>
          <BetaScatter rows={rows} win={win} selected={selected} onSelect={pickStock} />
        </Panel>
        <Panel title={t("sector_avg_title")} meta={<span className="num">{t("days_long", { n: win })}</span>} className="lg:col-span-4">
          <SectorBars data={sectorBars} />
        </Panel>

        <div ref={historyRef} className="scroll-mt-24 lg:col-span-8">
          {selectedRow ? (
            <History row={selectedRow} win={win} ob={ob} />
          ) : (
            <Panel title={t("history_title", { name: "--" })}>
              <p className="text-xs text-muted">{t("history_hint")}</p>
            </Panel>
          )}
        </div>
        <div className="grid gap-1 lg:col-span-4 lg:content-start">
          {selectedRow && <Detail row={selectedRow} windows={windows} />}
          <Panel title={t("p_about")}>
            <p className="text-xs leading-relaxed text-dim">{t("oil_intro")}</p>
            <p className="mt-1 text-xs leading-relaxed text-dim">{ob.method === "dimson" ? t("method_dimson") : t("method_same_day")}</p>
          </Panel>
        </div>

        <Panel title={t("table_title")} pad={false} meta={<span className="num">{rows.length}</span>} className="lg:col-span-12">
          <BetaTable rows={sorted} windows={windows} win={win} sort={sort} onSort={setSort} selected={selected} onSelect={pickStock} />
        </Panel>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //

function BetaScatter({ rows, win, selected, onSelect }: { rows: Row[]; win: string; selected: string | null; onSelect: (t: string) => void }) {
  const { t, num } = useI18n();
  const th = rechartsTheme();
  const bySector = useMemo(() => {
    const m = new Map<string, { ticker: string; name: string; sectorName: string; x: number; y: number }[]>();
    for (const r of rows) {
      const x = r.mkt[win], y = r.oil[win];
      if (x == null || y == null) continue;
      m.set(r.sector, [...(m.get(r.sector) ?? []), { ticker: r.ticker, name: r.name, sectorName: r.sectorName, x, y }]);
    }
    return [...m.entries()];
  }, [rows, win]);
  const sel = rows.find((r) => r.ticker === selected);
  const selPoint = sel && sel.mkt[win] != null && sel.oil[win] != null ? [{ x: sel.mkt[win], y: sel.oil[win] }] : [];

  return (
    <div dir="ltr" className="mt-1 h-[330px]">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 6, right: 10, bottom: 22, left: 0 }}>
          <CartesianGrid {...th.grid} />
          <XAxis
            type="number"
            dataKey="x"
            domain={["auto", "auto"]}
            {...th.axis}
            tickFormatter={(v: number) => v.toFixed(1)}
            label={{ value: t("mkt_beta_long").toUpperCase(), position: "insideBottom", offset: -12, ...th.label(token("mkt")) }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={["auto", "auto"]}
            {...th.axis}
            width={42}
            tickFormatter={(v: number) => v.toFixed(2)}
            label={{ value: t("oil_beta_long").toUpperCase(), angle: -90, position: "insideLeft", offset: 12, ...th.label(token("oil")) }}
          />
          <ZAxis range={[28, 28]} />
          <ReferenceLine y={0} stroke={th.ref} />
          <ReferenceLine x={1} stroke={th.ref} strokeDasharray="3 3" />
          <Tooltip
            cursor={{ stroke: token("muted"), strokeDasharray: "3 3" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = active && payload?.[0]?.payload;
              if (!p || !("name" in p)) return null;
              return (
                <TermTooltip>
                  <p className="font-semibold text-yellow">
                    {p.ticker.replace(".SR", "")} {p.name}
                  </p>
                  <p className="text-dim">{p.sectorName}</p>
                  <p className="num">
                    <span className="text-oil">{t("oil_beta")} {num(p.y, 2)}</span>
                    <span className="ms-3 text-mkt">{t("mkt_beta")} {num(p.x, 2)}</span>
                  </p>
                </TermTooltip>
              );
            }}
          />
          {bySector.map(([sec, pts]) => (
            <Scatter
              key={sec}
              data={pts}
              fill={sectorColor(sec)}
              shape="square"
              onClick={(d: { ticker?: string }) => d.ticker && onSelect(d.ticker)}
              className="cursor-pointer"
              isAnimationActive={false}
            />
          ))}
          {selPoint.length > 0 && (
            <Scatter data={selPoint} fill="none" stroke={token("yellow")} strokeWidth={2} shape="square" isAnimationActive={false} legendType="none" tooltipType="none" />
          )}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function TermTooltip({ children }: { children: ReactNode }) {
  return <div className="border border-amber bg-bg px-2 py-1 text-xs">{children}</div>;
}

function SectorBars({ data }: { data: { key: string; name: string; value: number; n: number }[] }) {
  const { num, t } = useI18n();
  const th = rechartsTheme();
  if (data.length === 0) return <p className="text-xs text-muted">{t("no_rows")}</p>;
  return (
    <div dir="ltr" style={{ height: Math.max(160, data.length * 19 + 16) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 0 }} barCategoryGap={3}>
          <CartesianGrid {...th.grid} horizontal={false} />
          <XAxis type="number" hide domain={[(min: number) => Math.min(0, min), "auto"]} />
          <YAxis
            type="category"
            dataKey="name"
            width={150}
            {...th.axis}
            axisLine={false}
            tickLine={false}
            interval={0}
            tickFormatter={(v: string) => (v.length > 23 ? `${v.slice(0, 22)}…` : v)}
          />
          <ReferenceLine x={0} stroke={th.ref} />
          <Tooltip
            cursor={{ fill: token("hover") }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = active && payload?.[0]?.payload;
              if (!p) return null;
              return (
                <TermTooltip>
                  <p className="font-semibold text-yellow">{p.name}</p>
                  <p className="num text-oil">{t("oil_beta")} {num(p.value, 2)}</p>
                  <p className="num text-dim">n = {p.n}</p>
                </TermTooltip>
              );
            }}
          />
          <Bar
            dataKey="value"
            isAnimationActive={false}
            label={{ position: "right", fill: token("text"), fontSize: 10, fontFamily: th.axis.tick.fontFamily, formatter: (v: number) => v.toFixed(2) }}
          >
            {data.map((d) => (
              <Cell key={d.key} fill={sectorColor(d.key)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function BetaTable({
  rows, windows, win, sort, onSort, selected, onSelect,
}: {
  rows: Row[];
  windows: string[];
  win: string;
  sort: { key: SortKey; desc: boolean };
  onSort: (s: { key: SortKey; desc: boolean }) => void;
  selected: string | null;
  onSelect: (t: string) => void;
}) {
  const { t } = useI18n();
  const click = (key: SortKey) => onSort({ key, desc: sort.key === key ? !sort.desc : key !== "name" && key !== "sector" });

  if (rows.length === 0) return <p className="p-2 text-xs text-muted">{t("no_rows")}</p>;

  const SortButton = ({ k, label, full }: { k: SortKey; label: string; full: string }) => (
    <button onClick={() => click(k)} className="inline-flex items-center gap-0.5 uppercase hover:text-yellow" title={t("sort_by", { col: full })}>
      {label}
      <span aria-hidden="true" className={sort.key === k ? "text-yellow" : "invisible"}>
        {sort.desc ? "▼" : "▲"}
      </span>
    </button>
  );
  const ariaSort = (k: SortKey) => (sort.key === k ? (sort.desc ? "descending" : "ascending") : "none");

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="text-2xs text-amber">
          <tr>
            <th rowSpan={2} scope="col" aria-sort={ariaSort("name")} className="border-b border-border px-2 py-0.5 text-start align-bottom font-normal">
              <SortButton k="name" label={t("col_stock")} full={t("col_stock")} />
            </th>
            <th rowSpan={2} scope="col" aria-sort={ariaSort("sector")} className="border-b border-border px-2 py-0.5 text-start align-bottom font-normal">
              <SortButton k="sector" label={t("sector")} full={t("sector")} />
            </th>
            <th colSpan={windows.length} scope="colgroup" className="border-s border-border px-2 pt-0.5 text-center font-semibold uppercase text-oil">
              {t("oil_beta_long")}
            </th>
            <th colSpan={windows.length} scope="colgroup" className="border-s border-border px-2 pt-0.5 text-center font-semibold uppercase text-mkt">
              {t("mkt_beta_long")}
            </th>
            <th rowSpan={2} scope="col" className="border-b border-s border-border px-2 py-0.5 text-end align-bottom font-normal uppercase">
              {t("col_obs")}
            </th>
          </tr>
          <tr className="border-b border-border">
            {(["oil", "mkt"] as const).flatMap((kind) =>
              windows.map((w, i) => {
                const k = `${kind}_${Number(w)}` as SortKey;
                const full = `${kind === "oil" ? t("oil_beta_long") : t("mkt_beta_long")} ${t("days_long", { n: w })}`;
                return (
                  <th key={k} scope="col" aria-sort={ariaSort(k)} className={`px-2 pb-0.5 text-end font-normal num ${i === 0 ? "border-s border-border" : ""}`}>
                    <SortButton k={k} label={t("days", { n: w })} full={full} />
                  </th>
                );
              }),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSel = r.ticker === selected;
            return (
              <tr
                key={r.ticker}
                onClick={() => onSelect(r.ticker)}
                className={`cursor-pointer border-b border-border/60 ${isSel ? "bg-select" : "hover:bg-hover"}`}
              >
                <td className="px-2 py-[2px]">
                  <button onClick={() => onSelect(r.ticker)} className="flex items-baseline gap-2 text-start" aria-pressed={isSel} aria-label={`${t("pick")}: ${r.name}`}>
                    <span className="w-9 shrink-0 font-semibold text-yellow num">{r.ticker.replace(".SR", "")}</span>
                    <span className="text-text">{r.name}</span>
                    {r.shariah && (
                      <span className="text-2xs text-mkt" title={t("shariah_title")}>
                        {t("shariah")}
                      </span>
                    )}
                  </button>
                </td>
                <td className="whitespace-nowrap px-2 py-[2px] text-dim">
                  <span className="me-1.5 inline-block h-2 w-2 align-middle" style={{ background: sectorColor(r.sector) }} aria-hidden="true" />
                  {r.sectorName}
                </td>
                {(["oil", "mkt"] as const).flatMap((kind) =>
                  windows.map((w, i) => (
                    <td key={`${kind}${w}`} className={`px-2 py-[2px] text-end ${i === 0 ? "border-s border-border" : ""}`}>
                      <Val value={r[kind][w]} className={w === win ? "text-text" : "text-muted"} />
                    </td>
                  )),
                )}
                <td className="border-s border-border px-2 py-[2px] text-end text-dim num">{r.n[win]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Detail({ row, windows }: { row: Row; windows: string[] }) {
  const { t, date } = useI18n();
  const Line = ({ label, children }: { label: string; children: ReactNode }) => (
    <tr className="border-b border-border last:border-b-0">
      <th scope="row" className="px-2 py-[3px] text-start font-normal text-amber">{label}</th>
      <td className="px-2 py-[3px] text-end">{children}</td>
    </tr>
  );
  return (
    <Panel title={t("p_detail")} pad={false} meta={<span className="num text-yellow">{row.ticker}</span>}>
      <p className="border-b border-border px-2 py-1 text-sm font-semibold text-yellow">{row.name}</p>
      <table className="w-full text-sm">
        <tbody>
          <Line label={t("col_last")}>
            <Val value={row.info?.last_close} className="text-yellow" /> <Chg value={row.info?.chg_1d} />
          </Line>
          <Line label={t("d_sector")}><span className="text-text">{row.sectorName}</span></Line>
          <Line label={t("d_shariah")}><span className="text-text">{row.shariah ? t("yes") : t("no")}</span></Line>
          {windows.map((w) => (
            <Line key={`o${w}`} label={`${t("oil_beta_long")} ${t("days", { n: w })}`}>
              <Val value={row.oil[w]} className="text-oil" />
            </Line>
          ))}
          {windows.map((w) => (
            <Line key={`m${w}`} label={`${t("mkt_beta_long")} ${t("days", { n: w })}`}>
              <Val value={row.mkt[w]} className="text-mkt" />
            </Line>
          ))}
          <Line label={t("d_since")}><span className="text-dim num">{date(row.info?.first_date)}</span></Line>
        </tbody>
      </table>
    </Panel>
  );
}

function History({ row, win, ob }: { row: Row; win: string; ob: OilBetaData }) {
  const { t } = useI18n();
  const series = useData<BetaSeries>(`oil_beta_series/${row.ticker}.json`);
  const showSector = String(ob.sector_series.window) === win && !!ob.sector_series.values[row.sector];

  const lines = useMemo<ChartLine[]>(() => {
    if (series.status !== "ready") return [];
    const s = series.data.series[win];
    if (!s) return [];
    const d = series.data.dates;
    const out: ChartLine[] = [
      { id: "oil", color: "oil", data: d.map((time, i) => ({ time, value: s.oil[i] })) },
      { id: "mkt", color: "mkt", data: d.map((time, i) => ({ time, value: s.mkt[i] })) },
    ];
    if (showSector) {
      const sec = ob.sector_series;
      out.push({ id: "sector", color: "oil", dashed: true, data: sec.dates.map((time, i) => ({ time, value: sec.values[row.sector][i] })) });
    }
    return out;
  }, [series, win, ob.sector_series, row.sector, showSector]);

  const legend = (
    <span className="flex gap-2 normal-case">
      <span className="text-oil">■ {t("oil_beta")}</span>
      <span className="text-mkt">■ {t("mkt_beta")}</span>
      {showSector && <span className="text-oil">┄ {t("sector_avg_line")}</span>}
    </span>
  );

  return (
    <Panel title={t("history_title", { name: `${row.ticker.replace(".SR", "")} ${row.name}` })} meta={legend}>
      {series.status === "loading" && <Loading />}
      {series.status === "error" && <ErrorState missing={series.missing} message={series.message} />}
      {series.status === "ready" && <TimeSeriesChart lines={lines} height={250} baseline={0} label={t("history_title", { name: row.name })} />}
    </Panel>
  );
}
