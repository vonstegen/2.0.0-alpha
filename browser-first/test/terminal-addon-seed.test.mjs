// CP-BR9 req #1: the two terminal add-on manifests install into the host
// registry and appear in `registry.snapshot().installations` across a fresh
// boot — through the same registry path the `/addons/install` route uses.
//
// No real process is spawned anywhere in this file; the terminal-host
// service is never constructed.

import assert from "node:assert/strict";
import test from "node:test";

import { createHarnessHostService } from "../host/harness-host-service.mjs";
import {
  loadTerminalAddonSeedInstallations,
  TERMINAL_ADDON_SEEDS,
} from "../host/terminal-addon-seed.mjs";
import { TERMINAL_FACTORY_IDS } from "../host/terminal-runtime-factories.mjs";
import { validateHarnessManifest } from "../host/harness-adapter-contract.mjs";

const GHOSTTY = "addon.resonant-terminal-ghostty";
const ITERM2 = "addon.resonant-terminal-iterm2";

const providerHost = {
  executeProviderStatus: async () => ({ providers: [] }),
  executeBridgeChat: async () => ({}),
};

function memoryStore() {
  let stored = null;
  return {
    read: async () => stored,
    write: async (value) => {
      stored = structuredClone(value);
    },
  };
}

async function makeService(store, seedInstallations) {
  return createHarnessHostService({
    env: {},
    store,
    providerHost,
    seedInstallations: seedInstallations ?? (await loadTerminalAddonSeedInstallations()),
  });
}

test("CP-BR9 req #1: the seed plan is SDK-valid, catalog-sourced, and paired with the reviewed factory ids", async () => {
  const plan = await loadTerminalAddonSeedInstallations();
  assert.equal(plan.length, 2);
  assert.equal(TERMINAL_ADDON_SEEDS.length, 2);
  const byId = new Map(plan.map((entry) => [entry.manifest.id, entry]));
  assert.equal(byId.get(GHOSTTY)?.factoryId, TERMINAL_FACTORY_IDS.ghostty);
  assert.equal(byId.get(ITERM2)?.factoryId, TERMINAL_FACTORY_IDS.iterm2);
  for (const { manifest } of plan) {
    assert.equal(validateHarnessManifest(manifest).valid, true, `${manifest.id} must validate`);
    assert.equal(manifest.runtimeType, "local-service");
    assert.equal(manifest.category, "integration");
    assert.deepEqual(
      manifest.requestedCapabilities.map((grant) => grant.capability),
      ["terminal-host"],
    );
    // Authorization is operator-consented: the seed never ships a grant.
    assert.ok(manifest.requestedCapabilities.every((grant) => grant.granted === false));
    // The /terminal-host/status surface walk keys on this declaration.
    assert.equal(manifest.surfaces[0].shellNavigation.sectionId, "terminal");
    assert.deepEqual(manifest.surfaces[0].shellNavigation.requiredCapabilities, ["terminal-host"]);
  }
});

test("CP-BR9 req #1: seeded installations appear in registry.snapshot().installations on a fresh boot", async (t) => {
  const svc = await makeService(memoryStore());
  t.after(() => svc.close());
  const { installations } = svc.registry.snapshot();
  for (const addonId of [GHOSTTY, ITERM2]) {
    const entry = installations[addonId];
    assert.ok(entry, `${addonId} must be installed`);
    assert.equal(entry.installed, true);
    // Installed disabled; enablement and grants stay operator-consented.
    assert.equal(entry.enabled, false);
    assert.equal(
      entry.factoryId,
      addonId === GHOSTTY ? TERMINAL_FACTORY_IDS.ghostty : TERMINAL_FACTORY_IDS.iterm2,
    );
    assert.equal(entry.compatible, true);
    assert.deepEqual(entry.requiredCapabilities, ["terminal-host"]);
    assert.equal(entry.projectionGeneration, 0);
    assert.equal(typeof entry.bootEpoch, "string");
    assert.equal(entry.manifest.runtimeType, "local-service");
    assert.equal(entry.manifest.category, "integration");
    assert.ok(entry.grantedCapabilities.every((grant) => grant.granted === false));
  }
});

test("CP-BR9 req #1: the seed survives a fresh bridge boot and preserves operator state", async (t) => {
  const store = memoryStore();
  const first = await makeService(store);
  t.after(() => first.close());
  await first.registry.setEnabled(GHOSTTY, true, {
    expectedRevision: first.registry.snapshot().revision,
  });
  await first.registry.setGrants(
    GHOSTTY,
    [{ capability: "terminal-host", scope: "system", revocationBehavior: "degrade", granted: true }],
    { consent: true, expectedRevision: first.registry.snapshot().revision },
  );
  const revisionAfterSetup = first.registry.snapshot().revision;
  await first.close();

  // Second boot with the same durable store: the seed must be idempotent
  // (no reinstall, no pin repair, no revision bump) and operator state
  // (enabled + granted) must survive.
  const second = await makeService(store);
  t.after(() => second.close());
  const snapshot = second.registry.snapshot();
  const ghostty = snapshot.installations[GHOSTTY];
  assert.equal(ghostty.enabled, true);
  assert.equal(ghostty.factoryId, TERMINAL_FACTORY_IDS.ghostty);
  assert.equal(ghostty.projectionGeneration, 2, "enable + grant each bump the lifecycle generation");
  assert.ok(ghostty.grantedCapabilities.some((grant) => grant.capability === "terminal-host" && grant.granted));
  assert.equal(
    snapshot.revision,
    revisionAfterSetup,
    "an idempotent seed performs no transaction on the second boot",
  );
});

