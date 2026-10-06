// ResonantOS bridge bootstrap client (CP-BR2).
//
// Narrow wrapper around `chrome.runtime.connectNative(NATIVE_HOST_NAME)` that
// speaks the `resonantos/bootstrap/v1` envelope (see
// browser-first/bootstrap/bootstrap-protocol.mjs). It is the ONLY module in
// the extension that talks to the bootstrap host. The extension never
// supplies a command, argv, path, cwd, endpoint, environment, or token to
// the host; messages are exactly { protocol, requestId, operation }.
//
// Hard rules (CP-BR2 §7):
//   1. Outbound messages contain exactly the three closed envelope fields.
//   2. Responses are validated with the same exact-shape rules as the host
//      (UNKNOWN_REQUEST_FIELDS, bad protocol/op, wrong type, oversized
//      requestId, unknown status, unknown failure code -> "invalid-request").
//   3. `chrome.runtime.lastError`, port disconnect, transport timeout, and
//      malformed framing all surface as a closed public failure
//      ("internal-error") with no raw error text echoed to callers.
//   4. The client never logs or returns tokens, paths, PIDs, env, or raw
//      errors. Every public method returns the projected lifecycle result
//      only.
//   5. The module is guarded so it can only be imported from a privileged
//      extension context (background service worker, settings page, main
//      workspace) — page scripts and React code cannot call it directly.
//      The guard is best-effort: it checks for the Chrome extension globals
//      that only privileged extension contexts provide.
//
// All external boundaries (port creation, timers, requestId generation) are
// injectable for deterministic tests. The production wiring calls
// `createBootstrapClient()` with no arguments and uses `chrome.runtime`.

import {
  BOOTSTRAP_OPERATIONS,
  PUBLIC_FAILURE_CODES,
  PUBLIC_STATUS_VALUES,
  buildErrorResponse,
  buildSuccessResponse,
  projectPublicResult,
  validateBootstrapRequest,
} from "../../../bootstrap/bootstrap-protocol.mjs";
import { NATIVE_HOST_NAME } from "../../../bootstrap/bridge-policy.mjs";

export const BOOTSTRAP_PROTOCOL = "resonantos/bootstrap/v1";
export const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
export const DEFAULT_DISCONNECT_GRACE_MS = 250;
export const REQUEST_ID_MAX_LENGTH = 128;

const KNOWN_ENVELOPE_FIELDS = new Set(["protocol", "requestId", "operation"]);
const OPERATION_SET = new Set(BOOTSTRAP_OPERATIONS);
const STATUS_SET = new Set(PUBLIC_STATUS_VALUES);
const FAILURE_SET = new Set(PUBLIC_FAILURE_CODES);

