import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";
import { useData } from "../lib/data";
import { PAGES, parseCommand, stockPath } from "../lib/commands";
import type { TickerInfo } from "../types";

interface Suggestion {
  key: string;
  code: string;
  label: string;
  tag: string;
  path: string;
}

const MAX_SUGGESTIONS = 8;

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

/**
 * Terminal command line. Accepts a ticker ("2222"), part of a name ("rajhi"),
 * a page code ("LIMT") or both ("2222 LIMT"), then Enter or the GO key.
 * "/" focuses it from anywhere; typing a letter or digit with nothing else
 * focused also starts a command.
 */
export default function CommandBar() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const tk = useData<TickerInfo[]>("tickers.json");
  const stocks = useMemo(() => (tk.status === "ready" ? tk.data : []), [tk]);
  const tickers = useMemo(() => stocks.map((s) => s.ticker), [stocks]);

  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // A bare ticker opens its oil-beta page if it has one, otherwise its limit history.
  const defaultPath = (s: TickerInfo) => stockPath(s.ticker, s.core ? "BETA" : "LIMT");
  const name = (s: TickerInfo) => (lang === "ar" ? s.name_ar : s.name_en);

  const suggestions = useMemo<Suggestion[]>(() => {
    const raw = q.trim();
    if (!raw) return [];
    const parts = raw.toUpperCase().split(/\s+/);
    const matchStocks = (s: string) => {
      const low = s.toLowerCase();
      const byTicker = stocks.filter((x) => x.ticker.toLowerCase().startsWith(low));
      const byName = stocks.filter((x) => !byTicker.includes(x) && (x.name_en.toLowerCase().includes(low) || x.name_ar.includes(s)));
      return [...byTicker, ...byName];
    };

    // "2222 L…": the pages that can show this stock.
    if (parts.length >= 2) {
      const stock = stocks.find((x) => x.ticker === parts[0] || x.ticker === `${parts[0]}.SR`);
      if (stock) {
        return PAGES.filter((p) => p.takesTicker && p.code.startsWith(parts[1]) && (p.code !== "BETA" || stock.core)).map((p) => ({
          key: `${stock.ticker}-${p.code}`,
          code: `${stock.ticker.replace(".SR", "")} ${p.code}`,
          label: `${name(stock)}  ${t(p.label)}`,
          tag: p.fkey,
          path: stockPath(stock.ticker, p.code),
        }));
      }
    }
    const pages: Suggestion[] = PAGES.filter((p) => p.code.startsWith(parts[0])).map((p) => ({
      key: p.code, code: p.code, label: t(p.label), tag: p.fkey, path: p.path,
    }));
    const st: Suggestion[] = matchStocks(raw).map((x) => ({
      key: x.ticker, code: x.ticker.replace(".SR", ""), label: name(x), tag: x.core ? "BETA" : "LIMT", path: defaultPath(x),
    }));
    return [...pages, ...st].slice(0, MAX_SUGGESTIONS);
  }, [q, stocks, t, lang]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => setError(null), [pathname]);
  useEffect(() => {
    if (!error) return;
    const id = window.setTimeout(() => setError(null), 4000);
    return () => window.clearTimeout(id);
  }, [error]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditable(document.activeElement)) return;
      if (e.key === "/") {
        e.preventDefault();
        input.current?.focus();
      } else if (e.key.length === 1 && /[\p{L}\p{N}]/u.test(e.key)) {
        e.preventDefault();
        setQ((v) => v + e.key);
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (path: string) => {
    navigate(path);
    setQ("");
    setError(null);
    input.current?.blur();
  };

  const run = () => {
    const raw = q.trim();
    if (!raw) return;
    const exact = parseCommand(raw, tickers);
    if (exact) {
      // A bare ticker without an oil-beta page goes to its limit history instead.
      const bare = stocks.find((x) => exact === stockPath(x.ticker, "BETA"));
      return go(bare && !bare.core ? stockPath(bare.ticker, "LIMT") : exact);
    }
    const choice = suggestions[active];
    if (choice) return go(choice.path);
    setError(t("cmd_unknown", { q: raw }));
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      run();
    } else if (e.key === "ArrowDown" && suggestions.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && suggestions.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Escape") {
      setQ("");
      input.current?.blur();
    }
  };

  const syncCaret = () => setCaret(input.current?.selectionStart ?? q.length);
  const ascii = /^[\x20-\x7E]*$/.test(q);
  const open = focused && suggestions.length > 0;

  return (
    <div className="relative min-w-0 flex-1">
      <div className={`flex h-[24px] items-center border ${focused ? "border-amber" : "border-border"} bg-bg`}>
        <span className="select-none self-stretch bg-amber px-1.5 text-xs font-bold leading-[22px] text-bg" aria-hidden="true">
          CMD
        </span>
        <div className="relative h-full min-w-0 flex-1" dir="ltr">
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
            }}
            onKeyDown={onKeyDown}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onSelect={syncCaret}
            onFocus={() => {
              setFocused(true);
              syncCaret();
            }}
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="characters"
            enterKeyHint="go"
            role="combobox"
            aria-label={t("cmd_label")}
            aria-expanded={open}
            aria-controls="cmd-list"
            aria-activedescendant={open ? `cmd-opt-${active}` : undefined}
            className="h-full w-full bg-transparent px-2 text-sm uppercase text-yellow outline-none num"
            style={{ caretColor: ascii ? "transparent" : "rgb(var(--c-yellow))" }}
          />
          <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center px-2 text-sm num" aria-hidden="true">
            {ascii && <span className="invisible whitespace-pre uppercase">{q.slice(0, focused ? caret : q.length)}</span>}
            {ascii && <span className={`cursor-blink inline-block h-[13px] w-[0.6em] ${focused ? "bg-amber" : "bg-amber/60"}`} />}
            {!q && <span className="ms-1 truncate text-muted">{t("cmd_placeholder")}</span>}
          </div>
        </div>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={run}
          className="self-stretch bg-up px-2 text-xs font-bold text-bg hover:brightness-110"
          aria-label={t("cmd_go")}
          title={t("cmd_go")}
        >
          GO
        </button>
      </div>

      {open && (
        <ul id="cmd-list" role="listbox" className="absolute inset-x-0 top-full z-50 mt-px max-h-72 overflow-auto border border-amber bg-bg text-xs">
          {suggestions.map((s, i) => (
            <li
              key={s.key}
              id={`cmd-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                go(s.path);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-baseline gap-3 px-2 py-0.5 ${i === active ? "bg-select text-text" : "text-text"}`}
            >
              <span className="w-24 shrink-0 font-semibold text-yellow num">{s.code}</span>
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              <span className={`shrink-0 num ${i === active ? "text-text" : "text-amber"}`}>{s.tag}</span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="absolute inset-x-0 top-full z-50 mt-px border border-down bg-bg px-2 py-0.5 text-xs text-down" dir={lang === "ar" ? "rtl" : "ltr"}>
          {error}
        </p>
      )}
    </div>
  );
}
