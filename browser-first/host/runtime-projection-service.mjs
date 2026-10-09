// CP-BR5: host-side composition for the non-secret runtime/connector/session
// projection.
//
// This module is a thin glue layer between the host-owned runtime lifecycle
// (CP-BR4 reconciler + factory registry), the harness registry projection
// (connectors / installations), and the pure projection module
// (`runtime-projection.mjs`). It owns:
//   - one in-memory snapshot derived from the most recent reconcile and
//     the most recent harness registry snapshot;
//   - monotonic projection generation (the `bridgeRuntimesCount` from the
//     reconciler + an internal counter);
//   - a subscriber list for the push update mechanism;
//   - a pure read-only `snapshot()` for the host route.
//
// The module deliberately does NOT import the bridge transport, the bridge
// auth, the React UI, or any SDK add-on manifest contents. It is a glue
// layer only.
//
// Intent citation: docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md §11
// (CP-BR5) and ADR-047 §"Public Status And Non-Leak Boundary".

import {
  PROJECTION_FAILURE_CODES,
  projectBridgeRuntimes,
  projectRuntimeList,
  projectConnectorList,
  projectSessionSummary,
  applyProjectionUpdate,
} from "./runtime-projection.mjs";

const KNOWN_RUNTIME_TYPES = new Set([
  "ui-module",
  "embedded-module",
  "local-service",
  "agent-addon",
  "channel-addon",
]);

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isNonNegativeSafeInteger = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const assertBoundedString = (value, label, { max = 128 } = {}) => {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new Error(`${label} must be a non-empty string <= ${max} characters`);
  }
  return value;
};

const isIsoTimestamp = (value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);

/**
 * @typedef {{
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
 * }} BridgeOverviewInput
 */

/**
 * @param {object} options
 * @param {{
 *   listActive?: () => ReadonlyArray<{ addonId: string, factoryId: string, generation: number, status: string }>,
 *   snapshot?: () => any,
 * }} [options.reconciler]
 *   Optional CP-BR4 reconciler facade. When supplied, `listActive()` is
 *   the live add-on process list and the projection prefers its
 *   `status` over the registry-derived fallback. When omitted, the
 *   projection derives status from the host registry projection. The
 *   reconciler is NEVER inspected for process internals.
 * @param {{
 *   snapshot: () => BridgeOverviewInput
 * }} options.bridgeStatus
 *   Public bridge status source (the CP-BR2 orchestrator or the bridge
 *   composition root).
 * @param {{
 *   getSessionsByRuntime: (addonId: string) => { activeSessionCount: number }
 * }} [options.sessionCounts]
 *   Optional session-count source. When omitted, the projection reports
 *   zero active sessions for every add-on.
 * @param {() => string} [options.now]
 *   Timestamp function for `producedAt`. Defaults to a fresh ISO string.
 * @param {(projection: any) => void} [options.onUpdate]
 *   Optional push consumer. Called with the new projection when the
 *   host calls `refresh()` or `recordEvent()`.
 */
