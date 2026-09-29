// Generic Harness Provider Adapter: compatibility + credential-delivery gate is
// host-owned and harness-agnostic. A harness's declared provider families bound
// what it can consume; an incompatible profile, a forged identity, or a missing
// grant fails closed at resolution — never a secret leak. A second (synthetic)
// harness proves the abstraction is not hard-coded to Pi.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { createHarnessProviderAdapter } from "../host/harness-provider-adapter.mjs";
import { createHarnessHostService } from "../host/harness-host-service.mjs";

const PROFILES = [
  { id: "p-openai", label: "OpenAI Compatible", providerType: "openai-compatible", models: ["m-openai"], apiBaseUrl: "http://127.0.0.1:1" },
  { id: "p-anthropic", label: "Anthropic", providerType: "anthropic", models: ["m-anthropic"], apiBaseUrl: "http://127.0.0.1:2" },
];
const CATALOG = [
  { model: "m-openai", label: "M OpenAI", providerId: "p-openai" },
  { model: "m-anthropic", label: "M Anthropic", providerId: "p-anthropic" },
];
const CREDENTIAL = "adapter-canary-credential-0123456789";

function providerHostStub() {
  return {
    allProviderProfiles: async () => PROFILES,
    allModelCatalog: async () => CATALOG,
    executeProviderStatus: async () => ({ providers: [] }),
    executeRawProviderChat: async () => { throw new Error("unused"); },
  };
}
function resolverStub() {
  return async (profileId) => {
    const profile = PROFILES.find((candidate) => candidate.id === profileId);
    if (!profile?.apiBaseUrl) throw new Error("unknown profile");
    return { endpoint: profile.apiBaseUrl, actionToken: CREDENTIAL };
  };
}

const manifestById = async (rel) => JSON.parse(await readFile(new URL(rel, import.meta.url), "utf8"));

test("plan rejects an incompatible provider family (declaration cannot bypass resolver)", async () => {
  const adapter = createHarnessProviderAdapter({ allProviderProfiles: async () => PROFILES, allModelCatalog: async () => CATALOG });
  const manifest = {
    harnessProviderConnection: { consumesProviderProfiles: true, providerFamilies: ["openai-compatible"], credentialDelivery: ["runtime-adapter"], modelSelection: true },
  };
  await assert.rejects(adapter.plan({ manifest, providerProfileId: "p-anthropic" }), { code: "permission-denied" });
  const plan = await adapter.plan({ manifest, providerProfileId: "p-openai", selectedModel: "m-openai" });
  assert.equal(plan.deliveryMechanism, "runtime-adapter");
  assert.equal(plan.providerType, "openai-compatible");
});

test("plan fails closed for a non-consumer harness, unknown profile, and unsupported delivery", async () => {
  const adapter = createHarnessProviderAdapter({ allProviderProfiles: async () => PROFILES, allModelCatalog: async () => CATALOG });
  await assert.rejects(adapter.plan({ manifest: {}, providerProfileId: "p-openai" }), { code: "permission-denied" });
  await assert.rejects(adapter.plan({ manifest: { harnessProviderConnection: { consumesProviderProfiles: true, providerFamilies: ["openai-compatible"], credentialDelivery: ["runtime-adapter"] } }, providerProfileId: "p-missing" }), { code: "permission-denied" });
  await assert.rejects(adapter.plan({ manifest: { harnessProviderConnection: { consumesProviderProfiles: true, providerFamilies: ["openai-compatible"], credentialDelivery: ["session-environment"] } }, providerProfileId: "p-openai" }), { code: "permission-denied" });
});

