// Pi-native adapter unit suite (testing phase). Canary secrets only; no real
// Pi process, no provider call. Proves the host session wrapper contract over
// the reviewed native chain: host-owned model selection, bounded ephemeral
// history, turn ownership, cancellation propagation to the launcher signal,
// credential-free frames, and the fail-closed declaration gate.
import assert from "node:assert/strict";
import test from "node:test";

import { createPiNativeAdapter } from "../host/agent-adapters/pi-native.mjs";

const CREDENTIAL = "pi-native-adapter-canary-0123456789abcdef";

const RUNTIME = {
  adapterId: "pi-native-v1",
  authScheme: "session-environment",
  credentialSource: "provider-profile",
  credentialBinding: "pi.native",
  supportedOperations: ["createSession", "invoke", "cancel", "history", "status", "selectModel"],
};

const MANIFEST = {
  id: "addon.pi-harness",
  harnessProviderConnection: {
    consumesProviderProfiles: true,
    providerProtocols: ["openai-compatible", "minimax-compatible", "ollama"],
    credentialDelivery: ["session-environment"],
    modelSelection: true,
  },
  harnessResources: { requests: { project: ["read"], files: ["read"] } },
};

const PROJECTION = Object.freeze({
  addonId: "addon.pi-harness",
  sessionId: "session-a",
  project: Object.freeze({ id: "project-a", label: "Project A" }),
  root: "/home/u/project",
  cwd: "/home/u/project",
  operations: Object.freeze([{ family: "project", operation: "read" }]),
});

function adapter(overrides = {}) {
  const captured = [];
  const sessionService = {
    async probe() { return { available: true }; },
    async launchProof(args) {
      captured.push(args);
      // Default: resolve immediately like a fast child exit. With
      // holdUntilAbort, behave like a long-running child: resolve only when the
      // turn signal aborts (the launcher's kill path).
      if (overrides.holdUntilAbort && args.signal) {
        await new Promise((resolve) => {
          if (args.signal.aborted) return resolve();
          args.signal.addEventListener("abort", resolve, { once: true });
        });
      }
      return {
        projection: { envKeys: ["OPENROUTER_API_KEY"] },
        evidence: {
          exitCode: overrides.exitCode ?? 0, signal: null, timedOut: false, aborted: false,
          spawnError: null, durationMs: 4,
          stdout: overrides.reply ?? "ROS_PI_NATIVE_REPLY",
          stderr: "",
        },
      };
    },
  };
  return {
    captured,
    adapter: createPiNativeAdapter({
      addonId: "addon.pi-harness",
      runtime: RUNTIME,
      manifest: MANIFEST,
      sessionService,
      providerProfileId: "openrouter-account",
      issueProjection: async ({ addonId, sessionId }) => {
        if (overrides.denyProjection) return { ok: false, code: "filesystem-not-granted" };
        return { ok: true, projection: { ...PROJECTION, addonId, sessionId } };
      },
      stageSkills: overrides.stageSkills,
      cleanupSkills: overrides.cleanupSkills,
      turnTimeoutMs: overrides.turnTimeoutMs ?? 120000,
      ...overrides,
    }),
  };
}

const input = (messages, model) => ({ messages, ...(model ? { model } : {}) });

test("declaration gate: only pi-native-v1 + session-environment is accepted", () => {
  assert.throws(() => adapter({ runtime: { ...RUNTIME, adapterId: "openai-compatible-v1" } }), { code: "permission-denied" });
  assert.throws(() => adapter({ runtime: { ...RUNTIME, authScheme: "bearer" } }), { code: "permission-denied" });
  assert.equal(typeof adapter().adapter.probe, "function");
});

test("probe reflects session-service executable readiness", async () => {
  assert.deepEqual(await adapter().adapter.probe(), { available: true });
  const offline = adapter();
  offline.adapter = createPiNativeAdapter({
    addonId: "addon.pi-harness", runtime: RUNTIME, manifest: MANIFEST,
    sessionService: { probe: async () => ({ available: false }), launchProof: async () => ({}) },
    providerProfileId: "openrouter-account",
    issueProjection: async () => ({ ok: true, projection: PROJECTION }),
  });
  assert.deepEqual(await offline.adapter.probe(), { available: false });
});

test("createSession issues an opaque host session and selectModel commits selection", async () => {
  const { adapter: a } = adapter();
  const session = await a.createSession();
  assert.ok(session && typeof session === "object");
  const selection = await a.selectModel({ session, input: { provider: "openrouter", model: "openai/gpt-5.5" } });
  assert.deepEqual(selection, { provider: "openrouter", model: "openai/gpt-5.5" });
  await a.dispose({ session });
});

test("invoke runs the real chain and yields a final frame with host-committed history", async () => {
  const { adapter: a, captured } = adapter();
  const session = await a.createSession();
  await a.selectModel({ session, input: { provider: "openrouter", model: "openai/gpt-5.5" } });
  const frames = [];
  for await (const frame of a.invoke({ session, input: input([{ role: "user", content: "hello" }]) })) frames.push(frame);
  assert.deepEqual(frames, [{ type: "final", data: { text: "ROS_PI_NATIVE_REPLY" } }]);
  // The launch used the selected model and the session-bound projection; the
  // credential never appears anywhere in the plan inputs.
  assert.equal(captured.length, 1);
  assert.equal(captured[0].providerProfileId, "openrouter-account");
  assert.equal(captured[0].selectedModel, "openai/gpt-5.5");
  assert.equal(captured[0].sessionId, session.piSessionId);
  assert.equal(captured[0].projection.cwd, "/home/u/project");
  assert.ok(!JSON.stringify(captured).includes(CREDENTIAL));
  // Completed reply committed to host history.
  assert.deepEqual(await a.history({ session }), {
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "ROS_PI_NATIVE_REPLY" },
    ],
    hasMore: false,
  });
  await a.dispose({ session });
});

