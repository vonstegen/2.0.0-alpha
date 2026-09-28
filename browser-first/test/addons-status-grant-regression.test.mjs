// P6 regression test for grant-wipe bug: status calls must not wipe grants.
//
// Updated for T2 semantics:
// - executeAddonsStatus() now reads registry state without installing discovered add-ons.
// - Discovered add-ons remain uninstalled until explicit POST /addons/workspace/install.
// - This test verifies that grants survive repeated status polls on installed add-ons.
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
import { createWorkspaceAddonCredentialResolver } from "../host/workspace-addon-credentials.mjs";
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
  const userRoot = mkdtempSync(join(tmpdir(), "sdk-demo-003-p6-regression-"));
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
      workspaceAddonCredentialResolver: createWorkspaceAddonCredentialResolver({
        credentials: { "addon.resonant-echo": { bearer: "echo-bearer-test" } },
      }),
    }),
    registry: workspaceAddonRegistry,
    cleanup: () => { try { rmSync(userRoot, { recursive: true, force: true }); } catch {} },
  };
}

test("P6 regression: a grant survives a subsequent /addons/status poll", async () => {
  const { service, registry, cleanup } = await buildService();
  try {
    // Step 1 — explicit install into registry first (T2 semantics).
    await service.executeWorkspaceAddonInstall({ manifest: echoManifest });
    const installations1 = registry.snapshot().installations;
    assert.ok(
      installations1["addon.resonant-echo"],
      "explicit install must install Echo into the registry",
    );

    // Step 2 — operator grants network through the public handler.
    // T7: the grant route now converges upstream (needs a reachable upstream);
    // this P6/R5 regression asserts grants survive status polls, so set the
    // registry grant directly for setup.
    await registry.setGrants("addon.resonant-echo", [
      { capability: "network", granted: true, scope: "self", revocationBehavior: "hard-stop" },
    ], { consent: true, expectedRevision: registry.snapshot().revision });
    assert.equal(registry.snapshot().installations["addon.resonant-echo"].grantedCapabilities[0].granted, true, "grant must succeed");

    // Step 3 — subsequent status poll (now reads-only, does not re-install).
    const status2 = await service.executeAddonsStatus();
    const installations2 = registry.snapshot().installations;

    // Step 4a — registry snapshot still shows the grant.
    assert.equal(
      installations2["addon.resonant-echo"].grantedCapabilities[0].granted,
      true,
      "registry must still show network: granted after status poll",
    );

    // Step 4b — renderer's view of the same field still surfaces the grant.
    const echoProjection = status2.workspaceAddonManifests.find((m) => m.id === "addon.resonant-echo");
    assert.deepEqual(
      echoProjection.grantedCapabilities,
      ["network"],
      "renderer projection must still show network as granted",
    );

    // Step 4c — bootstrap envelope still carries the bearer token.
    const bootstrap = await service.executeWorkspaceAddonBootstrap({ addonId: "addon.resonant-echo" });
    assert.equal(
      bootstrap.capabilityTokens?.network?.token,
      "echo-bearer-test",
      "bootstrap envelope must still carry the host-minted bearer for network",
    );
  } finally { cleanup(); }
});

test("P6 regression: grants survive multiple /addons/status polls (idempotent)", async () => {
  const { service, registry, cleanup } = await buildService();
  try {
    // Explicit install first.
    await service.executeWorkspaceAddonInstall({ manifest: echoManifest });

    // Grant.
    await registry.setGrants("addon.resonant-echo", [
      { capability: "network", granted: true, scope: "self", revocationBehavior: "hard-stop" },
    ], { consent: true, expectedRevision: registry.snapshot().revision });

    // Multiple status polls should not affect the grant.
    for (let i = 0; i < 5; i += 1) {
      await service.executeAddonsStatus();
    }

    const installation = registry.snapshot().installations["addon.resonant-echo"];
    assert.equal(installation.grantedCapabilities[0].granted, true, "grant must survive many polls");
    const bootstrap = await service.executeWorkspaceAddonBootstrap({ addonId: "addon.resonant-echo" });
    assert.equal(bootstrap.capabilityTokens?.network?.token, "echo-bearer-test", "bearer must survive many polls");
  } finally { cleanup(); }
});
