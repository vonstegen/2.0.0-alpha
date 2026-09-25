// Phase 3 (P6) — workspace add-on grant lifecycle against the host-owned
// `harness-registry`. Echo and Counter are local-service add-ons (no
// systemSlots, no agentRuntime); the registry's `install()` accepts any
// valid `AddOnSdkManifest`, so the same registry that gates harness adapters
// also gates workspace add-ons. No second registry is introduced.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createHarnessRegistry } from "../host/harness-registry.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const echoManifest = JSON.parse(await readFile(join(repoRoot, "examples/sdk-demo/echo/addon.json"), "utf8"));
const counterManifest = JSON.parse(await readFile(join(repoRoot, "examples/sdk-demo/counter/addon.json"), "utf8"));

function memoryStore() {
  let document = null;
  return {
    read: async () => structuredClone(document),
    write: async (value) => { document = structuredClone(value); },
  };
}

function openRegistry(store) {
  // reviewedAdapterIds / bindings are not relevant to local-service workspace
  // add-ons (they only gate primary-agent slot binding), but the registry
  // constructor requires the args to be present.
  return createHarnessRegistry({ store, reviewedAdapterIds: [], bindings: [] });
}

const networkGrant = (granted) => ({
  capability: "network",
  granted: Boolean(granted),
  scope: "self",
  revocationBehavior: "hard-stop",
});

test("harness-registry installs a local-service workspace add-on (no systemSlots)", async () => {
  const registry = await openRegistry(memoryStore());
  await registry.install(echoManifest, { enabled: false });
  const installation = registry.snapshot().installations["addon.resonant-echo"];
  assert.ok(installation, "Echo must be installed");
  assert.equal(installation.enabled, false);
  // Authored `granted: true` MUST be cleared at install; the host is the only
  // authority. The Echo manifest requests `network` `granted: false`; that
  // state is preserved (no flip happens either way).
  const networkEntry = installation.grantedCapabilities.find((g) => g.capability === "network");
  assert.ok(networkEntry, "Echo must have a network grant entry");
  assert.equal(networkEntry.granted, false);
});

test("consent: false is rejected by the registry (no self-grant)", async () => {
  const registry = await openRegistry(memoryStore());
  await registry.install(echoManifest, { enabled: false });
  await assert.rejects(
    registry.setGrants("addon.resonant-echo", [networkGrant(true)], { consent: false, expectedRevision: registry.snapshot().revision }),
    (error) => error?.code === "permission-denied",
  );
});

test("consent: true grants the capability; the snapshot reflects it", async () => {
  const registry = await openRegistry(memoryStore());
  await registry.install(echoManifest, { enabled: false });
  await registry.setGrants(
    "addon.resonant-echo",
    [networkGrant(true)],
    { consent: true, expectedRevision: registry.snapshot().revision },
  );
  const installation = registry.snapshot().installations["addon.resonant-echo"];
  const network = installation.grantedCapabilities.find((g) => g.capability === "network");
  assert.equal(network.granted, true, "the host has granted Echo's network capability");
});

test("revoke (granted: false) survives re-grant (granted: true) — round-trip is exact", async () => {
  const registry = await openRegistry(memoryStore());
  await registry.install(echoManifest, { enabled: false });
  // grant
  await registry.setGrants(
    "addon.resonant-echo",
    [networkGrant(true)],
    { consent: true, expectedRevision: registry.snapshot().revision },
  );
  const afterGrant = registry.snapshot().installations["addon.resonant-echo"].grantedCapabilities.find((g) => g.capability === "network").granted;
  assert.equal(afterGrant, true);
  // revoke
  await registry.setGrants(
    "addon.resonant-echo",
    [networkGrant(false)],
    { consent: true, expectedRevision: registry.snapshot().revision },
  );
  const afterRevoke = registry.snapshot().installations["addon.resonant-echo"].grantedCapabilities.find((g) => g.capability === "network").granted;
  assert.equal(afterRevoke, false, "the host has revoked Echo's network capability");
  // re-grant
  await registry.setGrants(
    "addon.resonant-echo",
    [networkGrant(true)],
    { consent: true, expectedRevision: registry.snapshot().revision },
  );
  const afterReg = registry.snapshot().installations["addon.resonant-echo"].grantedCapabilities.find((g) => g.capability === "network").granted;
  assert.equal(afterReg, true, "the host can re-grant after revoking");
});

test("Echo's grant and Counter's grant are independent (per-add-on audience)", async () => {
  const registry = await openRegistry(memoryStore());
  await registry.install(echoManifest, { enabled: false });
  await registry.install(counterManifest, { enabled: false });
  // Grant Echo but not Counter.
  await registry.setGrants(
    "addon.resonant-echo",
    [networkGrant(true)],
    { consent: true, expectedRevision: registry.snapshot().revision },
  );
  const snapshot = registry.snapshot();
  assert.equal(
    snapshot.installations["addon.resonant-echo"].grantedCapabilities.find((g) => g.capability === "network").granted,
    true,
    "Echo is granted",
  );
  assert.equal(
    snapshot.installations["addon.resonant-counter"].grantedCapabilities.find((g) => g.capability === "network").granted,
    false,
    "Counter remains ungranted",
  );
  // Now revoke Echo — Counter is still untouched.
  await registry.setGrants(
    "addon.resonant-echo",
    [networkGrant(false)],
    { consent: true, expectedRevision: registry.snapshot().revision },
  );
  const after = registry.snapshot();
  assert.equal(
    after.installations["addon.resonant-echo"].grantedCapabilities.find((g) => g.capability === "network").granted,
    false,
    "Echo revoked",
  );
  assert.equal(
    after.installations["addon.resonant-counter"].grantedCapabilities.find((g) => g.capability === "network").granted,
    false,
    "Counter still ungranted (the registry never silently flips a sibling)",
  );
});

test("grants outside the manifest's requestedCapabilities are rejected", async () => {
  const registry = await openRegistry(memoryStore());
  await registry.install(echoManifest, { enabled: false });
  // Echo does not request `archive-read`; the registry must refuse a grant
  // for that capability.
  await assert.rejects(
    registry.setGrants(
      "addon.resonant-echo",
      [{ capability: "archive-read", granted: true, scope: "self", revocationBehavior: "hard-stop" }],
      { consent: true, expectedRevision: registry.snapshot().revision },
    ),
    (error) => error?.code === "permission-denied",
    "the registry refuses grants outside the manifest's request set",
  );
});

test("grants survive registry restart (durable journal)", async () => {
  const store = memoryStore();
  let registry = await openRegistry(store);
  await registry.install(echoManifest, { enabled: false });
  await registry.setGrants(
    "addon.resonant-echo",
    [networkGrant(true)],
    { consent: true, expectedRevision: registry.snapshot().revision },
  );
  // Reload from the same store.
  registry = await openRegistry(store);
  const installation = registry.snapshot().installations["addon.resonant-echo"];
  assert.equal(installation.grantedCapabilities.find((g) => g.capability === "network").granted, true);
});

test("expectedRevision mismatch on setGrants is refused (optimistic concurrency)", async () => {
  const registry = await openRegistry(memoryStore());
  await registry.install(echoManifest, { enabled: false });
  await assert.rejects(
    registry.setGrants(
      "addon.resonant-echo",
      [networkGrant(true)],
      { consent: true, expectedRevision: 9999 },
    ),
    (error) => error?.code === "ownership-conflict",
  );
});