function defaultRequestIdFactory() {
  // Browser crypto is available in every privileged extension context. The
  // id is opaque to the host; it exists only so we can correlate the
  // response with the request.
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `r-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Public response shape after projection. Every value is a primitive or
// null; the client never returns the host's raw `result` object. Callers
// that need a richer snapshot must use the public result fields only.
export function projectBootstrapResponse(response) {
  if (!isPlainObject(response)) return null;
  // Reject unknown fields. The host projects results the same way, so any
  // extra field on the response is either a host bug or a forgery attempt.
  for (const key of Object.keys(response)) {
    if (!KNOWN_ENVELOPE_FIELDS.has(key)
      && key !== "result"
      && key !== "ok"
      && key !== "status"
      && key !== "version"
      && key !== "endpoint"
      && key !== "instanceId"
      && key !== "generation"
      && key !== "startedAt"
      && key !== "alreadyRunning"
      && key !== "failureCode"
      && key !== "failureMessage") {
      return null;
    }
  }
  if (response.protocol !== BOOTSTRAP_PROTOCOL) return null;
  if (typeof response.requestId !== "string"
    || response.requestId.length === 0
    || response.requestId.length > REQUEST_ID_MAX_LENGTH) {
    return null;
  }
  // Strict exact-shape on the result: the host may project leniently, but
  // the client enforces the closed vocabulary (per CP-BR2 §6.2: native
  // client validates responses with exact-shape rules and rejects unknown
  // fields / bad status / bad failure code).
  if (typeof response.result !== "object" || response.result === null) return null;
  const result = response.result;
  const KNOWN_RESULT_FIELDS = new Set([
    "ok",
    "status",
    "version",
    "endpoint",
    "instanceId",
    "generation",
    "startedAt",
    "alreadyRunning",
    "failureCode",
    "failureMessage",
  ]);
  for (const key of Object.keys(result)) {
    if (!KNOWN_RESULT_FIELDS.has(key)) return null;
  }
  if (typeof result.status !== "string" || !STATUS_SET.has(result.status)) return null;
  if (result.failureCode !== undefined && result.failureCode !== null
    && (typeof result.failureCode !== "string" || !FAILURE_SET.has(result.failureCode))) {
    return null;
  }
  const failureCode = result.failureCode ?? null;
  return {
    ok: result.ok === true,
    requestId: response.requestId,
    status: result.status,
    version: typeof result.version === "string" ? result.version : null,
    endpoint: typeof result.endpoint === "string" ? result.endpoint : null,
    instanceId: typeof result.instanceId === "string" ? result.instanceId : null,
    generation: typeof result.generation === "number" ? result.generation : null,
    startedAt: typeof result.startedAt === "string" ? result.startedAt : null,
    alreadyRunning: result.alreadyRunning === true,
    failureCode,
    failureMessage: typeof result.failureMessage === "string" ? result.failureMessage : null,
  };
}

// Build the outbound envelope. Strict exact-shape: only the three closed
// fields. Anything else is dropped here. Used by tests and by the public
// request path.
export function buildBootstrapRequestEnvelope({ operation, requestId = defaultRequestIdFactory() } = {}) {
  if (!OPERATION_SET.has(operation)) {
    throw new Error("bootstrap-client: unknown operation");
  }
  if (typeof requestId !== "string" || requestId.length === 0 || requestId.length > REQUEST_ID_MAX_LENGTH) {
    throw new Error("bootstrap-client: invalid requestId");
  }
  return Object.freeze({
    protocol: BOOTSTRAP_PROTOCOL,
    requestId,
    operation,
  });
}

function closedFailure(code, message) {
  if (!FAILURE_SET.has(code)) code = "internal-error";
  const safeMessage = typeof message === "string" && message.length > 0 && message.length <= 256
    ? message
    : null;
  return { ok: false, status: null, version: null, endpoint: null, instanceId: null, generation: null, startedAt: null, alreadyRunning: false, failureCode: code, failureMessage: safeMessage };
}

function checkPrivilegedContext() {
  // Privilege guard: refuse to construct a client in page/React contexts.
  // Background service worker, settings page, and main workspace all have
  // `chrome.runtime` AND a non-web `location.protocol`. Page scripts running
  // in the loopback or LAN origins have either no `chrome.runtime` or
  // `location.protocol` is `http:`/`https:`. The settings page is served
  // from `chrome-extension://`, the background SW has no document.
  if (typeof globalThis.chrome === "undefined" || !globalThis.chrome?.runtime) {
    throw new Error("bootstrap-client: chrome.runtime is not available in this context");
  }
  const protocol = (() => {
    try { return new URL(globalThis.location?.href ?? "").protocol; }
    catch { return ""; }
  })();
  if (protocol === "http:" || protocol === "https:") {
    throw new Error("bootstrap-client: refused in page context");
  }
}

/**
 * @param {{
 *   createPort?: () => unknown,
 *   requestTimeoutMs?: number,
 *   disconnectGraceMs?: number,
 *   nowImpl?: () => number,
 *   setTimeoutImpl?: typeof setTimeout,
 *   clearTimeoutImpl?: typeof clearTimeout,
 *   requestIdFactory?: () => string,
 *   privilegedCheck?: () => void,
 *   lastErrorMessage?: () => string,
 * }} [options]
 */
