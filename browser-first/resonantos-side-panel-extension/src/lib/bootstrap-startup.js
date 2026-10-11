// ResonantOS bridge bootstrap startup orchestrator (CP-BR2).
//
// The orchestrator drives the extension's bridge startup sequence:
//
//   query status
//     -> offline/starting : call start, poll health until connected or bounded timeout
//     -> connected        : reuse, do not start again
//     -> version-mismatch : surface public incompatibility, do not reuse
//   bind bridge clients after healthy + config adoption (see 5.3)
//
// It is independent of React rendering so background.js, side-panel.js, and
// main-workspace.js can all share the same state. Concurrent boots (MV3
// service-worker revival, multiple panels, multiple tabs) join the same
// in-flight `boot` promise — only one start call ever reaches the host.
//
// Hard rules (CP-BR2 §5.6 / §7):
//   - All waits are bounded; no infinite polling, no recursive auto-restart.
//   - Bounded backoff on retry: 1s -> 2s -> 5s -> 10s, capped at 10s, max 5
//     retries per offline cycle. After the cap, the orchestrator holds the
//     public `failed` state and waits for an explicit user action.
//   - `stopForShutdown` calls the host's stopForShutdown; the host decides
//     ownership. A bridge that was already running before ROS started is
//     not owned and is left untouched (host returns already-running).
//   - Public status never carries tokens, paths, PIDs, env, or raw errors.
//     Every event the orchestrator emits is a string from the closed
//     vocabulary.

import {
  BOOTSTRAP_OPERATIONS,
  PUBLIC_FAILURE_CODES,
  PUBLIC_STATUS_VALUES,
} from "../../../bootstrap/bootstrap-protocol.mjs";

const BOOT_OFFLINE_RETRY_BACKOFF_MS = Object.freeze([1000, 2000, 5000, 10_000]);
const DEFAULT_HEALTH_POLL_INTERVAL_MS = 250;
const DEFAULT_HEALTH_POLL_TIMEOUT_MS = 10_000;
const MAX_BOOT_RETRIES = 5;
const STATUS_RE = new Set(PUBLIC_STATUS_VALUES);
const FAILURE_RE = new Set(PUBLIC_FAILURE_CODES);

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Coerce any status value the host might have produced through the closed
// vocabulary. Unknown values become "failed" with `unknown-status` (host
// must not emit those, but this is a defensive belt).
function coerceStatus(value) {
  if (typeof value === "string" && STATUS_RE.has(value)) return value;
  return "failed";
}

function coerceFailureCode(value) {
  if (typeof value === "string" && FAILURE_RE.has(value)) return value;
  return "internal-error";
}

function defaultDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {{
 *   bootstrapClient?: { request: (op: string) => Promise<object> },
 *   healthProbe?: (endpoint: string) => Promise<{ ok: boolean, version: string | null }>,
 *   onHealthyAfterStart?: (info: { endpoint: string | null, version: string | null }) => Promise<void> | void,
 *   onLifecycleEvent?: (event: { status: string, failureCode: string | null, source: string }) => void,
 *   nowImpl?: () => number,
 *   setTimeoutImpl?: typeof setTimeout,
 *   clearTimeoutImpl?: typeof clearTimeout,
 *   delayImpl?: (ms: number) => Promise<void>,
 *   backoffScheduleMs?: number[],
 *   maxRetries?: number,
 *   healthPollIntervalMs?: number,
 *   healthPollTimeoutMs?: number,
 *   log?: (msg: string, extra?: unknown) => void,
 * }} [options]
 */
