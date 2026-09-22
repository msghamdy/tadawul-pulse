import { PAGES } from "../lib/commands";
import { useI18n } from "../i18n";
import Panel, { PageBar } from "../components/Panel";

/** Placeholder for pages that arrive in a later build phase. */
export default function Pending({ code }: { code: string }) {
  const { t } = useI18n();
  const page = PAGES.find((p) => p.code === code)!;
  const name = t(page.label);
  return (
    <div className="space-y-1">
      <PageBar code={code} title={name} />
      <Panel title={t("pending_title")} meta={<span className="num">{code}</span>}>
        <p className="max-w-2xl text-sm text-dim">{t("pending_body", { code, name, n: page.phase ?? "" })}</p>
      </Panel>
    </div>
  );
}