test("subsequent turns pass the committed transcript as the prompt", async () => {
  const { adapter: a, captured } = adapter();
  const session = await a.createSession();
  await a.selectModel({ session, input: { provider: "openrouter", model: "openai/gpt-5.5" } });
  for await (const frame of a.invoke({ session, input: input([{ role: "user", content: "first" }]) })) {
    assert.equal(frame.type, "final");
  }
  for await (const frame of a.invoke({ session, input: input([{ role: "user", content: "second" }]) })) {
    assert.equal(frame.type, "final");
  }
  assert.equal(captured.length, 2);
  assert.equal(captured[1].prompt, "User: first\n\nAssistant: ROS_PI_NATIVE_REPLY\n\nUser: second");
  await a.dispose({ session });
});

test("a failed turn yields an error frame and never enters history", async () => {
  const { adapter: a } = adapter({ reply: "bad", exitCode: 1 });
  const session = await a.createSession();
  await a.selectModel({ session, input: { provider: "openrouter", model: "openai/gpt-5.5" } });
  const frames = [];
  for await (const frame of a.invoke({ session, input: input([{ role: "user", content: "hello" }]) })) frames.push(frame);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].type, "error");
  assert.equal(frames[0].data.code, "runtime-unavailable");
  assert.deepEqual((await a.history({ session })).messages, []);
  await a.dispose({ session });
});

test("cancel aborts the turn signal (launcher kill path) and yields cancelled", async () => {
  const { adapter: a, captured } = adapter({ holdUntilAbort: true });
  const session = await a.createSession();
  await a.selectModel({ session, input: { provider: "openrouter", model: "openai/gpt-5.5" } });
  const iterator = a.invoke({ session, input: input([{ role: "user", content: "long task" }]) });
  const nextPromise = iterator.next();
  // Give the invoke a tick to reach the launcher, then cancel: the adapter
  // aborts the turn controller, which the fake launcher honors.
  await new Promise((resolve) => setTimeout(resolve, 10));
  await a.cancel({ session });
  const frames = [];
  const first = await nextPromise;
  if (!first.done) frames.push(first.value);
  for await (const rest of iterator) frames.push(rest);
  assert.deepEqual(frames, [{ type: "cancelled", data: {} }]);
  assert.equal(captured.length, 1);
  assert.ok(captured[0].signal, "the launcher received the turn signal");
  assert.deepEqual((await a.history({ session })).messages, []);
  assert.deepEqual(await a.status({ session }), { status: "idle" });
  await a.dispose({ session });
});

test("turn ownership: a second invoke while running fails closed", async () => {
  const { adapter: a } = adapter({ holdUntilAbort: true });
  const session = await a.createSession();
  await a.selectModel({ session, input: { provider: "openrouter", model: "openai/gpt-5.5" } });
  const iterator = a.invoke({ session, input: input([{ role: "user", content: "first" }]) });
  // Start the first turn so it owns the session, then the conflicting turn
  // must reject at its first next().
  const firstNext = iterator.next();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await assert.rejects(a.invoke({ session, input: input([{ role: "user", content: "second" }]) }).next(), { code: "ownership-conflict" });
  await a.cancel({ session });
  const first = await firstNext;
  if (!first.done) assert.equal(first.value.type, "cancelled");
  for await (const frame of iterator) assert.equal(frame.type, "cancelled");
  await a.dispose({ session });
});

test("no model selected fails closed as invalid-event", async () => {
  const { adapter: a } = adapter();
  const session = await a.createSession();
  const frames = [];
  for await (const frame of a.invoke({ session, input: input([{ role: "user", content: "hi" }]) })) frames.push(frame);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].type, "error");
  assert.equal(frames[0].data.code, "invalid-event");
  await a.dispose({ session });
});

test("a denied projection fails closed as permission-denied", async () => {
  const { adapter: a } = adapter({ denyProjection: true });
  const session = await a.createSession();
  await a.selectModel({ session, input: { provider: "openrouter", model: "openai/gpt-5.5" } });
  const frames = [];
  for await (const frame of a.invoke({ session, input: input([{ role: "user", content: "hi" }]) })) frames.push(frame);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].type, "error");
  assert.equal(frames[0].data.code, "permission-denied");
  await a.dispose({ session });
});

test("Phase 2C skills are staged once and cleaned on dispose", async () => {
  const staged = [];
  const cleaned = [];
  const { adapter: a } = adapter({
    stageSkills: async ({ sessionId }) => {
      staged.push(sessionId);
      return { ok: true, projection: { addonId: "addon.pi-harness", sessionId, project: { id: "project-a" } } };
    },
    cleanupSkills: async ({ sessionId }) => { cleaned.push(sessionId); },
  });
  const session = await a.createSession();
  await a.selectModel({ session, input: { provider: "openrouter", model: "openai/gpt-5.5" } });
  for await (const frame of a.invoke({ session, input: input([{ role: "user", content: "hi" }]) })) assert.equal(frame.type, "final");
  for await (const frame of a.invoke({ session, input: input([{ role: "user", content: "again" }]) })) assert.equal(frame.type, "final");
  assert.deepEqual(staged, [session.piSessionId], "skills staged exactly once per session");
  await a.dispose({ session });
  assert.deepEqual(cleaned, [session.piSessionId], "owned staging cleaned on session dispose");
});

test("dispose without a session closes the adapter", async () => {
  const { adapter: a } = adapter();
  const session = await a.createSession();
  await a.dispose({});
  assert.equal(session && typeof session === "object", true);
  assert.deepEqual(await a.probe(), { available: false });
  await assert.rejects(a.createSession(), { code: "runtime-unavailable" });
});
