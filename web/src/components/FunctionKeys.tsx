import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";
import { PAGES } from "../lib/commands";

/** F1–F5 page keys. Work with a click or the real keyboard F-keys. */
export default function FunctionKeys() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const page = PAGES.find((p) => p.fkey === e.key);
      if (page) {
        e.preventDefault(); // stops F1 help and F5 reload
        navigate(page.path);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const isActive = (path: string) => (path === "/" ? pathname === "/" : pathname.startsWith(path));

  return (
    <nav aria-label={t("fkeys_label")} className="flex overflow-x-auto border-t border-border" dir="ltr">
      {PAGES.map((p) => {
        const active = isActive(p.path);
        return (
          <button
            key={p.code}
            onClick={() => navigate(p.path)}
            aria-current={active ? "page" : undefined}
            title={t(p.label)}
            className={`flex shrink-0 items-center gap-1.5 border-e border-border px-1.5 py-[3px] text-xs sm:flex-1 ${
              active ? "bg-select text-text" : "text-text hover:bg-hover"
            }`}
          >
            <span className="bg-yellow px-1 text-2xs font-bold text-bg num">{p.fkey}</span>
            <span className="font-semibold num">{p.code}</span>
            <span className={`hidden truncate lg:inline ${active ? "text-text" : p.phase ? "text-muted" : "text-amber"}`}>{t(p.label)}</span>
          </button>
        );
      })}
    </nav>
  );
}
