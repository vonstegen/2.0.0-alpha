// CP-BR1: versioned native-message envelope and public result projection
// for the independent bridge bootstrap host.
//
// Two responsibilities, both fail-closed:
//
//   1. Request validation. A BootstrapRequest is a plain JSON object with
//      EXACTLY these fields:
//        protocol: "resonantos/bootstrap/v1"   (exact string)
//        requestId: string                     (1..128 chars, echoed)
//        operation: "status" | "start" | "restart" | "stopForShutdown"
//      Unknown fields, missing fields, arrays, null, scalars, unsupported
//      protocol versions, and unknown operations are rejected with the
//      closed public failure code "invalid-request". No field of a valid
//      request ever influences process policy (bridge-policy.mjs owns all
//      process inputs).
//
//   2. Public projection. `projectPublicResult` is the single choke point
//      through which every lifecycle outcome passes before it is framed
//      onto native stdout. It whitelist-copies ONLY the documented public
//      fields, coercing each to a primitive or dropping it. PID, process
//      paths, argv, environment, raw errors, and private state can never
//      reach the wire even if a lifecycle bug attached them.
//
// Closed public status vocabulary (ADR-047):
//   offline | starting | connected | degraded | restarting | failed
//
// Closed public failure codes:
//   invalid-request   malformed envelope, unknown field, bad protocol/op
//   start-failed      spawn failure or owned child died while starting
//   health-timeout    owned child did not become healthy within the bound
//   restart-failed    restart could not fence/stop the old generation or
//                     a healthy bridge not owned by this host blocked restart
//   stop-failed       owned child did not exit within the bounded stop wait
//   version-mismatch  healthy bridge reports a version the host rejects
//   unexpected-exit   owned child exited after reaching connected
//   internal-error    defensive fallback for host bugs (never expected)

export const PUBLIC_STATUS_VALUES = Object.freeze([
  "offline",
  "starting",
  "connected",
  "degraded",
  "restarting",
  "failed",
]);

export const PUBLIC_FAILURE_CODES = Object.freeze([
  "invalid-request",
  "start-failed",
  "health-timeout",
  "restart-failed",
  "stop-failed",
  "version-mismatch",
  "unexpected-exit",
  "internal-error",
]);

export const BOOTSTRAP_OPERATIONS = Object.freeze([
  "status",
  "start",
  "restart",
  "stopForShutdown",
]);

const REQUEST_ID_MAX_LENGTH = 128;
const KNOWN_REQUEST_FIELDS = new Set(["protocol", "requestId", "operation"]);
const STATUS_SET = new Set(PUBLIC_STATUS_VALUES);
const FAILURE_SET = new Set(PUBLIC_FAILURE_CODES);
const OPERATION_SET = new Set(BOOTSTRAP_OPERATIONS);

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Validate one decoded native message against the exact envelope shape.
 *
 * @param {unknown} value parsed JSON (any type)
 * @param {{ protocol: string }} policy
 * @returns {{ ok: true, request: { protocol: string, requestId: string, operation: string } }
 *          | { ok: false, failureCode: "invalid-request" }}
 */
export function validateBootstrapRequest(value, { protocol }) {
  if (!isPlainObject(value)) return { ok: false, failureCode: "invalid-request" };
  for (const key of Object.keys(value)) {
    if (!KNOWN_REQUEST_FIELDS.has(key)) return { ok: false, failureCode: "invalid-request" };
  }
  if (value.protocol !== protocol) return { ok: false, failureCode: "invalid-request" };
  if (typeof value.requestId !== "string"
    || value.requestId.length === 0
    || value.requestId.length > REQUEST_ID_MAX_LENGTH) {
    return { ok: false, failureCode: "invalid-request" };
  }
  if (typeof value.operation !== "string" || !OPERATION_SET.has(value.operation)) {
    return { ok: false, failureCode: "invalid-request" };
  }
  return {
    ok: true,
    request: {
      protocol: value.protocol,
      requestId: value.requestId,
      operation: value.operation,
    },
  };
}

/**
 * Whitelist projection of an internal lifecycle result onto the closed
 * public field set. Non-whitelisted keys are dropped; non-primitive values
 * are dropped; unknown status/failure values are dropped (never invented).
 *
 * @param {object} internal lifecycle result (may carry private fields)
 * @returns {{
 *   status: string,
 *   version?: string | null,
 *   endpoint?: string,
 *   instanceId?: string,
 *   startedAt?: string,
 *   failureCode?: string,
 *   alreadyRunning?: boolean,
 * }}
 */
export function projectPublicResult(internal) {
  const source = internal && typeof internal === "object" ? internal : {};
  const out = {};
  out.status = STATUS_SET.has(source.status) ? source.status : "failed";
  if (typeof source.version === "string" || source.version === null) out.version = source.version;
  if (typeof source.endpoint === "string") out.endpoint = source.endpoint;
  if (typeof source.instanceId === "string") out.instanceId = source.instanceId;
  if (typeof source.startedAt === "string") out.startedAt = source.startedAt;
  if (FAILURE_SET.has(source.failureCode)) out.failureCode = source.failureCode;
  if (typeof source.alreadyRunning === "boolean") out.alreadyRunning = source.alreadyRunning;
  return out;
}

/**
 * Build the framed success response envelope.
 */
export function buildSuccessResponse({ protocol, requestId, result }) {
  return {
    protocol,
    requestId,
    ok: true,
    result: projectPublicResult(result),
  };
}

/**
 * Build the framed error response envelope. `result` may carry additional
 * public state (e.g. the current status alongside a failure code); it is
 * projected through the same whitelist.
 */
export function buildErrorResponse({ protocol, requestId, failureCode, result = {} }) {
  const projected = projectPublicResult({ ...result, failureCode });
  const resolvedCode = projected.failureCode ?? (FAILURE_SET.has(failureCode) ? failureCode : "internal-error");
  projected.failureCode = resolvedCode;
  return {
    protocol,
    requestId,
    ok: false,
    failureCode: resolvedCode,
    result: projected,
  };
}
