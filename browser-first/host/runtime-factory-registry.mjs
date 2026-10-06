// CP-BR4: reviewed runtime factory registry.
//
// This module is the host-side owner of every reviewed runtime factory used
// by the generic add-on runtime lifecycle (CP-BR3/CP-BR4). The reconciler
// (`runtime-reconciler.mjs`) looks up a factory by `factoryId` and
// delegates the per-add-on start / stop / health / degrade / closeSessions
// work to it. The registry never executes a manifest `service.entrypoint`
// or any caller-supplied command / argv / path / cwd / env / endpoint; the
// only things it knows are host-coded factory functions, each with a
// pinned spawn policy written into the factory body.
//
// Failure model: an unknown / unregistered factory id fails closed. The
// registry itself never silently substitutes a default.
//
// ADR-047 + the CP-BR4 contract are the authority for this module.

/**
 * @typedef {Object} RuntimeFactorySpawnPolicy
 * @property {string}   factoryId       Reviewed, unique, lowercase reverse-DNS.
 * @property {readonly string[]} supportedRuntimeTypes
 *   The `runtimeType`s this factory can start (e.g. `["local-service"]`).
 * @property {string}   spawnSummary    Public, single-line description of
 *                                      the pinned spawn policy. NEVER
 *                                      includes the executable path, argv,
 *                                      cwd, env keys, or endpoint — those
 *                                      remain private to the factory body.
 *
 * @typedef {Object} RuntimeFactoryHandle
 *   Opaque per-instance handle returned by `start`. The reconciler passes
 *   it back into `stop` / `health` / `degrade` / `closeSessions`. The
 *   factory owns its internals; the reconciler never inspects them.
 *
 * @typedef {Object} RuntimeFactory
 * @property {RuntimeFactorySpawnPolicy} spawnPolicy
 * @property {(ctx: { addonId: string, bootEpoch: string, generation: number, now: () => number, signal: { aborted: boolean } }) => Promise<RuntimeFactoryHandle>} start
 * @property {(handle: RuntimeFactoryHandle, ctx: { addonId: string, now: () => number, timeoutMs: number }) => Promise<void>} stop
 * @property {(handle: RuntimeFactoryHandle, ctx: { addonId: string, now: () => number, timeoutMs: number }) => Promise<{ ok: boolean, publicDetail?: string }>} health
 * @property {(handle: RuntimeFactoryHandle, ctx: { addonId: string, publicReason: string, now: () => number }) => Promise<RuntimeFactoryHandle>} degrade
 * @property {(handle: RuntimeFactoryHandle, ctx: { addonId: string, now: () => number }) => Promise<void>} closeSessions
 *
 * The factory interface is intentionally small. Factories own the process
 * boundary; the reconciler owns lifecycle ordering and generation fencing.
 */

const KNOWN_RUNTIME_TYPES = new Set([
  "ui-module",
  "embedded-module",
  "local-service",
  "agent-addon",
  "channel-addon",
]);

const isString = (value) => typeof value === "string" && value.trim().length > 0;
const isFunction = (value) => typeof value === "function";

/**
 * Build a reviewed runtime factory registry. A factory is registered by
 * `factoryId`; `register` is a no-op when the same id is registered twice
 * unless `replace: true` is passed (test seam only — production code does
 * not replace).
 *
 * @param {object} [options]
 * @param {number} [options.now]    injectable `Date.now`-style function
 * @param {string} [options.label]  label used in error messages
 */
