// ResonantOS MV3 service-worker keepalive.
//
// Background:
//   MV3 service workers are idle-killed by Chromium after ~30s of no
//   dispatchable work. When that happens while the main-workspace page
//   is hidden, the extension UI reports "Bridge offline" even though the
//   bridge process is still up. The CP-BR2 orchestrator is in the SW
//   and its `getSnapshot` is the single source of truth — losing it
//   tears down the rendered state.
//
// Fix:
//   Open one long-lived `chrome.runtime.connect()` port from the
//   extension page. An open port pins the SW alive even while the page
//   is hidden or unfocused. The port carries NO payload — it exists
//   only to keep the worker alive. No tokens, credentials, paths, PIDs,
//   or env values ever cross it (the shape-walker test in
//   `browser-first/test/sw-keepalive.test.mjs` enforces this).
//
// Reconnect discipline:
//   The SW can be killed (idle kill, reload, update). When the port
//   disconnects, the keepalive reconnects with a bounded exponential
//   backoff (1s -> 2s -> 5s -> 10s -> 30s cap) so a SW that is briefly
//   down does not turn into a tight reconnect loop. A successful
//   connect resets the attempt counter so transient storms do not
//   poison the next window.
//
// The factory accepts injectable `connectImpl`, `setTimeoutImpl`, and
// `clearTimeoutImpl` seams so the reconnect discipline is testable
// without a live SW.

export const KEEPALIVE_PORT_NAME = "resonantos.keepalive";

// Backoff mirrors the CP-BR2 recovery backoff vocabulary, capped at 30s
// so a permanently dead SW does not cause a 1s-spam reconnect loop.
const RECONNECT_BACKOFF_MS = Object.freeze([1000, 2000, 5000, 10_000, 30_000]);
const RECONNECT_BACKOFF_CAP_MS = RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1];

function defaultConnect({ name }) {
  if (typeof chrome === "undefined" || !chrome?.runtime?.connect) {
    return null;
  }
  try {
    return chrome.runtime.connect({ name });
  } catch {
    // Extension context invalidated (reload / update) — caller reconnects.
    return null;
  }
}

/**
 * @param {{
 *   connectImpl?: (init: { name: string }) => unknown,
 *   setTimeoutImpl?: typeof setTimeout,
 *   clearTimeoutImpl?: typeof clearTimeout,
 *   nowImpl?: () => number,
 *   onStateChange?: (state: { connected: boolean, attempts: number, lastErrorAt: number | null }) => void,
 * }} [options]
 */
export function createSwKeepalive(options = {}) {
  const connectImpl = options.connectImpl ?? defaultConnect;
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
  const now = options.nowImpl ?? (() => Date.now());
  const onStateChange = options.onStateChange ?? (() => undefined);

  let port = null;
  let attempts = 0;
  let reconnectTimer = null;
  let stopped = false;
  let lastErrorAt = null;

  function emit() {
    onStateChange({ connected: port !== null, attempts, lastErrorAt });
  }

  function scheduleReconnect() {
    if (stopped) return;
    if (reconnectTimer !== null) return;
    const idx = Math.min(attempts, RECONNECT_BACKOFF_MS.length - 1);
    const waitMs = Math.min(RECONNECT_BACKOFF_MS[idx], RECONNECT_BACKOFF_CAP_MS);
    attempts += 1;
    reconnectTimer = setTimeoutImpl(() => {
      reconnectTimer = null;
      connect();
    }, waitMs);
  }

  function connect() {
    if (stopped) return;
    try {
      port = connectImpl({ name: KEEPALIVE_PORT_NAME });
    } catch {
      port = null;
      lastErrorAt = now();
    }
    if (!port) {
      emit();
      scheduleReconnect();
      return;
    }
    // Reset the backoff on a successful connect so a transient
    // disconnect-then-storm does not compound the previous window.
    attempts = 0;
    if (typeof port.onDisconnect?.addListener === "function") {
      port.onDisconnect.addListener(handleDisconnect);
    }
    if (typeof port.onMessage?.addListener === "function") {
      // The keepalive port carries no payload; ignore any incoming
      // message rather than echoing it back. A misbehaving caller cannot
      // exfiltrate anything because nothing crosses the channel.
      port.onMessage.addListener(() => undefined);
    }
    emit();
  }

  function handleDisconnect() {
    // Reading `lastError` clears the runtime error so it does not surface
    // as an "Unchecked runtime.lastError" warning in the DevTools
    // console. The keepalive is best-effort; failures are recoverable
    // via the bounded reconnect.
    const last = (typeof chrome !== "undefined" && chrome?.runtime?.lastError)
      ? chrome.runtime.lastError.message
      : null;
    if (last) lastErrorAt = now();
    port = null;
    emit();
    scheduleReconnect();
  }

  return Object.freeze({
    start() {
      if (stopped) return;
      connect();
    },
    stop() {
      stopped = true;
      if (reconnectTimer !== null) {
        clearTimeoutImpl(reconnectTimer);
        reconnectTimer = null;
      }
      if (port && typeof port.disconnect === "function") {
        try { port.disconnect(); } catch { /* extension context gone */ }
      }
      port = null;
      emit();
    },
    isConnected() {
      return port !== null;
    },
    getAttempts() {
      return attempts;
    },
  });
}
