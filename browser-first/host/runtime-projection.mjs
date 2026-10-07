// CP-BR5: non-secret runtime/connector/session projection for the
// Bridge & Runtimes UI.
//
// This module is a **pure projection**. It takes structured inputs
// (bridge status snapshot, reconciler-derived runtime entries, host
// registry projection, factory metadata, session counts) and returns
// the public BridgeRuntimesProjection. It MUST NOT:
//   - read files, spawn processes, or call the network;
//   - reach into reconciler / factory / registry private state;
//   - import React/renderer code;
//   - contain route or auth logic.
//
// All inputs are validated; unknown runtime types remain displayable
// through their public identifiers; forged or malformed input fails
// closed without leaking.
//
// Ordering and staleness:
//   - Every produced projection carries a monotonic `projectionGeneration`
//     supplied by the host. `applyProjectionUpdate(current, incoming)`
//     returns the current projection when `incoming.projectionGeneration`
//     is less than or equal to the current; a stale projection never
//     overwrites a newer one.
//
// Shape-walker contract:
//   - `walkShape(value, visit)` recursively visits every value in a
//     payload; the projection redaction tests use it to assert no
//     token-, credential-, path-, PID-, argv-, env-, prompt-, or
//     memory-shaped value is reachable in any public payload.
//   - `redactLogValue(value)` returns a public-only redacted copy
//     suitable for log lines and rejection serialization.
//
// Intent citation: docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md
// §11 (CP-BR5) and ADR-047 §"Public Status And Non-Leak Boundary".

import {
  ADDON_RUNTIME_LIFECYCLE_STATUSES,
  ADDON_RUNTIME_PUBLIC_FAILURE_CODES,
} from "../../packages/addon-sdk/src/runtime-lifecycle.ts";

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

export const KNOWN_BRIDGE_STATUSES = Object.freeze([
  "offline",
  "starting",
  "connected",
  "degraded",
  "restarting",
  "failed",
]);

export const KNOWN_CONNECTOR_STATES = Object.freeze([
  "installed",
  "enabled",
  "disabled",
  "not-installed",
  "incompatible",
  "revoked",
]);

export const KNOWN_AUTHORIZATION_STATES = Object.freeze([
  "granted",
  "partial",
  "missing",
  "revoked",
  "not-applicable",
]);

export const KNOWN_CONNECTOR_HEALTH_STATES = Object.freeze(["ok", "degraded", "unknown"]);

// CP-BR5 closed failure code catalog (re-uses CP-BR3/CP-BR4 vocabulary and
// adds projection-specific codes).
export const PROJECTION_FAILURE_CODES = Object.freeze([
  ...ADDON_RUNTIME_PUBLIC_FAILURE_CODES,
  "projection-bridge-offline",
  "projection-bridge-failed",
  "projection-shape-invalid",
  "projection-stale-superseded",
  "projection-connector-state-unknown",
  "projection-session-count-invalid",
  "projection-runtime-type-unknown",
  "projection-input-missing",
]);

export const RUNTIME_LIFECYCLE_STATUSES = Object.freeze([...ADDON_RUNTIME_LIFECYCLE_STATUSES]);

const RUNTIME_LIFECYCLE_STATUS_SET = new Set(ADDON_RUNTIME_LIFECYCLE_STATUSES);
const FAILURE_CODE_SET = new Set(PROJECTION_FAILURE_CODES);
const BRIDGE_STATUS_SET = new Set(KNOWN_BRIDGE_STATUSES);
const CONNECTOR_STATE_SET = new Set(KNOWN_CONNECTOR_STATES);
const AUTHORIZATION_STATE_SET = new Set(KNOWN_AUTHORIZATION_STATES);
const CONNECTOR_HEALTH_SET = new Set(KNOWN_CONNECTOR_HEALTH_STATES);
const RUNTIME_TYPE_KNOWN_SET = new Set([
  "ui-module",
  "embedded-module",
  "local-service",
  "agent-addon",
  "channel-addon",
]);
// Displayable runtime types include the known five plus an open "unknown"
// bucket so a future add-on with a novel runtimeType is still surfaced via
// its public identifiers.
const DISPLAYABLE_RUNTIME_TYPES = new Set([...RUNTIME_TYPE_KNOWN_SET, "unknown"]);

