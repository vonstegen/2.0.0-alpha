// Generic Harness Provider Connection discovery: host-owned filtering returns
// only Provider Profiles/models whose host-derived protocol
// (deriveProviderProtocol) is in the harness's declared providerProtocols.
// Metadata only — never a credential, endpoint, or catalog leak.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { discoverCompatibleProviderProfiles } from "../host/harness-provider-discovery.mjs";
import { createHarnessHostService } from "../host/harness-host-service.mjs";

const PROFILES = [
  { id: "p-openai", label: "OpenAI", providerType: "openai", models: ["m-openai"], apiBaseUrl: "http://127.0.0.1:1/v1" },
  { id: "p-zai", label: "Z.AI GLM", providerType: "openai-compatible", models: ["m-zai"], apiBaseUrl: "http://127.0.0.1:2/v1" },
  { id: "p-minimax", label: "MiniMax", providerType: "minimax", models: ["m-minimax"], apiBaseUrl: "http://127.0.0.1:3/v1" },
  { id: "p-local", label: "Local Ollama", providerType: "local", models: ["m-local"], apiBaseUrl: "http://127.0.0.1:4/v1" },
  { id: "p-anthropic", label: "Anthropic", providerType: "anthropic", models: ["m-anthropic"], apiBaseUrl: "http://127.0.0.1:5/v1" },
];
const CATALOG = [
  { model: "m-openai", label: "M OpenAI", providerId: "p-openai" },
  { model: "m-zai", label: "M ZAI", providerId: "p-zai" },
  { model: "m-minimax", label: "M MiniMax", providerId: "p-minimax" },
  { model: "m-local", label: "M Local", providerId: "p-local" },
  { model: "m-anthropic", label: "M Anthropic", providerId: "p-anthropic" },
];
const SECRET = "secret-canary-0123456789";
const openaiManifest = () => ({ harnessProviderConnection: { consumesProviderProfiles: true, providerProtocols: ["openai-compatible"], credentialDelivery: ["runtime-adapter"], modelSelection: true } });

test("CP-C4: two distinct provider identities deriving to openai-compatible are both discoverable", () => {
  const result = discoverCompatibleProviderProfiles({ manifest: openaiManifest(), profiles: PROFILES, modelCatalog: CATALOG });
  assert.deepEqual(result.profiles.map((profile) => profile.id).sort(), ["p-openai", "p-zai"]);
  assert.deepEqual(result.profiles.map((profile) => profile.providerProtocol), ["openai-compatible", "openai-compatible"]);
  assert.deepEqual(result.models.map((model) => model.model).sort(), ["m-openai", "m-zai"]);
});

test("CP-C5: openai-compatible discovery excludes minimax-compatible, ollama, and unsupported profiles", () => {
  const result = discoverCompatibleProviderProfiles({ manifest: openaiManifest(), profiles: PROFILES, modelCatalog: CATALOG });
  const visible = new Set(result.profiles.map((profile) => profile.id));
  assert.ok(!visible.has("p-minimax"), "minimax-compatible profile must not be discoverable");
  assert.ok(!visible.has("p-local"), "ollama profile must not be discoverable");
  assert.ok(!visible.has("p-anthropic"), "unsupported (null-derived) profile must not be discoverable");
});

test("CP-C5: synthetic minimax-compatible harness sees only minimax profiles", () => {
  const result = discoverCompatibleProviderProfiles({
    manifest: { harnessProviderConnection: { consumesProviderProfiles: true, providerProtocols: ["minimax-compatible"], credentialDelivery: ["runtime-adapter"], modelSelection: false } },
    profiles: PROFILES,
    modelCatalog: CATALOG,
  });
  assert.deepEqual(result.profiles.map((profile) => profile.id), ["p-minimax"]);
  assert.deepEqual(result.models.map((model) => model.model), ["m-minimax"]);
});

test("CP-C5: synthetic ollama harness sees only local profiles", () => {
  const result = discoverCompatibleProviderProfiles({
    manifest: { harnessProviderConnection: { consumesProviderProfiles: true, providerProtocols: ["ollama"], credentialDelivery: ["runtime-adapter"], modelSelection: false } },
    profiles: PROFILES,
    modelCatalog: CATALOG,
  });
  assert.deepEqual(result.profiles.map((profile) => profile.id), ["p-local"]);
  assert.deepEqual(result.models.map((model) => model.model), ["m-local"]);
});

