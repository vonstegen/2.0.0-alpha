// Intent citation: docs/architecture/resonantos-browser-architecture/CP5-PHASE5-CONTINUATION.md
// Intent citation: docs/architecture/resonantos-browser-architecture/IMPLEMENTATION_TRACKING.md (row 103)
//
// CP-5 Phase 5 row 103: per-harness archive parity. The 7 reference
// adapter factories (Hermes, OpenCode, OpenClaw, AgentZero,
// DeepSeekHarness, Pi, Aider) must never carry a direct-write path
// to the Living Archive. Archive writes go through the intake path
// (archive-review-service.executeArchiveIntake); the adapter layer
// produces a reviewable artifact but does not write the archive.
//
// The test injects a synthesized child-actor result with a
// "## Archive Citation" section, drives each adapter's dispatch, and
// asserts the dispatch outcome never includes archive-write keys
// (archivePath, wikiPath, memoryPath, directWrite, etc.) and never
// points outside the bridge's response shape. The intake path is
// the only writer — that is the row-103 contract.
//
// Note: the actual intake path lives in the host service
// (`addon-delegation-service.mjs`), not in the dispatch layer. The
// 5.3 contract is "the dispatch layer is not the writer." If a
// future refactor moves intake into the adapter layer, the test
// must call executeArchiveIntake directly to prove it is the
// route — that is what row 103's "intake path was hit" check
// means at the bridge seam.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createGovernedAuthority } from "../host/bridge-governed-authority.mjs";
import { createOpenclawGatewayClient } from "../host/openclaw-gateway-client.mjs";
import {
  createAgentZeroProviderAdapter,
  createAiderProviderAdapter,
  createDeepSeekHarnessProviderAdapter,
  createHermesProviderAdapter,
  createOpenClawProviderAdapter,
  createOpenCodeProviderAdapter,
  createPiProviderAdapter,
} from "../host/harness-provider-adapters.mjs";

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

function packet(overrides = {}) {
  return {
    taskId: "task-1",
    delegationChainRef: { delegationId: "del-1" },
    executorPrincipalId: "hermes-1",
    issuerPrincipalId: "user-1",
    auditCorrelationId: "aud-1",
    intent: "summarize and cite",
    workspaceRoots: ["/tmp/per-harness-parity"],
    ...overrides,
  };
}

const CHILD_OUTPUT_WITH_CITATION = [
  "## Final Summary",
  "The child actor returned a result that includes a citation.",
  "",
  "## Changed Files",
  "- (none)",
  "",
  "## Archive Citation",
  "Source: [[Living Archive / notes / foo]] — a reviewable citation.",
  "",
  "## Residual Risks",
  "- The archive write path is intake-only; the adapter is not the writer.",
].join("\n");

const FORBIDDEN_KEYS = [
  "archivePath",
  "wikiPath",
  "memoryPath",
  "directWrite",
  "wikiWrite",
  "aiMemoryWrite",
  "archiveWrite",
  "trustArchive",
  "promoteToWiki",
];

function assertNoDirectWriteKeys(obj) {
  if (obj === null || typeof obj !== "object") return;
  for (const key of Object.keys(obj)) {
    assert.ok(
      !FORBIDDEN_KEYS.includes(key),
      `dispatch outcome must not embed direct-write key "${key}"; the archive write path is intake-only`,
    );
    assertNoDirectWriteKeys(obj[key]);
  }
}

function withEmptyDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function buildAuthority() {
  const authority = createGovernedAuthority({ now: () => T0 });
  const scope = governedScope();
  recordLeaf(authority, scope);
  return { authority, handle: authority.mintGrant({ grantId: "g-1", scope }) };
}

test("Hermes: archive citation in the result does not produce a direct-write path", async () => {
  const homeDir = withEmptyDir("hermes-parity-");
  const { authority, handle } = buildAuthority();
  const adapter = createHermesProviderAdapter({
    homeDir,
    governedAuthority: authority,
    command: "hermes",
    spawnImpl: () => ({ status: 0, stdout: CHILD_OUTPUT_WITH_CITATION, stderr: "" }),
  });
  const run = await adapter.startTask(packet(), handle);
  const state = await adapter.getTask(run.runId);
  assertNoDirectWriteKeys(state);
});

