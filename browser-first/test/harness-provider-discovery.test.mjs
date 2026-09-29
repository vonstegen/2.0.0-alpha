// Generic Harness Provider Connection discovery: host-owned filtering returns
// only Provider Profiles/models compatible with a harness's declared provider
// families. Metadata only — never a credential, endpoint, or catalog leak.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { discoverCompatibleProviderProfiles } from "../host/harness-provider-discovery.mjs";
import { createHarnessHostService } from "../host/harness-host-service.mjs";

const PROFILES = [
  { id: "p-openai", label: "OpenAI Compatible", providerType: "openai-compatible", models: ["m-openai"], apiBaseUrl: "http://127.0.0.1:1/v1" },
  { id: "p-anthropic", label: "Anthropic", providerType: "anthropic", models: ["m-anthropic"], apiBaseUrl: "http://127.0.0.1:2/v1" },
];
const CATALOG = [
  { model: "m-openai", label: "M OpenAI", providerId: "p-openai" },
  { model: "m-anthropic", label: "M Anthropic", providerId: "p-anthropic" },
];
const SECRET = "secret-canary-0123456789";

test("discovery returns only declared-family profiles/models, metadata only", () => {
  const result = discoverCompatibleProviderProfiles({
    manifest: { harnessProviderConnection: { consumesProviderProfiles: true, providerFamilies: ["openai-compatible"], credentialDelivery: ["runtime-adapter"], modelSelection: true } },
    profiles: PROFILES,
    modelCatalog: CATALOG,
  });
  assert.deepEqual(result.profiles.map((profile) => profile.id), ["p-openai"]);
  assert.deepEqual(result.models.map((model) => model.model), ["m-openai"]);
  assert.ok(!JSON.stringify(result).includes("apiBaseUrl"), "no endpoint/url metadata leaks");
  assert.ok(!JSON.stringify(result).includes("127.0.0.1"));
});

test("incompatible families are filtered out (harness A cannot see harness B's provider)", () => {
  const result = discoverCompatibleProviderProfiles({
    manifest: { harnessProviderConnection: { consumesProviderProfiles: true, providerFamilies: ["anthropic"], credentialDelivery: ["runtime-adapter"], modelSelection: false } },
    profiles: PROFILES,
    modelCatalog: CATALOG,
  });
  assert.deepEqual(result.profiles.map((profile) => profile.id), ["p-anthropic"]);
  assert.deepEqual(result.models.map((model) => model.model), ["m-anthropic"]);
});

test("legacy provider-profile harness with no family declaration leaks nothing", () => {
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
  const binding = { name: "openai.compatible", addonId: "addon.pi-harness", adapterId: "openai-compatible-v1", authScheme: "bearer", source: { providerProfileId: "p-openai" } };
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
    assert.deepEqual(entry.compatibleProviderProfiles.map((profile) => profile.id), ["p-openai"]);
    assert.deepEqual(entry.compatibleModels.map((model) => model.model), ["m-openai"]);
    assert.equal(entry.providerProfileConfigured, true);
    const json = JSON.stringify(snapshot);
    assert.ok(!json.includes(SECRET), "snapshot never exposes the credential");
    assert.ok(!json.includes("127.0.0.1:1"), "snapshot never exposes the endpoint");
  } finally {
    await host.close();
  }
});
