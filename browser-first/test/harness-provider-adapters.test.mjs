// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAiderProviderAdapter,
  createAgentZeroProviderAdapter,
  createDeepSeekHarnessProviderAdapter,
  createHarnessProviderAdapter,
  createHermesProviderAdapter,
  createOpenClawProviderAdapter,
  createOpenCodeProviderAdapter,
  createPiProviderAdapter,
} from "../host/harness-provider-adapters.mjs";
import { createGovernedAuthority } from "../host/bridge-governed-authority.mjs";

function packet() {
  return {
    taskId: "task-1",
    issuerPrincipalId: "user-1",
    executorPrincipalId: "hermes-1",
    delegationChainRef: { delegationId: "del-1" },
    intent: "summarize the diff",
    successCriteria: ["summary present"],
    nonGoals: [],
    outputContract: {},
    contextRefs: { facts: [], provenance: [], sensitivity: "low", freshness: "x", allowedPurpose: "review", retentionPolicy: "session", redactions: [] },
    requestedCapabilities: [],
    resourceBudget: { priority: 1, deadline: "x", concurrencyClass: "shared", estimated: {}, hardCeiling: {}, requiredNodeRoles: [], networkMode: "none", workspaceMode: "isolated", secretPolicy: "none", onExhaustion: "stop" },
    workspaceRoots: ["/workspace/project-a"],
    approvalPolicy: "human-approval",
    deadline: "2026-08-28T12:00:00Z",
    expiresAt: "2026-08-28T12:00:00Z",
    cancellationChannel: "task-1:cancel",
    auditCorrelationId: "aud-1",
  };
}

test("startTask delegates to the dispatch transport and completes on allow", async () => {
  let seen = null;
  const adapter = createHarnessProviderAdapter({
    providerId: "test",
    cancellationSemantics: "cancel",
    sandboxStrength: "host-mediated",
    diagnose: async () => ({ status: "ok", providerId: "test" }),
    dispatch: async (packetArg, grant) => {
      seen = { taskId: packetArg.taskId, grant };
      return { outcome: "allow" };
    },
  });
  const run = await adapter.startTask(packet(), "grant-1");
  assert.equal(seen.taskId, "task-1");
  assert.equal(seen.grant, "grant-1");
  assert.equal((await adapter.getTask(run.runId)).status, "completed");
});

test("startTask fails the run when the dispatch denies", async () => {
  const adapter = createHarnessProviderAdapter({
    providerId: "test",
    cancellationSemantics: "cancel",
    sandboxStrength: "host-mediated",
    diagnose: async () => ({ status: "ok", providerId: "test" }),
    dispatch: async () => ({ outcome: "deny", reason: "capability-denied", detail: "missing grants" }),
  });
  const run = await adapter.startTask(packet(), "grant-1");
  const state = await adapter.getTask(run.runId);
  assert.equal(state.status, "failed");
  assert.equal(state.detail, "missing grants");
});

test("cancels a task through the generic lifecycle without a dispatch", async () => {
  const adapter = createHarnessProviderAdapter({
    providerId: "test",
    cancellationSemantics: "cancel",
    sandboxStrength: "host-mediated",
    diagnose: async () => ({ status: "ok", providerId: "test" }),
    dispatch: null,
  });
  const run = await adapter.startTask(packet(), "grant-1");
  await adapter.cancelTask(run.runId, "user abort");
  assert.equal((await adapter.getTask(run.runId)).status, "cancelled");
});

test("Hermes adapter diagnose reports real CLI discovery against an empty home directory", async () => {
  const emptyHome = mkdtempSync(join(tmpdir(), "hermes-empty-"));
  const adapter = createHermesProviderAdapter({ homeDir: emptyHome });
  const health = await adapter.diagnose();
  assert.equal(health.providerId, "hermes");
  // No Hermes CLI under an empty home -> unavailable (real discovery, not a stub).
  assert.equal(health.status, "unavailable");
});

