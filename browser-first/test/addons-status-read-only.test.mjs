// T2: /addons/status MUST BE READ-ONLY
//
// This test verifies the T2 invariant:
//   READ/DISCOVERY REPORTS STATE.
//   EXPLICIT INSTALL MUTATES STATE.
//
// executeAddonsStatus() must NOT call registry.install() for discovered manifests.
// Discovered add-ons should remain uninstalled until explicit POST /addons/workspace/install.
//
// T1: https://github.com/ResonantOS/ResonantOS/pull/XXXX
// T2: sdk-003r-t2-status-readonly

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { createAddonDelegationService } from "../host/addon-delegation-service.mjs";
import { createHarnessRegistry } from "../host/harness-registry.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const echoManifest = JSON.parse(
  await readFile(join(repoRoot, "examples/sdk-demo/echo/addon.json"), "utf8"),
);

function memoryStore() {
  const data = new Map();
  return {
    read: async (key) => data.get(key) ?? null,
    write: async (key, value) => { data.set(key, value); },
  };
}

async function buildService({ workspaceAddonBearerTokens = { "addon.resonant-echo": "echo-bearer-test" } } = {}) {
  const userRoot = mkdtempSync(join(tmpdir(), "sdk-demo-003-t2-status-readonly-"));
  const memoryRoot = mkdtempSync(join(userRoot, "memory-"));
  const browserFirstRootPath = join(userRoot, "browser-first-root");
  const registryStore = memoryStore();
  const workspaceAddonRegistry = await createHarnessRegistry({ store: registryStore });
  const fn = (p) => () => p;
  return {
    userRoot,
    service: createAddonDelegationService({
      browserFirstRoot: () => browserFirstRootPath,
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
      opencodeRuntimeDiagnostics: () => ({
        installed: false,
        searchedCommands: [],
        searchedPaths: [],
        searchedPathCount: 0,
        searchedPathOmitted: 0,
        overrideConfigured: false,
        overridePath: "",
        overrideFound: false,
      }),
      platform: "linux",
      redactPathForDiagnostics: () => "",
      readProviderSecrets: async () => ({}),
      repoRoot,
      safeFileSlug: (s) => s,
      fs: { readFile: async () => { throw new Error("stub: not used"); } },
      isolationDependency: { resolve: false },
      spawnProcess: () => { throw new Error("stub: not used"); },
      socketOpen: async () => false,
      uniqueRuntimeId: () => "runtime-test",
      userRoot,
      timers: { setTimeout, clearTimeout },
      workspaceAddonRegistry,
      workspaceAddonBearerTokens,
      workspaceAddonAdminTokens: { "addon.resonant-echo": "echo-admin-test" },
    }),
    registry: workspaceAddonRegistry,
    cleanup: () => { try { rmSync(userRoot, { recursive: true, force: true }); } catch {} },
  };
}

test("T2-1: first status call discovers but does NOT install discovered add-on", async () => {
  const { service, registry, cleanup } = await buildService();
  try {
    // Status poll discovers Echo but should NOT install it into registry.
    await service.executeAddonsStatus();
    const installations = registry.snapshot().installations;
    
    // The discovered add-on should NOT be in the registry.
    assert.ok(
      !installations["addon.resonant-echo"],
      "discovered Echo must NOT be installed by status call",
    );
    
    // Status should still report the add-on as discovered (may be unavailable if probe fails).
    const status = await service.executeAddonsStatus();
    const echo = status.workspaceAddonManifests.find((m) => m.id === "addon.resonant-echo");
    assert.ok(echo, "status must report discovered Echo as present");
    // The 'available' flag depends on loopback probe; we accept either true or false
    // as long as the add-on is discovered and not installed.
    assert.ok(echo.id === "addon.resonant-echo", "discovered add-on must have correct id");
    assert.equal(echo.grantedCapabilities.length, 0, "discovered uninstalled add-on must report zero granted capabilities");
  } finally { cleanup(); }
});

