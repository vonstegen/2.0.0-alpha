// Pi native session-credential foundation (P1.1/P1.2/P1.3). Canary secrets
// only. Proves: host-owned identity mapping (unknown fails closed), generic
// session-environment delivery (secret under a host-owned env name, never
// argv/projection), the Pi credential adapter (wrong harness / unknown mapping
// / revoked grant / missing executable or credential all fail closed), and the
// executable allowlist. Runtime-adapter behavior is unchanged and covered by
// the existing harness-provider-adapter.test.mjs suite.
import assert from "node:assert/strict";
import test from "node:test";

import { PI_NATIVE_PROVIDER_MAP, resolvePiNativeProvider } from "../host/pi-native-provider-map.mjs";
import { piCommand } from "../host/pi-runtime.mjs";
import { buildSessionEnvironment, redactEnvironment } from "../host/harness-session-environment.mjs";
import { createPiNativeCredentialAdapter, redactLaunchPlan } from "../host/pi-native-credential-adapter.mjs";

const CREDENTIAL = "pi-native-canary-credential-0123456789abcdef";
const EXECUTABLE = {
  command: "/usr/local/bin/pi",
  canonicalPath: "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
  source: "fixed-system-root",
  validated_by: "piRuntimeAllowlist",
};

const PROFILES = [
  { id: "p-openai", label: "OpenAI", providerType: "openai", models: ["m-openai"] },
  { id: "p-zai", label: "Z.AI GLM", providerType: "openai-compatible", templateId: "zai", models: ["m-zai"] },
  { id: "p-minimax", label: "MiniMax", providerType: "minimax", models: ["m-minimax"] },
  { id: "p-anthropic", label: "Anthropic", providerType: "anthropic", models: ["m-anthropic"] },
  { id: "p-generic", label: "Generic", providerType: "openai-compatible", templateId: "openai-compatible", models: ["m-generic"] },
];
const CATALOG = [
  { model: "m-openai", label: "M OpenAI", providerId: "p-openai" },
  { model: "m-zai", label: "M ZAI", providerId: "p-zai" },
  { model: "m-minimax", label: "M MiniMax", providerId: "p-minimax" },
  { model: "m-anthropic", label: "M Anthropic", providerId: "p-anthropic" },
  { model: "m-generic", label: "M Generic", providerId: "p-generic" },
];

const harness = (overrides = {}) => ({
  harnessProviderConnection: {
    consumesProviderProfiles: true,
    providerProtocols: ["openai-compatible"],
    credentialDelivery: ["session-environment"],
    modelSelection: true,
  },
  ...overrides,
});

function adapter(overrides = {}) {
  return createPiNativeCredentialAdapter({
    resolveExecutable: async () => EXECUTABLE,
    allProviderProfiles: async () => PROFILES,
    allModelCatalog: async () => CATALOG,
    credentialEnv: async ({ providerProfileId }) => (providerProfileId === "p-openai" ? CREDENTIAL : undefined),
    authorize: async () => {},
    envAllowlist: ["LANG"],
    baseEnv: { TERM: "xterm-256color" },
    ...overrides,
  });
}

const planInput = (overrides = {}) => ({
  addonId: "addon.pi-harness",
  manifest: harness(),
  projectPath: "/home/u/project",
  providerProfileId: "p-openai",
  selectedModel: "m-openai",
  ...overrides,
});

test("mapping: proven ROS identities resolve; unknown/unsupported identities fail closed", () => {
  assert.deepEqual(resolvePiNativeProvider({ templateId: "openai" }), { piProvider: "openai", envVar: "OPENAI_API_KEY" });
  assert.deepEqual(resolvePiNativeProvider({ providerType: "minimax" }), { piProvider: "minimax", envVar: "MINIMAX_API_KEY" });
  assert.deepEqual(resolvePiNativeProvider({ providerType: "openai-compatible", templateId: "zai" }), { piProvider: "zai", envVar: "ZAI_API_KEY" });
  assert.deepEqual(resolvePiNativeProvider({ templateId: "xai" }), { piProvider: "xai", envVar: "XAI_API_KEY" });
  assert.deepEqual(resolvePiNativeProvider({ templateId: "openrouter" }), { piProvider: "openrouter", envVar: "OPENROUTER_API_KEY" });
  assert.deepEqual(resolvePiNativeProvider({ templateId: "deepseek" }), { piProvider: "deepseek", envVar: "DEEPSEEK_API_KEY" });
  assert.equal(resolvePiNativeProvider({ providerType: "anthropic" }), null);
  assert.equal(resolvePiNativeProvider({ providerType: "google" }), null);
  assert.equal(resolvePiNativeProvider({ providerType: "openai-compatible", templateId: "openai-compatible" }), null);
  assert.equal(resolvePiNativeProvider({ providerType: "custom" }), null);
  assert.equal(resolvePiNativeProvider(null), null);
  assert.equal(resolvePiNativeProvider({}), null);
});

