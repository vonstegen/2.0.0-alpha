// CP-BR4: idempotent, generation-fenced, per-add-on serialized reconciler.
//
// The reconciler is the **act** side of the decide→act seam from CP-BR3.
// It consumes the CP-BR3 resolver's decisions, looks up a reviewed runtime
// factory in the CP-BR4 factory registry, and translates each decision
// into bounded, generation-fenced start / stop / degrade actions. It never
// executes a manifest `service.entrypoint` and never accepts caller-
// supplied process inputs.
//
// Invariants:
//   - Idempotent: a second `reconcile(snapshot)` for the same projection
//     and same generation is a no-op.
//   - Per-add-on serialized: concurrent reconciles for the same add-on
//     join; for different add-ons they proceed independently.
//   - Generation fenced: every start/restart receives a new generation.
//     Stale completions (from an older generation) cannot overwrite
//     newer state or become active.
//   - Bounded: start / stop / health / restart waits are bounded. On
//     timeout the reconciler attempts a bounded stop on the owned child
//     and surfaces the public failure code.
//   - Restore-after-bridge-restart: re-deriving desired state from the
//     host registry projection re-starts the add-ons that were running
//     before the restart (the new `bootEpoch` from the host projection
//     is the source of identity).
//   - Non-secret lifecycle events: every event emitted through the
//     provided `emit` callback carries public identifiers only.
//
// The reconciler is the host-side owner of the per-add-on lifecycle. It
// imports the pure CP-BR3 resolver and the CP-BR4 factory registry; it
// does not import the bridge transport, the bridge auth, the React UI,
// or any SDK add-on manifest contents.

import { randomUUID } from "node:crypto";
import {
  deriveDesiredRuntimeState,
  projectLifecycleSnapshot,
} from "../../packages/addon-sdk/src/runtime-lifecycle.ts";

const isString = (value) => typeof value === "string" && value.trim().length > 0;

const isKnownRuntimeType = (value) =>
  value === "ui-module" ||
  value === "embedded-module" ||
  value === "local-service" ||
  value === "agent-addon" ||
  value === "channel-addon";

/**
 * @typedef {Object} RuntimeReconcilerOptions
 * @property {ReturnType<typeof import('./runtime-factory-registry.mjs').createRuntimeFactoryRegistry>} factoryRegistry
 * @property {() => Promise<{ bootEpoch: string, installations: Record<string, object> }>} loadHostProjection
 *   Host-owned registry projection source. The reconciler re-derives
 *   desired state from this on every `reconcile`; UI state is never
 *   trusted.
 * @property {(event: { type: string, addonId: string, factoryId: string|null, generation: number, publicFailureCode?: string, publicReason?: string, at: number }) => void} emit
 *   Non-secret lifecycle event sink. The reconciler calls this once per
 *   transition. Implementations MUST treat the event as public.
 * @property {() => number} [now]
 * @property {{ startTimeoutMs?: number, stopTimeoutMs?: number, healthTimeoutMs?: number, restoreGraceMs?: number }} [timeouts]
 */

/**
 * @typedef {Object} RuntimeReconciler
 * @property {(projectionOverride?: { bootEpoch: string, installations: Record<string, object> } | null) => Promise<{ transitioned: Array<{ addonId: string, factoryId: string, generation: number, transition: string, publicFailureCode?: string }>, noop: string[] }>} reconcile
 * @property {() => void} stopAll
 * @property {() => ReadonlyArray<{ addonId: string, factoryId: string, generation: number, status: string }>} listActive
 * @property {() => void} _resetForTests
 * @property {(addonId: string) => any} _peek
 */

const DEFAULT_TIMEOUTS = Object.freeze({
  startTimeoutMs: 5_000,
  stopTimeoutMs: 5_000,
  healthTimeoutMs: 1_500,
  restoreGraceMs: 0,
});

/**
 * @param {RuntimeReconcilerOptions} options
 * @returns {RuntimeReconciler}
 */
