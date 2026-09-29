// Generic Harness Provider Adapter: compatibility + credential-delivery gate is
// host-owned and harness-agnostic. A harness's declared providerProtocols bound
// what it can consume; the adapter re-derives the selected profile's protocol
// at resolution (deriveProviderProtocol) and fails closed for incompatible,
// spoofed, or null-derived profiles.
import assert from "node:assert/strict";
import test from "node:test";

import { createHarnessProviderAdapter } from "../host/harness-provider-adapter.mjs";
import { createHarnessHostService } from "../host/harness-host-service.mjs";

const PROFILES = [
  { id: "p-openai", label: "OpenAI", providerType: "openai", models: ["m-openai"], apiBaseUrl: "http://127.0.0.1:1" },
  { id: "p-zai", label: "Z.AI GLM", providerType: "openai-compatible", models: ["m-zai"], apiBaseUrl: "http://127.0.0.1:2" },
  { id: "p-minimax", label: "MiniMax", providerType: "minimax", models: ["m-minimax"], apiBaseUrl: "http://127.0.0.1:3" },
  { id: "p-local", label: "Local Ollama", providerType: "local", models: ["m-local"], apiBaseUrl: "http://127.0.0.1:4" },
  { id: "p-anthropic", label: "Anthropic", providerType: "anthropic", models: ["m-anthropic"], apiBaseUrl: "http://127.0.0.1:5" },
];
const CATALOG = [
  { model: "m-openai", label: "M OpenAI", providerId: "p-openai" },
  { model: "m-zai", label: "M ZAI", providerId: "p-zai" },
  { model: "m-minimax", label: "M MiniMax", providerId: "p-minimax" },
  { model: "m-local", label: "M Local", providerId: "p-local" },
  { model: "m-anthropic", label: "M Anthropic", providerId: "p-anthropic" },
];
const CREDENTIAL = "adapter-canary-credential-0123456789";

// Minimal valid manifest matching pi-harness.json schema + validation requirements
const createPiManifest = () => ({
  id: "addon.pi-harness",
  name: "Pi Harness",
  version: "0.1.0",
  author: "Test Author",
  sdkVersion: "0.1.0",
  description: "Provider-profile harness example.",
  runtimeType: "local-service",
  surfaces: [
    { id: "pi-surface", type: "tool-panel", label: "Pi", icon: "pi", description: "Pi", requiredCapabilities: ["agent-runtime"] }
  ],
  requestedCapabilities: [
    { capability: "agent-runtime", granted: false, scope: "system", revocationBehavior: "hard-stop" }
  ],
  systemSlots: [
    { id: "primary-agent", role: "alternative-provider", replaceable: true }
  ],
  tools: [
    { name: "harness.invoke", description: "invoke", requiredCapabilities: ["agent-runtime"], inputSchema: { type: "object" }, outputSchema: { type: "object" }, audit: { artifactTypes: [] } }
  ],
  agentRuntime: {
    invocationTool: "harness.invoke",
    displayNameSource: "manifest",
    chatAuthorLabel: "Pi",
    supportsStreaming: false,
    supportsCancellation: true,
    supportsModelSelection: true,
    outputFiltering: "assistant-reply-only",
    requiredCapabilities: ["agent-runtime"],
    adapterVersion: 1,
    adapterId: "openai-compatible-v1",
    authScheme: "bearer",
    supportedOperations: ["createSession", "invoke", "cancel", "selectModel"],
    contextRoleFidelity: "structured-messages",
    toolCallbacks: false,
    credentialBinding: "openai.compatible",
    modelSelection: {
      source: "runtime-audit",
      currentModelField: "currentModel",
      selectable: true,
      requiredCapabilities: ["agent-runtime"]
    },
    credentialSource: "provider-profile"
  },
  harnessProviderConnection: {
    consumesProviderProfiles: true,
    providerProtocols: ["openai-compatible"],
    credentialDelivery: ["runtime-adapter"],
    modelSelection: true
  },
  providerRequirements: {
    sharedProfiles: [],
    supportsPrivateCredentials: false
  },
  archiveIntegration: {
    readScopes: [],
    intakeWriteScopes: [],
    canRequestIngest: false,
    canWriteKnowledgePages: false
  },
  health: {
    strategy: "host-command-ready"
  },
  installHooks: {},
  compatibility: {
    shellVersion: "^0.1.0",
    platforms: ["linux", "macOS", "windows"]
  },
  classification: { category: "harness", subtype: "testing" }
});

