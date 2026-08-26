// Intent citation: docs/architecture/ADR-040-provider-fabric-boundary-external-agent-runtimes.md#4-wire-format
//
// Add-on delegation host service: bridge-side route registry.
//
// This module returns a flat list of `addonDelegationRoutes` consumed by
// `bridge-server.mjs`. Each route binds an HTTP method + path + a
// required capability to a handler function the caller supplies via
// `createAddonDelegationHostService(handlers)`.
//
// Routes receive three arguments from the bridge dispatch loop:
//   1. payload        - parsed JSON body (POST) or {} (GET)
//   2. request        - the raw Node http.IncomingMessage
//   3. bridgeContext  - { callerId, perCallerGrants, auditLedger }
//
// The newest route, `POST /external-agent-runtime/delegate`, is the
// bridge-side surface for ADR-040 §4 wire-format dispatch. It pulls
// `callerId` / `perCallerGrants` / `auditLedger` from `bridgeContext`
// (wired by `bridge-server.mjs` from the request's
// `X-ResonantOS-Bridge-Caller-Id` header and the Phase 3.5 grant
// store) and forwards them to `dispatchExternalAgentRuntime`.


import { dispatchExternalAgentRuntime } from "./external-agent-runtime-dispatcher.mjs";

import { addonTrustAndIsolationSnapshot } from "./dev-panel-addon-snapshot.mjs";

// The dispatcher's checkToolGrants reads perCallerGrants as a Map:
//   perCallerGrants.get(callerId).capabilities.get(capability)
// but the bridge-server path puts a plain-object snapshot from
// createBridgeGrantsStore().snapshot() in bridgeContext.perCallerGrants
// (shape: { callerId: { capability: tokenString } }). Without this
// adapter every legitimate addon call is denied for "missing per-caller
// grants" because the dispatcher sees an empty Map.
function asGrantsMap(perCallerGrants) {
  if (perCallerGrants == null) return null;
  if (typeof perCallerGrants.get === "function") return perCallerGrants;
  if (typeof perCallerGrants !== "object") return null;
  const buckets = new Map();
  for (const [callerId, bucket] of Object.entries(perCallerGrants)) {
    if (!bucket || typeof bucket !== "object") continue;
    const caps = new Map();
    for (const [cap, token] of Object.entries(bucket)) {
      if (typeof token === "string" && token.length > 0) caps.set(cap, token);
    }
    buckets.set(callerId, { capabilities: caps });
  }
  return {
    get(callerId) { return buckets.get(callerId) ?? null; },
  };
}

