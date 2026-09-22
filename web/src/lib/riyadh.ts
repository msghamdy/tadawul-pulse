// Riyadh clock and a schedule-based market status. Public holidays and
// half-days aren't known to the site, so on those days "OPEN" can be wrong.

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Riyadh",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export interface RiyadhNow {
  hms: string;
  weekday: string;
  open: boolean;
}

export function riyadhNow(d = new Date()): RiyadhNow {
  const p = Object.fromEntries(parts.formatToParts(d).map((x) => [x.type, x.value]));
  const h = Number(p.hour) % 24;
  const m = Number(p.minute);
  const tradingDay = ["Sun", "Mon", "Tue", "Wed", "Thu"].includes(p.weekday);
  const mins = h * 60 + m;
  return {
    hms: `${String(h).padStart(2, "0")}:${p.minute}:${p.second}`,
    weekday: p.weekday,
    open: tradingDay && mins >= 10 * 60 && mins < 15 * 60,
  };
}
