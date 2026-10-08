// ResonantOS bridge bootstrap renderer helper (CP-BR2).
//
// Single owner for the renderer's view of the bridge bootstrap lifecycle.
// The renderer (side panel, main workspace, settings page) NEVER talks to
// `chrome.runtime.connectNative` directly — every bootstrap query/stop/retry
// goes through the service worker via the privileged message channel added
// by CP-BR2 in `background.js`.
//
// The renderer subscribes to the SW's snapshot via a `refresh()` poll loop
// (bounded at 1s while active, paused when the document is hidden). It also
// exposes imperative `stopForShutdown` and `retryOnce` so the Settings page
// can drive the lifecycle.

import { PUBLIC_FAILURE_CODES, PUBLIC_STATUS_VALUES } from "../../../bootstrap/bootstrap-protocol.mjs";

const DEFAULT_POLL_INTERVAL_MS = 1000;
const KNOWN_SNAPSHOT_KEYS = new Set([
  "status",
  "failureCode",
  "endpoint",
  "version",
  "instanceId",
  "generation",
  "startedAt",
  "retries",
  "lastDisconnectAt",
]);
const STATUS_SET = new Set(PUBLIC_STATUS_VALUES);
const FAILURE_SET = new Set(PUBLIC_FAILURE_CODES);

function coerceSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  for (const key of Object.keys(value)) {
    if (!KNOWN_SNAPSHOT_KEYS.has(key)) return null;
  }
  const status = typeof value.status === "string" && STATUS_SET.has(value.status)
    ? value.status
    : "offline";
  const failureCode = typeof value.failureCode === "string" && FAILURE_SET.has(value.failureCode)
    ? value.failureCode
    : null;
  return {
    status,
    failureCode,
    endpoint: typeof value.endpoint === "string" ? value.endpoint : null,
    version: typeof value.version === "string" ? value.version : null,
    instanceId: typeof value.instanceId === "string" ? value.instanceId : null,
    generation: typeof value.generation === "number" ? value.generation : null,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : null,
    retries: typeof value.retries === "number" ? value.retries : 0,
    lastDisconnectAt: typeof value.lastDisconnectAt === "number" ? value.lastDisconnectAt : null,
  };
}

function defaultSendMessage(message) {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome?.runtime?.sendMessage) {
      resolve({ ok: false, error: "no-runtime" });
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const last = chrome?.runtime?.lastError;
        if (last) {
          resolve({ ok: false, error: last.message ?? "runtime-error" });
          return;
        }
        resolve(response ?? { ok: false, error: "empty-response" });
      });
    } catch (error) {
      resolve({ ok: false, error: error?.message ?? String(error) });
    }
  });
}

/**
 * @param {{
 *   sendMessage?: (msg: object) => Promise<unknown>,
 *   pollIntervalMs?: number,
 *   nowImpl?: () => number,
 *   setIntervalImpl?: typeof setInterval,
 *   clearIntervalImpl?: typeof clearInterval,
 *   visibilityCheck?: () => boolean,
 *   onSnapshot?: (snapshot: object) => void,
 * }} [options]
 */
export function createBootstrapRenderer(options = {}) {
  const sendMessage = options.sendMessage ?? defaultSendMessage;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const now = options.nowImpl ?? (() => Date.now());
  const setIntervalImpl = options.setIntervalImpl ?? setInterval;
  const clearIntervalImpl = options.clearIntervalImpl ?? clearInterval;
  const visibilityCheck = options.visibilityCheck ?? (() => globalThis.document?.visibilityState !== "hidden");
  const onSnapshot = options.onSnapshot ?? (() => undefined);

  let lastSnapshot = null;
  let timer = null;
  let stopped = false;

  async function refresh() {
    if (stopped) return lastSnapshot;
    const response = await sendMessage({ type: "bootstrap:get-status", channel: "resonantos.browser_first" });
    if (response?.ok && response.snapshot) {
      const projected = coerceSnapshot(response.snapshot);
      if (projected) {
        lastSnapshot = projected;
        try { onSnapshot(projected); } catch { /* defensive */ }
      }
    } else if (response?.ok && !response.snapshot) {
      // First run before the SW has bound; treat as offline with no failure.
      lastSnapshot = coerceSnapshot({ status: "offline" });
    }
    return lastSnapshot;
  }

  function start() {
    if (timer || stopped) return;
    void refresh();
    timer = setIntervalImpl(() => {
      if (!visibilityCheck()) return;
      void refresh();
    }, pollIntervalMs);
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearIntervalImpl(timer);
      timer = null;
    }
  }

  async function stopForShutdown() {
    const response = await sendMessage({ type: "bootstrap:stop", channel: "resonantos.browser_first" });
    if (response?.ok) {
      await refresh();
    }
    return response;
  }

  async function retryOnce() {
    const response = await sendMessage({ type: "bootstrap:retry", channel: "resonantos.browser_first" });
    if (response?.ok) {
      await refresh();
    }
    return response;
  }

  async function restart() {
    const response = await sendMessage({ type: "bootstrap:restart", channel: "resonantos.browser_first" });
    if (response?.ok) {
      await refresh();
    }
    return response;
  }

  return Object.freeze({
    start,
    stop,
    refresh,
    stopForShutdown,
    retryOnce,
    restart,
    getSnapshot: () => lastSnapshot,
  });
}

export { PUBLIC_FAILURE_CODES, PUBLIC_STATUS_VALUES };
