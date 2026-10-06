// CP-XH5b: React hook for the live `/terminal-host/prompt-path` payload.
//
// The "Open in Terminal" button subscribes to this hook so it can
// enable/disable itself based on whether a valid 0600 prompt file
// currently exists at the host-configured path. The hook polls at
// the same cadence as `useTerminalHostStatus` and exposes only the
// documented fields (`promptPath`, `valid`).
//
// No payload value is logged or echoed back to the renderer beyond
// the documented fields.

import { useEffect, useRef, useState } from "react";
import { webInvoke } from "../../core/web-transport";

export interface UseTerminalPromptPathResult {
  promptPath: string | null;
  valid: boolean;
}

export interface UseTerminalPromptPathOptions {
  /** Polling interval in milliseconds. Default 4000. */
  intervalMs?: number;
  /** Disable polling (and skip the initial fetch) when false. Default true. */
  enabled?: boolean;
  /** Inject a custom fetch (test seam). Default uses `webInvoke`. */
  fetcher?: () => Promise<UseTerminalPromptPathResult | null>;
}

const DEFAULT_INTERVAL_MS = 4000;

const defaultFetcher = async (): Promise<UseTerminalPromptPathResult | null> => {
  const payload = await webInvoke<{ promptPath: string | null; valid: boolean }>(
    "terminal_host_prompt_path",
  ).catch(() => null);
  if (!payload) return null;
  return {
    promptPath: typeof payload.promptPath === "string" ? payload.promptPath : null,
    valid: payload.valid === true,
  };
};

export const useTerminalPromptPath = (
  options: UseTerminalPromptPathOptions = {},
): UseTerminalPromptPathResult => {
  const enabled = options.enabled ?? true;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const fetcher = options.fetcher ?? defaultFetcher;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [state, setState] = useState<UseTerminalPromptPathResult>({ promptPath: null, valid: false });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const result = await fetcherRef.current();
      if (cancelled) return;
      if (result) setState(result);
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, intervalMs]);

  return state;
};

export default useTerminalPromptPath;