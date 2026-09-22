import { useI18n } from "../i18n";
import { useFlash } from "../lib/useFlash";

/** A signed percentage: green up, red down, white unchanged. Flashes on change. */
export function Chg({ value, digits = 2, className = "" }: { value: number | null | undefined; digits?: number; className?: string }) {
  const { pct } = useI18n();
  const flash = useFlash(value);
  const color = value == null ? "text-muted" : value > 0 ? "text-up" : value < 0 ? "text-down" : "text-flat";
  return (
    <span className={`num ${color} ${flash} ${className}`} dir="ltr">
      {pct(value, digits)}
    </span>
  );
}

/** A fixed-decimal number that flashes green or red when it changes. */
export function Val({ value, digits = 2, className = "text-text" }: { value: number | null | undefined; digits?: number; className?: string }) {
  const { num } = useI18n();
  const flash = useFlash(value);
  return (
    <span className={`num ${value == null ? "text-muted" : className} ${flash}`} dir="ltr">
      {num(value, digits)}
    </span>
  );
}