test("mapping is host-owned: spoofed profile fields cannot rename the env var or provider", () => {
  const spoofed = { templateId: "openai", piProvider: "evil", envVar: "EVIL_API_KEY", providerProtocols: ["whatever"] };
  assert.deepEqual(resolvePiNativeProvider(spoofed), { piProvider: "openai", envVar: "OPENAI_API_KEY" });
  assert.ok(!Object.values(PI_NATIVE_PROVIDER_MAP).some((m) => m.envVar === "EVIL_API_KEY"));
});

test("session env: credential under host-owned name only; base+allowlist only; no blanket passthrough", () => {
  const env = buildSessionEnvironment({
    baseEnv: { TERM: "xterm-256color" },
    envAllowlist: ["LANG"],
    parentEnv: { LANG: "C.UTF-8", PATH: "/usr/bin", SECRET_IN_PARENT: "nope" },
    credentialName: "OPENAI_API_KEY",
    credentialValue: CREDENTIAL,
  });
  assert.equal(env.TERM, "xterm-256color");
  assert.equal(env.LANG, "C.UTF-8");
  assert.equal(env.OPENAI_API_KEY, CREDENTIAL);
  assert.ok(!("PATH" in env), "unapproved parent var is not passed through");
  assert.ok(!("SECRET_IN_PARENT" in env));
  assert.deepEqual(redactEnvironment(env), ["LANG", "OPENAI_API_KEY", "TERM"]);
  assert.ok(!JSON.stringify(redactEnvironment(env)).includes(CREDENTIAL), "redaction is names-only");
});

test("adapter builds a complete launch plan with the secret only in env", async () => {
  const plan = await adapter().plan(planInput());
  assert.equal(plan.providerProfileId, "p-openai");
  assert.equal(plan.providerType, "openai");
  assert.equal(plan.piProvider, "openai");
  assert.equal(plan.envVar, "OPENAI_API_KEY");
  assert.equal(plan.selectedModel, "m-openai");
  assert.equal(plan.credentialMechanism, "session-environment");
  assert.deepEqual(plan.argv, ["--provider", "openai", "--model", "m-openai"]);
  assert.ok(!plan.argv.includes("--api-key"), "secret is never delivered via --api-key");
  assert.equal(plan.env.OPENAI_API_KEY, CREDENTIAL);
  assert.equal(plan.executable.canonicalPath, EXECUTABLE.canonicalPath);
  assert.ok(!JSON.stringify(plan.argv).includes(CREDENTIAL), "argv never carries the credential");
});

test("adapter: unknown mapping fails closed", async () => {
  await assert.rejects(adapter().plan(planInput({ providerProfileId: "p-anthropic", selectedModel: "m-anthropic" })), { code: "permission-denied" });
  await assert.rejects(adapter().plan(planInput({ providerProfileId: "p-generic", selectedModel: "m-generic" })), { code: "permission-denied" });
});

test("adapter: wrong harness fails closed (no session-environment or non-consumer)", async () => {
  const runtimeOnly = harness({ harnessProviderConnection: { consumesProviderProfiles: true, providerProtocols: ["openai-compatible"], credentialDelivery: ["runtime-adapter"], modelSelection: true } });
  await assert.rejects(adapter().plan(planInput({ manifest: runtimeOnly })), { code: "permission-denied" });
  const self = { agentRuntime: { credentialSource: "self" } };
  await assert.rejects(adapter().plan(planInput({ manifest: self, providerProfileId: "p-openai", selectedModel: undefined })), { code: "permission-denied" });
  const legacyNoDelivery = { agentRuntime: { credentialSource: "provider-profile" } };
  await assert.rejects(adapter().plan(planInput({ manifest: legacyNoDelivery })), { code: "permission-denied" });
});

