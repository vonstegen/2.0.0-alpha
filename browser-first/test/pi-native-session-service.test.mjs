// Host wiring (P2-A): the native Pi session service composes the reviewed
// planner with the launcher. Proves the private plan flows host -> planner ->
// launcher, that the credential enters only the private session env, and that
// only the redacted projection (no env, no secret) crosses the boundary.
import assert from "node:assert/strict";
import test from "node:test";

import { createPiNativeSessionService } from "../host/pi-native-session-service.mjs";

const CREDENTIAL = "pi-native-service-canary-0123456789abcdef";
const EXECUTABLE = {
  command: "/usr/local/bin/pi",
  canonicalPath: "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
  source: "fixed-system-root",
  validated_by: "piRuntimeAllowlist",
};

const PROFILES = [
  { id: "openrouter-account", label: "OpenRouter", providerType: "openai-compatible", templateId: "openrouter", models: ["openai/gpt-5.5"] },
  { id: "p-openai", label: "OpenAI", providerType: "openai", models: ["gpt-5.5"] },
];
const CATALOG = [
  { model: "openai/gpt-5.5", label: "GPT 5.5", providerId: "openrouter-account" },
  { model: "gpt-5.5", label: "GPT 5.5", providerId: "p-openai" },
];

const harness = () => ({
  harnessProviderConnection: {
    consumesProviderProfiles: true,
    providerProtocols: ["openai-compatible"],
    credentialDelivery: ["session-environment"],
    modelSelection: true,
  },
});

function service(overrides = {}) {
  const captured = [];
  const providerHost = {
    allProviderProfiles: async () => PROFILES,
    allModelCatalog: async () => CATALOG,
  };
  const resolveProviderProfileCredential = async (providerProfileId) => {
    if (providerProfileId !== "openrouter-account") throw new Error("unknown");
    return { endpoint: "https://openrouter.ai/api/v1", actionToken: CREDENTIAL };
  };
  return {
    captured,
    service: createPiNativeSessionService({
      providerHost,
      resolveProviderProfileCredential,
      authorize: async () => {},
      projectPath: "/home/u/project",
      resolveExecutable: async () => EXECUTABLE,
      homeDir: "/home/u",
      launcher: {
        async launch(plan, { prompt }) {
          captured.push({ plan, prompt });
          return { exitCode: 0, signal: null, timedOut: false, stdout: "ROS_PI_NATIVE_CREDENTIAL_PROOF_OK", stderr: "", durationMs: 12 };
        },
      },
      ...overrides,
    }),
  };
}

test("createLaunchPlan resolves the private plan with the secret only in env", async () => {
  const { service: svc } = service();
  const plan = await svc.createLaunchPlan({
    addonId: "addon.pi-harness",
    manifest: harness(),
    providerProfileId: "openrouter-account",
    selectedModel: "openai/gpt-5.5",
  });
  assert.equal(plan.piProvider, "openrouter");
  assert.equal(plan.envVar, "OPENROUTER_API_KEY");
  assert.equal(plan.env.OPENROUTER_API_KEY, CREDENTIAL);
  assert.equal(plan.credentialMechanism, "session-environment");
  assert.deepEqual(plan.argv, ["--provider", "openrouter", "--model", "openai/gpt-5.5"]);
  assert.ok(!JSON.stringify(plan.argv).includes(CREDENTIAL));
  assert.equal(plan.projectPath, "/home/u/project");
});

test("launchProof flows the private plan to the launcher and returns only redacted evidence", async () => {
  const { captured, service: svc } = service();
  const result = await svc.launchProof({
    addonId: "addon.pi-harness",
    manifest: harness(),
    providerProfileId: "openrouter-account",
    selectedModel: "openai/gpt-5.5",
    prompt: "proof",
  });
  // The launcher received the private plan (with the credential), in-process only.
  assert.equal(captured.length, 1);
  assert.equal(captured[0].plan.env.OPENROUTER_API_KEY, CREDENTIAL);
  assert.equal(captured[0].prompt, "proof");
  // The returned projection strips the env and never carries the credential.
  assert.ok(!("env" in result.projection));
  assert.deepEqual(result.projection.envKeys, ["OPENROUTER_API_KEY"]);
  assert.ok(!JSON.stringify(result).includes(CREDENTIAL));
  assert.equal(result.evidence.stdout, "ROS_PI_NATIVE_CREDENTIAL_PROOF_OK");
});

test("redact() emits env key names only and redacts paths", async () => {
  const { service: svc } = service();
  const plan = await svc.createLaunchPlan({
    addonId: "addon.pi-harness",
    manifest: harness(),
    providerProfileId: "openrouter-account",
    selectedModel: "openai/gpt-5.5",
  });
  const projection = svc.redact(plan);
  assert.ok(!("env" in projection));
  assert.deepEqual(projection.envKeys, ["OPENROUTER_API_KEY"]);
  assert.equal(projection.projectPath, "~/project");
  assert.ok(!JSON.stringify(projection).includes(CREDENTIAL));
});

test("authorize gate fences new launch material after revocation", async () => {
  let revoked = false;
  const { service: svc } = service({
    authorize: async () => { if (revoked) throw { code: "permission-denied" }; },
  });
  const first = await svc.launchProof({ addonId: "addon.pi-harness", manifest: harness(), providerProfileId: "openrouter-account", selectedModel: "openai/gpt-5.5", prompt: "proof" });
  assert.ok(first.projection);
  revoked = true;
  await assert.rejects(svc.launchProof({ addonId: "addon.pi-harness", manifest: harness(), providerProfileId: "openrouter-account", selectedModel: "openai/gpt-5.5", prompt: "proof" }), { code: "permission-denied" });
});

test("credential resolver miss fails closed without leaking the secret", async () => {
  const providerHost = {
    allProviderProfiles: async () => PROFILES,
    allModelCatalog: async () => CATALOG,
  };
  const svc = createPiNativeSessionService({
    providerHost,
    resolveProviderProfileCredential: async () => { throw new Error("not configured"); },
    authorize: async () => {},
    projectPath: "/home/u/project",
    resolveExecutable: async () => EXECUTABLE,
  });
  await assert.rejects(svc.launchProof({ addonId: "addon.pi-harness", manifest: harness(), providerProfileId: "openrouter-account", selectedModel: "openai/gpt-5.5", prompt: "proof" }), { code: "runtime-unavailable" });
});