export function createBootstrapClient(options = {}) {
  const createPort = options.createPort
    ?? (() => {
      const port = globalThis.chrome.runtime.connectNative(NATIVE_HOST_NAME);
      return port;
    });
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const disconnectGraceMs = options.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
  const now = options.nowImpl ?? (() => Date.now());
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
  const requestIdFactory = options.requestIdFactory ?? defaultRequestIdFactory;
  const privilegedCheck = options.privilegedCheck ?? checkPrivilegedContext;
  const readLastError = options.lastErrorMessage ?? (() => globalThis.chrome?.runtime?.lastError?.message ?? null);

  // Privilege guard at construction time (so an injected createPort can't
  // bypass it; the production factory is the only caller that needs the
  // guard, but we also run it here for defense in depth).
  privilegedCheck();

  /**
   * Send a single bootstrap operation and await the projected public
   * response. Resolves to a closed public shape; never rejects.
   *
   * @param {"status" | "start" | "restart" | "stopForShutdown"} operation
   */
  async function request(operation) {
    if (!OPERATION_SET.has(operation)) {
      return closedFailure("invalid-request", "unknown operation");
    }
    privilegedCheck();
    const requestId = requestIdFactory();
    const envelope = buildBootstrapRequestEnvelope({ operation, requestId });
    let port;
    try {
      port = createPort();
    } catch (error) {
      return closedFailure("internal-error", "port-open-failed");
    }
    if (!port) {
      return closedFailure("internal-error", "port-open-failed");
    }
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      let disconnectTimer = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeoutImpl(timer);
        if (disconnectTimer) clearTimeoutImpl(disconnectTimer);
        try { port.disconnect?.(); } catch { /* defensive */ }
        resolve(value);
      };
      timer = setTimeoutImpl(() => finish(closedFailure("internal-error", "request-timeout")), requestTimeoutMs);
      // Chrome ports dispatch a native message via `port.onMessage`. We
      // accept any payload (string or object); strings are parsed as JSON.
      const onMessage = (raw) => {
        let decoded = raw;
        if (typeof decoded === "string") {
          try { decoded = JSON.parse(decoded); }
          catch { return finish(closedFailure("invalid-request", "non-json response")); }
        }
        const projected = projectBootstrapResponse(decoded);
        if (!projected) {
          return finish(closedFailure("invalid-request", "bad response shape"));
        }
        if (projected.requestId !== requestId) {
          // Out-of-order or forged response: drop and keep waiting.
          return;
        }
        finish(projected);
      };
      const onDisconnect = () => {
        // Chrome sets chrome.runtime.lastError on disconnect. Read it
        // through the injected seam; never echo raw text to the caller.
        const lastError = readLastError();
        if (!settled) finish(closedFailure(lastError ? "internal-error" : "internal-error", "port-disconnected"));
      };
      try {
        port.onMessage?.addListener?.(onMessage);
        port.onDisconnect?.addListener?.(onDisconnect);
        port.postMessage?.(envelope);
      } catch {
        return finish(closedFailure("internal-error", "post-failed"));
      }
      // Edge case: some Chrome versions never call onDisconnect if the
      // host closes the pipe without sending. We still need a hard bound.
      disconnectTimer = setTimeoutImpl(() => {
        if (!settled) finish(closedFailure("internal-error", "disconnect-grace"));
      }, requestTimeoutMs + disconnectGraceMs);
    });
  }

  return Object.freeze({
    request,
    NATIVE_HOST_NAME,
    PROTOCOL: BOOTSTRAP_PROTOCOL,
  });
}

// Re-export closed vocabularies for callers that need to validate UI state
// (e.g. the bridge-status badge or the Settings → Stop bridge confirmation).
export { BOOTSTRAP_OPERATIONS, PUBLIC_FAILURE_CODES, PUBLIC_STATUS_VALUES, validateBootstrapRequest, buildSuccessResponse, buildErrorResponse, NATIVE_HOST_NAME };