const piManifest = createPiManifest();

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

test("CP-C4: two distinct openai-compatible profiles both resolve through the same path", async () => {
  const adapter = createHarnessProviderAdapter({ allProviderProfiles: async () => PROFILES, allModelCatalog: async () => CATALOG });
  const manifest = { harnessProviderConnection: { consumesProviderProfiles: true, providerProtocols: ["openai-compatible"], credentialDelivery: ["runtime-adapter"], modelSelection: true } };
  const planOpenai = await adapter.plan({ manifest, providerProfileId: "p-openai", selectedModel: "m-openai" });
  const planZai = await adapter.plan({ manifest, providerProfileId: "p-zai", selectedModel: "m-zai" });
  assert.equal(planOpenai.deliveryMechanism, "runtime-adapter");
  assert.equal(planOpenai.providerProtocol, "openai-compatible");
  assert.equal(planZai.deliveryMechanism, "runtime-adapter");
  assert.equal(planZai.providerProtocol, "openai-compatible");
  assert.equal(planOpenai.providerType, "openai");
  assert.equal(planZai.providerType, "openai-compatible");
});

test("CP-C5: incompatible protocol (minimax) is rejected at resolution", async () => {
  const adapter = createHarnessProviderAdapter({ allProviderProfiles: async () => PROFILES, allModelCatalog: async () => CATALOG });
  const manifest = { harnessProviderConnection: { consumesProviderProfiles: true, providerProtocols: ["openai-compatible"], credentialDelivery: ["runtime-adapter"], modelSelection: true } };
  await assert.rejects(adapter.plan({ manifest, providerProfileId: "p-minimax" }), { code: "permission-denied" });
});

test("plan rejects unsupported (null-derived) providerType at resolution", async () => {
  const adapter = createHarnessProviderAdapter({ allProviderProfiles: async () => PROFILES, allModelCatalog: async () => CATALOG });
  const manifest = { harnessProviderConnection: { consumesProviderProfiles: true, providerProtocols: ["openai-compatible"], credentialDelivery: ["runtime-adapter"], modelSelection: true } };
  await assert.rejects(adapter.plan({ manifest, providerProfileId: "p-anthropic" }), { code: "permission-denied" });
});

test("plan fails closed for a non-consumer harness, unknown profile, and unsupported delivery", async () => {
  const adapter = createHarnessProviderAdapter({ allProviderProfiles: async () => PROFILES, allModelCatalog: async () => CATALOG });
  await assert.rejects(adapter.plan({ manifest: {}, providerProfileId: "p-openai" }), { code: "permission-denied" });
  await assert.rejects(adapter.plan({ manifest: { harnessProviderConnection: { consumesProviderProfiles: true, providerProtocols: ["openai-compatible"], credentialDelivery: ["runtime-adapter"] } }, providerProfileId: "p-missing" }), { code: "permission-denied" });
  await assert.rejects(adapter.plan({ manifest: { harnessProviderConnection: { consumesProviderProfiles: true, providerProtocols: ["openai-compatible"], credentialDelivery: ["session-environment"] } }, providerProfileId: "p-openai" }), { code: "permission-denied" });
});

test("model not belonging to selected profile is rejected", async () => {
  const adapter = createHarnessProviderAdapter({ allProviderProfiles: async () => PROFILES, allModelCatalog: async () => CATALOG });
  const manifest = { harnessProviderConnection: { consumesProviderProfiles: true, providerProtocols: ["openai-compatible"], credentialDelivery: ["runtime-adapter"], modelSelection: true } };
  await assert.rejects(adapter.plan({ manifest, providerProfileId: "p-openai", selectedModel: "m-local" }), { code: "permission-denied" });
});

