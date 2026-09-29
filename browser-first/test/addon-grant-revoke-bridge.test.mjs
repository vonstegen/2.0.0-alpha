// SDK-DEMO-003R T5 — bridge-side grant/revoke contract.
//
// Proves the host-side changes the operator grant/revoke UI depends on:
//   1. /addons/status reports an explicit `installed` boundary (discovery does
//      not install; explicit install flips it true).
//   2. POST /addons/workspace/install accepts intent-only { addonId } and the
//      host resolves the canonical manifest from its discovery cache (T1).
//   3. grant/install routes carry the same harness transport boundary as the
//      T4 revoke routes, so policy denials map to 4xx and runtime/upstream
//      failures to 5xx.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { createAddonDelegationService } from "../host/addon-delegation-service.mjs";
import { createAddonDelegationHostService } from "../host/addon-delegation-host-service.mjs";
import { createHarnessRegistry } from "../host/harness-registry.mjs";
import { evaluateBridgeRequestForSelfTest } from "../host/bridge-server.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const echoManifest = JSON.parse(
  await readFile(join(repoRoot, "examples/sdk-demo/echo/addon.json"), "utf8"),
);

function memoryStore() {
  const data = new Map();
  return { read: async () => data.get("doc") ?? null, write: async (_k, v) => { data.set("doc", v); } };
}

async function buildService() {
  const userRoot = mkdtempSync(join(tmpdir(), "sdk-003r-t5-bridge-"));
  const memoryRoot = mkdtempSync(join(userRoot, "memory-"));
  const registry = await createHarnessRegistry({ store: memoryStore() });
  const fn = (p) => () => p;
  const service = createAddonDelegationService({
    browserFirstRoot: () => join(userRoot, "browser-first-root"),
    bridgePublicUrl: () => "http://127.0.0.1:47325",
    dashboardTarget: { url: "about:blank", control: "noop" },
    execFileStdout: fn(""),
    expandUserPath: (p) => p,
    firstExistingExecutable: () => null,
    hermesCommand: () => null,
    hermesHome: () => userRoot,
    hermesPythonRuntime: () => null,
    listFilesRecursive: async () => [],
    memoryRoot: () => memoryRoot,
    opencodeCommand: () => null,
    opencodeRuntimeDiagnostics: () => ({ installed: false, searchedCommands: [], searchedPaths: [], searchedPathCount: 0, searchedPathOmitted: 0, overrideConfigured: false, overridePath: "", overrideFound: false }),
    platform: "linux",
    redactPathForDiagnostics: () => "",
    readProviderSecrets: async () => ({}),
    repoRoot,
    safeFileSlug: (s) => s,
    fs: { readFile: async () => { throw new Error("stub: not used"); } },
    isolationDependency: { resolve: false },
    spawnProcess: () => { throw new Error("stub: not used"); },
    socketOpen: async () => false,
    uniqueRuntimeId: () => "t5-bridge",
    userRoot,
    timers: { setTimeout, clearTimeout },
    workspaceAddonRegistry: registry,
  });
  return { service, registry, cleanup: () => { try { rmSync(userRoot, { recursive: true, force: true }); } catch {} } };
}

const echoInStatus = async (service) =>
  (await service.executeAddonsStatus()).workspaceAddonManifests.find((m) => m.id === "addon.resonant-echo");

test("T5 status reports installed:false on discovery and installed:true after explicit install", async () => {
  const { service, registry, cleanup } = await buildService();
  try {
    await service.executeAddonsStatus();
    let echo = await echoInStatus(service);
    assert.equal(echo.installed, false, "discovered add-on must report installed:false");
    assert.equal(echo.grantedCapabilities.length, 0);

    await service.installWorkspaceAddonManifest(echoManifest);
    assert.ok(registry.snapshot().installations["addon.resonant-echo"], "registry must contain installation");

    echo = await echoInStatus(service);
    assert.equal(echo.installed, true, "explicitly installed add-on must report installed:true");
    assert.deepEqual(echo.deniedCapabilities, ["network"], "install grants nothing: requested capability is denied");
  } finally { cleanup(); }
});

test("T5 install accepts intent-only { addonId } and resolves the cached manifest host-side", async () => {
  const { service, registry, cleanup } = await buildService();
  try {
    // Populate the discovery cache (executeAddonsStatus caches the full manifest).
    await service.executeAddonsStatus();

    const res = await service.executeWorkspaceAddonInstall({ addonId: "addon.resonant-echo" });
    assert.equal(res.addonId, "addon.resonant-echo", "install by addonId must resolve the manifest");
    assert.ok(registry.snapshot().installations["addon.resonant-echo"], "registry must contain installed add-on");
  } finally { cleanup(); }
});

test("T5 install by unknown addonId is invalid-event and installs nothing", async () => {
  const { service, registry, cleanup } = await buildService();
  try {
    await service.executeAddonsStatus();
    await assert.rejects(
      service.executeWorkspaceAddonInstall({ addonId: "addon.does-not-exist" }),
      (err) => err.code === "invalid-event",
      "unknown addonId must fail with invalid-event",
    );
    assert.equal(Object.keys(registry.snapshot().installations).length, 0);
  } finally { cleanup(); }
});