test("CP-BR9 req #1: pinFactory repairs an unpinned legacy installation without touching consent", async (t) => {
  const store = memoryStore();
  const seedPlan = await loadTerminalAddonSeedInstallations();
  const ghosttyManifest = seedPlan.find((entry) => entry.manifest.id === GHOSTTY).manifest;
  // Simulate a pre-CP-BR9 operator install through the plain route path:
  // installed + enabled + granted, but no factory pin.
  const legacy = await createHarnessHostService({ env: {}, store, providerHost });
  t.after(() => legacy.close());
  await legacy.registry.install(ghosttyManifest, { enabled: true });
  await legacy.registry.setGrants(GHOSTTY, ghosttyManifest.requestedCapabilities.map((grant) => ({ ...grant, granted: true })), {
    consent: true,
    expectedRevision: legacy.registry.snapshot().revision,
  });
  assert.equal(legacy.registry.snapshot().installations[GHOSTTY].factoryId, undefined);
  await legacy.close();

  const seeded = await makeService(store);
  t.after(() => seeded.close());
  const repaired = seeded.registry.snapshot().installations[GHOSTTY];
  assert.equal(repaired.factoryId, TERMINAL_FACTORY_IDS.ghostty);
  assert.equal(repaired.enabled, true, "enablement is preserved");
  assert.ok(repaired.grantedCapabilities.every((grant) => grant.granted), "grants are preserved");
  assert.equal(repaired.projectionGeneration, 1, "the pin repair bumps the lifecycle generation once");
});

test("CP-BR9 req #1: the seeded manifests reach the route-facing /terminal-host/status surface walk", async (t) => {
  const svc = await makeService(memoryStore());
  t.after(() => svc.close());
  const statusRoute = svc.harnessRoutes.find((route) => route.path === "/terminal-host/status");
  const status = await statusRoute.handler({});
  const byAdapter = new Map(status.surfaces.map((surface) => [surface.adapterId, surface]));
  assert.equal(byAdapter.get(GHOSTTY)?.label, "Ghostty Terminal Host");
  assert.equal(byAdapter.get(ITERM2)?.label, "iTerm2 Terminal Host");
  // `compatible` reflects platform compatibility (macOS), independent of
  // grant state; nothing is connected without a live adapter.
  assert.equal(byAdapter.get(GHOSTTY)?.compatible, true);
  assert.equal(byAdapter.get(GHOSTTY)?.connected, false);
  await svc.registry.setGrants(
    GHOSTTY,
    [{ capability: "terminal-host", scope: "system", revocationBehavior: "degrade", granted: true }],
    { consent: true, expectedRevision: svc.registry.snapshot().revision },
  );
  const after = await statusRoute.handler({});
  // Granting does not change the platform-compatibility verdict.
  assert.equal(
    after.surfaces.find((surface) => surface.adapterId === GHOSTTY)?.compatible,
    true,
  );
});

test("CP-BR9 req #1: slot-managed (unpinned) installations keep the legacy snapshot shape", async (t) => {
  const svc = await makeService(memoryStore());
  t.after(() => svc.close());
  const legacyManifest = {
    id: "addon.legacy-slot-managed",
    name: "Legacy Slot Managed",
    version: "0.1.0",
    author: "ResonantOS",
    category: "tool",
    sdkVersion: "0.1.0",
    description: "Legacy slot-managed add-on fixture for the CP-BR9 snapshot-shape test.",
    runtimeType: "ui-module",
    surfaces: [],
    requestedCapabilities: [],
    providerRequirements: { sharedProfiles: [], supportsPrivateCredentials: false },
    archiveIntegration: { readScopes: [], intakeWriteScopes: [], canRequestIngest: false, canWriteKnowledgePages: false },
    health: { strategy: "none" },
    installHooks: {},
    compatibility: { shellVersion: "^0.1.0", platforms: [] },
  };
  await svc.registry.install(legacyManifest, { enabled: true });
  const entry = svc.registry.snapshot().installations[legacyManifest.id];
  assert.ok(entry, "legacy add-on installed");
  // No reconciler/projection fields leak onto unpinned entries: the
  // CP-BR4 reconciler and CP-BR5 projection must not see slot-managed
  // add-ons as lifecycle runtimes.
  assert.equal(entry.factoryId, undefined);
  assert.equal(entry.manifest, undefined);
  assert.equal(entry.compatible, undefined);
  assert.equal(entry.projectionGeneration, undefined);
  assert.equal(entry.enabled, true);
});
