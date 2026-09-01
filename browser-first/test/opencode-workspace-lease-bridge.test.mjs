// Intent citation: docs/architecture/resonantos-browser-architecture/CP5-PHASE5-CONTINUATION.md
// Intent citation: docs/architecture/resonantos-browser-architecture/IMPLEMENTATION_TRACKING.md (row 99)
//
// CP-5 Phase 5 row 99: bridge cannot drive a real `opencode serve` session
// against a workspace unless it holds the workspace lease. These tests
// prove the gate is in place, the lease is acquired before the HTTP
// session starts, and the lease is released even when the transport
// throws.
//
// The "403 outside a lease holder" test (the Phase 5 doc's named
// acceptance criterion) is the first test below. It uses a fresh
// registry, pre-holds the lease for a different holder, then drives
// the adapter — the bridge's acquire must fail with
// `workspace-lease-unavailable`.

import assert from "node:assert/strict";
import test from "node:test";

import { makeRegistry } from "../host/workspace-lease.mjs";
import { createGovernedAuthority } from "../host/bridge-governed-authority.mjs";
import { createOpenCodeProviderAdapter } from "../host/harness-provider-adapters.mjs";

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
    intent: "drive a session",
    workspaceRoots: ["/tmp/opencode-ws-test"],
    ...overrides,
  };
}

test("opencodeRuntimeDispatch denies when no lease can be acquired (403 outside lease holder)", async () => {
  // The Phase 5 acceptance criterion: a caller outside a lease holder
  // is denied. We pre-hold the lease for a different holder so the
  // bridge's acquire must fail with `workspace-lease-unavailable`.
  const registry = makeRegistry();
  registry.clear();
  const existing = registry.acquire({ resourceId: "/tmp/opencode-ws-test", holder: "other-task" });
  assert.equal(existing.ok, true);

  const authority = createGovernedAuthority({ now: () => T0 });
  const scope = governedScope();
  recordLeaf(authority, scope);
  const handle = authority.mintGrant({ grantId: "g-1", scope });

  let ensureServerCalled = false;
  const adapter = createOpenCodeProviderAdapter({
    homeDir: "/tmp",
    governedAuthority: authority,
    workspaceLeaseRegistry: registry,
    ensureServer: async () => { ensureServerCalled = true; return { baseUrl: "http://test" }; },
    createClient: () => ({
      createSession: async () => ({ id: "sess-x" }),
      prompt: async () => {},
    }),
  });

  const run = await adapter.startTask(packet(), handle);
  const state = await adapter.getTask(run.runId);
  assert.equal(state.status, "failed");
  assert.match(state.detail, /workspace lease for \/tmp\/opencode-ws-test unavailable/);
  assert.match(state.detail, /already held by other-task/);
  assert.equal(ensureServerCalled, false, "ensureServer must not run without a lease");
});

test("opencodeRuntimeDispatch acquires a lease, opens the session, and releases the lease", async () => {
  const registry = makeRegistry();
  registry.clear();
  const authority = createGovernedAuthority({ now: () => T0 });
  const scope = governedScope();
  recordLeaf(authority, scope);
  const handle = authority.mintGrant({ grantId: "g-1", scope });

  const calls = [];
  const adapter = createOpenCodeProviderAdapter({
    homeDir: "/tmp",
    governedAuthority: authority,
    workspaceLeaseRegistry: registry,
    leaseHolder: "test:holder:1",
    ensureServer: async () => {
      calls.push("ensureServer");
      assert.equal(registry.size(), 1, "lease must be held while ensureServer is running");
      return { baseUrl: "http://test" };
    },
    createClient: () => ({
      createSession: async (title) => { calls.push(`createSession:${title}`); return { id: "sess-1" }; },
      prompt: async (sessionId) => {
        calls.push(`prompt:${sessionId}`);
        assert.equal(registry.size(), 1, "lease must still be held during prompt");
      },
    }),
  });

  const run = await adapter.startTask(packet(), handle);
  const state = await adapter.getTask(run.runId);
  assert.equal(state.status, "completed");
  assert.deepEqual(calls, ["ensureServer", "createSession:task-1", "prompt:sess-1"]);
  assert.equal(registry.size(), 0, "lease must be released after the response");
});

test("opencodeRuntimeDispatch releases the lease even when the transport throws", async () => {
  const registry = makeRegistry();
  registry.clear();
  const authority = createGovernedAuthority({ now: () => T0 });
  const scope = governedScope();
  recordLeaf(authority, scope);
  const handle = authority.mintGrant({ grantId: "g-1", scope });

  const adapter = createOpenCodeProviderAdapter({
    homeDir: "/tmp",
    governedAuthority: authority,
    workspaceLeaseRegistry: registry,
    leaseHolder: "test:holder:2",
    ensureServer: async () => ({ baseUrl: "http://test" }),
    createClient: () => ({
      createSession: async () => { throw new Error("server exploded"); },
      prompt: async () => {},
    }),
  });

  const run = await adapter.startTask(packet(), handle);
  const state = await adapter.getTask(run.runId);
  assert.equal(state.status, "failed");
  assert.match(state.detail, /server exploded/);
  assert.equal(registry.size(), 0, "lease must be released even when the transport throws");
});

test("a second concurrent task against the same workspace is denied with workspace-lease-unavailable", async () => {
  const registry = makeRegistry();
  registry.clear();
  const authority = createGovernedAuthority({ now: () => T0 });
  const scope = governedScope();
  recordLeaf(authority, scope);
  const handle = authority.mintGrant({ grantId: "g-1", scope });

  let releaseFirst;
  const releaseFirstPromise = new Promise((resolve) => { releaseFirst = resolve; });

  const adapter = createOpenCodeProviderAdapter({
    homeDir: "/tmp",
    governedAuthority: authority,
    workspaceLeaseRegistry: registry,
    leaseHolder: "test:holder:first",
    ensureServer: async () => {
      // Hold the lease for the duration of the second task's attempt.
      await releaseFirstPromise;
      return { baseUrl: "http://test" };
    },
    createClient: () => ({
      createSession: async () => ({ id: "sess-first" }),
      prompt: async () => {},
    }),
  });

  const firstRunPromise = adapter.startTask(packet(), handle);

  // Give the microtask queue a turn so the first run reaches ensureServer.
  await new Promise((resolve) => setImmediate(resolve));

  // The second task must be denied because the first is still holding the lease.
  const secondRun = await adapter.startTask(packet(), handle);
  const secondState = await adapter.getTask(secondRun.runId);
  assert.equal(secondState.status, "failed");
  assert.match(secondState.detail, /workspace lease for \/tmp\/opencode-ws-test unavailable/);
  assert.match(secondState.detail, /already held by test:holder:first/);

  // Let the first task finish and clean up.
  releaseFirst();
  const firstRun = await firstRunPromise;
  const firstFinal = await adapter.getTask(firstRun.runId);
  assert.equal(firstFinal.status, "completed");
  assert.equal(registry.size(), 0);
});
