import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getPref, setPref } from "./lib/storage";

export type Lang = "en" | "ar";

const en = {
  brand: "Tadawul Pulse",
  nav_overview: "Market overview",
  nav_oil: "Oil beta monitor",
  nav_factors: "Factor backtests",
  nav_seasonality: "Seasonality",
  nav_pairs: "Pairs trading",
  switch_lang: "AR",
  switch_lang_label: "Switch to Arabic",
  disclaimer: "For research and education only. Not investment advice.",
  data_updated: "Data",
  upd: "Upd",
  synthetic_banner: "Demo data: generated, not market prices. Run the pipeline without --synthetic for real prices.",
  loading: "Loading data…",
  missing_title: "No data yet",
  missing_body: "The data files haven't been generated yet. Run “python -m pipeline.export” locally, or run the “Update data” workflow on GitHub.",
  error_title: "The data couldn't be loaded",
  retry: "Retry",
  riyadh: "Riyadh",
  market_open: "Market open",
  market_closed: "Market closed",
  market_hint: "Based on the Sun–Thu 10:00–15:00 schedule. Public holidays aren't included.",
  charts_by: "Charts by TradingView",
  cmd_label: "Command: type a ticker or page code, then press Enter",
  cmd_placeholder: "2222, ARAMCO, BETA…",
  cmd_unknown: "Unknown command “{q}”. Try a ticker like 2222 or a code: HOME BETA FACT SEAS PAIR.",
  cmd_page: "page",
  fkeys_label: "Function keys",
  tasi_long: "TASI index",
  tasi_proxy: "TASI (proxy)",
  proxy_note: "Yahoo's TASI history is incomplete, so this is an equal-weighted index of the universe, scaled to end at the latest TASI close. Market betas use it too.",
  warnings: "Warnings",
  p_stats: "Key statistics",
  last: "Last",
  chg_1d: "1 day",
  chg_1m: "1 month",
  chg_ytd: "Year to date",
  chg_1y: "1 year",
  vol_1y: "Volatility 1Y",
  max_dd_1y: "Max drawdown 1Y",
  as_of: "As of",
  brent: "Brent crude",
  per_barrel: "USD/bbl",
  gainers: "Top gainers",
  losers: "Top losers",
  breadth: "Breadth",
  advancing: "Up",
  declining: "Down",
  unchanged: "Flat",
  no_movers: "No usable returns on the last trading day.",
  p_monitor: "Market monitor",
  col_tkr: "Tkr",
  col_name: "Name",
  col_last: "Last",
  col_chg: "Chg%",
  p_quality: "Data quality",
  q_loaded: "Stocks loaded",
  q_failed: "Failed downloads",
  q_zero: "Zero-volume days dropped",
  q_bad: "Bad prints removed",
  q_flag: "Limit breaches flagged",
  q_fill: "Short gaps filled",
  range_1y: "1Y",
  range_3y: "3Y",
  range_5y: "5Y",
  range_all: "All",
  chart_range: "Chart range",
  source: "Prices: Yahoo Finance, adjusted for splits and dividends. Saudi data on Yahoo can be late or incomplete.",
  oil_title: "How much do Saudi stocks move with oil?",
  oil_intro:
    "Rolling beta of each stock to Brent crude and to TASI, on daily log returns. An oil beta of 0.3 means the stock has tended to move 0.3% for every 1% move in Brent.",
  method_dimson: "Oil beta sums same-day and prior-day Brent slopes (Dimson), because Brent settles hours after Tadawul closes.",
  method_same_day: "Oil beta uses same-day Brent returns only.",
  window: "Window",
  days: "{n}D",
  days_long: "{n} days",
  sector: "Sector",
  all_sectors: "All sectors",
  search: "Filter",
  shariah_only: "Shariah only",
  oil_beta: "Oil β",
  mkt_beta: "Mkt β",
  oil_beta_long: "Oil beta",
  mkt_beta_long: "Market beta",
  scatter_title: "Oil beta vs market beta",
  scatter_hint: "Up: more oil-sensitive. Right: more market-sensitive.",
  sector_avg_title: "Avg oil beta by sector",
  table_title: "Beta table",
  col_stock: "Stock",
  col_obs: "Obs",
  history_title: "Rolling betas: {name}",
  history_hint: "Select a stock in the table or type its ticker in the command bar.",
  sector_avg_line: "Sector avg oil β",
  no_rows: "No stocks match these filters.",
  data_as_of: "Data as of {date}.",
  p_detail: "Security",
  d_sector: "Sector",
  d_shariah: "Shariah flag",
  d_since: "History from",
  yes: "Yes",
  no: "No",
  shariah: "S",
  shariah_title: "Shariah-compliant (per config.py)",
  sort_by: "Sort by {col}",
  pick: "Show history",
  p_about: "Method",
  pending_title: "Function not available yet",
  pending_body: "{code} ({name}) arrives in build phase {n}. Press F1 for the market overview or F2 for the oil beta monitor.",
};

