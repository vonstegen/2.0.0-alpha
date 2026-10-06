// CP-BR4: composition root for the host-side add-on runtime lifecycle.
//
// This module is a thin glue layer that wires the factory registry, the
// reconciler, the host projection, and the lifecycle-event sink. The
// host bridge composition root (run-bridge-minimal.mjs) instantiates one
// of these at startup. The unit tests instantiate one with a fake host
// projection and a fake emit.
//
// The composer's surface is intentionally small:
//   - createHostRuntimeLifecycle({ factoryRegistry, hostRegistry, emit, ... })
//   - reconcile() reads the host projection and reconciles
//   - stopAll() is called at bridge shutdown
//
// The composer does NOT import the bridge transport, the bridge auth, the
// React UI, or any SDK add-on manifest contents. It only imports the
// factory registry, the reconciler, and (via the reconciler) the CP-BR3
// pure resolver.

import { createRuntimeReconciler } from "./runtime-reconciler.mjs";
import {
  createRuntimeFactoryRegistry,
  ensureReviewedRuntimeFactories,
} from "./runtime-factory-registry.mjs";

/**
 * @param {object} options
 * @param {ReturnType<typeof import('./runtime-factory-registry.mjs').createRuntimeFactoryRegistry>} [options.factoryRegistry]
 *   Caller-supplied factory registry. If omitted, a fresh registry is
 *   created and seeded with the reviewed CP-BR4 fixtures.
 * @param {{ snapshot: () => { bootEpoch: string, installations: Record<string, any> } }} options.hostRegistry
 *   Host-owned registry facade. `snapshot()` is the source of truth.
 * @param {(event: any) => void} [options.emit]
 *   Lifecycle event sink. Defaults to no-op.
 * @param {Map<string, { id: string, calls: Array<unknown>, handle: object }>} [options.observers]
 *   Test seam: the per-factory observer map returned by
 *   `seedReviewedRuntimeFactories`. Production callers can omit this.
 * @param {(now: () => number) | undefined} [options.now]
 * @param {{ startTimeoutMs?: number, stopTimeoutMs?: number, healthTimeoutMs?: number, restoreGraceMs?: number }} [options.timeouts]
 */
export function createHostRuntimeLifecycle(options) {
  if (!options || typeof options !== "object") {
    throw new TypeError("createHostRuntimeLifecycle requires an options object");
  }
  if (!options.hostRegistry || typeof options.hostRegistry.snapshot !== "function") {
    throw new TypeError("createHostRuntimeLifecycle requires a hostRegistry with a snapshot() method");
  }
  const now = options.now ?? (() => Date.now());
  const emit = typeof options.emit === "function" ? options.emit : () => {};

  // Factory registry construction. If the caller supplied one, the
  // caller is responsible for seeding it (and may pass the observers
  // map they want to reuse). If the caller supplied neither, we build
  // a fresh registry, seed it, and return the observer map so the
  // caller can introspect factory calls.
  let factoryRegistry = options.factoryRegistry;
  let observers = options.observers ?? null;
  if (!factoryRegistry) {
    factoryRegistry = createRuntimeFactoryRegistry({ now });
    observers = ensureReviewedRuntimeFactories(factoryRegistry, { observers: new Map() });
  } else if (observers) {
    // Reuse the supplied registry but re-seed the factories so the
    // factory closures capture the supplied observers map. The seed
    // function is idempotent (`replace: true`).
    ensureReviewedRuntimeFactories(factoryRegistry, { observers, replace: true });
  }

  // Wrap hostRegistry.snapshot into the reconciler's `loadHostProjection`
  // shape. The reconciler expects `{ bootEpoch, installations }`.
  const loadHostProjection = async () => {
    const snap = options.hostRegistry.snapshot();
    return {
      bootEpoch: typeof snap.bootEpoch === "string" ? snap.bootEpoch : "",
      installations: snap.installations ?? {},
    };
  };

  const reconciler = createRuntimeReconciler({
    factoryRegistry,
    loadHostProjection,
    emit,
    now,
    timeouts: options.timeouts,
  });

  return {
    factoryRegistry,
    observers,
    reconciler,
  };
}