export function createBootstrapStartup(options = {}) {
  const bootstrapClient = options.bootstrapClient
    ?? requireBootstrapClient();
  const healthProbe = options.healthProbe
    ?? requireHealthProbe();
  const onHealthyAfterStart = options.onHealthyAfterStart ?? (() => undefined);
  const onLifecycleEvent = options.onLifecycleEvent ?? (() => undefined);
  const now = options.nowImpl ?? (() => Date.now());
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
  const delayImpl = options.delayImpl ?? defaultDelay;
  const backoffScheduleMs = options.backoffScheduleMs ?? BOOT_OFFLINE_RETRY_BACKOFF_MS;
  const maxRetries = options.maxRetries ?? MAX_BOOT_RETRIES;
  const healthPollIntervalMs = options.healthPollIntervalMs ?? DEFAULT_HEALTH_POLL_INTERVAL_MS;
  const healthPollTimeoutMs = options.healthPollTimeoutMs ?? DEFAULT_HEALTH_POLL_TIMEOUT_MS;
  const log = options.log ?? (() => undefined);

  /** @type {"offline" | "starting" | "connected" | "degraded" | "restarting" | "failed"} */
  let status = "offline";
  let failureCode = null;
  let endpoint = null;
  let version = null;
  let instanceId = null;
  let generation = null;
  let startedAt = null;
  let bootRetries = 0;
  let bootInFlight = null;
  let lastDisconnectAt = null;
  let pendingRetryTimer = null;

  function snapshot() {
    return Object.freeze({
      status,
      failureCode,
      endpoint,
      version,
      instanceId,
      generation,
      startedAt,
      retries: bootRetries,
      lastDisconnectAt,
    });
  }

  function emit(source) {
    onLifecycleEvent({ status, failureCode, source });
  }

  function transition(next, { failureCode: nextFailure = null, source = "internal" } = {}) {
    const safe = coerceStatus(next);
    const code = nextFailure ? coerceFailureCode(nextFailure) : null;
    if (status === safe && failureCode === code) return;
    status = safe;
    failureCode = code;
    emit(source);
  }

  function resetRetryState({ clearRetryCount = false } = {}) {
    if (clearRetryCount) bootRetries = 0;
    if (pendingRetryTimer) {
      clearTimeoutImpl(pendingRetryTimer);
      pendingRetryTimer = null;
    }
  }

  function scheduleBoundedRetry(source) {
    if (bootRetries >= maxRetries) {
      transition("failed", { failureCode: "start-failed", source });
      return Promise.resolve();
    }
    const idx = Math.min(bootRetries, backoffScheduleMs.length - 1);
    const waitMs = backoffScheduleMs[idx];
    bootRetries += 1;
    if (pendingRetryTimer) clearTimeoutImpl(pendingRetryTimer);
    return new Promise((resolve) => {
      pendingRetryTimer = setTimeoutImpl(() => {
        pendingRetryTimer = null;
        resolve(undefined);
      }, waitMs);
    });
  }

  function clearOwned() {
    endpoint = null;
    version = null;
    instanceId = null;
    generation = null;
    startedAt = null;
  }

  async function pollUntilHealthy(candidateEndpoint) {
    if (!candidateEndpoint) return { ok: false, failureCode: "health-timeout", version: null };
    const deadline = now() + healthPollTimeoutMs;
    let lastVersion = null;
    let lastOk = false;
    while (now() < deadline) {
      const result = await healthProbe(candidateEndpoint);
      lastVersion = result?.version ?? null;
      lastOk = result?.ok === true;
      if (lastOk) return { ok: true, failureCode: null, version: lastVersion };
      await delayImpl(healthPollIntervalMs);
    }
    return { ok: lastOk, failureCode: lastOk ? null : "health-timeout", version: lastVersion };
  }

  async function boot() {
    if (bootInFlight) return bootInFlight;
    const promise = (async () => {
      // Boot does not reset the retry counter — only the explicit
      // `retryOnce` action does. This way, repeated reportUnexpectedExit
      // calls honour the BOOTSTRAP_MAX_RETRIES cap even when each
      // attempt re-issues boot() internally.
      resetRetryState({ clearRetryCount: false });
      transition("starting", { source: "boot" });
      const initial = await bootstrapClient.request("status");
      if (initial.ok && initial.status === "connected") {
        endpoint = initial.endpoint;
        version = initial.version;
        instanceId = initial.instanceId;
        generation = initial.generation;
        startedAt = initial.startedAt;
        transition("connected", { source: "boot-reuse" });
        return snapshot();
      }
      if (initial.ok && initial.status === "starting") {
        // The host already has an in-flight start. Just poll for healthy
        // status; do NOT issue a parallel start.
        const targetEndpoint = initial.endpoint ?? endpoint;
        const result = await pollUntilHealthy(targetEndpoint);
        if (result.ok) {
          const verified = await bootstrapClient.request("status");
          if (verified.ok && verified.status === "connected") {
            endpoint = verified.endpoint;
            version = verified.version;
            instanceId = verified.instanceId;
            generation = verified.generation;
            startedAt = verified.startedAt;
            transition("connected", { source: "boot-join" });
            return snapshot();
          }
        }
        transition("failed", { failureCode: "health-timeout", source: "boot-join" });
        return snapshot();
      }
      if (initial.ok && initial.status === "version-mismatch") {
        endpoint = initial.endpoint;
        version = initial.version;
        instanceId = initial.instanceId;
        generation = initial.generation;
        transition("failed", { failureCode: "version-mismatch", source: "boot-mismatch" });
        return snapshot();
      }
      if (!initial.ok && initial.failureCode === "version-mismatch") {
        transition("failed", { failureCode: "version-mismatch", source: "boot-mismatch" });
        return snapshot();
      }
      // offline / degraded / failed / restart-failed / start-failed: issue start
      const started = await bootstrapClient.request("start");
      if (!started.ok) {
        if (started.failureCode === "version-mismatch") {
          transition("failed", { failureCode: "version-mismatch", source: "boot-start-mismatch" });
          return snapshot();
        }
        transition("failed", { failureCode: started.failureCode ?? "start-failed", source: "boot-start" });
        return snapshot();
      }
      const targetEndpoint = started.endpoint ?? endpoint;
      const result = await pollUntilHealthy(targetEndpoint);
      if (!result.ok) {
        transition("failed", { failureCode: result.failureCode ?? "health-timeout", source: "boot-health" });
        return snapshot();
      }
      const verified = await bootstrapClient.request("status");
      if (!verified.ok || verified.status !== "connected") {
        transition("failed", { failureCode: verified.ok ? "health-timeout" : (verified.failureCode ?? "start-failed"), source: "boot-verify" });
        return snapshot();
      }
      endpoint = verified.endpoint;
      version = verified.version;
      instanceId = verified.instanceId;
      generation = verified.generation;
      startedAt = verified.startedAt;
      transition("connected", { source: "boot-fresh" });
      try {
        await onHealthyAfterStart({ endpoint, version });
      } catch (error) {
        log("bootstrap-startup: rebind trigger failed", error);
        // Rebind failure is visible (we keep `connected` so the UI can
        // surface it) but does not silently use stale credentials: the
        // onHealthyAfterStart owner is responsible for surfacing the
        // failure. The orchestrator transitions to `degraded`.
        transition("degraded", { source: "boot-rebind-failed" });
      }
      return snapshot();
    })();
    bootInFlight = promise.finally(() => { bootInFlight = null; });
    return bootInFlight;
  }

  async function restart() {
    transition("restarting", { source: "restart" });
    const result = await bootstrapClient.request("restart");
    if (!result.ok) {
      transition("failed", { failureCode: result.failureCode ?? "restart-failed", source: "restart-fail" });
      return snapshot();
    }
    const targetEndpoint = result.endpoint ?? endpoint;
    const probe = await pollUntilHealthy(targetEndpoint);
    if (!probe.ok) {
      transition("failed", { failureCode: probe.failureCode ?? "health-timeout", source: "restart-health" });
      return snapshot();
    }
    const verified = await bootstrapClient.request("status");
    if (!verified.ok || verified.status !== "connected") {
      transition("failed", { failureCode: verified.ok ? "health-timeout" : (verified.failureCode ?? "restart-failed"), source: "restart-verify" });
      return snapshot();
    }
    endpoint = verified.endpoint;
    version = verified.version;
    instanceId = verified.instanceId;
    generation = verified.generation;
    startedAt = verified.startedAt;
    transition("connected", { source: "restart-done" });
    try {
      await onHealthyAfterStart({ endpoint, version });
    } catch {
      transition("degraded", { source: "restart-rebind-failed" });
    }
    return snapshot();
  }

  /**
   * Explicit shutdown. Resolves with the public snapshot; never rejects.
   * The host decides ownership: an externally-started bridge is reported
   * via the host's response and is NOT killed. After the host responds,
   * we re-probe the loopback endpoint; if /healthz still answers, the
   * bridge was not owned and we restore the public `connected` snapshot.
   */
  async function stopForShutdown() {
    const result = await bootstrapClient.request("stopForShutdown");
    if (!result.ok) {
      transition("failed", { failureCode: result.failureCode ?? "stop-failed", source: "shutdown-fail" });
      return snapshot();
    }
    // Re-probe the loopback endpoint. If it still answers, the host had no
    // owned record and the bridge is externally-started. Preserve
    // `connected` so the user can see the bridge is still reachable.
    const probeEndpoint = result.endpoint ?? endpoint;
    if (probeEndpoint) {
      try {
        const probe = await healthProbe(probeEndpoint);
        if (probe?.ok) {
          // Bridge survived — externally started. Re-verify through the
          // host so we get a fresh instanceId/generation if any.
          const verified = await bootstrapClient.request("status");
          if (verified.ok && verified.status === "connected") {
            endpoint = verified.endpoint ?? endpoint;
            version = verified.version ?? version;
            instanceId = verified.instanceId ?? instanceId;
            generation = verified.generation ?? generation;
            startedAt = verified.startedAt ?? startedAt;
            transition("connected", { source: "shutdown-external" });
            return snapshot();
          }
        }
      } catch {
        // fall through to offline
      }
    }
    clearOwned();
    transition("offline", { source: "shutdown" });
    return snapshot();
  }

  /**
   * Called by external observers (the rebind owner or the settings page) when
   * the host reports an unexpected exit, a version-mismatch, or a 401 that
   * the host re-issued via the same protocol. The orchestrator transitions
   * to `failed` and schedules a bounded retry on next `boot` only — it does
   * NOT auto-call `boot` here (the prompt's "no recursive auto-restart" rule).
   */
  async function reportUnexpectedExit({ failureCode: code = "unexpected-exit" } = {}) {
    lastDisconnectAt = now();
    clearOwned();
    const safeCode = coerceFailureCode(code);
    transition("failed", { failureCode: safeCode, source: "unexpected-exit" });
    if (bootRetries < maxRetries) {
      await scheduleBoundedRetry("unexpected-exit-retry");
      return boot();
    }
    return snapshot();
  }

  /**
   * Single bounded retry action. Used by the Settings page "Retry" button.
   * This is the ONLY way the orchestrator re-attempts after exhausting
   * backoff or after an unexpected-exit.
   */
  async function retryOnce() {
    bootRetries = 0;
    resetRetryState({ clearRetryCount: true });
    return boot();
  }

  /**
   * Resolve when any in-flight boot attempt settles; resolve immediately
   * when the orchestrator is idle. The MV3 service-worker recovery path
   * uses this to avoid reporting the pre-boot "starting" / "offline"
   * placeholder after a SW revival while a healthy bridge is reachable.
   *
   * Always resolves (never rejects) so the caller can chain `then(snapshot)`
   * without a catch. Both the happy and the failed paths of `boot()` end
   * with a settled snapshot, which is the public post-condition.
   */
  function whenBootSettled() {
    if (!bootInFlight) return Promise.resolve();
    return bootInFlight.then(() => undefined, () => undefined);
  }

  return Object.freeze({
    boot,
    restart,
    stopForShutdown,
    retryOnce,
    reportUnexpectedExit,
    getSnapshot: snapshot,
    onLifecycleEvent,
    onHealthyAfterStart,
    whenBootSettled,
  });
}

// Default seam: pulls the production bootstrap client + health probe.
// Both are required at construction time; this is the production wiring
// only — tests always inject their own.
function requireBootstrapClient() {
  throw new Error("bootstrap-startup: bootstrapClient is required");
}
function requireHealthProbe() {
  throw new Error("bootstrap-startup: healthProbe is required");
}

export const BOOTSTRAP_RETRY_BACKOFF_MS = BOOT_OFFLINE_RETRY_BACKOFF_MS;
export const BOOTSTRAP_MAX_RETRIES = MAX_BOOT_RETRIES;
export const BOOTSTRAP_DEFAULT_HEALTH_POLL_INTERVAL_MS = DEFAULT_HEALTH_POLL_INTERVAL_MS;
export const BOOTSTRAP_DEFAULT_HEALTH_POLL_TIMEOUT_MS = DEFAULT_HEALTH_POLL_TIMEOUT_MS;
export { coerceStatus, coerceFailureCode, BOOTSTRAP_OPERATIONS, PUBLIC_FAILURE_CODES, PUBLIC_STATUS_VALUES };