type Strings = typeof en;

const ar: Strings = {
  brand: "نبض تداول",
  nav_overview: "نظرة على السوق",
  nav_oil: "مراقب حساسية النفط",
  nav_factors: "اختبار العوامل",
  nav_seasonality: "الموسمية",
  nav_pairs: "تداول الأزواج",
  switch_lang: "EN",
  switch_lang_label: "التبديل إلى الإنجليزية",
  disclaimer: "لأغراض البحث والتعليم فقط، وليست توصية استثمارية.",
  data_updated: "البيانات",
  upd: "تحديث",
  synthetic_banner: "بيانات تجريبية مولّدة وليست أسعار السوق. شغّل خط البيانات بالوضع العادي للحصول على أسعار حقيقية.",
  loading: "جارٍ تحميل البيانات…",
  missing_title: "لا توجد بيانات بعد",
  missing_body: "لم يتم توليد ملفات البيانات. شغّل سير العمل «Update data» على GitHub، أو نفّذ هذا الأمر محليًا: python -m pipeline.export",
  error_title: "تعذّر تحميل البيانات",
  retry: "إعادة المحاولة",
  riyadh: "الرياض",
  market_open: "السوق مفتوح",
  market_closed: "السوق مغلق",
  market_hint: "حسب الجدول: الأحد إلى الخميس 10:00–15:00. لا يشمل العطل الرسمية.",
  charts_by: "الرسوم من TradingView",
  cmd_label: "الأوامر: اكتب رمز سهم أو رمز صفحة ثم اضغط Enter",
  cmd_placeholder: "2222، أرامكو، BETA…",
  cmd_unknown: "أمر غير معروف «{q}». جرّب رمز سهم مثل 2222 أو: HOME BETA FACT SEAS PAIR.",
  cmd_page: "صفحة",
  fkeys_label: "مفاتيح الوظائف",
  tasi_long: "مؤشر تاسي",
  tasi_proxy: "تاسي (تقديري)",
  proxy_note: "تاريخ تاسي في Yahoo ناقص، لذا هذا مؤشر متساوي الأوزان لأسهم العيّنة، معايَر لينتهي عند آخر إغلاق لتاسي. بيتا السوق تُحسب مقابله أيضًا.",
  warnings: "تنبيهات",
  p_stats: "إحصاءات رئيسية",
  last: "آخر سعر",
  chg_1d: "يوم",
  chg_1m: "شهر",
  chg_ytd: "منذ بداية السنة",
  chg_1y: "سنة",
  vol_1y: "التذبذب سنة",
  max_dd_1y: "أقصى تراجع سنة",
  as_of: "حتى",
  brent: "خام برنت",
  per_barrel: "دولار/برميل",
  gainers: "الأكثر ارتفاعًا",
  losers: "الأكثر انخفاضًا",
  breadth: "اتساع السوق",
  advancing: "مرتفع",
  declining: "منخفض",
  unchanged: "ثابت",
  no_movers: "لا توجد عوائد صالحة في آخر يوم تداول.",
  p_monitor: "مراقب السوق",
  col_tkr: "الرمز",
  col_name: "الاسم",
  col_last: "آخر",
  col_chg: "التغير%",
  p_quality: "جودة البيانات",
  q_loaded: "الأسهم المحمّلة",
  q_failed: "تنزيلات فاشلة",
  q_zero: "أيام بلا حجم حُذفت",
  q_bad: "قراءات خاطئة أُزيلت",
  q_flag: "تجاوزات للحد السعري",
  q_fill: "فجوات قصيرة مُلئت",
  range_1y: "سنة",
  range_3y: "3 سنوات",
  range_5y: "5 سنوات",
  range_all: "الكل",
  chart_range: "مدة الرسم",
  source: "الأسعار من Yahoo Finance ومعدّلة للتجزئة والتوزيعات. بيانات الأسهم السعودية فيها قد تتأخر أو تنقص.",
  oil_title: "إلى أي حد تتحرك الأسهم السعودية مع النفط؟",
  oil_intro:
    "بيتا متحركة لكل سهم مقابل خام برنت ومقابل تاسي، على العوائد اللوغاريتمية اليومية. بيتا نفط 0.3 تعني أن السهم يتحرك في المتوسط 0.3٪ مقابل كل 1٪ في برنت.",
  method_dimson: "بيتا النفط تجمع ميل برنت في اليوم نفسه واليوم السابق (ديمسون)، لأن تسوية برنت تتم بعد إغلاق تداول بساعات.",
  method_same_day: "بيتا النفط تستخدم عائد برنت في اليوم نفسه فقط.",
  window: "النافذة",
  days: "{n}ي",
  days_long: "{n} يوم",
  sector: "القطاع",
  all_sectors: "كل القطاعات",
  search: "تصفية",
  shariah_only: "الشرعية فقط",
  oil_beta: "بيتا النفط",
  mkt_beta: "بيتا السوق",
  oil_beta_long: "بيتا النفط",
  mkt_beta_long: "بيتا السوق",
  scatter_title: "بيتا النفط مقابل بيتا السوق",
  scatter_hint: "للأعلى: أكثر حساسية للنفط. لليمين: أكثر حساسية للسوق.",
  sector_avg_title: "متوسط بيتا النفط حسب القطاع",
  table_title: "جدول البيتا",
  col_stock: "السهم",
  col_obs: "المشاهدات",
  history_title: "البيتا المتحركة: {name}",
  history_hint: "اختر سهمًا من الجدول أو اكتب رمزه في شريط الأوامر.",
  sector_avg_line: "متوسط القطاع",
  no_rows: "لا توجد أسهم تطابق هذه الفلاتر.",
  data_as_of: "البيانات حتى {date}.",
  p_detail: "السهم",
  d_sector: "القطاع",
  d_shariah: "متوافق مع الشريعة",
  d_since: "التاريخ منذ",
  yes: "نعم",
  no: "لا",
  shariah: "ش",
  shariah_title: "متوافق مع الشريعة (حسب config.py)",
  sort_by: "رتّب حسب {col}",
  pick: "اعرض التاريخ",
  p_about: "المنهجية",
  pending_title: "الوظيفة غير متاحة بعد",
  pending_body: "{code} ({name}) ستتوفر في المرحلة {n}. اضغط F1 لنظرة السوق أو F2 لمراقب حساسية النفط.",
};

