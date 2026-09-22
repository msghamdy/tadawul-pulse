import type { ReactNode } from "react";
import type { LoadState } from "../lib/data";
import { useI18n } from "../i18n";

export function Loading() {
  const { t } = useI18n();
  return (
    <p role="status" className="p-2 text-xs uppercase text-amber">
      <span className="cursor-blink me-1 inline-block h-3 w-2 bg-amber align-middle" aria-hidden="true" />
      {t("loading")}
    </p>
  );
}

export function ErrorState({ missing, message }: { missing: boolean; message: string }) {
  const { t } = useI18n();
  return (
    <div className="m-2 max-w-2xl border border-down p-3 text-sm">
      <p className="font-semibold uppercase text-down">{missing ? t("missing_title") : t("error_title")}</p>
      <p className="mt-1 text-dim">{missing ? t("missing_body") : message}</p>
      {!missing && (
        <button onClick={() => window.location.reload()} className="mt-2 border border-amber px-2 text-xs uppercase text-amber hover:bg-amber hover:text-bg">
          {t("retry")}
        </button>
      )}
    </div>
  );
}

/** Render children once every state is ready; otherwise show loading or the first error. */
export function Gate<T extends unknown[]>({
  states,
  children,
}: {
  states: { [K in keyof T]: LoadState<T[K]> };
  children: (...data: T) => ReactNode;
}) {
  const list = states as unknown as LoadState<unknown>[];
  const err = list.find((s) => s.status === "error");
  if (err && err.status === "error") return <ErrorState missing={err.missing} message={err.message} />;
  if (list.some((s) => s.status !== "ready")) return <Loading />;
  const data = list.map((s) => (s as { data: unknown }).data) as T;
  return <>{children(...data)}</>;
}
