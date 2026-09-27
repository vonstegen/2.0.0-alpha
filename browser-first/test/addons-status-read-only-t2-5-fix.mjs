// T2-5 FIX: discovery error does not create registry state
//
// This test verifies that when discoverWorkspaceAddonManifests throws,
// executeAddonsStatus handles it gracefully, reports the error, and
// does NOT mutate registry state.
//
// We inject a failing discovery by passing workspaceAddonDiscoveryDependency
// to the service constructor.

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

function memoryStore() {
  const data = new Map();
  return {
    read: async (key) => data.get(key) ?? null,
    write: async (key, value) => { data.set(key, value); },
  };
}

async function buildServiceWithFailingDiscovery() {
  const userRoot = mkdtempSync(join(tmpdir(), "sdk-demo-003-t2-5-failing-discovery-"));
  const memoryRoot = mkdtempSync(join(userRoot, "memory-"));
  const browserFirstRootPath = join(userRoot, "browser-first-root");
  const registryStore = memoryStore();
  const workspaceAddonRegistry = await createHarnessRegistry({ store: registryStore });

  // Inject a mock discovery that throws synchronously
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
      // Inject the failing discovery dependency
      workspaceAddonDiscoveryDependency: failingDiscovery,
      fs: { readFile: async () => { throw new Error("stub: not used"); } },
      isolationDependency: { resolve: false },
      spawnProcess: () => { throw new Error("stub: not used"); },
      socketOpen: async () => false,
      uniqueRuntimeId: () => "runtime-test",
      userRoot,
      timers: { setTimeout, clearTimeout },
      workspaceAddonRegistry,
      workspaceAddonBearerTokens: { "addon.resonant-echo": "echo-bearer-test" },
      workspaceAddonAdminTokens: { "addon.resonant-echo": "echo-admin-test" },
    }),
    registry: workspaceAddonRegistry,
    cleanup: () => { try { rmSync(userRoot, { recursive: true, force: true }); } catch {} },
  };
}

test("T2-5-fixed: discovery error does not create registry state", async () => {
  const { service, registry, cleanup } = await buildServiceWithFailingDiscovery();
  try {
    // This call MUST trigger discovery failure
    const status = await service.executeAddonsStatus();
    
    // Prove returned workspaceAddonDiscoveryErrors contains discovery-failed
    assert.ok(
      Array.isArray(status.workspaceAddonDiscoveryErrors),
      "errors must be array when discovery throws",
    );
    assert.ok(
      status.workspaceAddonDiscoveryErrors.length > 0,
      "errors must contain at least one error entry",
    );
    
    // Verify error structure has expected code
    const firstError = status.workspaceAddonDiscoveryErrors[0];
    assert.ok(
      firstError.code === "discovery-failed",
      `error code must be discovery-failed, got: ${firstError.code}`,
    );
    assert.ok(
      firstError.message,
      "error must have message describing the failure",
    );
    
    // Prove registry snapshot remains empty
    const installations = registry.snapshot().installations;
    assert.equal(
      Object.keys(installations).length,
      0,
      "registry must be empty after discovery failure",
    );
    
    // Prove no install/grant mutation occurs
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
