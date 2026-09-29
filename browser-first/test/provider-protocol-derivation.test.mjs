// Host-owned provider protocol derivation. deriveProviderProtocol maps a profile's
// authoritative providerType to a canonical protocol family, mirroring the host
// execution adapters (cloud-openai-compatible, cloud-minimax-compatible,
// local-ollama). A harness/manifest-supplied field can never override the host
// mapping, and no credential or endpoint is read or returned.
import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveProviderProtocol,
  PROVIDER_PROTOCOL_BY_TYPE,
} from "../host/provider-fabric-core.mjs";

test("known provider types map to their host execution-adapter protocol family", () => {
  assert.equal(deriveProviderProtocol({ providerType: "openai" }), "openai-compatible");
  assert.equal(deriveProviderProtocol({ providerType: "openai-compatible" }), "openai-compatible");
  assert.equal(deriveProviderProtocol({ providerType: "minimax" }), "minimax-compatible");
  assert.equal(deriveProviderProtocol({ providerType: "local" }), "ollama");
});

test("two distinct provider identities/types map to the same protocol family", () => {
  // openai and openai-compatible are served by the single cloud-openai-compatible
  // host adapter, so they truthfully share one protocol family.
  const openai = { id: "shared-openai", providerType: "openai" };
  const zai = { id: "shared-zai-glm", providerType: "openai-compatible" };
  assert.equal(deriveProviderProtocol(openai), "openai-compatible");
  assert.equal(deriveProviderProtocol(zai), "openai-compatible");
  assert.equal(deriveProviderProtocol(openai), deriveProviderProtocol(zai));
});

test("incompatible protocol families stay distinct", () => {
  // minimax and local have their own host adapters; they must not collapse into
  // openai-compatible.
  assert.equal(deriveProviderProtocol({ providerType: "minimax" }), "minimax-compatible");
  assert.notEqual(
    deriveProviderProtocol({ providerType: "minimax" }),
    deriveProviderProtocol({ providerType: "openai" }),
  );
  assert.equal(deriveProviderProtocol({ providerType: "local" }), "ollama");
  assert.notEqual(
    deriveProviderProtocol({ providerType: "local" }),
    deriveProviderProtocol({ providerType: "openai-compatible" }),
  );
});

test("adapter-pending and unknown types fail closed to null", () => {
  assert.equal(deriveProviderProtocol({ providerType: "anthropic" }), null);
  assert.equal(deriveProviderProtocol({ providerType: "google" }), null);
  assert.equal(deriveProviderProtocol({ providerType: "custom" }), null);
  assert.equal(deriveProviderProtocol({ providerType: "unknown-vendor" }), null);
  assert.equal(deriveProviderProtocol({ providerType: "" }), null);
  assert.equal(deriveProviderProtocol({ providerType: undefined }), null);
  assert.equal(deriveProviderProtocol({}), null);
  assert.equal(deriveProviderProtocol(null), null);
  assert.equal(deriveProviderProtocol(undefined), null);
  assert.equal(deriveProviderProtocol("openai"), null);
});

test("harness/add-on supplied metadata cannot override host derivation", () => {
  // A spoofed protocolFamily/providerProtocols/endpoint field on the profile object
  // is ignored: only the authoritative providerType is read.
  const spoofed = {
    providerType: "openai",
    protocolFamily: "anthropic",
    providerProtocols: ["anthropic"],
    apiBaseUrl: "http://127.0.0.1:1/v1",
  };
  assert.equal(deriveProviderProtocol(spoofed), "openai-compatible");
  assert.equal(deriveProviderProtocol({ providerType: "local", protocolFamily: "openai-compatible" }), "ollama");
});

test("derivation returns only a protocol string, never a profile/secret projection", () => {
  const profile = {
    providerType: "openai",
    apiBaseUrl: "http://127.0.0.1:1/v1",
    apiKey: "secret-canary-0123456789",
    credential: { token: "secret-canary-0123456789" },
  };
  const result = deriveProviderProtocol(profile);
  assert.equal(typeof result, "string");
  assert.equal(result, "openai-compatible");
});

test("protocol map contains only host-execution-adapter-backed families", () => {
  assert.deepEqual(
    Object.keys(PROVIDER_PROTOCOL_BY_TYPE).sort(),
    ["local", "minimax", "openai", "openai-compatible"],
  );
  assert.deepEqual(
    [...new Set(Object.values(PROVIDER_PROTOCOL_BY_TYPE))].sort(),
    ["minimax-compatible", "ollama", "openai-compatible"],
  );
});