const RUNTIME_TYPE_TO_PUBLIC_LABEL = Object.freeze({
  "ui-module": "ui-module",
  "embedded-module": "embedded-module",
  "local-service": "local-service",
  "agent-addon": "agent-addon",
  "channel-addon": "channel-addon",
});

const CLOSED_FIELDS_OVERVIEW = Object.freeze(
  new Set([
    "status",
    "version",
    "endpoint",
    "publicEndpoint",
    "startedAt",
    "uptimeSeconds",
    "generation",
    "publicFailureCode",
    "bootEpoch",
    "instanceId",
  ]),
);

const CLOSED_FIELDS_RUNTIME = Object.freeze(
  new Set([
    "addonId",
    "runtimeId",
    "runtimeType",
    "status",
    "generation",
    "activeSessionCount",
    "startedAt",
    "lastTransitionAt",
    "publicFailureCode",
    "factoryId",
    "classification",
    "displayLabel",
  ]),
);

const CLOSED_FIELDS_CONNECTOR = Object.freeze(
  new Set([
    "addonId",
    "label",
    "runtimeType",
    "connectionState",
    "authorizationState",
    "lastSuccessfulHealthAt",
    "publicFailureCode",
    "supportedRuntimeTypes",
  ]),
);

const CLOSED_FIELDS_SESSION = Object.freeze(
  new Set(["addonId", "runtimeId", "activeSessionCount"]),
);

const CLOSED_FIELDS_TOP = Object.freeze(
  new Set([
    "bridgeOverview",
    "runtimeList",
    "connectorList",
    "activeSessions",
    "projectionGeneration",
    "producedAt",
    "updateMechanism",
  ]),
);

// ---------------------------------------------------------------------------
// Type predicates
// ---------------------------------------------------------------------------

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

const isNonNegativeSafeInteger = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isBoundedString = (value, { max = 256 } = {}) =>
  typeof value === "string" && value.length <= max;

const isIsoTimestamp = (value) => {
  if (typeof value !== "string") return false;
  // Strict ISO 8601 with milliseconds and Z (matches the SDK projection
  // timestamp convention). Other shapes would be too permissive.
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
};

const assertString = (value, label) => {
  if (!isNonEmptyString(value)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      `${label} must be a non-empty string`,
    );
  }
  return value;
};

const assertBoundedString = (value, label, { max = 256 } = {}) => {
  if (!isBoundedString(value, { max })) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      `${label} must be a non-empty string <= ${max} characters`,
    );
  }
  return value;
};

const assertNonNegativeInteger = (value, label) => {
  if (!isNonNegativeSafeInteger(value)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      `${label} must be a non-negative safe integer`,
    );
  }
  return value;
};

const assertIsoTimestamp = (value, label) => {
  if (value === undefined) return undefined;
  if (!isIsoTimestamp(value)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      `${label} must be an ISO 8601 timestamp (YYYY-MM-DDTHH:MM:SS.sssZ)`,
    );
  }
  return value;
};

const assertFailureCode = (value, label) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !FAILURE_CODE_SET.has(value)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      `${label} must be a closed failure code`,
    );
  }
  return value;
};

const assertBridgeStatus = (value, label) => {
  if (typeof value !== "string" || !BRIDGE_STATUS_SET.has(value)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      `${label} must be a closed bridge status`,
    );
  }
  return value;
};

const assertRuntimeStatus = (value, label) => {
  if (typeof value !== "string" || !RUNTIME_LIFECYCLE_STATUS_SET.has(value)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      `${label} must be a closed runtime status`,
    );
  }
  return value;
};

const assertRuntimeType = (value, label) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProjectionShapeError(
      "projection-runtime-type-unknown",
      `${label} must be a non-empty string (a known or novel runtime type)`,
    );
  }
  if (value.length > 128) {
    throw new ProjectionShapeError(
      "projection-runtime-type-unknown",
      `${label} must be a non-empty string <= 128 characters`,
    );
  }
  return value;
};