test("OpenCode: archive citation in the result does not produce a direct-write path", async () => {
  const homeDir = withEmptyDir("opencode-parity-");
  const { authority, handle } = buildAuthority();
  const adapter = createOpenCodeProviderAdapter({
    homeDir,
    governedAuthority: authority,
    ensureServer: async () => ({ baseUrl: "http://unused" }),
    createClient: () => ({
      createSession: async () => ({ id: "sess-x" }),
      prompt: async () => ({}),
    }),
  });
  const run = await adapter.startTask(packet(), handle);
  const state = await adapter.getTask(run.runId);
  assertNoDirectWriteKeys(state);
});

test("OpenClaw (host-command fallback): archive citation does not produce a direct-write path", async () => {
  const { authority, handle } = buildAuthority();
  const adapter = createOpenClawProviderAdapter({
    governedAuthority: authority,
    command: "openclaw",
    spawnImpl: () => ({ status: 0, stdout: CHILD_OUTPUT_WITH_CITATION, stderr: "" }),
  });
  const run = await adapter.startTask(packet(), handle);
  const state = await adapter.getTask(run.runId);
  assertNoDirectWriteKeys(state);
});

test("OpenClaw (gateway transport): archive citation does not produce a direct-write path", async () => {
  const { authority, handle } = buildAuthority();
  // The gateway returns a child-actor reply that includes a citation.
  // The bridge must surface the gateway's reply as a `response` only;
  // it must not synthesize an archive-write key alongside.
  const gatewayClient = createOpenclawGatewayClient({
    baseUrl: "http://unused",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        childActorId: "actor-1",
        reply: CHILD_OUTPUT_WITH_CITATION,
      }),
    }),
  });
  const adapter = createOpenClawProviderAdapter({
    governedAuthority: authority,
    gatewayClient,
  });
  const run = await adapter.startTask(packet(), handle);
  const state = await adapter.getTask(run.runId);
  assertNoDirectWriteKeys(state);
});

test("AgentZero: archive citation does not produce a direct-write path", async () => {
  const { authority, handle } = buildAuthority();
  const adapter = createAgentZeroProviderAdapter({
    governedAuthority: authority,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ reply: CHILD_OUTPUT_WITH_CITATION }),
    }),
    repoRoot: "/tmp",
  });
  const run = await adapter.startTask(packet(), handle);
  const state = await adapter.getTask(run.runId);
  assertNoDirectWriteKeys(state);
});

test("DeepSeek harness: archive citation does not produce a direct-write path", async () => {
  const { authority, handle } = buildAuthority();
  const adapter = createDeepSeekHarnessProviderAdapter({
    governedAuthority: authority,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ reply: CHILD_OUTPUT_WITH_CITATION }),
    }),
    repoRoot: "/tmp",
  });
  const run = await adapter.startTask(packet(), handle);
  const state = await adapter.getTask(run.runId);
  assertNoDirectWriteKeys(state);
});

test("Pi: archive citation does not produce a direct-write path", async () => {
  const { authority, handle } = buildAuthority();
  const adapter = createPiProviderAdapter({
    governedAuthority: authority,
    provider: "deepseek",
    model: "deepseek/deepseek-chat",
    runPrompt: async () => ({ outcome: "allow", response: { text: CHILD_OUTPUT_WITH_CITATION } }),
  });
  const run = await adapter.startTask(packet(), handle);
  const state = await adapter.getTask(run.runId);
  assertNoDirectWriteKeys(state);
});

test("Aider: archive citation does not produce a direct-write path", async () => {
  const { authority, handle } = buildAuthority();
  const adapter = createAiderProviderAdapter({
    governedAuthority: authority,
    command: "aider",
    spawnImpl: () => ({ status: 0, stdout: CHILD_OUTPUT_WITH_CITATION, stderr: "" }),
  });
  const run = await adapter.startTask(packet(), handle);
  const state = await adapter.getTask(run.runId);
  assertNoDirectWriteKeys(state);
});