test("spoofed profile protocol metadata cannot override host derivation", () => {
  // The manifest is openai-compatible; the minimax profile carries a spoofed
  // providerProtocols field. Only providerType (minimax -> minimax-compatible)
  // is authoritative, so it must remain undiscoverable.
  const spoofed = [{ ...PROFILES.find((profile) => profile.id === "p-minimax"), providerProtocols: ["openai-compatible"] }];
  const result = discoverCompatibleProviderProfiles({ manifest: openaiManifest(), profiles: spoofed, modelCatalog: [] });
  assert.deepEqual(result.profiles, []);
});

test("discovery projection is metadata-only (no endpoint/credential/secret)", () => {
  const result = discoverCompatibleProviderProfiles({ manifest: openaiManifest(), profiles: PROFILES, modelCatalog: CATALOG });
  const json = JSON.stringify(result);
  assert.ok(!json.includes("apiBaseUrl"), "no endpoint/url metadata leaks");
  assert.ok(!json.includes("127.0.0.1"));
  for (const profile of result.profiles) {
    assert.deepEqual(Object.keys(profile).sort(), ["id", "label", "models", "providerProtocol", "providerType"]);
  }
});

test("legacy provider-profile harness with no protocol declaration leaks nothing", () => {
  const result = discoverCompatibleProviderProfiles({
    manifest: { agentRuntime: { credentialSource: "provider-profile" } },
    profiles: PROFILES,
    modelCatalog: CATALOG,
  });
  assert.equal(result.consumesProviderProfiles, true);
  assert.deepEqual(result.profiles, []);
  assert.deepEqual(result.models, []);
});

test("non-provider harness yields empty discovery", () => {
  const result = discoverCompatibleProviderProfiles({ manifest: {}, profiles: PROFILES, modelCatalog: CATALOG });
  assert.equal(result.consumesProviderProfiles, false);
  assert.deepEqual(result.profiles, []);
  assert.deepEqual(result.models, []);
});

test("host snapshot surfaces compatible metadata for an authorized provider-profile harness", async () => {
  const providerHost = { allProviderProfiles: async () => PROFILES, allModelCatalog: async () => CATALOG };
  const binding = { name: "pi.native", addonId: "addon.pi-harness", adapterId: "pi-native-v1", authScheme: "session-environment", source: { providerProfileId: "p-openai" } };
  const resolveProviderProfileCredential = async () => ({ endpoint: "http://127.0.0.1:1/v1", actionToken: SECRET });
  let stored = null;
  const host = await createHarnessHostService({
    env: {},
    store: { read: async () => stored, write: async (value) => { stored = structuredClone(value); } },
    providerHost,
    resolveProviderProfileCredential,
    bindings: [binding],
  });
  try {
    const pi = JSON.parse(await readFile(new URL("../../examples/addons/pi-harness.json", import.meta.url), "utf8"));
    await host.registry.install(pi, { enabled: true });
    const route = host.harnessRoutes.find((entry) => entry.path === "/addons/registry");
    const snapshot = await route.handler({}, { url: "http://127.0.0.1/addons/registry" });
    const entry = snapshot.installations["addon.pi-harness"];
    assert.ok(entry, "Pi installation present in registry snapshot");
    // The native Pi harness declares every protocol family the Pi CLI speaks:
    // openai-compatible, minimax-compatible, and ollama.
    assert.deepEqual(entry.compatibleProviderProfiles.map((profile) => profile.id).sort(), ["p-local", "p-minimax", "p-openai", "p-zai"]);
    assert.deepEqual(entry.compatibleModels.map((model) => model.model).sort(), ["m-local", "m-minimax", "m-openai", "m-zai"]);
    assert.equal(entry.providerProfileConfigured, true);
    const json = JSON.stringify(snapshot);
    assert.ok(!json.includes(SECRET), "snapshot never exposes the credential");
    assert.ok(!json.includes("127.0.0.1:1"), "snapshot never exposes the endpoint");
  } finally {
    await host.close();
  }
});