test("the seven provider factories expose distinct shapes on the same contract", async () => {
  const hermes = createHermesProviderAdapter({ homeDir: mkdtempSync(join(tmpdir(), "h-")) });
  const opencode = createOpenCodeProviderAdapter({ homeDir: mkdtempSync(join(tmpdir(), "o-")) });
  const openclaw = createOpenClawProviderAdapter({});
  const agentzero = createAgentZeroProviderAdapter({});
  const deepseek = createDeepSeekHarnessProviderAdapter({});
  const pi = createPiProviderAdapter({});
  const aider = createAiderProviderAdapter({});

  assert.equal(hermes.providerId, "hermes");
  assert.equal(hermes.cancellationSemantics, "cancel");
  assert.equal(hermes.sandboxStrength, "host-mediated");
  assert.equal(opencode.providerId, "opencode");
  assert.equal(opencode.cancellationSemantics, "finish-atomic");
  assert.equal(opencode.sandboxStrength, "sandboxed-outer-boundary");
  assert.equal(openclaw.providerId, "openclaw");
  assert.equal(openclaw.cancellationSemantics, "quarantine");
  assert.equal(openclaw.sandboxStrength, "sandboxed-outer-boundary");
  assert.equal(agentzero.providerId, "agentzero");
  assert.equal(agentzero.cancellationSemantics, "cancel");
  assert.equal(agentzero.sandboxStrength, "sandboxed-outer-boundary");
  assert.equal(deepseek.providerId, "deepseek-harness");
  assert.equal(deepseek.cancellationSemantics, "cancel");
  assert.equal(deepseek.sandboxStrength, "host-mediated");
  assert.equal(pi.providerId, "pi");
  assert.equal(pi.cancellationSemantics, "cancel");
  assert.equal(pi.sandboxStrength, "host-mediated");
  assert.equal(aider.providerId, "aider");
  assert.equal(aider.cancellationSemantics, "finish-atomic");
  assert.equal(aider.sandboxStrength, "host-mediated");

  for (const adapter of [hermes, opencode, openclaw, agentzero, deepseek, pi, aider]) {
    const health = await adapter.diagnose();
    assert.equal(health.providerId, adapter.providerId);
    assert.ok(["ok", "unavailable"].includes(health.status));
  }
});

const T0 = Date.parse("2026-08-27T06:00:00Z");

function governedScope(overrides = {}) {
  return {
    action: "archive-read",
    resourceSelectors: ["/workspace/project-a"],
    operations: ["read"],
    taskId: "task-1",
    delegationId: "del-1",
    issuerPrincipalId: "user-1",
    subjectPrincipalId: "hermes-1",
    notBefore: "2026-08-27T00:00:00Z",
    expiresAt: "2026-08-27T12:00:00Z",
    revocationBehavior: "cancel",
    ...overrides,
  };
}

function recordLeaf(authority, s) {
  authority.recordDelegation({
    id: s.delegationId,
    taskId: s.taskId,
    parentDelegationId: null,
    issuerPrincipalId: s.issuerPrincipalId,
    subjectPrincipalId: s.subjectPrincipalId,
    requestedCapabilities: [],
    effectiveGrantId: "g-1",
    purpose: "test",
    issuedAt: s.notBefore,
    notBefore: s.notBefore,
    expiresAt: s.expiresAt,
    status: "active",
    auditCorrelationId: "aud-1",
  });
}

test("governed dispatch denies a forged subject before any provider effect", async () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = governedScope();
  recordLeaf(authority, s);
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });

  const adapter = createHermesProviderAdapter({
    homeDir: mkdtempSync(join(tmpdir(), "h-")),
    governedAuthority: authority,
  });
  const forged = { ...packet(), executorPrincipalId: "attacker" };
  const run = await adapter.startTask(forged, handle);

  const state = await adapter.getTask(run.runId);
  assert.equal(state.status, "failed");
  assert.match(state.detail, /subject-mismatch/);
});

test("the four new provider factories deny a forged subject before any effect", async () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = governedScope();
  recordLeaf(authority, s);
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });

  const factories = [
    createAgentZeroProviderAdapter,
    createDeepSeekHarnessProviderAdapter,
    createPiProviderAdapter,
    createAiderProviderAdapter,
  ];
  for (const factory of factories) {
    const adapter = factory({ governedAuthority: authority });
    const forged = { ...packet(), executorPrincipalId: "attacker" };
    const run = await adapter.startTask(forged, handle);
    const state = await adapter.getTask(run.runId);
    assert.equal(state.status, "failed");
    assert.match(state.detail, /subject-mismatch/);
  }
});

test("governed dispatch fails closed without a governed authority", async () => {
  const adapter = createHermesProviderAdapter({ homeDir: mkdtempSync(join(tmpdir(), "h-")) });
  const run = await adapter.startTask(packet(), "grant-1");
  const state = await adapter.getTask(run.runId);
  assert.equal(state.status, "failed");
  assert.match(state.detail, /no governed authority on this bridge/);
});

