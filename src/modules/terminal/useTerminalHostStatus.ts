// CP-XH4d: React hook for the live `/terminal-host/status` payload.
//
// The Terminal dock entry subscribes to this hook so the connection badge
// updates when the harness service restarts or a different drive becomes
// active. The hook polls the host at a fixed interval (host's choice —
// polling) and re-renders on each update. Failures are swallowed: a stale
// or missing payload simply leaves the badges at their default values
// ("Not installed"), which is the safe rendering.
//
// No payload value is logged or echoed back to the renderer beyond the
// documented fields (`connected`, `driveId`, `surfaces`, `sessions`).
// The shape-walker guard in the harness route ensures no secret-shaped
// string ever rides in.

import { useEffect, useRef, useState } from "react";
import { webInvoke } from "../../core/web-transport";
import type { TerminalSurfaceStatus } from "./TerminalSurfaceTabs";

export interface UseTerminalHostStatusOptions {
  /** Polling interval in milliseconds. Default 4000. */
  intervalMs?: number;
  /** Disable polling (and skip the initial fetch) when false. Default true. */
  enabled?: boolean;
  /** Inject a custom fetch (test seam). Default uses `webInvoke`. */
  fetcher?: () => Promise<TerminalSurfaceStatus | null>;
}

export interface UseTerminalHostStatusResult {
  status: TerminalSurfaceStatus | null;
  loading: boolean;
  error: string | null;
}

const TERMINAL_STATUS_POLL_MS = 4000;

const defaultFetcher = async (): Promise<TerminalSurfaceStatus | null> => {
  const payload = await webInvoke<TerminalSurfaceStatus>("terminal_host_status").catch(() => null);
  if (!payload) return null;
  // Defensive copy: only the documented fields leave this hook. Anything
  // else the host might add later is dropped before reaching the renderer.
  return {
    connected: Boolean(payload.connected),
    driveId: typeof payload.driveId === "string" ? payload.driveId : null,
    surfaces: Array.isArray(payload.surfaces)
      ? payload.surfaces.map((surface) => ({
          adapterId: typeof surface?.adapterId === "string" ? surface.adapterId : "",
          label: typeof surface?.label === "string" ? surface.label : "",
          compatible: Boolean(surface?.compatible),
          connected: Boolean(surface?.connected),
        }))
      : [],
    sessions: Array.isArray(payload.sessions) ? payload.sessions.slice() : [],
  };
};

export const useTerminalHostStatus = (
  options: UseTerminalHostStatusOptions = {},
): UseTerminalHostStatusResult => {
  const enabled = options.enabled ?? true;
  const intervalMs = options.intervalMs ?? TERMINAL_STATUS_POLL_MS;
  const fetcher = options.fetcher ?? defaultFetcher;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [status, setStatus] = useState<TerminalSurfaceStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOnce = (): Promise<TerminalSurfaceStatus | null> => fetcherRef.current();
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async (): Promise<void> => {
      try {
        const next = await fetchOnce();
        if (cancelled) return;
        setStatus(next);
        setError(null);
      } catch (failure) {
        if (cancelled) return;
        // Swallow: a transient bridge hiccup must not crash the renderer.
        // Surface a minimal error string for debugging; the renderer's
        // default badge ("Not installed" via `terminalBadgeForTab`) remains
        // accurate when the status is null.
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void tick();
    timer = setInterval(() => {
      void tick();
    }, intervalMs);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [enabled, intervalMs]);

  return { status, loading, error };
};