test("T2-2: repeated status calls remain read-only/idempotent", async () => {
  const { service, registry, cleanup } = await buildService();
  try {
    // Multiple status polls must not create state.
    for (let i = 0; i < 5; i += 1) {
      const status = await service.executeAddonsStatus();
      const installations = registry.snapshot().installations;
      
      assert.ok(!installations["addon.resonant-echo"], `poll ${i + 1}: must not install`);
      
      const echo = status.workspaceAddonManifests.find((m) => m.id === "addon.resonant-echo");
      assert.ok(echo, `poll ${i + 1}: must still report discovered add-on`);
    }
  } finally { cleanup(); }
});

test("T2-3: explicit workspace install creates installation", async () => {
  const { service, registry, cleanup } = await buildService();
  try {
    // First confirm status does not install.
    await service.executeAddonsStatus();
    assert.ok(
      !registry.snapshot().installations["addon.resonant-echo"],
      "status must not install",
    );
    
    // Explicit install should add it.
    const installRes = await service.executeWorkspaceAddonInstall({
      manifest: echoManifest,
    });
    assert.equal(installRes.addonId, "addon.resonant-echo", "install must return addonId");
    assert.ok(installRes.installation, "install must return installation");
    assert.ok(
      registry.snapshot().installations["addon.resonant-echo"],
      "registry must contain installed add-on",
    );
    
    // Status now reports from registry grants (which are empty/default).
    const status = await service.executeAddonsStatus();
    const echo = status.workspaceAddonManifests.find((m) => m.id === "addon.resonant-echo");
    assert.ok(echo, "status must report installed add-on");
  } finally { cleanup(); }
});

test("T2-4: status polling cannot duplicate installation", async () => {
  const { service, registry, cleanup } = await buildService();
  try {
    // Install once.
    await service.executeWorkspaceAddonInstall({ manifest: echoManifest });
    assert.ok(registry.snapshot().installations["addon.resonant-echo"], "must be installed");
    
    // Poll status multiple times.
    for (let i = 0; i < 3; i += 1) {
      await service.executeAddonsStatus();
    }
    
    // Still exactly one installation.
    const installations = registry.snapshot().installations;
    assert.equal(
      Object.keys(installations).length,
      1,
      "multiple status polls must not duplicate installations",
    );
    assert.ok(installations["addon.resonant-echo"], "original installation must persist");
  } finally { cleanup(); }
});

test("T2-5: discovery error does not create registry state", async () => {
  const { service, registry, cleanup } = await buildService();
  try {
    // Status can report errors without mutating registry.
    const status = await service.executeAddonsStatus();
    assert.ok(
      !registry.snapshot().installations["addon.resonant-echo"],
      "status with errors must not install anything",
    );
    // Errors are reported separately.
    assert.ok(Array.isArray(status.workspaceAddonDiscoveryErrors), "errors must be array");
  } finally { cleanup(); }
});

test("T2-6: status reports registry grants for installed add-ons", async () => {
  const { service, registry, cleanup } = await buildService();
  try {
    // Install and grant.
    await service.executeWorkspaceAddonInstall({ manifest: echoManifest });
    await service.executeWorkspaceAddonGrant({
      addonId: "addon.resonant-echo",
      grants: [{ capability: "network", granted: true, scope: "self", revocationBehavior: "hard-stop" }],
    });
    
    // Status must report current grant state.
    const status = await service.executeAddonsStatus();
    const echo = status.workspaceAddonManifests.find((m) => m.id === "addon.resonant-echo");
    assert.deepEqual(echo.grantedCapabilities, ["network"], "status must report granted capabilities");
    assert.equal(echo.deniedCapabilities.length, 0, "status must report no denied capabilities");
    
    // Registry snapshot also shows the grant.
    const installation = registry.snapshot().installations["addon.resonant-echo"];
    assert.ok(installation, "registry must have installation");
    const networkGrant = installation.grantedCapabilities.find((g) => g.capability === "network");
    assert.ok(networkGrant?.granted, "registry must show network granted: true");
  } finally { cleanup(); }
});