const assertConnectorState = (value, label) => {
  if (typeof value !== "string" || !CONNECTOR_STATE_SET.has(value)) {
    throw new ProjectionShapeError(
      "projection-connector-state-unknown",
      `${label} must be a closed connector state`,
    );
  }
  return value;
};

const assertAuthorizationState = (value, label) => {
  if (typeof value !== "string" || !AUTHORIZATION_STATE_SET.has(value)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      `${label} must be a closed authorization state`,
    );
  }
  return value;
};

const assertConnectorHealth = (value, label) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !CONNECTOR_HEALTH_SET.has(value)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      `${label} must be a closed connector health state`,
    );
  }
  return value;
};

// ---------------------------------------------------------------------------
// Public error
// ---------------------------------------------------------------------------

export class ProjectionShapeError extends Error {
  constructor(publicFailureCode, message) {
    super(message);
    this.name = "ProjectionShapeError";
    this.publicFailureCode = assertFailureCode(publicFailureCode, "publicFailureCode");
  }
}

// ---------------------------------------------------------------------------
// Shape-walker
// ---------------------------------------------------------------------------

/**
 * Recursively visit every value in `value`. Arrays, plain objects, and
 * primitives are all visited. The walker is shared by the projection and
 * the redaction tests; it never throws, never invokes a callback twice
 * for the same node, and never inspects a node's prototype chain.
 *
 * @param {unknown} value
 * @param {(key: string|number|null, value: unknown) => void} visit
 */
export function walkShape(value, visit) {
  if (typeof visit !== "function") return;
  const stack = [{ key: null, value }];
  while (stack.length > 0) {
    const { key, value: current } = stack.pop();
    visit(key, current);
    if (current === null || current === undefined) continue;
    if (Array.isArray(current)) {
      for (let i = current.length - 1; i >= 0; i -= 1) {
        stack.push({ key: i, value: current[i] });
      }
      continue;
    }
    if (typeof current === "object") {
      const entries = Object.entries(current);
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const [entryKey, entryValue] = entries[i];
        stack.push({ key: entryKey, value: entryValue });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Redaction (log / rejection serialization)
// ---------------------------------------------------------------------------

// Fields that must NEVER appear in a public payload (redacted before log).
// The shape-walker tests assert these are unreachable; the redactor strips
// any value of the named key from a payload before logging.
const FORBIDDEN_PUBLIC_KEYS = new Set([
  "token",
  "accessToken",
  "bearer",
  "password",
  "secret",
  "privateKey",
  "credential",
  "authFile",
  "tokenFile",
  "env",
  "argv",
  "pid",
  "command",
  "childArgv",
  "memory",
  "prompt",
  "promptContent",
  "memoryContent",
  "privatePath",
  "rawError",
  "stack",
  "home",
  "userPath",
]);

const REDACTED_MARKER = "[REDACTED]";

/**
 * Return a public-only redacted copy of `value`. The result is a deep copy
 * with every forbidden key removed; arrays and primitives are returned
 * unchanged. The redactor never throws and never mutates the input.
 *
 * @param {unknown} value
 */
export function redactLogValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => redactLogValue(entry));
  }
  if (!isPlainObject(value)) return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PUBLIC_KEYS.has(key)) {
      result[key] = REDACTED_MARKER;
      continue;
    }
    result[key] = redactLogValue(entry);
  }
  return Object.freeze(result);
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

/**
 * Project the public bridge overview. Accepts the CP-BR2 public bootstrap
 * status plus the CP-BR1 generation/instance identity. Carries only public
 * identifiers; no tokens, no credentials, no path, no PID, no argv.
 *
 * @param {{
 *   status: string,
 *   version?: string,
 *   endpoint?: string,
 *   publicEndpoint?: string,
 *   startedAt?: string,
 *   uptimeSeconds?: number,
 *   generation?: number,
 *   instanceId?: string,
 *   bootEpoch?: string,
 *   publicFailureCode?: string,
 * }} input
 * @returns {Readonly<{...}>}
 */
