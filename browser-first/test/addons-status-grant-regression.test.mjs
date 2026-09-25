// Regression test for the P6 grant-wipe bug fixed in commit on top of 9a6ffe88.
//
// Bug: executeAddonsStatus called registry.install(fullManifest,
// { enabled: false }) unconditionally on every /addons/status poll.
// registry.install() *replaces* the installation entry and resets
// grantedCapabilities back to requestedCapabilities (granted: false).
// Effect: a grant made via POST /addons/workspace/grant was wiped the next
// time the extension polled /addons/status.
//
// Why in-suite tests missed it: the live extension tests call /addons/status
// ONCE at the start, then grant, then never re-poll.
//
// This test reproduces the bug end-to-end through the public service surface:
//   1. First /addons/status — registry installs Echo
//   2. /addons/workspace/grant — registry.setGrants(network, granted: true)
//   3. Second /addons/status — would have re-installed and wiped the grant
//   4. /addons/workspace/bootstrap — must still return capabilityTokens.network.token
//      and the snapshot must still show granted: true
//
// Pre-fix: step 4 returns capabilityTokens: {} (assertion fails).
// Post-fix: step 4 returns the bearer (assertion passes).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdir } from "node:fs/promises";
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
      workspaceAddonBearerTokens,
      workspaceAddonAdminTokens: { "addon.resonant-echo": "echo-admin-test" },
    }),
    registry: workspaceAddonRegistry,
    cleanup: () => { try { rmSync(userRoot, { recursive: true, force: true }); } catch {} },
  };
}

test("P6 regression: a grant survives a subsequent /addons/status poll", async () => {
  const { service, registry, cleanup } = await buildService();
  try {
    // Step 1 — first poll installs Echo into the registry.
    await service.executeAddonsStatus();
    const installations1 = registry.snapshot().installations;
    assert.ok(
      installations1["addon.resonant-echo"],
      "first poll must install Echo into the registry",
    );

    // Step 2 — operator grants network through the public handler.
    const grantRes = await service.executeWorkspaceAddonGrant({
      addonId: "addon.resonant-echo",
      grants: [{ capability: "network", granted: true, scope: "self", revocationBehavior: "hard-stop" }],
    });
    assert.equal(grantRes.installation.grantedCapabilities[0].granted, true, "grant must succeed");

    // Step 3 — second poll. PRE-FIX this re-installs and wipes the grant.
    const status2 = await service.executeAddonsStatus();
    const installations2 = registry.snapshot().installations;

    // Step 4a — registry snapshot still shows the grant.
    assert.equal(
      installations2["addon.resonant-echo"].grantedCapabilities[0].granted,
      true,
      "registry must still show network: granted after the second poll",
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
    await service.executeAddonsStatus();
    await service.executeWorkspaceAddonGrant({
      addonId: "addon.resonant-echo",
      grants: [{ capability: "network", granted: true, scope: "self", revocationBehavior: "hard-stop" }],
    });
    for (let i = 0; i < 5; i += 1) {
      await service.executeAddonsStatus();
    }
    const installation = registry.snapshot().installations["addon.resonant-echo"];
    assert.equal(installation.grantedCapabilities[0].granted, true, "grant must survive many polls");
    const bootstrap = await service.executeWorkspaceAddonBootstrap({ addonId: "addon.resonant-echo" });
    assert.equal(bootstrap.capabilityTokens?.network?.token, "echo-bearer-test", "bearer must survive many polls");
  } finally { cleanup(); }
});
