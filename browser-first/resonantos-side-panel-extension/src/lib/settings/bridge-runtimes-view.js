// CP-BR6: pure view-model for the Bridge & Runtimes settings section.
//
// This module translates the CP-BR5 projection + the CP-BR2 bootstrap
// snapshot into a closed, render-ready view model. It contains NO DOM
// and NO imports from the renderer / bridge / React layers.
//
// The contract is:
//   - the bootstrap snapshot is the OFFLINE source for core-bridge health;
//   - the projection is the ONLINE source for bridge details, runtimes,
//     connectors, sessions, and diagnostics;
//   - when the bootstrap snapshot is "connected", the projection is
//     authoritative for everything except the lifecycle status field
//     (which the bootstrap already published);
//   - when the bootstrap snapshot is "offline" / "starting" / "failed",
//     the projection MAY be absent; the view model then renders a
//     degraded fallback sourced from the bootstrap only.
//
// Every field exposed to the renderer is on a closed set; the renderer
// reads only this view model and never inspects raw projection or
// bootstrap fields. A new public field requires a change here AND a
// test in `bridge-runtimes-section.test.mjs`.
//
// Intent citation: docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md
// §12 (CP-BR6), BRIDGE-RUNTIME-PROJECTION.md, ADR-047.

import {
  PUBLIC_FAILURE_CODES,
  PUBLIC_STATUS_VALUES,
} from "../../../../bootstrap/bootstrap-protocol.mjs";

// ---------------------------------------------------------------------------
// Closed label vocabulary (UI state glossary)
// ---------------------------------------------------------------------------

export const BRIDGE_STATUS_LABELS = Object.freeze({
  offline: "Bridge offline",
  starting: "Bridge starting…",
  connected: "Bridge connected",
  degraded: "Bridge degraded",
  restarting: "Bridge restarting…",
  failed: "Bridge failed",
});

export const RUNTIME_STATUS_LABELS = Object.freeze({
  inactive: "Disabled",
  starting: "Starting…",
  ready: "Active",
  degraded: "Degraded",
  failed: "Failed",
  stopping: "Stopping…",
});

export const CONNECTOR_STATE_LABELS = Object.freeze({
  installed: "Installed",
  enabled: "Enabled",
  disabled: "Disabled",
  "not-installed": "Not installed",
  incompatible: "Incompatible",
  revoked: "Revoked",
});

export const AUTHORIZATION_STATE_LABELS = Object.freeze({
  granted: "Authorized",
  partial: "Partially authorized",
  missing: "Authorization missing",
  revoked: "Authorization revoked",
  "not-applicable": "Not applicable",
});

export const VIEW_TONE = Object.freeze({
  ok: "ok",
  warn: "warn",
  error: "error",
  info: "info",
});

// ---------------------------------------------------------------------------
// Input shape validation (fail-closed)
// ---------------------------------------------------------------------------

const KNOWN_TOP_FIELDS = new Set([
  "bridgeOverview",
  "runtimeList",
  "connectorList",
  "activeSessions",
  "projectionGeneration",
  "producedAt",
  "updateMechanism",
]);

const KNOWN_OVERVIEW_FIELDS = new Set([
  "status",
  "version",
  "endpoint",
  "publicEndpoint",
  "startedAt",
  "uptimeSeconds",
  "generation",
  "instanceId",
  "bootEpoch",
  "publicFailureCode",
]);

const KNOWN_RUNTIME_FIELDS = new Set([
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
]);

const KNOWN_CONNECTOR_FIELDS = new Set([
  "addonId",
  "label",
  "runtimeType",
  "connectionState",
  "authorizationState",
  "lastSuccessfulHealthAt",
  "publicFailureCode",
  "supportedRuntimeTypes",
]);

const KNOWN_SESSION_FIELDS = new Set(["addonId", "runtimeId", "activeSessionCount"]);