export type StringKey = keyof Strings;

interface I18n {
  lang: Lang;
  dir: "ltr" | "rtl";
  setLang: (l: Lang) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  num: (v: number | null | undefined, digits?: number) => string;
  pct: (v: number | null | undefined, digits?: number, signed?: boolean) => string;
  date: (iso: string | null | undefined) => string;
  dateTime: (iso: string | null | undefined) => string;
  pick: <T extends { name_en: string; name_ar: string }>(o: T) => string;
}

const Ctx = createContext<I18n | null>(null);

// Terminal-style dates ("22 SEP 2026") regardless of browser locale.
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (getPref("tp-lang") === "ar" ? "ar" : "en"));
  const dir = lang === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    document.title = lang === "ar" ? "نبض تداول" : "Tadawul Pulse";
  }, [lang, dir]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    setPref("tp-lang", l);
  }, []);

  const value = useMemo<I18n>(() => {
    // Latin digits and fixed decimal places in both languages, as on a terminal.
    const locale = lang === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB";
    const strings = lang === "ar" ? ar : en;
    const nf = (d: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    return {
      lang,
      dir,
      setLang,
      t: (key, vars) => {
        let s: string = strings[key];
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
        return s;
      },
      num: (v, d = 2) => (v == null || !Number.isFinite(v) ? "--" : nf(d).format(v)),
      pct: (v, d = 2, signed = true) => {
        if (v == null || !Number.isFinite(v)) return "--";
        const sign = v < 0 ? "-" : signed && v > 0 ? "+" : "";
        return `${sign}${nf(d).format(Math.abs(v * 100))}%`;
      },
      date: (iso) => {
        if (!iso) return "--";
        const d = new Date(iso);
        if (lang === "en") return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
        return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
      },
      dateTime: (iso) => {
        if (!iso) return "--";
        const p = Object.fromEntries(
          new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Riyadh" })
            .formatToParts(new Date(iso))
            .map((x) => [x.type, x.value]),
        );
        return `${p.day} ${MONTHS[Number(p.month) - 1]} ${p.hour}:${p.minute}`;
      },
      pick: (o) => (lang === "ar" ? o.name_ar : o.name_en),
    };
  }, [lang, dir, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside I18nProvider");
  return v;
}