export function createRuntimeFactoryRegistry(options = {}) {
  const now = options.now ?? (() => Date.now());
  const label = options.label ?? "runtime-factory-registry";

  /** @type {Map<string, RuntimeFactory>} */
  const factories = new Map();
  /** @type {Map<string, Set<string>>} runtimeType -> factoryIds that support it */
  const byRuntimeType = new Map();
  /** @type {string[]} */
  const registrationOrder = [];

  function register(factory, { replace = false } = {}) {
    if (!factory || typeof factory !== "object") {
      throw new TypeError(`[${label}] factory must be an object`);
    }
    const policy = factory.spawnPolicy;
    if (!policy || typeof policy !== "object") {
      throw new TypeError(`[${label}] factory.spawnPolicy is required`);
    }
    if (!isString(policy.factoryId)) {
      throw new TypeError(`[${label}] factory.spawnPolicy.factoryId must be a non-empty string`);
    }
    if (!isFunction(factory.start) || !isFunction(factory.stop) ||
        !isFunction(factory.health) || !isFunction(factory.degrade) ||
        !isFunction(factory.closeSessions)) {
      throw new TypeError(`[${label}] factory must implement start/stop/health/degrade/closeSessions`);
    }
    if (!Array.isArray(policy.supportedRuntimeTypes) ||
        policy.supportedRuntimeTypes.length === 0 ||
        policy.supportedRuntimeTypes.some((rt) => !KNOWN_RUNTIME_TYPES.has(rt))) {
      throw new TypeError(`[${label}] factory.spawnPolicy.supportedRuntimeTypes must be a non-empty list of known runtime types`);
    }
    if (!isString(policy.spawnSummary)) {
      throw new TypeError(`[${label}] factory.spawnPolicy.spawnSummary must be a non-empty string`);
    }
    if (factories.has(policy.factoryId)) {
      if (!replace) {
        throw new Error(`[${label}] factory already registered: ${policy.factoryId}`);
      }
      // replace=true: drop the old reverse-index entries first
      const old = factories.get(policy.factoryId);
      for (const runtimeType of old.spawnPolicy.supportedRuntimeTypes) {
        const set = byRuntimeType.get(runtimeType);
        if (set) set.delete(policy.factoryId);
      }
    }
    factories.set(policy.factoryId, factory);
    for (const runtimeType of policy.supportedRuntimeTypes) {
      let set = byRuntimeType.get(runtimeType);
      if (!set) { set = new Set(); byRuntimeType.set(runtimeType, set); }
      set.add(policy.factoryId);
    }
    if (!registrationOrder.includes(policy.factoryId)) registrationOrder.push(policy.factoryId);
    return { factoryId: policy.factoryId };
  }

  function get(factoryId) {
    if (!isString(factoryId)) return null;
    return factories.get(factoryId) ?? null;
  }

  function has(factoryId) {
    if (!isString(factoryId)) return false;
    return factories.has(factoryId);
  }

  function list() {
    return registrationOrder.map((id) => {
      const f = factories.get(id);
      return { factoryId: id, spawnPolicy: f.spawnPolicy };
    });
  }

  function findForRuntimeType(runtimeType) {
    if (!isString(runtimeType)) return [];
    const ids = byRuntimeType.get(runtimeType);
    if (!ids) return [];
    return [...ids].map((id) => factories.get(id)).filter(Boolean);
  }

  function isRuntimeTypeSupported(runtimeType) {
    if (!isString(runtimeType)) return false;
    return byRuntimeType.has(runtimeType);
  }

  /** Test-only seam. Production never calls this. */
  function _clear() {
    factories.clear();
    byRuntimeType.clear();
    registrationOrder.length = 0;
  }

  return {
    register,
    get,
    has,
    list,
    findForRuntimeType,
    isRuntimeTypeSupported,
    _clear,
    _now: now,
  };
}

/**
 * Seed the registry with the existing reviewed runtime paths. The seed
 * factories do NOT spawn real processes — they are no-op-shaped adapters
 * that report the add-on's intended behavior so the reconciler can drive
 * the lifecycle plumbing. Migrating the real terminal / external-cli /
 * pi runtimes onto the generic lifecycle is CP-BR7.
 *
 * The seed factories deliberately return the same `handle` from `start`,
 * record calls in an observable array (test seam), and resolve all hooks
 * synchronously. They are reviewed because they live in this file (host
 * code) and never reach for an external binary.
 *
 * @param {ReturnType<typeof createRuntimeFactoryRegistry>} registry
 * @param {object} [options]
 * @param {Array<{ id: string, calls: Array<unknown>, handle: object }>} [options.observers]
 *   Test seam: a per-factory observer list to record calls. The same shape
 *   is returned so tests can assert the reconciler invoked the right hooks
 *   in the right order.
 */