export function projectBridgeOverview(input) {
  if (!isPlainObject(input)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      "bridge overview input must be a plain object",
    );
  }
  // Whitelist: any field not on the closed list is dropped before the
  // public object is built. This is the core non-leak guard.
  const sanitized = {};
  for (const key of Object.keys(input)) {
    if (!CLOSED_FIELDS_OVERVIEW.has(key)) continue;
    sanitized[key] = input[key];
  }
  const overview = {};
  overview.status = assertBridgeStatus(sanitized.status, "bridge.status");
  if (sanitized.version !== undefined) {
    overview.version = assertBoundedString(sanitized.version, "bridge.version", { max: 64 });
  }
  if (sanitized.endpoint !== undefined) {
    overview.endpoint = assertBoundedString(sanitized.endpoint, "bridge.endpoint", { max: 256 });
  }
  if (sanitized.publicEndpoint !== undefined) {
    overview.publicEndpoint = assertBoundedString(
      sanitized.publicEndpoint,
      "bridge.publicEndpoint",
      { max: 256 },
    );
  }
  if (sanitized.startedAt !== undefined) {
    overview.startedAt = assertIsoTimestamp(sanitized.startedAt, "bridge.startedAt");
  }
  if (sanitized.uptimeSeconds !== undefined) {
    overview.uptimeSeconds = assertNonNegativeInteger(
      sanitized.uptimeSeconds,
      "bridge.uptimeSeconds",
    );
  }
  if (sanitized.generation !== undefined) {
    overview.generation = assertNonNegativeInteger(sanitized.generation, "bridge.generation");
  }
  if (sanitized.instanceId !== undefined) {
    overview.instanceId = assertBoundedString(sanitized.instanceId, "bridge.instanceId", {
      max: 128,
    });
  }
  if (sanitized.bootEpoch !== undefined) {
    overview.bootEpoch = assertBoundedString(sanitized.bootEpoch, "bridge.bootEpoch", { max: 128 });
  }
  if (sanitized.publicFailureCode !== undefined) {
    overview.publicFailureCode = assertFailureCode(
      sanitized.publicFailureCode,
      "bridge.publicFailureCode",
    );
  }
  // Map a few bridge statuses to projection failure codes so the UI can
  // surface a uniform "why" without reading raw host state.
  if (overview.publicFailureCode === undefined) {
    if (overview.status === "offline") overview.publicFailureCode = "projection-bridge-offline";
    else if (overview.status === "failed") overview.publicFailureCode = "projection-bridge-failed";
  }
  return Object.freeze(overview);
}

/**
 * Project one public add-on runtime entry. Unknown `runtimeType` values
 * remain displayable via their public `runtimeId` / `addonId`.
 *
 * @param {{
 *   addonId: string,
 *   runtimeId?: string,
 *   runtimeType: string,
 *   status: string,
 *   generation: number,
 *   activeSessionCount: number,
 *   startedAt?: string,
 *   lastTransitionAt?: string,
 *   publicFailureCode?: string,
 *   factoryId?: string,
 *   classification?: string,
 *   displayLabel?: string,
 * }} input
 */
