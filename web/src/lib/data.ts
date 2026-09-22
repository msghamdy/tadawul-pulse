import { useEffect, useState } from "react";

export type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; missing: boolean; message: string }
  | { status: "ready"; data: T };

const cache = new Map<string, Promise<unknown>>();

/** URL of a file in public/data, respecting the Vite base path. */
export function dataUrl(path: string): string {
  return `${import.meta.env.BASE_URL}data/${path}`;
}

class MissingDataError extends Error {}

function load<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(dataUrl(path), { cache: "no-cache" }).then(async (res) => {
      if (res.status === 404) throw new MissingDataError(path);
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      const text = await res.text();
      // Vite's dev server answers unknown paths with index.html; treat that as missing.
      if (text.trimStart().startsWith("<")) throw new MissingDataError(path);
      return JSON.parse(text) as T;
    });
    p.catch(() => cache.delete(path)); // allow a retry after a failure
    cache.set(path, p);
  }
  return p;
}

/** Fetch a JSON file from public/data once and share it between components. */
export function useData<T>(path: string | null): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState({ status: "loading" });
    load<T>(path).then(
      (data) => alive && setState({ status: "ready", data }),
      (err: unknown) =>
        alive &&
        setState({
          status: "error",
          missing: err instanceof MissingDataError,
          message: err instanceof Error ? err.message : String(err),
        }),
    );
    return () => {
      alive = false;
    };
  }, [path]);
  return state;
}
