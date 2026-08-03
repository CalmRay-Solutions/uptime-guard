import { useEffect, useRef, useState, useCallback } from "react";
import { AuthError } from "./api";

interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
}

/**
 * Polls `fetcher` every `intervalMs`, but:
 *  - pauses while the tab is hidden (no wasted requests/battery), refetching on return
 *  - never overlaps: a run is skipped if the previous is still in flight
 *  - aborts the in-flight request on unmount / dep change
 *  - surfaces AuthError separately so the app can bounce to login
 */
export function usePoll<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  opts: { intervalMs?: number; enabled?: boolean; onAuthError?: () => void } = {}
) {
  const { intervalMs = 30_000, enabled = true, onAuthError } = opts;
  const [s, setS] = useState<PollState<T>>({ data: null, error: null, loading: true, updatedAt: null });
  const inFlight = useRef(false);
  const acRef = useRef<AbortController | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const authRef = useRef(onAuthError);
  authRef.current = onAuthError;

  const run = useCallback(async (showLoading: boolean) => {
    if (inFlight.current || document.hidden) return;
    inFlight.current = true;
    if (showLoading) setS((p) => ({ ...p, loading: p.data == null }));
    const ac = new AbortController();
    acRef.current = ac;
    try {
      const data = await fetcherRef.current(ac.signal);
      if (!ac.signal.aborted) setS({ data, error: null, loading: false, updatedAt: Date.now() });
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof AuthError) {
        authRef.current?.();
        return;
      }
      setS((p) => ({ ...p, error: e instanceof Error ? e.message : String(e), loading: false }));
    } finally {
      inFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setS((p) => ({ ...p, loading: p.data == null }));
    run(true);
    const id = setInterval(() => run(false), intervalMs);
    const onVis = () => {
      if (!document.hidden) run(false);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      acRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, ...deps]);

  const refresh = useCallback(() => run(false), [run]);
  return { ...s, refresh, setData: (fn: (d: T | null) => T | null) => setS((p) => ({ ...p, data: fn(p.data) })) };
}