export function createAddonDelegationHostService(handlers = {}) {
  function required(name) {
    if (typeof handlers[name] !== "function") {
      throw new Error(`Add-on delegation host service missing handler: ${name}`);
    }
    return handlers[name];
  }

  return {
    addonDelegationRoutes: [
      { method: "GET", path: "/addons/status", handler: required("executeAddonsStatus") },
      { method: "GET", path: "/addons/surface-routes", handler: required("executeAddonSurfaceRoutes") },
      { method: "GET", path: "/addons/execution-settings", handler: required("executeAddonExecutionSettingsGet") },
      {
        method: "POST",
        path: "/addons/execution-settings",
        requiredCapability: "addon-execution-settings-write",
        handler: required("executeAddonExecutionSettingsUpdate"),
      },
      { method: "GET", path: "/opencode/status", handler: required("executeOpenCodeStatus") },
      {
        method: "POST",
        path: "/hermes/dashboard/status",
        requiredCapability: "addon-runtime-read",
        handler: required("executeHermesDashboardStatus"),
      },
      {
        method: "POST",
        path: "/hermes/dashboard/start",
        requiredCapability: "addon-runtime-control",
        handler: required("executeHermesDashboardStart"),
      },
      {
        method: "POST",
        path: "/hermes/dashboard/stop",
        requiredCapability: "addon-runtime-control",
        handler: required("executeHermesDashboardStop"),
      },
      {
        method: "POST",
        path: "/hermes/status",
        requiredCapability: "addon-runtime-read",
        handler: required("executeHermesStatus"),
      },
      {
        method: "POST",
        path: "/hermes/delegation/start",
        requiredCapability: "addon-runtime-control",
        handler: required("executeHermesDelegationStart"),
      },
      {
        method: "POST",
        path: "/hermes/delegation/status",
        requiredCapability: "addon-runtime-read",
        handler: required("executeHermesDelegationStatus"),
      },
      {
        method: "POST",
        path: "/hermes/delegation/cancel",
        requiredCapability: "addon-runtime-control",
        handler: required("executeHermesDelegationCancel"),
      },
      {
        method: "POST",
        path: "/hermes/delegation/list",
        requiredCapability: "addon-runtime-read",
        handler: required("executeDelegationList"),
      },
      {
        method: "GET",
        path: "/addons/draft",
        handler: required("executeAddonDraftList"),
      },
      {
        method: "GET",
        path: "/addons/draft/get",
        handler: required("executeAddonDraftRead"),
      },
      {
        method: "POST",
        path: "/addons/draft/transition",
        requiredCapability: "addon-record-write",
        handler: required("executeAddonDraftTransition"),
      },
      {
        method: "POST",
        path: "/addons/draft/handoff",
        requiredCapability: "addon-record-write",
        handler: required("executeAddonDraftProviderHandoff"),
      },
      {
        method: "POST",
        path: "/addons/delegate",
        requiredCapability: "addon-record-write",
        handler: required("executeDelegationRecord"),
      },
      {
        method: "POST",
        path: "/addons/delegate/list",
        requiredCapability: "addon-record-read",
        handler: required("executeDelegationList"),
      },
      {
        method: "POST",
        path: "/goals",
        requiredCapability: "addon-record-write",
        handler: required("executeGoalRecord"),
      },
      // ADR-040 §4 wire-format dispatch (Phase 3.5-mediated). Caller
      // MUST send X-ResonantOS-Bridge-Caller-Id; bridge-server.mjs
      // resolves it through the Phase 3.5 grant store and forwards
      // `{ callerId, perCallerGrants, auditLedger }` to this handler
      // as `bridgeContext`. The dispatcher reads them.
      {
        method: "POST",
        path: "/external-agent-runtime/delegate",
        requiredCapability: "agent-delegation",
        handler: async (body, request, bridgeContext) => {
          const addonId = body?.addonId;
          const toolName = body?.tool;
          const payload = body?.payload ?? {};
          const result = await dispatchExternalAgentRuntime({
            addonId,
            toolName,
            payload,
            callerId: bridgeContext?.callerId ?? "__anonymous__",
            perCallerGrants: asGrantsMap(bridgeContext?.perCallerGrants),
            auditLedger: bridgeContext?.auditLedger ?? null,
          });
          if (result.outcome === "deny") {
            const status = result.reason === "addon-not-found"
              || result.reason === "manifest-misconfigured"
              ? 404
              : result.reason === "unknown-tool"
                ? 404
                : 403;
            return {
              status,
              body: { error: { code: result.reason, message: result.detail } },
            };
          }
          return { status: 200, body: { response: result.response } };
        },
      },
      // Dev-only: list addon manifests discovered under examples/addons/
      // and per-F verdict. Returns JSON; the static panel at
      // `/dev/external-agent-runtimes/` (served by
      // dev-external-agent-runtimes-panel.mjs) consumes this.
      {
        method: "GET",
        path: "/dev/external-agent-runtimes",
        handler: async (_body, _request, bridgeContext) => {
          const { readdirSync, readFileSync } = await import("node:fs");
          const { join } = await import("node:path");

          const repoRoot = bridgeContext?.repoRoot ?? process.env.RESONANTOS_REPO_ROOT;
          if (typeof repoRoot !== "string") {
            return { status: 503, body: { error: { message: "RESONANTOS_REPO_ROOT is not set; dev panel cannot enumerate addon manifests." } } };
          }

          const examplesDir = join(repoRoot, "examples", "addons");
          let fileNames = [];
          try {
            fileNames = readdirSync(examplesDir).filter((n) => n.endsWith(".json"));
          } catch (err) {
            return { status: 500, body: { error: { message: `failed to read ${examplesDir}: ${err.message}` } } };
          }

          const addons = [];
          for (const fileName of fileNames) {
            const absPath = join(examplesDir, fileName);
            let manifest;
            try {
              manifest = JSON.parse(readFileSync(absPath, "utf8"));
            } catch (err) {
              addons.push({ fileName, error: `parse failed: ${err.message}` });
              continue;
            }
            const capabilities = new Set((manifest.requestedCapabilities ?? []).map((c) => c.capability));
            const hasTrigger = capabilities.has("providers") && capabilities.has("agent-delegation");
            const tools = (manifest.tools ?? []).map((t) => t.name);
            const snapshot = addonTrustAndIsolationSnapshot(manifest);
            addons.push({
              fileName,
              id: manifest.id,
              name: manifest.name,
              version: manifest.version,
              runtimeType: manifest.runtimeType,
              serviceEntrypoint: manifest.service?.entrypoint,
              trustTier: snapshot.trustTier,
              publisher: snapshot.publisher,
              publisherNote: snapshot.publisherNote,
              workerKey: snapshot.workerKey,
              isolationBoundary: snapshot.boundary,
              hostMediated: snapshot.hostMediated,
              validationNote: "use npm run deepseek-harness:smoke for validation + F-cases (this panel only enumerates manifests; running .ts validators in the bridge requires a tsx loader)",
              hasTrigger,
              tools,
            });
          }
          return {
            status: 200,
            body: {
              addons,
              panelPath: "/dev/external-agent-runtimes/",
              generatedAt: new Date().toISOString(),
            },
          };
        },
      },
    ],
  };
}
