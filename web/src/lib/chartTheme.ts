// Shared Recharts styling so no default library look remains.
// All colours come from src/styles/theme.css via token().
import { token } from "./colors";

export const MONO = '"IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace';

export function rechartsTheme() {
  return {
    grid: { stroke: token("grid"), strokeDasharray: "1 3" },
    axis: {
      stroke: token("border"),
      tick: { fill: token("amber"), fontSize: 10, fontFamily: MONO },
      tickLine: { stroke: token("border") },
    },
    ref: token("muted", 0.8),
    label: (color: string) => ({ fill: color, fontSize: 10, fontFamily: MONO }),
  };
}
