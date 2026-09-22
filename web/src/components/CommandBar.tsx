import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";
import { useData } from "../lib/data";
import { PAGES, stockPath } from "../lib/commands";
import type { Meta, StockInfo } from "../types";

type Suggestion =
  | { kind: "page"; code: string; path: string; label: string; disabled: boolean }
  | { kind: "stock"; code: string; path: string; label: string; sector: string };

const MAX_SUGGESTIONS = 8;

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

/**
 * Terminal-style command line. Type a ticker ("2222"), part of a name
 * ("rajhi") or a page code ("BETA") and press Enter.
 * "/" focuses it from anywhere; typing a letter or digit while nothing else
 * has focus also starts a command.
 */
export default function CommandBar() {
  const { t, lang, pick } = useI18n();
  const navigate = useNavigate();
  const uni = useData<StockInfo[]>("universe.json");
  const meta = useData<Meta>("meta.json");
  const stocks = useMemo(() => (uni.status === "ready" ? uni.data : []), [uni]);
  const sectorName = (k: string) => (meta.status === "ready" ? meta.data.sectors[k]?.[lang] : undefined) ?? k;

  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo<Suggestion[]>(() => {
    const s = q.trim();
    if (!s) return [];
    const up = s.toUpperCase();
    const low = s.toLowerCase();
    const pages: Suggestion[] = PAGES.filter((p) => p.code.startsWith(up)).map((p) => ({
      kind: "page",
      code: p.code,
      path: p.path,
      label: t(p.label),
      disabled: p.phase !== undefined,
    }));
    const byTicker = stocks.filter((x) => x.ticker.toLowerCase().startsWith(low));
    const byName = stocks.filter(
      (x) => !byTicker.includes(x) && (x.name_en.toLowerCase().includes(low) || x.name_ar.includes(s)),
    );
    const st: Suggestion[] = [...byTicker, ...byName].map((x) => ({
      kind: "stock",
      code: x.ticker.replace(".SR", ""),
      path: stockPath(x.ticker),
      label: pick(x),
      sector: x.sector,
    }));
    return [...pages, ...st].slice(0, MAX_SUGGESTIONS);
  }, [q, stocks, t, pick]);

  useEffect(() => setActive(0), [q]);
  const { pathname } = useLocation();
  useEffect(() => setError(null), [pathname]);
  useEffect(() => {
    if (!error) return;
    const id = window.setTimeout(() => setError(null), 4000);
    return () => window.clearTimeout(id);
  }, [error]);

  // Global shortcuts: "/" focuses; a printable key with nothing focused starts a command.
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
    const s = q.trim();
    if (!s) return;
    const choice = suggestions[active];
    if (choice) return go(choice.path);
    const up = s.toUpperCase().replace(/\s*<?GO>?$/, "");
    const page = PAGES.find((p) => p.code === up);
    if (page) return go(page.path);
    const stock = stocks.find((x) => x.ticker === up || x.ticker === `${up}.SR`);
    if (stock) return go(stockPath(stock.ticker));
    setError(t("cmd_unknown", { q: s }));
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
  // The drawn block cursor relies on monospace widths; for Arabic input fall back to the native caret.
  const ascii = /^[\x20-\x7E]*$/.test(q);
  const open = focused && suggestions.length > 0;

  return (
    <div className="relative min-w-0 flex-1">
      <div className={`flex h-[26px] items-center border ${focused ? "border-amber" : "border-border"} bg-bg`}>
        <span className="select-none bg-amber px-1.5 text-xs font-semibold leading-[24px] text-bg" aria-hidden="true">
          CMD&gt;
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
          {/* Blinking block cursor and placeholder, drawn over the input */}
          <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center px-2 text-sm num" aria-hidden="true">
            {ascii && (
              <span className="invisible whitespace-pre uppercase">{q.slice(0, focused ? caret : q.length)}</span>
            )}
            {ascii && <span className={`cursor-blink inline-block h-[14px] w-[0.6em] ${focused ? "bg-amber" : "bg-amber/60"}`} />}
            {!q && <span className="ms-1 truncate text-muted">{t("cmd_placeholder")}</span>}
          </div>
        </div>
      </div>

      {open && (
        <ul
          id="cmd-list"
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-px max-h-72 overflow-auto border border-amber bg-bg text-xs"
        >
          {suggestions.map((s, i) => (
            <li
              key={`${s.kind}-${s.code}`}
              id={`cmd-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                go(s.path);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-baseline gap-3 px-2 py-0.5 ${i === active ? "bg-amber text-bg" : "text-text"}`}
            >
              <span className={`w-10 shrink-0 font-semibold num ${i === active ? "" : "text-yellow"}`}>{s.code}</span>
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              <span className={`shrink-0 uppercase ${i === active ? "" : "text-muted"}`}>
                {s.kind === "page" ? t("cmd_page") : sectorName(s.sector)}
              </span>
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