test("a second (synthetic) harness family resolves through the same generic path as Pi", async () => {
  const pi = await manifestById("../../examples/addons/pi-harness.json");
  // Harmless synthetic harness: same reviewed openai-compatible-v1 adapter,
  // but declares the anthropic family only. Proves discovery + adapter are not
  // hard-coded to Pi or to one provider family.
  const synthetic = structuredClone(pi);
  synthetic.id = "addon.synthetic-anthropic";
  synthetic.name = "Synthetic Anthropic Harness";
  synthetic.agentRuntime.credentialBinding = "anthropic.main";
  synthetic.harnessProviderConnection = { consumesProviderProfiles: true, providerFamilies: ["anthropic"], credentialDelivery: ["runtime-adapter"], modelSelection: true };

  const binding = { name: "anthropic.main", addonId: "addon.synthetic-anthropic", adapterId: "openai-compatible-v1", authScheme: "bearer", source: { providerProfileId: "p-anthropic" } };
  let stored = null;
  const host = await createHarnessHostService({
    env: {},
    store: { read: async () => stored, write: async (value) => { stored = structuredClone(value); } },
    providerHost: providerHostStub(),
    resolveProviderProfileCredential: resolverStub(),
    bindings: [binding],
  });
  try {
    await host.registry.install(synthetic, { enabled: true });
    const route = host.registry; // grants path: same as Pi
    await host.registry.setGrants(synthetic.id, synthetic.requestedCapabilities.map((g) => ({ ...g, granted: true })), { consent: true, expectedRevision: host.registry.snapshot().revision });
    await host.registry.assignSlot("primary-agent", synthetic.id, { expectedGeneration: 0 });

    const snapshot = await host.harnessRoutes.find((r) => r.path === "/addons/registry").handler({}, { url: "http://127.0.0.1/addons/registry" });
    const entry = snapshot.installations[synthetic.id];
    assert.deepEqual(entry.compatibleProviderProfiles.map((profile) => profile.id), ["p-anthropic"]);
    // The synthetic harness must not see Pi's openai-compatible family.
    assert.ok(!entry.compatibleProviderProfiles.some((profile) => profile.providerType === "openai-compatible"));

    // Session resolution passes the same adapter gate (compatible family).
    const session = await host.boundary.createSession({ addonId: synthetic.id });
    await host.boundary.dispose(session);
    assert.ok(!JSON.stringify(snapshot).includes(CREDENTIAL), "no credential in projection");
  } finally {
    await host.close();
  }
});

test("incompatible declaration is rejected at resolution, not just discovery", async () => {
  const pi = await manifestById("../../examples/addons/pi-harness.json");
  // Pi declares openai-compatible, but the host binding maps it to an
  // anthropic profile: the adapter gate must refuse to resolve it.
  const binding = { name: "openai.compatible", addonId: "addon.pi-harness", adapterId: "openai-compatible-v1", authScheme: "bearer", source: { providerProfileId: "p-anthropic" } };
  let stored = null;
  const host = await createHarnessHostService({
    env: {},
    store: { read: async () => stored, write: async (value) => { stored = structuredClone(value); } },
    providerHost: providerHostStub(),
    resolveProviderProfileCredential: resolverStub(),
    bindings: [binding],
  });
  try {
    await host.registry.install(pi, { enabled: true });
    await host.registry.setGrants(pi.id, pi.requestedCapabilities.map((g) => ({ ...g, granted: true })), { consent: true, expectedRevision: host.registry.snapshot().revision });
    await host.registry.assignSlot("primary-agent", pi.id, { expectedGeneration: 0 });
    await assert.rejects(host.boundary.createSession({ addonId: pi.id }), { code: "permission-denied" });
  } finally {
    await host.close();
  }
});

test("forged harness identity cannot resolve another harness's provider authority", async () => {
  const pi = await manifestById("../../examples/addons/pi-harness.json");
  // Binding belongs to a different add-on; Pi's provider-profile manifest must
  // not install at all (authority is host-owned, never manifest-owned).
  const binding = { name: "openai.compatible", addonId: "addon.other-harness", adapterId: "openai-compatible-v1", authScheme: "bearer", source: { providerProfileId: "p-openai" } };
  let stored = null;
  const host = await createHarnessHostService({
    env: {},
    store: { read: async () => stored, write: async (value) => { stored = structuredClone(value); } },
    providerHost: providerHostStub(),
    resolveProviderProfileCredential: resolverStub(),
    bindings: [binding],
  });
  try {
    await assert.rejects(host.registry.install(pi, { enabled: true }), { code: "permission-denied" });
  } finally {
    await host.close();
  }
});