const KNOWN_BOOTSTRAP_KEYS = new Set([
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
const RUNTIME_STATUS_SET = new Set(Object.keys(RUNTIME_STATUS_LABELS));
const CONNECTOR_STATE_SET = new Set(Object.keys(CONNECTOR_STATE_LABELS));
const AUTHORIZATION_SET = new Set(Object.keys(AUTHORIZATION_STATE_LABELS));

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isBoundedString(value, max) {
  return typeof value === "string" && value.length <= max;
}

function isNonNegativeSafeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function closedFields(value, allowed, label) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} contains unknown field "${key}"`);
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// Projection coercion
// ---------------------------------------------------------------------------

function coerceProjection(value) {
  if (value == null) return null;
  closedFields(value, KNOWN_TOP_FIELDS, "projection");
  if (!isNonNegativeSafeInteger(value.projectionGeneration)) {
    throw new TypeError("projection.projectionGeneration must be a non-negative safe integer");
  }
  if (!isBoundedString(value.producedAt ?? "", 64)) {
    throw new TypeError("projection.producedAt must be a bounded string");
  }
  if (
    value.updateMechanism !== "polling" &&
    value.updateMechanism !== "push" &&
    value.updateMechanism !== "both"
  ) {
    throw new TypeError("projection.updateMechanism must be polling | push | both");
  }
  const overview = value.bridgeOverview
    ? closedFields(value.bridgeOverview, KNOWN_OVERVIEW_FIELDS, "projection.bridgeOverview")
    : null;
  const runtimes = Array.isArray(value.runtimeList) ? value.runtimeList : [];
  const connectors = Array.isArray(value.connectorList) ? value.connectorList : [];
  const sessions = Array.isArray(value.activeSessions) ? value.activeSessions : [];
  for (let i = 0; i < runtimes.length; i += 1) {
    closedFields(runtimes[i], KNOWN_RUNTIME_FIELDS, `projection.runtimeList[${i}]`);
    if (!RUNTIME_STATUS_SET.has(runtimes[i].status)) {
      throw new TypeError(`projection.runtimeList[${i}].status is unknown`);
    }
  }
  for (let i = 0; i < connectors.length; i += 1) {
    closedFields(connectors[i], KNOWN_CONNECTOR_FIELDS, `projection.connectorList[${i}]`);
    if (!CONNECTOR_STATE_SET.has(connectors[i].connectionState)) {
      throw new TypeError(`projection.connectorList[${i}].connectionState is unknown`);
    }
    if (!AUTHORIZATION_SET.has(connectors[i].authorizationState)) {
      throw new TypeError(`projection.connectorList[${i}].authorizationState is unknown`);
    }
  }
  for (let i = 0; i < sessions.length; i += 1) {
    closedFields(sessions[i], KNOWN_SESSION_FIELDS, `projection.activeSessions[${i}]`);
  }
  return {
    raw: value,
    overview,
    runtimes,
    connectors,
    sessions,
    generation: value.projectionGeneration,
    producedAt: value.producedAt,
    updateMechanism: value.updateMechanism,
  };
}

function coerceBootstrapSnapshot(value) {
  if (value == null) return null;
  closedFields(value, KNOWN_BOOTSTRAP_KEYS, "bootstrapSnapshot");
  const status = STATUS_SET.has(value.status) ? value.status : "offline";
  const failureCode = FAILURE_SET.has(value.failureCode) ? value.failureCode : null;
  return {
    status,
    failureCode,
    endpoint: isNonEmptyString(value.endpoint) ? value.endpoint : null,
    version: isNonEmptyString(value.version) ? value.version : null,
    instanceId: isNonEmptyString(value.instanceId) ? value.instanceId : null,
    generation: isNonNegativeSafeInteger(value.generation) ? value.generation : null,
    startedAt: isNonEmptyString(value.startedAt) ? value.startedAt : null,
    retries: isNonNegativeSafeInteger(value.retries) ? value.retries : 0,
    lastDisconnectAt: isNonEmptyString(value.lastDisconnectAt) ? value.lastDisconnectAt : null,
  };
}

// ---------------------------------------------------------------------------
// Public view model
// ---------------------------------------------------------------------------

/**
 * Build the Bridge & Runtimes view model.
 *
 * @param {{
 *   projection: Readonly<Record<string, unknown>> | null,
 *   bootstrapSnapshot: Readonly<Record<string, unknown>> | null,
 *   enableTransaction?: (addonId: string, enabled: boolean) => Promise<void>,
 *   supportedActions?: {
 *     enableDisable?: boolean,
 *     retry?: boolean,
 *     restart?: boolean,
 *     terminateSession?: boolean,
 *   },
 * }} input
 *
 * `enableTransaction` is required to render enable/disable buttons. If it
 * is missing, the enable/disable buttons are omitted and `actions`
 * reflects "unsupported".
 *
 * `supportedActions` describes what the host actually exposes. The prompt
 * is explicit: do not present retry/restart as functional unless the host
 * provides a real transaction. The default is `{}`; the host may set
 * individual flags as it adds transactions.
 */
export function buildBridgeRuntimesView(input = {}) {
  const projection = coerceProjection(input.projection ?? null);
  const bootstrap = coerceBootstrapSnapshot(input.bootstrapSnapshot ?? null);
  const actions = input.supportedActions ?? {};

  const hasProjection = projection !== null;
  const hasBootstrap = bootstrap !== null;
  const bridgeConnected = bootstrap?.status === "connected";

  // Source: bootstrap drives core-bridge health; projection drives online
  // detail. If the bridge is offline, the view model falls back to
  // bootstrap only and renders a degraded view.
  const overview = deriveOverview(bootstrap, projection, bridgeConnected);
  const runtimes = projection?.runtimes.map(coerceRuntimeEntry) ?? [];
  const connectors = projection?.connectors.map(coerceConnectorEntry) ?? [];
  const sessions = projection?.sessions.map(coerceSessionEntry) ?? [];

  // The active view state of each surface (loading / empty / degraded /
  // failed / ready). These are exposed so the renderer can pick a
  // label + tone without re-deriving.
  const viewState = {
    overview: deriveViewState({ hasProjection, hasBootstrap, bridgeConnected, overview }),
    runtimes: deriveListViewState({ hasProjection, runtimes, overview }),
    connectors: deriveListViewState({ hasProjection, items: connectors, overview }),
    sessions: deriveListViewState({ hasProjection, items: sessions, overview }),
    diagnostics: deriveDiagnosticsViewState({ hasProjection, hasBootstrap, overview }),
  };

  return {
    overview,
    runtimes,
    connectors,
    sessions,
    viewState,
    actions: {
      enableDisable:
        Boolean(actions.enableDisable) && typeof input.enableTransaction === "function",
      retry: Boolean(actions.retry),
      restart: Boolean(actions.restart),
      terminateSession: Boolean(actions.terminateSession),
    },
    updateMechanism: projection?.updateMechanism ?? null,
    projectionGeneration: projection?.generation ?? null,
    producedAt: projection?.producedAt ?? null,
    failureCode: overview.failureCode,
    bridgeConnected,
    hasProjection,
    hasBootstrap,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveOverview(bootstrap, projection, bridgeConnected) {
  // The bootstrap snapshot is the OFFLINE source for core-bridge health.
  // The projection is the ONLINE source for details. When the bootstrap
  // reports `connected`, we prefer the projection for the rest of the
  // overview; otherwise we fall back to bootstrap-only.
  const fallbackStatus = bootstrap?.status ?? "offline";
  const fallbackFailure = bootstrap?.failureCode ?? null;
  const fallbackEndpoint = bootstrap?.endpoint ?? null;
  const fallbackVersion = bootstrap?.version ?? null;
  const fallbackInstance = bootstrap?.instanceId ?? null;
  const fallbackGeneration = bootstrap?.generation ?? null;
  const fallbackStartedAt = bootstrap?.startedAt ?? null;

  if (bridgeConnected && projection?.overview) {
    return {
      status: projection.overview.status ?? "connected",
      label: BRIDGE_STATUS_LABELS[projection.overview.status] ?? BRIDGE_STATUS_LABELS.connected,
      version: projection.overview.version ?? fallbackVersion,
      endpoint: projection.overview.endpoint ?? fallbackEndpoint,
      publicEndpoint: projection.overview.publicEndpoint ?? null,
      uptimeSeconds: projection.overview.uptimeSeconds ?? null,
      generation: projection.overview.generation ?? fallbackGeneration,
      instanceId: projection.overview.instanceId ?? fallbackInstance,
      bootEpoch: projection.overview.bootEpoch ?? null,
      startedAt: projection.overview.startedAt ?? fallbackStartedAt,
      failureCode: projection.overview.publicFailureCode ?? fallbackFailure,
      tone: pickToneForBridgeStatus(projection.overview.status ?? "connected"),
    };
  }

  // Bootstrap-only fallback (offline, starting, failed, restarting, degraded).
  return {
    status: fallbackStatus,
    label: BRIDGE_STATUS_LABELS[fallbackStatus] ?? BRIDGE_STATUS_LABELS.offline,
    version: fallbackVersion,
    endpoint: fallbackEndpoint,
    publicEndpoint: null,
    uptimeSeconds: null,
    generation: fallbackGeneration,
    instanceId: fallbackInstance,
    bootEpoch: null,
    startedAt: fallbackStartedAt,
    failureCode: fallbackFailure,
    tone: pickToneForBridgeStatus(fallbackStatus),
  };
}

function pickToneForBridgeStatus(status) {
  if (status === "connected") return VIEW_TONE.ok;
  if (status === "starting" || status === "restarting") return VIEW_TONE.info;
  if (status === "degraded") return VIEW_TONE.warn;
  return VIEW_TONE.error;
}

function pickToneForRuntimeStatus(status) {
  if (status === "ready") return VIEW_TONE.ok;
  if (status === "starting" || status === "stopping") return VIEW_TONE.info;
  if (status === "degraded") return VIEW_TONE.warn;
  return VIEW_TONE.error;
}

function deriveViewState({ hasProjection, hasBootstrap, bridgeConnected, overview }) {
  if (!hasBootstrap) return "loading";
  if (bridgeConnected && !hasProjection) return "degraded";
  if (overview.status === "offline" || overview.status === "failed") return "failed";
  if (overview.status === "starting" || overview.status === "restarting") return "loading";
  if (overview.status === "degraded") return "degraded";
  return "ready";
}

function deriveListViewState({ hasProjection, items, runtimes, overview }) {
  const list = items ?? runtimes;
  if (overview && (overview.status === "offline" || overview.status === "failed")) {
    return "degraded";
  }
  if (
    overview &&
    (overview.status === "starting" || overview.status === "restarting") &&
    !hasProjection
  ) {
    return "degraded";
  }
  if (!hasProjection) return "loading";
  if (!Array.isArray(list) || list.length === 0) return "empty";
  return "ready";
}

function deriveDiagnosticsViewState({ hasProjection, hasBootstrap, overview }) {
  if (!hasBootstrap && !hasProjection) return "loading";
  if (overview && (overview.status === "offline" || overview.status === "failed"))
    return "degraded";
  if (
    overview &&
    (overview.status === "starting" || overview.status === "restarting") &&
    !hasProjection
  )
    return "degraded";
  return "ready";
}

function coerceRuntimeEntry(entry) {
  return {
    addonId: String(entry.addonId),
    runtimeId: String(entry.runtimeId ?? entry.addonId),
    label: entry.displayLabel || String(entry.addonId),
    runtimeType: String(entry.runtimeType ?? "unknown"),
    status: entry.status,
    statusLabel: RUNTIME_STATUS_LABELS[entry.status] ?? entry.status,
    generation: isNonNegativeSafeInteger(entry.generation) ? entry.generation : 0,
    activeSessionCount: isNonNegativeSafeInteger(entry.activeSessionCount)
      ? entry.activeSessionCount
      : 0,
    startedAt: isNonEmptyString(entry.startedAt) ? entry.startedAt : null,
    lastTransitionAt: isNonEmptyString(entry.lastTransitionAt) ? entry.lastTransitionAt : null,
    publicFailureCode: isNonEmptyString(entry.publicFailureCode) ? entry.publicFailureCode : null,
    factoryId: isNonEmptyString(entry.factoryId) ? entry.factoryId : null,
    classification: isNonEmptyString(entry.classification) ? entry.classification : null,
    tone: pickToneForRuntimeStatus(entry.status),
  };
}

function coerceConnectorEntry(entry) {
  return {
    addonId: String(entry.addonId),
    label: entry.label || String(entry.addonId),
    runtimeType: String(entry.runtimeType ?? "unknown"),
    connectionState: entry.connectionState,
    connectionLabel: CONNECTOR_STATE_LABELS[entry.connectionState] ?? entry.connectionState,
    authorizationState: entry.authorizationState,
    authorizationLabel:
      AUTHORIZATION_STATE_LABELS[entry.authorizationState] ?? entry.authorizationState,
    lastSuccessfulHealthAt: isNonEmptyString(entry.lastSuccessfulHealthAt)
      ? entry.lastSuccessfulHealthAt
      : null,
    publicFailureCode: isNonEmptyString(entry.publicFailureCode) ? entry.publicFailureCode : null,
    supportedRuntimeTypes: Array.isArray(entry.supportedRuntimeTypes)
      ? entry.supportedRuntimeTypes.map(String)
      : [],
  };
}

function coerceSessionEntry(entry) {
  return {
    addonId: String(entry.addonId),
    runtimeId: String(entry.runtimeId ?? entry.addonId),
    activeSessionCount: isNonNegativeSafeInteger(entry.activeSessionCount)
      ? entry.activeSessionCount
      : 0,
  };
}

// ---------------------------------------------------------------------------
// Staleness guard (re-exported shape)
// ---------------------------------------------------------------------------

/**
 * The renderer calls this before applying a fetched projection to decide
 * whether to keep the current view. Stale projections are dropped; the
 * view model state remains unchanged.
 */
export function shouldAcceptProjection(current, incoming) {
  const currentGen = current?.projectionGeneration;
  const incomingGen = incoming?.projectionGeneration;
  if (typeof incomingGen !== "number") return false;
  if (typeof currentGen === "number" && incomingGen <= currentGen) return false;
  return true;
}