test("a second (synthetic) harness family resolves through the same generic path as Pi", async () => {
  const synthetic = JSON.parse(JSON.stringify(piManifest));
  synthetic.id = "addon.synthetic-minimax";
  synthetic.name = "Synthetic Minimax Harness";
  synthetic.harnessProviderConnection.providerProtocols = ["minimax-compatible"];
  synthetic.agentRuntime.credentialBinding = "minimax.main";

  const binding = { name: "minimax.main", addonId: "addon.synthetic-minimax", adapterId: "openai-compatible-v1", authScheme: "bearer", source: { providerProfileId: "p-minimax" } };
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
    await host.registry.setGrants(synthetic.id, synthetic.requestedCapabilities.map((g) => ({ ...g, granted: true })), { consent: true, expectedRevision: host.registry.snapshot().revision });
    await host.registry.assignSlot("primary-agent", synthetic.id, { expectedGeneration: 0 });

    const snapshot = await host.harnessRoutes.find((r) => r.path === "/addons/registry").handler({}, { url: "http://127.0.0.1/addons/registry" });
    const entry = snapshot.installations[synthetic.id];
    assert.deepEqual(entry.compatibleProviderProfiles.map((profile) => profile.id), ["p-minimax"]);
    assert.ok(!entry.compatibleProviderProfiles.some((profile) => profile.providerType === "openai"));
    assert.ok(!entry.compatibleProviderProfiles.some((profile) => profile.providerType === "anthropic"));

    const session = await host.boundary.createSession({ addonId: synthetic.id });
    await host.boundary.dispose(session);
    assert.ok(!JSON.stringify(snapshot).includes(CREDENTIAL), "no credential in projection");
  } finally {
    await host.close();
  }
});

test("incompatible declaration is rejected at resolution, not just discovery", async () => {
  const binding = { name: "openai.compatible", addonId: "addon.pi-harness", adapterId: "openai-compatible-v1", authScheme: "bearer", source: { providerProfileId: "p-minimax" } };
  let stored = null;
  const host = await createHarnessHostService({
    env: {},
    store: { read: async () => stored, write: async (value) => { stored = structuredClone(value); } },
    providerHost: providerHostStub(),
    resolveProviderProfileCredential: resolverStub(),
    bindings: [binding],
  });
  try {
    await host.registry.install(piManifest, { enabled: true });
    await host.registry.setGrants(piManifest.id, piManifest.requestedCapabilities.map((g) => ({ ...g, granted: true })), { consent: true, expectedRevision: host.registry.snapshot().revision });
    await host.registry.assignSlot("primary-agent", piManifest.id, { expectedGeneration: 0 });
    await assert.rejects(host.boundary.createSession({ addonId: piManifest.id }), { code: "permission-denied" });
  } finally {
    await host.close();
  }
});

test("spoofed profile protocol metadata cannot bypass adapter resolution", async () => {
  const adapter = createHarnessProviderAdapter({ allProviderProfiles: async () => PROFILES, allModelCatalog: async () => CATALOG });
  const manifest = { harnessProviderConnection: { consumesProviderProfiles: true, providerProtocols: ["openai-compatible"], credentialDelivery: ["runtime-adapter"], modelSelection: true } };
  const adapterWithSpoofedProfile = createHarnessProviderAdapter({
    allProviderProfiles: async () => [
      ...PROFILES.filter(p => p.id !== "p-minimax"),
      { ...PROFILES.find(p => p.id === "p-minimax"), providerProtocols: ["openai-compatible"] }
    ],
    allModelCatalog: async () => CATALOG,
  });
  await assert.rejects(adapterWithSpoofedProfile.plan({ manifest, providerProfileId: "p-minimax" }), { code: "permission-denied" });
});

test("forged harness identity cannot resolve another harness's provider authority", async () => {
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
    await assert.rejects(host.registry.install(piManifest, { enabled: true }), { code: "permission-denied" });
  } finally {
    await host.close();
  }
});
