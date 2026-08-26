import assert from "node:assert/strict";
import test from "node:test";
import { createAddonDelegationHostService } from "../host/addon-delegation-host-service.mjs";

const requiredHandlers = [
  "executeAddonsStatus",
  "executeAddonSurfaceRoutes",
  "executeAddonExecutionSettingsGet",
  "executeAddonExecutionSettingsUpdate",
  "executeOpenCodeStatus",
  "executeHermesDashboardStatus",
  "executeHermesDashboardStart",
  "executeHermesDashboardStop",
  "executeHermesStatus",
  "executeHermesDelegationStart",
  "executeHermesDelegationStatus",
  "executeHermesDelegationArtifact",
  "executeHermesDelegationCancel",
  "executeOpenCodeDelegationStart",
  "executeOpenCodeDelegationStatus",
  "executeOpenCodeDelegationArtifact",
  "executeOpenCodeDelegationCancel",
  "executeOpenCodeWebUrl",
  "executeAddonDraftRecord",
  "executeAddonDraftList",
  "executeAddonDraftRead",
  "executeAddonDraftTransition",
  "executeAddonDraftProviderHandoff",
  "executeDelegationRecord",
  "executeDelegationList",
  "executeGoalRecord",
];

function handlers() {
  return Object.fromEntries(requiredHandlers.map((name) => [name, async () => ({ name })]));
}

test("add-on delegation host service owns add-on, delegation, draft, and goal routes", () => {
  const { addonDelegationRoutes } = createAddonDelegationHostService(handlers());
  const routes = new Map(addonDelegationRoutes.map((route) => [`${route.method} ${route.path}`, route]));

  assert.deepEqual([...routes.keys()], [
    "GET /addons/status",
    "GET /addons/surface-routes",
    "GET /addons/execution-settings",
    "POST /addons/execution-settings",
    "GET /opencode/status",
    "POST /hermes/dashboard/status",
    "POST /hermes/dashboard/start",
    "POST /hermes/dashboard/stop",
    "POST /hermes/status",
    "POST /hermes/delegation/start",
    "POST /hermes/delegation/status",
    "POST /hermes/delegation/cancel",
    "POST /hermes/delegation/list",
    "GET /addons/draft",
    "GET /addons/draft/get",
    "POST /addons/draft/transition",
    "POST /addons/draft/handoff",
    "POST /addons/delegate",
    "POST /addons/delegate/list",
    "POST /goals",
    "POST /external-agent-runtime/delegate",
    "GET /dev/external-agent-runtimes",
  ]);
  assert.equal(routes.get("POST /addons/execution-settings").requiredCapability, "addon-execution-settings-write");
  assert.equal(routes.get("POST /hermes/dashboard/status").requiredCapability, "addon-runtime-read");
  assert.equal(routes.get("POST /hermes/dashboard/start").requiredCapability, "addon-runtime-control");
  assert.equal(routes.get("POST /hermes/dashboard/stop").requiredCapability, "addon-runtime-control");
  assert.equal(routes.get("POST /hermes/status").requiredCapability, "addon-runtime-read");
  assert.equal(routes.get("POST /hermes/delegation/start").requiredCapability, "addon-runtime-control");
  assert.equal(routes.get("POST /hermes/delegation/status").requiredCapability, "addon-runtime-read");
  assert.equal(routes.get("POST /hermes/delegation/cancel").requiredCapability, "addon-runtime-control");
  assert.equal(routes.get("POST /hermes/delegation/list").requiredCapability, "addon-runtime-read");
  assert.equal(routes.get("POST /addons/draft/transition").requiredCapability, "addon-record-write");
  assert.equal(routes.get("POST /addons/draft/handoff").requiredCapability, "addon-record-write");
  assert.equal(routes.get("POST /addons/delegate").requiredCapability, "addon-record-write");
  assert.equal(routes.get("POST /addons/delegate/list").requiredCapability, "addon-record-read");
  assert.equal(routes.get("POST /goals").requiredCapability, "addon-record-write");
  assert.equal(routes.get("POST /external-agent-runtime/delegate").requiredCapability, "agent-delegation");
});

test("add-on delegation host service fails fast when a handler is missing", () => {
  const incomplete = handlers();
  delete incomplete.executeHermesDelegationStart;

  assert.throws(
    () => createAddonDelegationHostService(incomplete),
    /Add-on delegation host service missing handler: executeHermesDelegationStart/,
  );
});

test("/external-agent-runtime/delegate accepts plain-object perCallerGrants from bridgeContext", async () => {
  // Reproduces the Phase 3.5 shape mismatch surfaced by the dev-panel
  // round-trip: createBridgeGrantsStore().snapshot() returns
  // { callerId: { capability: token } }, but the dispatcher's
  // checkToolGrants expects a Map. Without the asGrantsMap adapter
  // every legitimate addon call would be denied for "missing
  // per-caller grants".
  const { addonDelegationRoutes } = createAddonDelegationHostService(handlers());
  const route = addonDelegationRoutes.find((r) => r.method === "POST" && r.path === "/external-agent-runtime/delegate");
  assert.ok(route, "delegate route must exist");

  // Stub out the upstream fetch so we don't actually hit Cordis.
  const originalFetch = globalThis.fetch;
  let lastRequest = null;
  globalThis.fetch = async (url, init) => {
    lastRequest = { url, init };
    return new Response(
      JSON.stringify({
        id: "stubcmpl", object: "chat.completion", created: 0, model: "stub",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    const plainObjectGrants = {
      "caller.bridge": {
        "network": "token-network-1234567890",
        "providers": "token-providers-1234567890",
        "agent-delegation": "token-delegation-1234567890",
      },
    };
    const result = await route.handler(
      { addonId: "addon.deepseek-harness", tool: "deepseek_harness.run_task", payload: { model: "deepseek-chat", messages: [{ role: "user", content: "hi" }] } },
      { headers: {} },
      { callerId: "caller.bridge", perCallerGrants: plainObjectGrants, auditLedger: null, repoRoot: "/Users/andrewjochl/Developer/Projects/2.0.0-alpha.worktrees/feat-dev-panel" },
    );
    assert.equal(result.status, 200, "expected allow once the adapter is in place");
    assert.ok(lastRequest?.url?.includes("/api/v1/chat/completions"), "should have posted to addon entrypoint");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("/external-agent-runtime/delegate still denies when plain-object perCallerGrants has no matching capability", async () => {
  const { addonDelegationRoutes } = createAddonDelegationHostService(handlers());
  const route = addonDelegationRoutes.find((r) => r.method === "POST" && r.path === "/external-agent-runtime/delegate");
  assert.ok(route, "delegate route must exist");
  const result = await route.handler(
    { addonId: "addon.deepseek-harness", tool: "deepseek_harness.run_task", payload: { model: "deepseek-chat", messages: [{ role: "user", content: "hi" }] } },
    { headers: {} },
    { callerId: "caller.empty", perCallerGrants: {}, auditLedger: null, repoRoot: "/Users/andrewjochl/Developer/Projects/2.0.0-alpha.worktrees/feat-dev-panel" },
  );
  assert.equal(result.status, 403);
  assert.equal(result.body?.error?.code, "capability-denied");
});
