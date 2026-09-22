import { useEffect, useRef, useState } from "react";

/**
 * Returns "flash-up" or "flash-down" for ~0.7s after a numeric value changes,
 * so a table cell can briefly highlight the direction of the change.
 */
export function useFlash(value: number | null | undefined): string {
  const prev = useRef(value);
  const [cls, setCls] = useState("");
  useEffect(() => {
    const p = prev.current;
    prev.current = value;
    if (p == null || value == null || p === value) return;
    setCls(value > p ? "flash-up" : "flash-down");
    const id = window.setTimeout(() => setCls(""), 700);
    return () => window.clearTimeout(id);
  }, [value]);
  return cls;
}
