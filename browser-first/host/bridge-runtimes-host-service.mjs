// CP-BR5: thin host route for the non-secret runtime/connector/session
// projection.
//
// This module wires the pure `runtime-projection-service.mjs` into the
// bridge route table. The route is:
//
//   GET /bridge/runtimes  (capability: addon-runtime-read, loopback only)
//
// The route returns the current projection. The route does NOT mutate
// any state, does NOT log raw fields, and does NOT accept caller input.
// The projection is always read from the cached in-memory snapshot; the
// service recomputes lazily on first read and on reconciler events.
//
// Intent citation: docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md §11
// (CP-BR5) and ADR-047 §"Public Status And Non-Leak Boundary".

import { redactLogValue } from "./runtime-projection.mjs";

/**
 * @param {{
 *   runtimeProjection: {
 *     snapshot: () => Readonly<Record<string, unknown>>,
 *   },
 *   attachRoute: (route: {
 *     method: string,
 *     path: string,
 *     requiredCapability: string,
 *     loopbackHostOnly?: boolean,
 *     errorFamily?: string,
 *     handler: (payload: any, request: any) => Promise<any>,
 *   }) => void,
 * }} options
 */
export function createBridgeRuntimesHostService({ runtimeProjection, attachRoute } = {}) {
  if (!runtimeProjection || typeof runtimeProjection.snapshot !== "function") {
    throw new TypeError("createBridgeRuntimesHostService requires runtimeProjection.snapshot()");
  }
  if (typeof attachRoute !== "function") {
    throw new TypeError("createBridgeRuntimesHostService requires an attachRoute(route) callback");
  }
  attachRoute({
    method: "GET",
    path: "/bridge/runtimes",
    requiredCapability: "addon-runtime-read",
    loopbackHostOnly: true,
    errorFamily: "harness",
    async handler(_payload, _request) {
      // The projection is already public. The route never inspects
      // caller input and never logs raw fields. Any log line that
      // surfaces the projection MUST go through redactLogValue().
      const projection = runtimeProjection.snapshot();
      return projection;
    },
  });
  return {
    /**
     * Return a redacted copy of the current projection for logs or
     * rejection serialization. The route itself does not log; this is
     * exposed for tests and for downstream callers that need to record
     * the projection in a structured log.
     */
    logProjection() {
      return redactLogValue(runtimeProjection.snapshot());
    },
  };
}
