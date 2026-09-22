import { useEffect, useRef } from "react";
import { ColorType, CrosshairMode, createChart, LineStyle, type IChartApi, type ISeriesApi, type SeriesType, type UTCTimestamp } from "lightweight-charts";
import { useI18n } from "../i18n";
import { token } from "../lib/colors";
import { MONO } from "../lib/chartTheme";

export interface ChartLine {
  id: string;
  /** A theme colour name from theme.css (e.g. "oil", "mkt", "up"). */
  color: string;
  data: { time: string; value: number | null }[];
  dashed?: boolean;
  width?: 1 | 2 | 3;
}

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Props {
  lines?: ChartLine[];
  candles?: Candle[];
  height?: number;
  digits?: number;
  /** Horizontal reference line (e.g. 0 for betas). */
  baseline?: number;
  label?: string;
}

function toTime(iso: string): UTCTimestamp {
  return (Date.parse(`${iso}T00:00:00Z`) / 1000) as UTCTimestamp;
}

/**
 * TradingView lightweight-charts, restyled for the terminal: black
 * background, dim grid, amber axis text, green/red candles.
 */
export default function TimeSeriesChart({ lines = [], candles, height = 260, digits = 2, baseline, label }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const { lang } = useI18n();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: token("bg") },
        textColor: token("amber"),
        fontFamily: MONO,
        fontSize: 10,
        attributionLogo: false, // attribution is in the status bar instead
      },
      grid: { vertLines: { color: token("grid") }, horzLines: { color: token("grid") } },
      rightPriceScale: { borderColor: token("border"), scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: token("border"), fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: token("muted"), style: LineStyle.Dashed, width: 1, labelBackgroundColor: token("titlebar") },
        horzLine: { color: token("muted"), style: LineStyle.Dashed, width: 1, labelBackgroundColor: token("titlebar") },
      },
      localization: {
        locale: lang === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB",
        priceFormatter: (p: number) => p.toFixed(digits),
      },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: false },
    });

    let first = true;
    const addBaseline = (s: ISeriesApi<SeriesType>) => {
      if (first && baseline !== undefined) {
        s.createPriceLine({ price: baseline, color: token("muted"), lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
      }
      first = false;
    };

    if (candles?.length) {
      const s = chart.addCandlestickSeries({
        upColor: token("up"),
        downColor: token("down"),
        borderUpColor: token("up"),
        borderDownColor: token("down"),
        wickUpColor: token("up"),
        wickDownColor: token("down"),
        priceLineColor: token("yellow"),
        priceLineStyle: LineStyle.Dotted,
      });
      s.setData(candles.map((c) => ({ ...c, time: toTime(c.time) })));
      addBaseline(s);
    }

    lines.forEach((l, i) => {
      const s = chart.addLineSeries({
        color: token(l.color),
        lineWidth: l.width ?? (l.dashed ? 1 : 2),
        lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: !l.dashed,
        crosshairMarkerBackgroundColor: token(l.color),
        crosshairMarkerBorderColor: token("bg"),
      });
      s.setData(
        l.data.filter((p) => p.value != null && Number.isFinite(p.value)).map((p) => ({ time: toTime(p.time), value: p.value as number })),
      );
      if (i === 0 && !candles?.length) addBaseline(s);
    });

    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => chart.timeScale().fitContent());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [lines, candles, lang, digits, baseline]);

  // Time runs left to right whatever the page direction.
  return <div ref={box} dir="ltr" style={{ height }} className="w-full" role="img" aria-label={label} />;
}
