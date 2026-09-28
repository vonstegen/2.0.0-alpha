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

async function buildService() {
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
    }),
    registry: workspaceAddonRegistry,
    cleanup: () => { try { rmSync(userRoot, { recursive: true, force: true }); } catch {} },
  };
}

async function buildServiceWithFailingDiscovery() {
  const userRoot = mkdtempSync(join(tmpdir(), "sdk-demo-003-t2-5-must-"));
  const memoryRoot = mkdtempSync(join(userRoot, "memory-"));
  const browserFirstRootPath = join(userRoot, "browser-first-root");
  const registryStore = memoryStore();
  const workspaceAddonRegistry = await createHarnessRegistry({ store: registryStore });

  const failingDiscovery = {
    discoverWorkspaceAddonManifests: async () => {
      throw new Error("ENOSPC: simulated disk full during discovery");
    },
  };

  return {
    userRoot,
    service: createAddonDelegationService({
      browserFirstRoot: () => browserFirstRootPath,
      bridgePublicUrl: () => "http://127.0.0.1:47325",
      dashboardTarget: { url: "about:blank", control: "noop" },
      execFileStdout: () => "",
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
      workspaceAddonDiscoveryDependency: failingDiscovery,
      fs: { readFile: async () => { throw new Error("stub: not used"); } },
      isolationDependency: { resolve: false },
      spawnProcess: () => { throw new Error("stub: not used"); },
      socketOpen: async () => false,
      uniqueRuntimeId: () => "runtime-test",
      userRoot,
      timers: { setTimeout, clearTimeout },
      workspaceAddonRegistry,
    }),
    registry: workspaceAddonRegistry,
    cleanup: () => { try { rmSync(userRoot, { recursive: true, force: true }); } catch {} },
  };
}

test("T2-1: first status call discovers but does NOT install discovered add-on", async () => {
  const { service, registry, cleanup } = await buildService();
  try {
    await service.executeAddonsStatus();
    const installations = registry.snapshot().installations;
    
    assert.ok(
      !installations["addon.resonant-echo"],
      "discovered Echo must NOT be installed by status call",
    );
    
    const status = await service.executeAddonsStatus();
    const echo = status.workspaceAddonManifests.find((m) => m.id === "addon.resonant-echo");
    assert.ok(echo, "status must report discovered Echo as present");
    assert.ok(echo.id === "addon.resonant-echo", "discovered add-on must have correct id");
    assert.equal(echo.grantedCapabilities.length, 0, "discovered uninstalled add-on must report zero granted capabilities");
  } finally { cleanup(); }
});

test("T2-2: repeated status calls remain read-only/idempotent", async () => {
  const { service, registry, cleanup } = await buildService();
  try {
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
    await service.executeAddonsStatus();
    assert.ok(
      !registry.snapshot().installations["addon.resonant-echo"],
      "status must not install",
    );
    
    const installRes = await service.executeWorkspaceAddonInstall({
      manifest: echoManifest,
    });
    assert.equal(installRes.addonId, "addon.resonant-echo", "install must return addonId");
    assert.ok(installRes.installation, "install must return installation");
    assert.ok(
      registry.snapshot().installations["addon.resonant-echo"],
      "registry must contain installed add-on",
    );
    
    const status = await service.executeAddonsStatus();
    const echo = status.workspaceAddonManifests.find((m) => m.id === "addon.resonant-echo");
    assert.ok(echo, "status must report installed add-on");
  } finally { cleanup(); }
});

test("T2-4: status polling cannot duplicate installation", async () => {
  const { service, registry, cleanup } = await buildService();
  try {
    await service.executeWorkspaceAddonInstall({ manifest: echoManifest });
    assert.ok(registry.snapshot().installations["addon.resonant-echo"], "must be installed");
    
    for (let i = 0; i < 3; i += 1) {
      await service.executeAddonsStatus();
    }
    
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
  const { service, registry, cleanup } = await buildServiceWithFailingDiscovery();
  try {
    const status = await service.executeAddonsStatus();
    
    assert.ok(
      Array.isArray(status.workspaceAddonDiscoveryErrors),
      "errors must be array when discovery throws",
    );
    assert.ok(
      status.workspaceAddonDiscoveryErrors.length > 0,
      "errors must contain at least one error entry",
    );
    
    const firstError = status.workspaceAddonDiscoveryErrors[0];
    assert.ok(
      firstError.code === "discovery-failed",
      `error code must be discovery-failed, got: ${firstError.code}`,
    );
    assert.ok(
      firstError.message,
      "error must have message describing the failure",
    );
    
    const installations = registry.snapshot().installations;
    assert.equal(
      Object.keys(installations).length,
      0,
      "registry must be empty after discovery failure",
    );
    
    const manifests = status.workspaceAddonManifests;
    assert.ok(
      Array.isArray(manifests),
      "manifests must be array",
    );
    assert.equal(
      manifests.length,
      0,
      "manifests must be empty when discovery fails",
    );
  } finally {
    cleanup();
  }
});

test("T2-6: status reports registry grants for installed add-ons", async () => {
  const { service, registry, cleanup } = await buildService();
  try {
    await service.executeWorkspaceAddonInstall({ manifest: echoManifest });
    await service.executeWorkspaceAddonGrant({
      addonId: "addon.resonant-echo",
      grants: [{ capability: "network", granted: true, scope: "self", revocationBehavior: "hard-stop" }],
    });
    
    const status = await service.executeAddonsStatus();
    const echo = status.workspaceAddonManifests.find((m) => m.id === "addon.resonant-echo");
    assert.deepEqual(echo.grantedCapabilities, ["network"], "status must report granted capabilities");
    assert.equal(echo.deniedCapabilities.length, 0, "status must report no denied capabilities");
    
    const installation = registry.snapshot().installations["addon.resonant-echo"];
    assert.ok(installation, "registry must have installation");
    const networkGrant = installation.grantedCapabilities.find((g) => g.capability === "network");
    assert.ok(networkGrant?.granted, "registry must show network granted: true");
  } finally { cleanup(); }
});