export function projectRuntimeEntry(input) {
  if (!isPlainObject(input)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      "runtime entry input must be a plain object",
    );
  }
  const sanitized = {};
  for (const key of Object.keys(input)) {
    if (!CLOSED_FIELDS_RUNTIME.has(key)) continue;
    sanitized[key] = input[key];
  }
  const entry = {};
  entry.addonId = assertString(sanitized.addonId, "runtime.addonId");
  entry.runtimeId = assertBoundedString(
    sanitized.runtimeId ?? sanitized.addonId,
    "runtime.runtimeId",
    { max: 128 },
  );
  entry.runtimeType = assertRuntimeType(sanitized.runtimeType, "runtime.runtimeType");
  entry.status = assertRuntimeStatus(sanitized.status, "runtime.status");
  entry.generation = assertNonNegativeInteger(sanitized.generation, "runtime.generation");
  entry.activeSessionCount = assertNonNegativeInteger(
    sanitized.activeSessionCount,
    "runtime.activeSessionCount",
  );
  if (sanitized.startedAt !== undefined) {
    entry.startedAt = assertIsoTimestamp(sanitized.startedAt, "runtime.startedAt");
  }
  if (sanitized.lastTransitionAt !== undefined) {
    entry.lastTransitionAt = assertIsoTimestamp(
      sanitized.lastTransitionAt,
      "runtime.lastTransitionAt",
    );
  }
  if (sanitized.publicFailureCode !== undefined) {
    entry.publicFailureCode = assertFailureCode(
      sanitized.publicFailureCode,
      "runtime.publicFailureCode",
    );
  }
  if (sanitized.factoryId !== undefined) {
    entry.factoryId = assertBoundedString(sanitized.factoryId, "runtime.factoryId", { max: 128 });
  }
  if (sanitized.classification !== undefined) {
    entry.classification = assertBoundedString(sanitized.classification, "runtime.classification", {
      max: 128,
    });
  }
  if (sanitized.displayLabel !== undefined) {
    entry.displayLabel = assertBoundedString(sanitized.displayLabel, "runtime.displayLabel", {
      max: 128,
    });
  } else {
    // Provide a public display label derived from the addonId. This is the
    // public identifier, never a credential or a path.
    entry.displayLabel = publicDisplayLabelForAddonId(entry.addonId);
  }
  // Coerce unknown runtimeType to "unknown" for the canonical label, but
  // keep the public identifier readable.
  if (!RUNTIME_TYPE_KNOWN_SET.has(entry.runtimeType)) {
    entry.runtimeType = "unknown";
  }
  return Object.freeze(entry);
}

/**
 * Project one public connector entry. Connectors are derived from
 * installations whose `classification.category === "connector"` OR whose
 * `runtimeType === "channel-addon"`. The public label is the add-on
 * public identifier; the host registry never provides a private label.
 *
 * @param {{
 *   addonId: string,
 *   label?: string,
 *   runtimeType: string,
 *   connectionState: string,
 *   authorizationState: string,
 *   lastSuccessfulHealthAt?: string,
 *   publicFailureCode?: string,
 *   supportedRuntimeTypes?: readonly string[],
 * }} input
 */
export function projectConnectorEntry(input) {
  if (!isPlainObject(input)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      "connector entry input must be a plain object",
    );
  }
  const sanitized = {};
  for (const key of Object.keys(input)) {
    if (!CLOSED_FIELDS_CONNECTOR.has(key)) continue;
    sanitized[key] = input[key];
  }
  const entry = {};
  entry.addonId = assertString(sanitized.addonId, "connector.addonId");
  entry.label = assertBoundedString(sanitized.label ?? sanitized.addonId, "connector.label", {
    max: 128,
  });
  entry.runtimeType = assertRuntimeType(
    sanitized.runtimeType ?? "unknown",
    "connector.runtimeType",
  );
  entry.connectionState = assertConnectorState(
    sanitized.connectionState,
    "connector.connectionState",
  );
  entry.authorizationState = assertAuthorizationState(
    sanitized.authorizationState,
    "connector.authorizationState",
  );
  if (sanitized.lastSuccessfulHealthAt !== undefined) {
    entry.lastSuccessfulHealthAt = assertIsoTimestamp(
      sanitized.lastSuccessfulHealthAt,
      "connector.lastSuccessfulHealthAt",
    );
  }
  if (sanitized.publicFailureCode !== undefined) {
    entry.publicFailureCode = assertFailureCode(
      sanitized.publicFailureCode,
      "connector.publicFailureCode",
    );
  }
  if (Array.isArray(sanitized.supportedRuntimeTypes)) {
    const types = [];
    for (const value of sanitized.supportedRuntimeTypes) {
      if (typeof value !== "string") {
        throw new ProjectionShapeError(
          "projection-shape-invalid",
          "connector.supportedRuntimeTypes must be an array of strings",
        );
      }
      types.push(RUNTIME_TYPE_KNOWN_SET.has(value) ? value : "unknown");
    }
    entry.supportedRuntimeTypes = Object.freeze(types);
  }
  if (!RUNTIME_TYPE_KNOWN_SET.has(entry.runtimeType)) {
    entry.runtimeType = "unknown";
  }
  return Object.freeze(entry);
}