test("OpenCode transport drives a session through the governed envelope", async () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = governedScope();
  recordLeaf(authority, s);
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });

  const calls = [];
  const adapter = createOpenCodeProviderAdapter({
    homeDir: mkdtempSync(join(tmpdir(), "o-")),
    governedAuthority: authority,
    ensureServer: async () => { calls.push("ensureServer"); return { baseUrl: "http://test" }; },
    createClient: () => ({
      createSession: async (title) => { calls.push(`createSession:${title}`); return { id: "sess-1" }; },
      prompt: async (sessionId) => { calls.push(`prompt:${sessionId}`); },
    }),
  });
  const run = await adapter.startTask(packet(), handle);

  assert.equal((await adapter.getTask(run.runId)).status, "completed");
  assert.ok(calls.includes("ensureServer"));
  assert.ok(calls.includes("createSession:task-1"));
  assert.ok(calls.includes("prompt:sess-1"));
});

test("OpenCode transport denies a forged subject before opening a session", async () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = governedScope();
  recordLeaf(authority, s);
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });

  let serverCalled = false;
  const adapter = createOpenCodeProviderAdapter({
    homeDir: mkdtempSync(join(tmpdir(), "o-")),
    governedAuthority: authority,
    ensureServer: async () => { serverCalled = true; return { baseUrl: "http://test" }; },
    createClient: () => ({ createSession: async () => ({ id: "x" }), prompt: async () => {} }),
  });
  const forged = { ...packet(), executorPrincipalId: "attacker" };
  const run = await adapter.startTask(forged, handle);

  assert.equal((await adapter.getTask(run.runId)).status, "failed");
  assert.equal(serverCalled, false);
});

test("Pi transport drives a stdio-json-rpc prompt through the governed envelope", async () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = governedScope();
  recordLeaf(authority, s);
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });

  const calls = [];
  const adapter = createPiProviderAdapter({
    governedAuthority: authority,
    provider: "deepseek",
    model: "deepseek/deepseek-chat",
    runPrompt: async ({ intent, provider, model }) => {
      calls.push(`runPrompt:${provider}:${model}:${intent}`);
      return { outcome: "allow", response: { text: "Hello." } };
    },
  });
  const run = await adapter.startTask(packet(), handle);

  assert.equal((await adapter.getTask(run.runId)).status, "completed");
  assert.deepEqual(calls, ["runPrompt:deepseek:deepseek/deepseek-chat:summarize the diff"]);
});

test("Pi transport denies a forged subject before spawning pi", async () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = governedScope();
  recordLeaf(authority, s);
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });

  let called = false;
  const adapter = createPiProviderAdapter({
    governedAuthority: authority,
    runPrompt: async () => { called = true; return { outcome: "allow", response: { text: "x" } }; },
  });
  const run = await adapter.startTask({ ...packet(), executorPrincipalId: "attacker" }, handle);

  assert.equal((await adapter.getTask(run.runId)).status, "failed");
  assert.equal(called, false);
});

test("Aider transport runs a host-command through the governed envelope", async () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = governedScope();
  recordLeaf(authority, s);
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });

  const calls = [];
  const adapter = createAiderProviderAdapter({
    governedAuthority: authority,
    command: "aider",
    model: "deepseek/deepseek-chat",
    spawnImpl: (cmd, args, opts) => {
      calls.push({ cmd, args, cwd: opts.cwd });
      return { status: 0, stdout: "applied", stderr: "" };
    },
  });
  const run = await adapter.startTask(packet(), handle);

  assert.equal((await adapter.getTask(run.runId)).status, "completed");
  assert.equal(calls[0].cmd, "aider");
  assert.ok(calls[0].args.includes("--yes-always"));
  assert.ok(calls[0].args.includes("--message"));
  assert.equal(calls[0].cwd, "/workspace/project-a");
});

test("Aider transport denies a forged subject before running the command", async () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = governedScope();
  recordLeaf(authority, s);
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });

  let called = false;
  const adapter = createAiderProviderAdapter({
    governedAuthority: authority,
    spawnImpl: () => { called = true; return { status: 0 }; },
  });
  const run = await adapter.startTask({ ...packet(), executorPrincipalId: "attacker" }, handle);

  assert.equal((await adapter.getTask(run.runId)).status, "failed");
  assert.equal(called, false);
});
