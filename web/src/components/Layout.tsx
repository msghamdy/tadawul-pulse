import { Link, Outlet } from "react-router-dom";
import { useI18n } from "../i18n";
import { useData } from "../lib/data";
import type { Meta } from "../types";
import CommandBar from "./CommandBar";
import TickerTape from "./TickerTape";
import StatusBar from "./StatusBar";
import FunctionKeys from "./FunctionKeys";

function PulseMark() {
  return (
    <svg viewBox="0 0 32 20" className="h-4 w-7 shrink-0" aria-hidden="true">
      <path d="M1 12h6l3-8 5 14 3-9 2 3h11" fill="none" stroke="rgb(var(--c-amber))" strokeWidth="2.4" strokeLinecap="square" />
    </svg>
  );
}

/** Terminal shell: command bar and ticker tape on top, status and F-keys at the bottom. */
export default function Layout() {
  const { t, lang, setLang } = useI18n();
  const meta = useData<Meta>("meta.json");
  const synthetic = meta.status === "ready" && meta.data.synthetic;

  return (
    <div className="flex min-h-screen flex-col" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="z-30 bg-bg md:sticky md:top-0">
        <header className="flex items-center gap-2 px-1.5 py-1">
          <Link to="/" className="flex shrink-0 items-center gap-1.5 pe-1">
            <PulseMark />
            <span className="hidden text-sm font-bold uppercase tracking-wide text-amber sm:inline">{t("brand")}</span>
          </Link>
          <CommandBar />
          <button
            onClick={() => setLang(lang === "en" ? "ar" : "en")}
            aria-label={t("switch_lang_label")}
            title={t("switch_lang_label")}
            className="h-[26px] shrink-0 border border-border px-2 text-xs font-semibold text-amber hover:border-amber num"
          >
            {t("switch_lang")}
          </button>
        </header>
        <TickerTape />
        {synthetic && (
          <p className="bg-yellow px-2 py-[2px] text-2xs font-semibold uppercase text-bg">{t("synthetic_banner")}</p>
        )}
      </div>

      <main className="flex-1 p-1">
        <Outlet />
      </main>

      <div className="sticky bottom-0 z-30 bg-bg" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <StatusBar />
        <FunctionKeys />
      </div>
    </div>
  );
}