/**
 * Project the public active-session summary. Each entry carries only
 * `addonId`, `runtimeId`, and the bounded `activeSessionCount`. Private
 * session data (prompt content, memory content, raw payload) is never
 * included.
 *
 * @param {{
 *   addonId: string,
 *   runtimeId: string,
 *   activeSessionCount: number,
 * }} input
 */
export function projectSessionEntry(input) {
  if (!isPlainObject(input)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      "session entry input must be a plain object",
    );
  }
  const sanitized = {};
  for (const key of Object.keys(input)) {
    if (!CLOSED_FIELDS_SESSION.has(key)) continue;
    sanitized[key] = input[key];
  }
  const entry = {};
  entry.addonId = assertString(sanitized.addonId, "session.addonId");
  entry.runtimeId = assertBoundedString(
    sanitized.runtimeId ?? sanitized.addonId,
    "session.runtimeId",
    { max: 128 },
  );
  entry.activeSessionCount = assertNonNegativeInteger(
    sanitized.activeSessionCount,
    "session.activeSessionCount",
  );
  return Object.freeze(entry);
}

// ---------------------------------------------------------------------------
// Composed projection + ordering
// ---------------------------------------------------------------------------

/**
 * Assemble the full public projection. All four shapes plus the
 * `projectionGeneration` and `producedAt` are required.
 *
 * @param {{
 *   bridgeOverview: Readonly<Record<string, unknown>>,
 *   runtimeList: ReadonlyArray<Readonly<Record<string, unknown>>>,
 *   connectorList: ReadonlyArray<Readonly<Record<string, unknown>>>,
 *   activeSessions: ReadonlyArray<Readonly<Record<string, unknown>>>,
 *   projectionGeneration: number,
 *   producedAt: string,
 *   updateMechanism?: "polling" | "push" | "both",
 * }} input
 */
export function projectBridgeRuntimes(input) {
  if (!isPlainObject(input)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      "bridgeRuntimes input must be a plain object",
    );
  }
  // Whitelist at the top level too.
  const sanitized = {};
  for (const key of Object.keys(input)) {
    if (!CLOSED_FIELDS_TOP.has(key)) continue;
    sanitized[key] = input[key];
  }
  if (!isPlainObject(sanitized.bridgeOverview)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      "bridgeOverview must be a plain object",
    );
  }
  if (
    !Array.isArray(sanitized.runtimeList) ||
    !Array.isArray(sanitized.connectorList) ||
    !Array.isArray(sanitized.activeSessions)
  ) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      "runtimeList, connectorList, and activeSessions must be arrays",
    );
  }
  const projectionGeneration = assertNonNegativeInteger(
    sanitized.projectionGeneration,
    "projectionGeneration",
  );
  const producedAt = assertIsoTimestamp(sanitized.producedAt, "producedAt");
  const updateMechanism =
    sanitized.updateMechanism === undefined
      ? "polling"
      : sanitized.updateMechanism === "polling" ||
          sanitized.updateMechanism === "push" ||
          sanitized.updateMechanism === "both"
        ? sanitized.updateMechanism
        : (() => {
            throw new ProjectionShapeError(
              "projection-shape-invalid",
              "updateMechanism must be polling|push|both",
            );
          })();

  const runtimeList = Object.freeze(
    sanitized.runtimeList.map((entry) => projectRuntimeEntry(entry)),
  );
  const connectorList = Object.freeze(
    sanitized.connectorList.map((entry) => projectConnectorEntry(entry)),
  );
  const activeSessions = Object.freeze(
    sanitized.activeSessions.map((entry) => projectSessionEntry(entry)),
  );
  const bridgeOverview = projectBridgeOverview(sanitized.bridgeOverview);

  return Object.freeze({
    bridgeOverview,
    runtimeList,
    connectorList,
    activeSessions,
    projectionGeneration,
    producedAt,
    updateMechanism,
  });
}