test("adapter: model not belonging to the selected profile is rejected", async () => {
  await assert.rejects(adapter().plan(planInput({ selectedModel: "m-minimax" })), { code: "permission-denied" });
});

test("adapter: revoked grant / failed binding gate fences new launch material", async () => {
  let revoked = false;
  const a = adapter({ authorize: async () => { if (revoked) throw { code: "permission-denied" }; } });
  const plan = await a.plan(planInput());
  assert.ok(plan);
  revoked = true;
  await assert.rejects(a.plan(planInput()), { code: "permission-denied" });
  assert.ok(!JSON.stringify(a).includes(CREDENTIAL));
});

test("adapter: missing executable or credential fails closed with public errors", async () => {
  await assert.rejects(adapter({ resolveExecutable: async () => null }).plan(planInput()), { code: "runtime-unavailable" });
  const missingCredential = adapter({ credentialEnv: async () => undefined });
  await assert.rejects(missingCredential.plan(planInput()), { code: "runtime-unavailable" });
  // Public errors never embed the secret.
  await missingCredential.plan(planInput()).catch((error) => {
    assert.ok(!String(error?.message).includes(CREDENTIAL));
  });
});

test("redaction: secret never reaches projection; env keys are names only; paths redacted", async () => {
  const plan = await adapter().plan(planInput());
  const redacted = redactLaunchPlan(plan, { homeDir: "/home/u" });
  assert.ok(!("env" in redacted), "projection strips the private env");
  assert.deepEqual(redacted.envKeys, ["LANG", "OPENAI_API_KEY", "TERM"]);
  assert.equal(redacted.projectPath, "~/project");
  assert.equal(redacted.executable.command, "/usr/local/bin/pi");
  assert.ok(JSON.stringify(redacted).includes("OPENAI_API_KEY"), "host-owned env NAME is visible");
  assert.ok(!JSON.stringify(redacted).includes(CREDENTIAL), "projection never carries the credential");
});

test("shared-profile peers build independent launch material", async () => {
  const a = adapter();
  const first = await a.plan(planInput());
  const second = await a.plan(planInput());
  assert.notEqual(first.env, second.env, "each plan owns a fresh env object");
  first.env.OPENAI_API_KEY = "tampered";
  assert.equal(second.env.OPENAI_API_KEY, CREDENTIAL, "mutating one plan cannot corrupt a peer");
});

// ---- pi executable allowlist ----
const piOpts = ({ files = {}, real = {}, ...overrides } = {}) => ({
  platform: "linux", homeDir: "/home/u", npmPrefix: "/home/u/npm-global",
  exists: (p) => p in files,
  stat: (p) => files[p],
  realpath: typeof real === "function" ? real : (p) => real[p] ?? p,
  ...overrides,
});
const PI_BIN = "/home/u/npm-global/bin/pi";
const PI_CANON = "/home/u/npm-global/lib/node_modules/pi/dist/cli.js";

test("pi allowlist accepts a canonical path inside the npm-global root", () => {
  const result = piCommand(piOpts({ files: { [PI_BIN]: { isFile: () => true, mode: 0o755 } }, real: { [PI_BIN]: PI_CANON } }));
  assert.ok(result);
  assert.equal(result.source, "npm-global");
  assert.equal(result.validated_by, "piRuntimeAllowlist");
});

test("pi allowlist rejects a canonical path escaping the install root", () => {
  const result = piCommand(piOpts({ files: { [PI_BIN]: { isFile: () => true, mode: 0o755 } }, real: () => "/tmp/evil" }));
  assert.equal(result, null);
});

test("pi allowlist rejects a non-executable candidate and win32", () => {
  assert.equal(piCommand(piOpts({ files: { [PI_BIN]: { isFile: () => true, mode: 0o644 } }, real: { [PI_BIN]: PI_CANON } })), null);
  assert.equal(piCommand(piOpts({ platform: "win32", files: { [PI_BIN]: { isFile: () => true, mode: 0o755 } }, real: { [PI_BIN]: PI_CANON } })), null);
});
