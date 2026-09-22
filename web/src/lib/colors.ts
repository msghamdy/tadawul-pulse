// Chart code can't use Tailwind classes, so it reads the same CSS variables
// defined in src/styles/theme.css. There are no colour literals in this file.

function readVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * A theme colour as rgba(), for canvas and SVG charts. Comma syntax because
 * lightweight-charts doesn't parse "rgb(R G B)".
 */
export function token(name: string, alpha = 1): string {
  const v = readVar(`--c-${name}`) || "128 128 128";
  return `rgba(${v.split(/\s+/).join(",")},${alpha})`;
}

/** Colour for a sector key, from the --s-* variables. */
export function sectorColor(key: string, alpha = 1): string {
  const v = readVar(`--s-${key}`) || readVar("--s-default");
  return `rgba(${v.split(/\s+/).join(",")},${alpha})`;
}