export function seedReviewedRuntimeFactories(registry, options = {}) {
  const observers = options.observers ?? new Map();
  const observerFor = (id) => {
    let o = observers.get(id);
    if (!o) { o = { id, calls: [], handle: { kind: id, instances: 0 } }; observers.set(id, o); }
    return o;
  };

  const makeRecordingFactory = (factoryId, runtimeTypes, summary) => {
    /** @type {RuntimeFactory} */
    return {
      spawnPolicy: {
        factoryId,
        supportedRuntimeTypes: runtimeTypes,
        spawnSummary: summary,
      },
      async start({ addonId, bootEpoch, generation }) {
        const o = observerFor(factoryId);
        o.calls.push({ method: "start", addonId, bootEpoch, generation, at: registry._now() });
        o.handle.instances += 1;
        return o.handle;
      },
      async stop(handle, { addonId, timeoutMs }) {
        const o = observerFor(factoryId);
        o.calls.push({ method: "stop", addonId, handle, timeoutMs, at: registry._now() });
        if (o.handle.instances > 0) o.handle.instances -= 1;
      },
      async health(handle, { addonId, timeoutMs }) {
        const o = observerFor(factoryId);
        o.calls.push({ method: "health", addonId, handle, timeoutMs, at: registry._now() });
        return { ok: true };
      },
      async degrade(handle, { addonId, publicReason }) {
        const o = observerFor(factoryId);
        o.calls.push({ method: "degrade", addonId, handle, publicReason, at: registry._now() });
        return handle;
      },
      async closeSessions(handle, { addonId }) {
        const o = observerFor(factoryId);
        o.calls.push({ method: "closeSessions", addonId, handle, at: registry._now() });
      },
    };
  };

  registry.register(
    makeRecordingFactory(
      "com.resonantos.factory.terminal-host-service",
      ["local-service", "agent-addon"],
      "Reviewed local-service factory for terminal-host-service (no real spawn; CP-BR7 wires the live driver).",
    ),
    { replace: true },
  );

  registry.register(
    makeRecordingFactory(
      "com.resonantos.factory.external-cli-terminal",
      ["agent-addon"],
      "Reviewed agent-addon factory for the external-CLI terminal adapter (no real spawn; CP-BR7 wires the live harness).",
    ),
    { replace: true },
  );

  registry.register(
    makeRecordingFactory(
      "com.resonantos.factory.pi-runtime",
      ["local-service"],
      "Reviewed local-service factory for the pi-runtime harness (no real spawn; CP-BR7 wires the live pi CLI).",
    ),
    { replace: true },
  );

  return observers;
}

/**
 * Idempotent variant: re-uses the supplied observers and registry. If a
 * factory with the same id is already registered, the existing entry is
 * kept (the caller supplied their own); only the observer map is
 * populated for the existing factory id.
 *
 * When the caller passes `options.replace: true` (or the registry is
 * empty), the seed factories are re-registered with closures that
 * capture the supplied observers map. This is the test-friendly path
 * that ensures the test's observers see the factory invocations.
 */
export function ensureReviewedRuntimeFactories(registry, options = {}) {
  const observers = options.observers ?? new Map();
  if (!options.replace) {
    const allRegistered =
      registry.has("com.resonantos.factory.terminal-host-service") &&
      registry.has("com.resonantos.factory.external-cli-terminal") &&
      registry.has("com.resonantos.factory.pi-runtime");
    if (allRegistered) {
      // The registry already has the seed factories. Populate observer
      // records for the supplied map so the test can introspect.
      for (const id of [
        "com.resonantos.factory.terminal-host-service",
        "com.resonantos.factory.external-cli-terminal",
        "com.resonantos.factory.pi-runtime",
      ]) {
        if (!observers.has(id)) {
          observers.set(id, { id, calls: [], handle: { kind: id, instances: 0 } });
        }
      }
      return observers;
    }
  }
  // Re-register with closures that capture the supplied observers map.
  return seedReviewedRuntimeFactories(registry, { observers });
}