test("T5 grant/install routes carry the harness transport boundary (4xx policy vs 5xx runtime)", () => {
  const handlers = {};
  const make = (handler) => handler ?? (async () => ({ ok: true }));
  const all = [
    "executeAddonsStatus", "executeAddonExecutionSettingsGet", "executeAddonExecutionSettingsUpdate",
    "executeOpenCodeStatus", "executeHermesDashboardStatus", "executeHermesDashboardStart", "executeHermesDashboardStop",
    "executeHermesStatus", "executeHermesDelegationStart", "executeHermesDelegationStatus", "executeHermesDelegationArtifact", "executeHermesDelegationCancel",
    "executeOpenCodeDelegationStart", "executeOpenCodeDelegationStatus", "executeOpenCodeDelegationArtifact", "executeOpenCodeDelegationCancel", "executeOpenCodeWebUrl",
    "executeAddonDraftRecord", "executeAddonDraftList", "executeAddonDraftRead", "executeAddonDraftTransition", "executeAddonDraftProviderHandoff",
    "executeDelegationRecord", "executeDelegationList",
    "executeAddonUninstallAudit", "executeAddonRunningWork", "executeAddonUserDataList", "executeAddonUserDataDelete", "executeGoalRecord",
    "executeWorkspaceAddonInstall", "executeWorkspaceAddonGrants", "executeWorkspaceAddonGrant", "executeWorkspaceAddonRevoke", "executeWorkspaceAddonAdminRevoke", "executeWorkspaceAddonBootstrap",
  ];
  for (const name of all) handlers[name] = make();
  const host = createAddonDelegationHostService(handlers);
  const find = (method, path) => host.addonDelegationRoutes.find((r) => r.method === method && r.path === path);

  for (const path of ["/addons/workspace/install", "/addons/workspace/grant", "/addons/workspace/revoke", "/addons/workspace/admin-revoke"]) {
    const route = find("POST", path);
    assert.ok(route, `${path} must remain`);
    assert.equal(route.loopbackHostOnly, true, `${path} must be loopback-host-only`);
    assert.equal(route.errorFamily, "harness", `${path} must use the harness transport boundary`);
  }
});

test("T5 harness boundary maps permission-denied to 4xx and runtime-unavailable to 5xx", async () => {
  const all = [
    "executeAddonsStatus", "executeAddonExecutionSettingsGet", "executeAddonExecutionSettingsUpdate",
    "executeOpenCodeStatus", "executeHermesDashboardStatus", "executeHermesDashboardStart", "executeHermesDashboardStop",
    "executeHermesStatus", "executeHermesDelegationStart", "executeHermesDelegationStatus", "executeHermesDelegationArtifact", "executeHermesDelegationCancel",
    "executeOpenCodeDelegationStart", "executeOpenCodeDelegationStatus", "executeOpenCodeDelegationArtifact", "executeOpenCodeDelegationCancel", "executeOpenCodeWebUrl",
    "executeAddonDraftRecord", "executeAddonDraftList", "executeAddonDraftRead", "executeAddonDraftTransition", "executeAddonDraftProviderHandoff",
    "executeDelegationRecord", "executeDelegationList",
    "executeAddonUninstallAudit", "executeAddonRunningWork", "executeAddonUserDataList", "executeAddonUserDataDelete", "executeGoalRecord",
    "executeWorkspaceAddonInstall", "executeWorkspaceAddonGrants", "executeWorkspaceAddonGrant", "executeWorkspaceAddonRevoke", "executeWorkspaceAddonAdminRevoke", "executeWorkspaceAddonBootstrap",
  ];
  const handlers = {};
  for (const name of all) handlers[name] = async () => ({ ok: true });
  handlers.executeWorkspaceAddonGrant = async () => {
    throw Object.assign(new Error("denied"), { code: "permission-denied" });
  };
  handlers.executeWorkspaceAddonRevoke = async () => {
    throw Object.assign(new Error("upstream down"), { code: "runtime-unavailable" });
  };
  const host = createAddonDelegationHostService(handlers);

  const call = (url, body) => evaluateBridgeRequestForSelfTest({
    method: "POST",
    url,
    body,
    routes: host.addonDelegationRoutes,
    bridgeToken: "bridge-token",
    bridgeCapabilityTokens: { "addon-runtime-control": "control-token" },
    listenerPort: 47773,
    headers: { host: "127.0.0.1:47773", "x-resonantos-bridge-token": "bridge-token", "x-resonantos-bridge-capability-token": "control-token" },
    rawHeaders: ["Host", "127.0.0.1:47773"],
  });

  const grant = await call("/addons/workspace/grant", { addonId: "addon.resonant-echo", grants: [] });
  assert.equal(grant.status, 403, "permission-denied must map to 403");
  assert.equal(grant.payload.code, "permission-denied");

  const revoke = await call("/addons/workspace/revoke", { addonId: "addon.resonant-echo", capabilities: ["network"] });
  assert.equal(revoke.status, 503, "runtime-unavailable must map to 503");
  assert.equal(revoke.payload.code, "runtime-unavailable");
});