export function createRuntimeProjectionService(options) {
  if (!options || typeof options !== "object") {
    throw new TypeError("createRuntimeProjectionService requires an options object");
  }
  const { hostRegistry, reconciler, bridgeStatus } = options;
  if (!hostRegistry || typeof hostRegistry.snapshot !== "function") {
    throw new TypeError("createRuntimeProjectionService requires a hostRegistry.snapshot()");
  }
  // The reconciler is OPTIONAL. When the CP-BR4 reconciler is not
  // wired into the composition root, the projection falls back to
  // deriving runtime status from the host registry projection. The
  // service therefore accepts any value here, including null/undefined,
  // and treats it as "no live reconciler".
  if (!bridgeStatus || typeof bridgeStatus.snapshot !== "function") {
    throw new TypeError("createRuntimeProjectionService requires a bridgeStatus.snapshot()");
  }
  const sessionCounts = options.sessionCounts ?? {
    getSessionsByRuntime: () => ({ activeSessionCount: 0 }),
  };
  const now = options.now ?? (() => new Date().toISOString());
  const onUpdate = typeof options.onUpdate === "function" ? options.onUpdate : null;

  let current = null;
  let nextGeneration = 0;

  /**
   * Project the runtime entries from the host registry + reconciler
   * active set. The host registry is the source of truth for
   * installation / enablement / grants / required / factory availability;
   * the reconciler's `listActive()` is the source of truth for the
   * active process status.
   */
  function buildRuntimeEntries() {
    const registryProjection = hostRegistry.snapshot();
    const installations = registryProjection?.installations ?? {};
    const activeList =
      typeof reconciler.listActive === "function" ? (reconciler.listActive() ?? []) : [];
    // Index the active list by addonId for O(1) lookup.
    const activeByAddon = new Map();
    for (const active of activeList) {
      if (active && typeof active.addonId === "string") {
        activeByAddon.set(active.addonId, active);
      }
    }
    // Stable iteration order: sort by addonId. The route would otherwise
    // surface non-deterministic order across re-reads, which the shape-
    // walker would not catch but which the UI would.
    const addonIds = Object.keys(installations).sort();
    const entries = [];
    for (const addonId of addonIds) {
      const installation = installations[addonId];
      if (!installation || typeof installation !== "object") continue;
      const manifest = installation.manifest;
      if (!manifest || typeof manifest !== "object") continue;
      const runtimeType =
        typeof manifest.runtimeType === "string" && KNOWN_RUNTIME_TYPES.has(manifest.runtimeType)
          ? manifest.runtimeType
          : "unknown";
      const active = activeByAddon.get(addonId);
      let status;
      if (active) {
        status = String(active.status ?? "inactive");
      } else {
        // Fallback: derive status from the harness registry projection
        // when the CP-BR4 reconciler is not wired into the composition
        // root. The derivation is closed and public.
        status = deriveStatusFromRegistry(installation, runtimeType);
      }
      const generation = isNonNegativeSafeInteger(installation.projectionGeneration)
        ? installation.projectionGeneration
        : 0;
      const sessionCount = sessionCounts.getSessionsByRuntime(addonId);
      const activeSessionCount =
        isPlainObject(sessionCount) && isNonNegativeSafeInteger(sessionCount.activeSessionCount)
          ? sessionCount.activeSessionCount
          : 0;
      entries.push({
        addonId: assertBoundedString(addonId, "runtime.addonId"),
        runtimeId: typeof active?.factoryId === "string" ? active.factoryId : addonId,
        runtimeType,
        status,
        generation,
        activeSessionCount,
        factoryId: typeof active?.factoryId === "string" ? active.factoryId : undefined,
        classification: typeof manifest.category === "string" ? manifest.category : undefined,
      });
    }
    return entries;
  }

  function deriveStatusFromRegistry(installation, runtimeType) {
    if (installation?.installed !== true) return "inactive";
    if (installation?.enabled !== true) return "inactive";
    if (installation?.revocation === "hard-stop") return "inactive";
    if (runtimeType === "ui-module" || runtimeType === "embedded-module") return "inactive";
    const grants = Array.isArray(installation.grantedCapabilities)
      ? installation.grantedCapabilities
      : [];
    const required = Array.isArray(installation.requiredCapabilities)
      ? installation.requiredCapabilities
      : [];
    if (required.length > 0) {
      const granted = new Set(
        grants
          .filter(
            (grant) => grant && grant.granted === true && typeof grant.capability === "string",
          )
          .map((grant) => grant.capability),
      );
      for (const cap of required) {
        if (typeof cap === "string" && !granted.has(cap)) {
          // A missing required grant is a stopped state, not a failure:
          // the operator withdrew (or never granted) authority, the
          // reconciler already stopped the runtime, and the
          // `failed` status is reserved for real adapter failures
          // (singleton refusal, health failure, factory missing).
          return "inactive";
        }
      }
    } else if (grants.length === 0) {
      return "inactive";
    }
    return "ready";
  }

  /**
   * Project connector entries from the host registry. A connector is an
   * installation whose `classification.category === "connector"` OR whose
   * `runtimeType === "channel-addon"`.
   */
  function buildConnectorEntries() {
    const registryProjection = hostRegistry.snapshot();
    const installations = registryProjection?.installations ?? {};
    const addonIds = Object.keys(installations).sort();
    const entries = [];
    for (const addonId of addonIds) {
      const installation = installations[addonId];
      if (!installation || typeof installation !== "object") continue;
      const manifest = installation.manifest;
      if (!manifest || typeof manifest !== "object") continue;
      const isConnector =
        manifest.category === "connector" || manifest.runtimeType === "channel-addon";
      if (!isConnector) continue;
      const runtimeType =
        typeof manifest.runtimeType === "string" && KNOWN_RUNTIME_TYPES.has(manifest.runtimeType)
          ? manifest.runtimeType
          : "unknown";
      const installed = installation.installed === true;
      const enabled = installation.enabled === true;
      const connectionState = !installed
        ? "not-installed"
        : !enabled
          ? "disabled"
          : installation.revocation === "hard-stop"
            ? "revoked"
            : manifest.runtimeType === "channel-addon"
              ? "installed"
              : "installed";
      const grants = Array.isArray(installation.grantedCapabilities)
        ? installation.grantedCapabilities
        : [];
      const required = Array.isArray(installation.requiredCapabilities)
        ? installation.requiredCapabilities
        : [];
      const authorizationState = deriveAuthorizationState(grants, required, installation);
      entries.push({
        addonId: assertBoundedString(addonId, "connector.addonId"),
        label: typeof manifest.name === "string" ? manifest.name : addonId,
        runtimeType,
        connectionState,
        authorizationState,
        lastSuccessfulHealthAt: undefined,
        publicFailureCode: undefined,
        supportedRuntimeTypes: [runtimeType],
      });
    }
    return entries;
  }

  function deriveAuthorizationState(grants, required, installation) {
    if (installation?.revocation === "hard-stop") return "revoked";
    if (!Array.isArray(grants) || grants.length === 0) return "missing";
    if (!Array.isArray(required) || required.length === 0) {
      return grants.some((grant) => grant && grant.granted === true) ? "granted" : "missing";
    }
    const requiredSet = new Set(required.filter((cap) => typeof cap === "string"));
    const grantedSet = new Set(
      grants
        .filter((grant) => grant && grant.granted === true && typeof grant.capability === "string")
        .map((grant) => grant.capability),
    );
    let matched = 0;
    for (const cap of requiredSet) {
      if (grantedSet.has(cap)) matched += 1;
    }
    if (matched === 0) return "missing";
    if (matched < requiredSet.size) return "partial";
    return "granted";
  }

  function buildSessionSummary(runtimeEntries) {
    return runtimeEntries
      .filter((entry) => entry.activeSessionCount > 0)
      .map((entry) => ({
        addonId: entry.addonId,
        runtimeId: entry.runtimeId,
        activeSessionCount: entry.activeSessionCount,
      }));
  }

  function buildBridgeOverview() {
    const raw = bridgeStatus.snapshot();
    if (!isPlainObject(raw)) {
      return { status: "offline", publicFailureCode: "projection-bridge-offline" };
    }
    return {
      status: typeof raw.status === "string" ? raw.status : "offline",
      version: typeof raw.version === "string" ? raw.version : undefined,
      endpoint: typeof raw.endpoint === "string" ? raw.endpoint : undefined,
      publicEndpoint: typeof raw.publicEndpoint === "string" ? raw.publicEndpoint : undefined,
      startedAt: isIsoTimestamp(raw.startedAt) ? raw.startedAt : undefined,
      uptimeSeconds: isNonNegativeSafeInteger(raw.uptimeSeconds) ? raw.uptimeSeconds : undefined,
      generation: isNonNegativeSafeInteger(raw.generation) ? raw.generation : undefined,
      instanceId: typeof raw.instanceId === "string" ? raw.instanceId : undefined,
      bootEpoch: typeof raw.bootEpoch === "string" ? raw.bootEpoch : undefined,
      publicFailureCode:
        typeof raw.publicFailureCode === "string" ? raw.publicFailureCode : undefined,
    };
  }

  /**
   * Recompute the projection, advance the generation, and notify
   * subscribers. Returns the new projection.
   */
  function refresh() {
    const runtimeEntries = buildRuntimeEntries();
    const connectorEntries = buildConnectorEntries();
    const sessionEntries = buildSessionSummary(runtimeEntries);
    const bridgeOverview = buildBridgeOverview();
    nextGeneration += 1;
    const producedAt = now();
    if (!isIsoTimestamp(producedAt)) {
      throw new Error("now() must return an ISO 8601 timestamp");
    }
    const projection = projectBridgeRuntimes({
      bridgeOverview,
      runtimeList: projectRuntimeList(runtimeEntries),
      connectorList: projectConnectorList(connectorEntries),
      activeSessions: projectSessionSummary(sessionEntries),
      projectionGeneration: nextGeneration,
      producedAt,
      updateMechanism: "both",
    });
    try {
      current = applyProjectionUpdate(current, projection);
    } catch (error) {
      // applyProjectionUpdate throws on stale; we just constructed a
      // newer projection so this branch is defensive only.
      current = projection;
    }
    if (onUpdate) {
      try {
        onUpdate(current);
      } catch {
        /* subscriber errors are non-fatal */
      }
    }
    return current;
  }

  /**
   * Read the current projection (or compute the first one if none is
   * cached). Pure read; no I/O.
   */
  function snapshot() {
    if (current === null) {
      return refresh();
    }
    return current;
  }

  /**
   * Recompute after a reconciler event. The host composition root wires
   * this as the `emit` callback of the reconciler; events do not change
   * the projection but they trigger a refresh so the runtime list
   * matches the latest reconciler active set.
   */
  function recordEvent(event) {
    if (!isPlainObject(event)) return null;
    return refresh();
  }

  return {
    refresh,
    snapshot,
    recordEvent,
    /**
     * Test seam. Resets the cached projection to `null`; the next
     * `snapshot()` or `refresh()` call will recompute.
     */
    _resetForTests() {
      current = null;
      nextGeneration = 0;
    },
  };
}

export { PROJECTION_FAILURE_CODES };
