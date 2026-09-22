import type { ReactNode } from "react";

interface Props {
  title: string;
  /** Right-hand side of the title bar: a code, date or small control. */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Inner padding; tables usually want none. */
  pad?: boolean;
  id?: string;
}

/** A terminal panel: dark-blue title bar, 1px border, square corners. */
export default function Panel({ title, meta, children, className = "", pad = true, id }: Props) {
  return (
    <section id={id} aria-label={title} className={`flex min-w-0 flex-col border border-border bg-bg ${className}`}>
      <header className="flex h-[22px] shrink-0 items-center justify-between gap-3 bg-titlebar px-2">
        <h2 className="truncate text-2xs font-semibold uppercase tracking-wider text-text">{title}</h2>
        {meta != null && <div className="flex shrink-0 items-center gap-2 text-2xs uppercase text-amber">{meta}</div>}
      </header>
      <div className={`min-h-0 flex-1 ${pad ? "p-2" : ""}`}>{children}</div>
    </section>
  );
}

/** One-line strip at the top of each page: page code in yellow, then the title. */
export function PageBar({ code, title, right }: { code: string; title: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border px-1 pb-1 text-sm">
      <span className="bg-amber px-1.5 font-semibold text-bg num">{code}</span>
      <h1 className="font-semibold uppercase text-yellow">{title}</h1>
      {right && <div className="ms-auto text-xs text-dim">{right}</div>}
    </div>
  );
}

/** Small segmented button group used for windows and chart ranges. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`border border-border px-1.5 leading-[16px] uppercase num -ms-px first:ms-0 ${
            value === o.id ? "border-amber bg-amber text-bg" : "text-amber hover:bg-hover"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
