import type { ReactNode } from "react";

interface Props {
  title: string;
  /** Menu number shown as "1)" before the title, matching the page's numbered menu. */
  n?: number;
  /** Right-hand side of the title strip: a code, date or small control. */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Inner padding; tables usually want none. */
  pad?: boolean;
  id?: string;
}

/** A terminal panel: grey title strip with an amber title, 1px rule, square corners. */
export default function Panel({ title, n, meta, children, className = "", pad = true, id }: Props) {
  return (
    <section id={id} aria-label={title} className={`flex min-w-0 scroll-mt-24 flex-col border border-border bg-bg ${className}`}>
      <header className="flex h-[20px] shrink-0 items-center justify-between gap-3 border-b border-border bg-titlebar px-1.5">
        <h2 className="flex min-w-0 items-baseline gap-1.5 truncate text-2xs font-semibold uppercase tracking-wide text-amber">
          {n != null && <span className="text-text num">{n})</span>}
          <span className="truncate">{title}</span>
        </h2>
        {meta != null && <div className="flex shrink-0 items-center gap-2 text-2xs uppercase text-dim">{meta}</div>}
      </header>
      <div className={`min-h-0 flex-1 ${pad ? "p-1.5" : ""}`}>{children}</div>
    </section>
  );
}

/** Function header: the page code on an amber key, then the page title in white. */
export function PageBar({ code, title, right }: { code: string; title: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 bg-titlebar px-1 py-[2px] text-sm">
      <span className="bg-amber px-1.5 font-bold text-bg num">{code}</span>
      <h1 className="font-semibold uppercase text-text">{title}</h1>
      {right && <div className="ms-auto text-xs text-amber">{right}</div>}
    </div>
  );
}

/** Numbered menu: "1) Summary  2) Aftermath …". Each item scrolls to its panel. */
export function NumberedMenu({ items, label }: { items: { n: number; label: string; target: string }[]; label: string }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-px">
      {items.map((it) => (
        <a
          key={it.n}
          href={`#${it.target}`}
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(it.target)?.scrollIntoView({ block: "start" });
          }}
          className="bg-menu px-2 py-[1px] text-xs text-text hover:bg-select"
        >
          <span className="me-1 text-yellow num">{it.n})</span>
          {it.label}
        </a>
      ))}
    </nav>
  );
}

/** Small segmented button group used for windows, sides and chart ranges. */
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
    <div role="group" aria-label={label} className="flex gap-px">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`px-1.5 leading-[16px] uppercase num ${value === o.id ? "bg-select text-text" : "bg-menu text-dim hover:text-text"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
