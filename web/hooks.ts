// Shared page hooks: sequenced loading and query-string state.
import {
  useEffect,
  useRef,
  useState,
  type DependencyList,
  type Dispatch,
  type SetStateAction,
} from "react";

export type Loader<T> = {
  /** The last successful result; kept when a later load fails. */
  data: T | null;
  setData: Dispatch<SetStateAction<T | null>>;
  loading: boolean;
  error: string;
  setError: Dispatch<SetStateAction<string>>;
  /** Load again with the current inputs. */
  refresh: () => void;
};

/**
 * Runs `load` whenever `deps` change or `refresh()` is called. The previous
 * request is aborted, and only the newest request may update state, so a slow
 * stale response can never overwrite a newer one. While `enabled` is false
 * nothing loads and the current state is left as it is.
 */
export function useLoader<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
  {
    enabled = true,
    errorMessage,
    onLoad,
  }: {
    enabled?: boolean;
    /** The message shown for a failed (not aborted) load. */
    errorMessage: (error: unknown) => string;
    /** Called with each successful result before it is stored. */
    onLoad?: (data: T) => void;
  },
): Loader<T> {
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const sequence = useRef(0),
    latest = useRef({ load, errorMessage, onLoad });
  latest.current = { load, errorMessage, onLoad };
  useEffect(() => {
    if (!enabled) return;
    const id = ++sequence.current,
      controller = new AbortController(),
      current = () => id === sequence.current;
    setLoading(true);
    setError("");
    latest.current
      .load(controller.signal)
      .then((next) => {
        if (!current()) return;
        latest.current.onLoad?.(next);
        setData(next);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted && current())
          setError(latest.current.errorMessage(e));
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
    return () => controller.abort();
    // `deps` are the caller's inputs to `load`; the latest `load` is read from a ref.
  }, [enabled, revision, ...deps]);
  const refresh = useRef(() => setRevision((n) => n + 1)).current;
  return { data, setData, loading, error, setError, refresh };
}

export type HistoryMode = "push" | "replace";

/**
 * Writes a query string to the address bar. A history entry is added only for
 * "push" (page changes, discrete choices); "replace" rewrites the current
 * entry (filter tweaks, normalising an invalid link). Unchanged URLs are left
 * alone.
 */
export function writeSearch(search: string, mode: HistoryMode) {
  if (search === location.search) return;
  if (mode === "push") history.pushState(history.state, "", search);
  else history.replaceState(history.state, "", search);
}

/**
 * State that mirrors the query string: it starts from `read()` and is read
 * again on back/forward. `normalise` runs for the first value and for each
 * restored one, so an invalid link can be rewritten in place.
 */
export function useUrlState<T>(
  read: () => T,
  normalise?: (value: T) => void,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(read),
    latest = useRef({ read, normalise, value });
  latest.current = { read, normalise, value };
  useEffect(() => {
    latest.current.normalise?.(latest.current.value);
    const restore = () => {
      const next = latest.current.read();
      latest.current.normalise?.(next);
      setValue(next);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  return [value, setValue];
}