export function createRuntimeReconciler(options) {
  if (!options || typeof options !== "object") {
    throw new TypeError("createRuntimeReconciler requires an options object");
  }
  if (!options.factoryRegistry) {
    throw new TypeError("createRuntimeReconciler requires a factoryRegistry");
  }
  if (typeof options.loadHostProjection !== "function") {
    throw new TypeError("createRuntimeReconciler requires loadHostProjection()");
  }
  if (typeof options.emit !== "function") {
    throw new TypeError("createRuntimeReconciler requires an emit(event) callback");
  }

  const now = options.now ?? (() => Date.now());
  const timeouts = { ...DEFAULT_TIMEOUTS, ...(options.timeouts ?? {}) };
  // Per-add-on serializer. Each add-on has its own in-flight Promise so
  // concurrent reconciles join the chain rather than racing.
  /** @type {Map<string, Promise<unknown>>} */
  const perAddonChain = new Map();
  // Per-add-on state record. The reconciler never lets a stale generation
  // overwrite newer state.
  /** @type {Map<string, { factoryId: string, generation: number, handle: any, status: "starting" | "ready" | "degraded" | "failed" | "stopping" | "inactive" }>} */
  const active = new Map();
  // Public failure codes that the resolver can emit. We use a closed
  // set to keep the public surface tight.
  const PUBLIC_FAILURE_CODES = new Set([
    "addon-not-installed",
    "addon-disabled",
    "addon-authorization-required",
    "addon-incompatible",
    "addon-factory-missing",
    "addon-revoked",
    "addon-degraded-by-policy",
    "addon-runtime-type-unknown",
    "addon-authority-input-invalid",
    "addon-manifest-invalid",
  ]);

  function emitEvent(type, payload) {
    try {
      options.emit({
        type,
        at: now(),
        ...payload,
      });
    } catch {
      // Emit failures must never break the reconciler.
    }
  }

  /**
   * Translate a host projection entry into a CP-BR3 authority projection.
   * The host projection is the source of truth; the resolver never sees
   * a UI-supplied authority projection.
   */
  function toAuthorityProjection(installation, { factoryAvailable, revocation }) {
    const grantedCapabilities = new Set();
    const requiredCapabilities = new Set();
    const grants = Array.isArray(installation.grantedCapabilities)
      ? installation.grantedCapabilities
      : [];
    for (const grant of grants) {
      if (!grant || typeof grant !== "object") continue;
      if (typeof grant.capability !== "string") continue;
      if (grant.granted === true) {
        grantedCapabilities.add(grant.capability);
      }
      // The required set is the closed list of capabilities the add-on
      // declared in its manifest. The host projection passes them
      // through; the reconciler copies them into the resolver input.
      requiredCapabilities.add(grant.capability);
    }
    // Some host projections may carry a separate `requiredCapabilities`
    // list (preferred); fall back to the grants list otherwise.
    if (Array.isArray(installation.requiredCapabilities)) {
      requiredCapabilities.clear();
      for (const cap of installation.requiredCapabilities) {
        if (typeof cap === "string") requiredCapabilities.add(cap);
      }
    }
    return {
      installed: installation.installed === true,
      enabled: installation.enabled === true,
      grantedCapabilities,
      requiredCapabilities,
      compatible: installation.compatible === true,
      reviewedFactoryAvailable: factoryAvailable === true,
      revocation: revocation ?? "none",
    };
  }

  /**
   * Bound a factory call. Returns the result or throws a typed error
   * with a public failure code. No infinite waits; no unhandled
   * rejection leakage.
   */
  async function withTimeout(promise, { timeoutMs, label, addonId }) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label} timed out for ${addonId} after ${timeoutMs}ms`);
        err.code = "lifecycle-timeout";
        err.publicFailureCode = "addon-factory-missing"; // best public code
        reject(err);
      }, timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Run the per-add-on work inside the serializer. Concurrent calls for
   * the same add-on chain together. If the previous run rejected, the
   * new run STILL proceeds (the chain does not stall on a failed
   * prior reconcile).
   *
   * The returned promise NEVER rejects; per-add-on errors are reported
   * via the event sink. The reconcile() caller awaits via Promise.all
   * and a rejection here would break the whole batch.
   */
  function serialize(addonId, work) {
    const previous = perAddonChain.get(addonId) ?? Promise.resolve();
    const next = previous.then(() => work(), () => work());
    const safe = next.catch(() => undefined);
    perAddonChain.set(addonId, safe);
    return safe;
  }

  /**
   * Translate a CP-BR3 decision into a process action via the factory
   * registry, honoring generation fencing and bounded waits.
   */
  async function transitionFor(addonId, factory, decision, projectionEntry) {
    const { addonId: _ignore, manifest, factoryId, bootEpoch, projectionGeneration } = projectionEntry;
    const previous = active.get(addonId);

    // No-op: already on the desired state for the current generation.
    if (previous && previous.generation === projectionGeneration &&
        statusForDesired(decision.desiredState) === previous.status) {
      return { transition: "noop" };
    }

    // Stale generation: a previous reconcile is in flight for an older
    // bootEpoch/generation. Mark it inactive but do not touch the
    // owned process — the new generation will be picked up.
    if (previous && previous.generation > projectionGeneration) {
      return { transition: "stale" };
    }

    const currentFactory = previous?.factoryId;

    if (decision.desiredState === "stopped") {
      // If we were running, stop deterministically.
      if (previous && previous.handle) {
        const previousFactory = options.factoryRegistry.get(previous.factoryId);
        if (!previousFactory) {
          // Stale registry state; clear the record and continue.
          active.delete(addonId);
          return { transition: "noop" };
        }
        emitEvent("stop_requested", { addonId, factoryId: previous.factoryId, generation: previous.generation });
        try {
          await withTimeout(
            previousFactory.stop(previous.handle, { addonId, now, timeoutMs: timeouts.stopTimeoutMs }),
            { timeoutMs: timeouts.stopTimeoutMs + 250, label: "stop", addonId },
          );
          // Close sessions on every stop (CP-BR4 §5.8 + XH4/XH5 invariant).
          await previousFactory.closeSessions(previous.handle, { addonId, now });
        } catch (error) {
          emitEvent("stop_failed", {
            addonId, factoryId: previous.factoryId, generation: previous.generation,
            publicFailureCode: previousFailureCode(decision) ?? "addon-factory-missing",
            publicReason: error && error.message ? String(error.message) : "stop failed",
          });
          // Re-throw so the serializer does not silently mark the
          // add-on as stopped. The reconciler surfaces the failure.
          throw error;
        }
        emitEvent("stopped", { addonId, factoryId: previous.factoryId, generation: previous.generation });
        active.delete(addonId);
        return { transition: "stopped" };
      }
      // No previous runtime; nothing to stop.
      active.delete(addonId);
      return { transition: "noop" };
    }

    if (decision.desiredState === "degraded") {
      // Keep the runtime but ask the factory to degrade.
      if (!previous) {
        // No previous runtime to degrade; fall through to "stopped".
        active.delete(addonId);
        return { transition: "stopped" };
      }
      const previousFactory = options.factoryRegistry.get(previous.factoryId);
      if (!previousFactory) {
        active.delete(addonId);
        return { transition: "noop" };
      }
      emitEvent("degrade_requested", {
        addonId, factoryId: previous.factoryId, generation: previous.generation,
        publicFailureCode: decision.publicFailureCode,
        publicReason: decision.publicReason,
      });
      const newHandle = await withTimeout(
        previousFactory.degrade(previous.handle, {
          addonId, now, publicReason: decision.publicReason ?? "degrade",
        }),
        { timeoutMs: timeouts.startTimeoutMs, label: "degrade", addonId },
      );
      active.set(addonId, {
        factoryId: currentFactory ?? factoryId,
        generation: projectionGeneration,
        handle: newHandle,
        status: "degraded",
      });
      emitEvent("degraded", {
        addonId, factoryId: currentFactory ?? factoryId, generation: projectionGeneration,
        publicFailureCode: decision.publicFailureCode,
      });
      return { transition: "degraded" };
    }

    // decision.desiredState === "running"
    if (!factory) {
      // No reviewed factory for this runtime type.
      emitEvent("factory_missing", {
        addonId, factoryId: null, generation: projectionGeneration,
        publicFailureCode: "addon-factory-missing",
      });
      active.delete(addonId);
      return {
        transition: "factory-missing",
        publicFailureCode: "addon-factory-missing",
      };
    }

    // If we are already on the same factory and same generation, this is
    // an idempotent re-reconcile. Skip the start.
    if (previous && previous.factoryId === factoryId && previous.generation === projectionGeneration) {
      return { transition: "noop" };
    }

    // Generation replacement: stop the previous owned runtime (if any)
    // BEFORE starting the new one, so the previous process is never left
    // orphaned.
    if (previous && previous.handle && previous.factoryId !== factoryId) {
      const previousFactory = options.factoryRegistry.get(previous.factoryId);
      if (previousFactory) {
        emitEvent("stop_requested", {
          addonId, factoryId: previous.factoryId, generation: previous.generation,
        });
        try {
          await withTimeout(
            previousFactory.stop(previous.handle, { addonId, now, timeoutMs: timeouts.stopTimeoutMs }),
            { timeoutMs: timeouts.stopTimeoutMs + 250, label: "stop-pre-restart", addonId },
          );
          await previousFactory.closeSessions(previous.handle, { addonId, now });
        } catch (error) {
          emitEvent("stop_failed", {
            addonId, factoryId: previous.factoryId, generation: previous.generation,
            publicFailureCode: "addon-factory-missing",
            publicReason: error && error.message ? String(error.message) : "pre-restart stop failed",
          });
          throw error;
        }
        emitEvent("stopped", { addonId, factoryId: previous.factoryId, generation: previous.generation });
      }
    }

    emitEvent("start_requested", {
      addonId, factoryId, generation: projectionGeneration,
    });
    let handle;
    try {
      handle = await withTimeout(
        factory.start({ addonId, bootEpoch, generation: projectionGeneration, now, signal: { aborted: false } }),
        { timeoutMs: timeouts.startTimeoutMs, label: "start", addonId },
      );
    } catch (error) {
      emitEvent("start_failed", {
        addonId, factoryId, generation: projectionGeneration,
        publicFailureCode: error && typeof error.publicFailureCode === "string" ? error.publicFailureCode : "addon-factory-missing",
        publicReason: error && error.message ? String(error.message) : "start failed",
      });
      active.delete(addonId);
      throw error;
    }

    // Health check (bounded). If health fails, stop deterministically.
    try {
      const health = await withTimeout(
        factory.health(handle, { addonId, now, timeoutMs: timeouts.healthTimeoutMs }),
        { timeoutMs: timeouts.healthTimeoutMs + 250, label: "health", addonId },
      );
      if (!health || health.ok !== true) {
        await factory.stop(handle, { addonId, now, timeoutMs: timeouts.stopTimeoutMs });
        await factory.closeSessions(handle, { addonId, now });
        active.delete(addonId);
        emitEvent("start_failed", {
          addonId, factoryId, generation: projectionGeneration,
          publicFailureCode: "addon-factory-missing",
          publicReason: "health check failed",
        });
        return { transition: "start-failed-health" };
      }
    } catch (error) {
      try {
        await factory.stop(handle, { addonId, now, timeoutMs: timeouts.stopTimeoutMs });
        await factory.closeSessions(handle, { addonId, now });
      } catch { /* best effort */ }
      active.delete(addonId);
      emitEvent("start_failed", {
        addonId, factoryId, generation: projectionGeneration,
        publicFailureCode: "addon-factory-missing",
        publicReason: error && error.message ? String(error.message) : "health check errored",
      });
      return { transition: "start-failed-health" };
    }

    active.set(addonId, {
      factoryId,
      generation: projectionGeneration,
      handle,
      status: "ready",
    });
    emitEvent("ready", { addonId, factoryId, generation: projectionGeneration });
    return { transition: "started" };
  }

  function statusForDesired(desiredState) {
    if (desiredState === "running") return "ready";
    if (desiredState === "degraded") return "degraded";
    return "inactive";
  }

  function previousFailureCode(decision) {
    if (decision.publicFailureCode && PUBLIC_FAILURE_CODES.has(decision.publicFailureCode)) {
      return decision.publicFailureCode;
    }
    return undefined;
  }

  /**
   * Resolve a factory for a runtime type. If the add-on manifest pins a
   * factory id, that wins; otherwise the first registered factory for
   * the runtime type is used. The reconciler NEVER falls back to an
   * arbitrary factory; if none matches, the resolver's
   * `addon-factory-missing` outcome is left as-is.
   */
  function resolveFactory(addonId, runtimeType, manifestFactoryId) {
    if (isString(manifestFactoryId)) {
      const f = options.factoryRegistry.get(manifestFactoryId);
      if (!f) return { factory: null, factoryId: manifestFactoryId };
      if (!f.spawnPolicy.supportedRuntimeTypes.includes(runtimeType)) {
        return { factory: null, factoryId: manifestFactoryId };
      }
      return { factory: f, factoryId: manifestFactoryId };
    }
    const candidates = options.factoryRegistry.findForRuntimeType(runtimeType);
    if (candidates.length === 0) return { factory: null, factoryId: null };
    // Deterministic pick: first registered.
    const picked = candidates[0];
    return { factory: picked, factoryId: picked.spawnPolicy.factoryId };
  }

  /**
   * Reconcile a single add-on against the host projection entry.
   * Returns the transition outcome.
   */
  async function reconcileOne(addonId, installation) {
    if (!installation || typeof installation !== "object") {
      return { transition: "noop" };
    }
    const manifest = installation.manifest;
    if (!manifest || typeof manifest !== "object") {
      return { transition: "noop" };
    }
    const runtimeType = manifest.runtimeType;
    if (!isKnownRuntimeType(runtimeType)) {
      // Unknown runtime type → fail closed (CP-BR3 already returns
      // `addon-runtime-type-unknown`); the reconciler just records the
      // outcome and clears the active record.
      active.delete(addonId);
      return { transition: "noop" };
    }

    const factoryAvailable = options.factoryRegistry.isRuntimeTypeSupported(runtimeType);
    // The host projection's `factoryId` is the authoritative choice
    // (CP-BR4 §5.1 — the host owns the factory selection; the manifest
    // never names an entrypoint). If the host omits it, fall back to
    // the first registered factory for the runtime type.
    const hostFactoryId = isString(installation.factoryId) ? installation.factoryId : null;
    const { factory, factoryId } = resolveFactory(addonId, runtimeType, hostFactoryId);

    const authority = toAuthorityProjection(installation, {
      factoryAvailable,
      revocation: installation.revocation ?? "none",
    });

    const decision = deriveDesiredRuntimeState({
      addonId,
      runtimeType,
      classification: manifest.category ?? "",
      authority,
    });

    const projectionEntry = {
      addonId,
      manifest,
      factoryId,
      bootEpoch: installation.bootEpoch ?? "",
      projectionGeneration: installation.projectionGeneration ?? 0,
    };

    return serialize(addonId, () =>
      transitionFor(addonId, factory, decision, projectionEntry)
        .then((result) => ({
          addonId,
          factoryId,
          decision,
          ...result,
        })),
    ).then((value) => value ?? { addonId, factoryId, decision, transition: "noop" });
  }

  /**
   * Main entry point. Reads the host projection (or uses the override
   * supplied by the caller for tests / restore-after-restart), then
   * reconciles each add-on in parallel-per-add-on.
   *
   * @param {{ bootEpoch: string, installations: Record<string, object> } | null} [projectionOverride]
   */
  async function reconcile(projectionOverride = null) {
    const projection = projectionOverride ?? (await options.loadHostProjection());
    const installations = projection?.installations ?? {};
    const bootEpoch = projection?.bootEpoch ?? "";

    // Build a per-add-on list of work items; serialize each.
    const addons = Object.keys(installations);
    const results = await Promise.all(
      addons.map((addonId) => reconcileOne(addonId, installations[addonId])),
    );
    const transitioned = [];
    const noop = [];
    for (const r of results) {
      if (r.transition === "noop") noop.push(r.addonId);
      else {
        transitioned.push({
          addonId: r.addonId,
          factoryId: r.factoryId,
          generation: installations[r.addonId]?.projectionGeneration ?? 0,
          transition: r.transition,
          // Prefer the per-transition public failure code (set on
          // factory-missing and start-failed paths) over the resolver
          // decision's code, which only fires for the resolver-known
          // failure modes.
          publicFailureCode: r.publicFailureCode ?? r.decision?.publicFailureCode,
        });
      }
    }
    return { transitioned, noop, bootEpoch };
  }

  /**
   * Stop all currently active runtimes. Idempotent. Used at bridge
   * shutdown.
   */
  async function stopAll() {
    const tasks = [];
    for (const [addonId, record] of active.entries()) {
      const f = options.factoryRegistry.get(record.factoryId);
      if (!f) continue;
      tasks.push(serialize(addonId, async () => {
        try {
          await f.stop(record.handle, { addonId, now, timeoutMs: timeouts.stopTimeoutMs });
          await f.closeSessions(record.handle, { addonId, now });
        } catch { /* best effort */ }
      }));
    }
    await Promise.allSettled(tasks);
    active.clear();
  }

  function listActive() {
    return [...active.entries()].map(([addonId, record]) => ({
      addonId,
      factoryId: record.factoryId,
      generation: record.generation,
      status: record.status,
    }));
  }

  function _peek(addonId) {
    return active.get(addonId) ?? null;
  }

  function _resetForTests() {
    perAddonChain.clear();
    active.clear();
  }

  return {
    reconcile,
    stopAll,
    listActive,
    _peek,
    _resetForTests,
  };
}

/**
 * Public helpers exposed for tests.
 */
export const __testing__ = {
  DEFAULT_TIMEOUTS,
};
