// ResonantOS bridge rebind coordinator (CP-BR2).
//
// One shared owner for the "rebinding" event so background.js, side-panel.js,
// and main-workspace.js stop duplicating rebind chains. The orchestrator's
// "healthy after start" trigger fires through this same channel; the existing
// 401-driven rebind also goes through it so both triggers converge on the
// same owner.
//
// Hard rules (CP-BR2 §5.3 / §7):
//   * Rebind reads the generated bridge config via the existing extension
//     resource fetch (`refreshGeneratedBridgeConfig`); it never reads from
//     disk or a private path.
//   * Rebind rebuilds bridge clients (createBridgeClient + createRawBridgeFetch)
//     and re-runs `initCapabilityTokens`.
//   * Rebind never writes bridge/capability tokens into chrome.storage beyond
//     the existing narrow bridge-target override.
//   * The coordinator is purely additive: the legacy in-line rebind chains
//     in background/side-panel/main-workspace continue to work; this
//     coordinator exposes an opt-in `subscribeRebind` API the new code uses.

import {
  createBridgeClient,
  createRawBridgeFetch,
  detectLoopbackBridge,
  initCapabilityTokens,
  resolveBridgeConfig,
} from "./bridge-client.js";

/**
 * @typedef {{
 *   resolveBridgeConfig?: typeof resolveBridgeConfig,
 *   detectLoopbackBridge?: typeof detectLoopbackBridge,
 *   createBridgeClient?: typeof createBridgeClient,
 *   createRawBridgeFetch?: typeof createRawBridgeFetch,
 *   initCapabilityTokens?: typeof initCapabilityTokens,
 * }} RebindDeps
 */

/**
 * @param {RebindDeps} [deps]
 */
export function createRebindCoordinator(deps = {}) {
  const resolveFn = deps.resolveBridgeConfig ?? resolveBridgeConfig;
  const detectFn = deps.detectLoopbackBridge ?? detectLoopbackBridge;
  const buildFn = deps.createBridgeClient ?? createBridgeClient;
  const buildRawFn = deps.createRawBridgeFetch ?? createRawBridgeFetch;
  const initTokensFn = deps.initCapabilityTokens ?? initCapabilityTokens;

  const subscribers = new Set();
  let inFlight = null;

  function subscribe(listener) {
    if (typeof listener !== "function") {
      throw new Error("rebind-coordinator: listener must be a function");
    }
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  function emit(event) {
    for (const sub of subscribers) {
      try { sub(event); }
      catch { /* defensive: a broken subscriber must not poison the channel */ }
    }
  }

  /**
   * Run the full rebind chain and notify subscribers. Returns the resolved
   * bridge request + raw fetch. Safe to call concurrently: in-flight
   * calls are joined.
   *
   * @param {{ refreshGenerated?: boolean, source?: string }} [options]
   */
  function rebind(options = {}) {
    if (inFlight) return inFlight;
    const source = options.source ?? "rebind";
    const promise = (async () => {
      const cfg = await resolveFn({ refreshGenerated: options.refreshGenerated ?? true });
      const resolved = await detectFn(cfg);
      const bridgeRequest = buildFn(resolved);
      const rawFetch = buildRawFn(resolved);
      try {
        await initTokensFn(resolved);
      } catch (error) {
        emit({ source, ok: false, error, config: resolved, bridgeRequest, rawFetch });
        return { config: resolved, bridgeRequest, rawFetch, ok: false, error };
      }
      emit({ source, ok: true, config: resolved, bridgeRequest, rawFetch });
      return { config: resolved, bridgeRequest, rawFetch, ok: true };
    })();
    inFlight = promise.finally(() => { inFlight = null; });
    return inFlight;
  }

  return Object.freeze({
    rebind,
    subscribe,
  });
}

// A single default coordinator for contexts that don't need to inject
// dependencies. Tests construct their own via `createRebindCoordinator`.
let _default = null;
export function getDefaultRebindCoordinator() {
  if (!_default) _default = createRebindCoordinator();
  return _default;
}