/**
 * Apply an incoming projection to a current projection. Stale
 * projections never overwrite newer ones. Returns the same reference
 * when stale (so callers can detect rejection by reference equality).
 *
 * @param {Readonly<Record<string, unknown>>|null} current
 * @param {Readonly<Record<string, unknown>>} incoming
 */
export function applyProjectionUpdate(current, incoming) {
  if (current === null || current === undefined) return incoming;
  if (!isPlainObject(current) || !isPlainObject(incoming)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      "applyProjectionUpdate: both projections must be plain objects",
    );
  }
  const currentGen = current.projectionGeneration;
  const incomingGen = incoming.projectionGeneration;
  if (!isNonNegativeSafeInteger(currentGen) || !isNonNegativeSafeInteger(incomingGen)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      "applyProjectionUpdate: projectionGeneration must be a non-negative safe integer",
    );
  }
  if (incomingGen <= currentGen) {
    // Stale: keep the current projection. Throw a typed error so the
    // route can map to the public `projection-stale-superseded` code.
    throw new ProjectionShapeError(
      "projection-stale-superseded",
      `incoming projection generation ${incomingGen} is not newer than current ${currentGen}`,
    );
  }
  return incoming;
}

// ---------------------------------------------------------------------------
// Pure helper: derive runtime entries from host-owned inputs
// ---------------------------------------------------------------------------

/**
 * Build public runtime entries from a host-side ordered list. Each input
 * is a plain object; unknown runtime types are still projected via their
 * public identifiers. The list is returned in generation order (the
 * host's order); the route MUST supply generation-sorted input.
 *
 * @param {ReadonlyArray<Readonly<Record<string, unknown>>>} entries
 */
export function projectRuntimeList(entries) {
  if (!Array.isArray(entries)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      "projectRuntimeList: entries must be an array",
    );
  }
  return Object.freeze(entries.map((entry) => projectRuntimeEntry(entry)));
}

/**
 * Build public connector entries from a host-side ordered list. The list
 * is returned in the same order; the route MUST supply input already
 * sorted by `addonId` to keep the UI stable.
 *
 * @param {ReadonlyArray<Readonly<Record<string, unknown>>>} entries
 */
export function projectConnectorList(entries) {
  if (!Array.isArray(entries)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      "projectConnectorList: entries must be an array",
    );
  }
  return Object.freeze(entries.map((entry) => projectConnectorEntry(entry)));
}

/**
 * Build the active-session summary. The input MUST be the ordered list
 * of `{ addonId, runtimeId, activeSessionCount }` triples derived from
 * the host-side session counts; private session data is never accepted.
 *
 * @param {ReadonlyArray<Readonly<Record<string, unknown>>>} entries
 */
export function projectSessionSummary(entries) {
  if (!Array.isArray(entries)) {
    throw new ProjectionShapeError(
      "projection-shape-invalid",
      "projectSessionSummary: entries must be an array",
    );
  }
  return Object.freeze(entries.map((entry) => projectSessionEntry(entry)));
}

// ---------------------------------------------------------------------------
// Public display label helper
// ---------------------------------------------------------------------------

/**
 * Derive a public display label from a public addonId. Never a path or
 * a credential; only the id is consumed.
 *
 * @param {string} addonId
 */
function publicDisplayLabelForAddonId(addonId) {
  if (typeof addonId !== "string" || addonId.length === 0) return "addon";
  // Strip a leading "addon." or "com.resonantos." prefix to surface a
  // public label. The result is a public identifier, not a path.
  let label = addonId;
  if (label.startsWith("com.resonantos.")) {
    label = label.slice("com.resonantos.".length);
  } else if (label.startsWith("addon.")) {
    label = label.slice("addon.".length);
  }
  return label.slice(0, 128);
}

export { publicDisplayLabelForAddonId };

// Public re-exports of the public runtime lifecycle vocabulary.
export { RUNTIME_TYPE_TO_PUBLIC_LABEL };
