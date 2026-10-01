// Host wiring (testing phase): the native Pi session service composes the
// reviewed planner with the launcher. Proves the private plan flows host ->
// planner -> launcher, that the session cwd comes ONLY from the host-wired
// projection consumer (never a caller path), that the credential enters only
// the private session env, and that only the redacted projection (no env, no
// secret) crosses the boundary.
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

const PROJECT_ROOT = "/home/u/project";
const SESSION_ID = "session-1";
// Minimal authorized Project/Files projection (cwd = the projected root). The
// real host wires this to createHarnessResourceProjection().consume().
const projectionFor = (sessionId) => Object.freeze({
  addonId: "addon.pi-harness",
  sessionId,
  project: Object.freeze({ id: "project-a", label: "Project A" }),
  root: PROJECT_ROOT,
  cwd: PROJECT_ROOT,
  operations: Object.freeze([{ family: "project", operation: "read" }]),
});

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
      // The launch cwd must come from the host-wired consumer re-validating the
      // projection against the current addonId + sessionId binding.
      consumeProjection: async (projection, { addonId, sessionId }) => {
        if (!projection || typeof projection !== "object") return { ok: false, code: "projection-identity-mismatch" };
        if (projection.addonId !== addonId || projection.sessionId !== sessionId) {
          return { ok: false, code: "projection-identity-mismatch" };
        }
        return { ok: true, projection };
      },
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

const proofInput = (overrides = {}) => ({
  addonId: "addon.pi-harness",
  manifest: harness(),
  providerProfileId: "openrouter-account",
  selectedModel: "openai/gpt-5.5",
  projection: projectionFor(SESSION_ID),
  sessionId: SESSION_ID,
  ...overrides,
});

test("createLaunchPlan resolves the private plan with the secret only in env", async () => {
  const { service: svc } = service();
  const plan = await svc.createLaunchPlan(proofInput());
  assert.equal(plan.piProvider, "openrouter");
  assert.equal(plan.envVar, "OPENROUTER_API_KEY");
  assert.equal(plan.env.OPENROUTER_API_KEY, CREDENTIAL);
  assert.equal(plan.credentialMechanism, "session-environment");
  assert.deepEqual(plan.argv, ["--provider", "openrouter", "--model", "openai/gpt-5.5"]);
  assert.ok(!JSON.stringify(plan.argv).includes(CREDENTIAL));
  assert.equal(plan.projectPath, PROJECT_ROOT);
});

test("the session cwd comes only from the authorized projection, never a caller path", async () => {
  const { service: svc } = service();
  // A caller-supplied projectPath is ignored entirely: it is not even a plan input.
  const plan = await svc.createLaunchPlan(proofInput({ projectPath: "/etc/passwd" }));
  assert.equal(plan.projectPath, PROJECT_ROOT);
  // A projection bound to another session fails closed (no fallback cwd).
  await assert.rejects(
    svc.createLaunchPlan(proofInput({ sessionId: "other-session" })),
    { code: "permission-denied" },
  );
  // No projection at all: the caller cannot supply a cwd.
  await assert.rejects(
    svc.createLaunchPlan(proofInput({ projection: undefined })),
    { code: "permission-denied" },
  );
});

test("launchProof flows the private plan to the launcher and returns only redacted evidence", async () => {
  const { captured, service: svc } = service();
  const result = await svc.launchProof(proofInput({ prompt: "proof" }));
  // The launcher received the private plan (with the credential), in-process only.
  assert.equal(captured.length, 1);
  assert.equal(captured[0].plan.env.OPENROUTER_API_KEY, CREDENTIAL);
  assert.equal(captured[0].plan.projectPath, PROJECT_ROOT);
  assert.equal(captured[0].prompt, "proof");
  // The returned projection strips the env and never carries the credential.
  assert.ok(!("env" in result.projection));
  assert.deepEqual(result.projection.envKeys, ["OPENROUTER_API_KEY"]);
  assert.ok(!JSON.stringify(result).includes(CREDENTIAL));
  assert.equal(result.evidence.stdout, "ROS_PI_NATIVE_CREDENTIAL_PROOF_OK");
});

test("redact() emits env key names only and redacts paths", async () => {
  const { service: svc } = service();
  const plan = await svc.createLaunchPlan(proofInput());
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
  const first = await svc.launchProof(proofInput({ prompt: "proof" }));
  assert.ok(first.projection);
  revoked = true;
  await assert.rejects(svc.launchProof(proofInput({ prompt: "proof" })), { code: "permission-denied" });
});

test("host-injected baseEnv reaches the private plan env (agent-dir isolation)", async () => {
  const { service: svc } = service({
    baseEnv: { PI_CODING_AGENT_DIR: "/tmp/pi-agent-isolated" },
  });
  const plan = await svc.createLaunchPlan(proofInput());
  assert.equal(plan.env.PI_CODING_AGENT_DIR, "/tmp/pi-agent-isolated", "the isolated agent dir is part of the session env");
  assert.equal(plan.env.OPENROUTER_API_KEY, CREDENTIAL);
  assert.ok(!JSON.stringify(plan.argv).includes(CREDENTIAL));
});

test("startSession flows the private plan to the interactive launcher with an isolated session-dir", async () => {
  const captured = [];
  const fakeHandle = { write() {}, resize() {}, cancel() {} };
  const { service: svc } = service({
    baseEnv: { PI_CODING_AGENT_DIR: "/tmp/pi-agent-isolated" },
    launcher: {
      launchInteractive(plan, options) {
        captured.push({ plan, options });
        return fakeHandle;
      },
    },
  });
  const result = await svc.startSession({
    ...proofInput(),
    cols: 90,
    rows: 28,
    initialPrompt: "start me",
    onData: () => {},
    onExit: () => {},
  });
  assert.equal(result.handle, fakeHandle);
  assert.equal(captured.length, 1);
  const { plan, options } = captured[0];
  assert.ok(plan.argv.includes("--session-dir"));
  const dirIndex = plan.argv.indexOf("--session-dir");
  assert.equal(plan.argv[dirIndex + 1], "/tmp/pi-agent-isolated/sessions");
  assert.ok(!JSON.stringify(plan.argv).includes(CREDENTIAL));
  assert.equal(plan.env.OPENROUTER_API_KEY, CREDENTIAL);
  assert.equal(options.cols, 90);
  assert.equal(options.rows, 28);
  assert.equal(options.initialPrompt, "start me");
  // Only the redacted projection crosses the boundary; env key names only.
  assert.ok(!JSON.stringify(result.projection).includes(CREDENTIAL));
  assert.ok(JSON.stringify(result.projection).includes("OPENROUTER_API_KEY"));
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
    consumeProjection: async (projection, { addonId, sessionId }) => {
      if (!projection || projection.addonId !== addonId || projection.sessionId !== sessionId) {
        return { ok: false, code: "projection-identity-mismatch" };
      }
      return { ok: true, projection };
    },
    resolveExecutable: async () => EXECUTABLE,
  });
  await assert.rejects(svc.launchProof(proofInput({ prompt: "proof" })), { code: "runtime-unavailable" });
});
