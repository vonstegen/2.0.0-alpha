// Intent citation: docs/architecture/ADR-054-principal-delegation-chain-task-scoped-authority.md
// Intent citation: docs/architecture/resonantos-browser-architecture/08-capability-inheritance-task-scope.md
import assert from "node:assert/strict";
import test from "node:test";

import {
  createGovernedAuthority,
  isScopeSubset,
  pathsWithinSelectors,
} from "../host/bridge-governed-authority.mjs";
import { redactAuditRecord } from "../host/bridge-redact-audit.mjs";

const T0 = Date.parse("2026-08-27T06:00:00Z");

function scope(overrides = {}) {
  return {
    action: "network",
    resourceSelectors: ["/workspace/project-a"],
    operations: ["read"],
    taskId: "task-1",
    delegationId: "del-1",
    issuerPrincipalId: "user-1",
    subjectPrincipalId: "harness-1",
    notBefore: "2026-08-27T00:00:00Z",
    expiresAt: "2026-08-27T12:00:00Z",
    revocationBehavior: "cancel",
    ...overrides,
  };
}

function request(handle, overrides = {}) {
  return {
    taskId: "task-1",
    delegationId: "del-1",
    subjectPrincipalId: "harness-1",
    grantHandle: handle,
    payload: {},
    ...overrides,
  };
}

// Record a single-edge delegation consistent with a leaf scope, so the
// chain walk (CP-2) passes for tests that exercise the allow/scope paths.
function recordLeaf(authority, s, overrides = {}) {
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
    ...overrides,
  });
}

test("admits a request whose claims match the resolved grant", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = scope();
  recordLeaf(authority, s);
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });
  const result = authority.validateGovernedRequest(request(handle));
  assert.equal(result.ok, true);
  assert.equal(result.grantId, "g-1");
});

test("rejects a forged subject principal", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const handle = authority.mintGrant({ grantId: "g-1", scope: scope() });
  const result = authority.validateGovernedRequest(
    request(handle, { subjectPrincipalId: "attacker" }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "subject-mismatch");
});

test("rejects sibling reuse across tasks", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const handle = authority.mintGrant({ grantId: "g-1", scope: scope({ taskId: "task-A" }) });
  const result = authority.validateGovernedRequest(request(handle, { taskId: "task-B" }));
  assert.equal(result.reason, "task-mismatch");
});

test("rejects a delegation-id mismatch", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const handle = authority.mintGrant({ grantId: "g-1", scope: scope() });
  const result = authority.validateGovernedRequest(request(handle, { delegationId: "del-9" }));
  assert.equal(result.reason, "delegation-mismatch");
});

test("rejects an expired grant", () => {
  const t = Date.parse("2026-08-27T13:00:00Z");
  const authority = createGovernedAuthority({ now: () => t });
  const handle = authority.mintGrant({ grantId: "g-1", scope: scope() });
  const result = authority.validateGovernedRequest(request(handle));
  assert.equal(result.reason, "expired");
});

test("rejects a request before the grant is valid", () => {
  const t = Date.parse("2026-08-26T00:00:00Z");
  const authority = createGovernedAuthority({ now: () => t });
  const handle = authority.mintGrant({ grantId: "g-1", scope: scope() });
  const result = authority.validateGovernedRequest(request(handle));
  assert.equal(result.reason, "not-yet-valid");
});

test("rejects a payload path that escapes the granted selectors", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = scope({ resourceSelectors: ["/workspace/project-a"] });
  recordLeaf(authority, s);
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });
  const result = authority.validateGovernedRequest(
    request(handle, { payload: { paths: ["/workspace/project-b/file.txt"] } }),
  );
  assert.equal(result.reason, "path-escape");
});

test("rejects parent-traversal path segments", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = scope({ resourceSelectors: ["/workspace/project-a"] });
  recordLeaf(authority, s);
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });
  const result = authority.validateGovernedRequest(
    request(handle, { payload: { paths: ["/workspace/project-a/../../etc/passwd"] } }),
  );
  assert.equal(result.reason, "path-escape");
});

test("rejects a payload-declared scope that widens the grant", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = scope({ operations: ["read"] });
  recordLeaf(authority, s);
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });
  const result = authority.validateGovernedRequest(
    request(handle, { payload: { requestedScope: scope({ operations: ["read", "write"] }) } }),
  );
  assert.equal(result.reason, "scope-widening");
});

test("rejects an unknown grant handle", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const result = authority.validateGovernedRequest(request("does-not-exist"));
  assert.equal(result.reason, "unknown-handle");
});

test("rejects a grant with no delegation record (chain-missing-record)", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const handle = authority.mintGrant({ grantId: "g-1", scope: scope() });
  const result = authority.validateGovernedRequest(request(handle));
  assert.equal(result.reason, "chain-missing-record");
});

test("rejects a revoked parent delegation (chain-status)", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = scope();
  recordLeaf(authority, s, { status: "revoked" });
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });
  const result = authority.validateGovernedRequest(request(handle));
  assert.equal(result.reason, "chain-status-revoked");
});

test("rejects a lineage break across the delegation chain", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  // Parent subject is "hermes-1", but the child issuer claims "someone-else".
  authority.recordDelegation({
    id: "del-1",
    taskId: "task-1",
    parentDelegationId: null,
    issuerPrincipalId: "user-1",
    subjectPrincipalId: "hermes-1",
    status: "active",
    issuedAt: "2026-08-27T00:00:00Z",
    notBefore: "2026-08-27T00:00:00Z",
    expiresAt: "2026-08-27T12:00:00Z",
    auditCorrelationId: "aud-1",
  });
  authority.recordDelegation({
    id: "del-2",
    taskId: "task-1",
    parentDelegationId: "del-1",
    issuerPrincipalId: "someone-else",
    subjectPrincipalId: "tool-1",
    status: "active",
    issuedAt: "2026-08-27T00:00:00Z",
    notBefore: "2026-08-27T00:00:00Z",
    expiresAt: "2026-08-27T12:00:00Z",
    auditCorrelationId: "aud-1",
  });
  const s = scope({ delegationId: "del-2", issuerPrincipalId: "someone-else", subjectPrincipalId: "tool-1" });
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });
  const result = authority.validateGovernedRequest(
    request(handle, { delegationId: "del-2", subjectPrincipalId: "tool-1" }),
  );
  assert.equal(result.reason, "chain-lineage-break");
});

test("accepts a valid multi-edge delegation chain", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  authority.recordDelegation({
    id: "del-1",
    taskId: "task-1",
    parentDelegationId: null,
    issuerPrincipalId: "user-1",
    subjectPrincipalId: "hermes-1",
    status: "active",
    issuedAt: "2026-08-27T00:00:00Z",
    notBefore: "2026-08-27T00:00:00Z",
    expiresAt: "2026-08-27T12:00:00Z",
    auditCorrelationId: "aud-1",
  });
  authority.recordDelegation({
    id: "del-2",
    taskId: "task-1",
    parentDelegationId: "del-1",
    issuerPrincipalId: "hermes-1",
    subjectPrincipalId: "tool-1",
    status: "active",
    issuedAt: "2026-08-27T00:00:00Z",
    notBefore: "2026-08-27T00:00:00Z",
    expiresAt: "2026-08-27T12:00:00Z",
    auditCorrelationId: "aud-1",
  });
  const s = scope({ delegationId: "del-2", issuerPrincipalId: "hermes-1", subjectPrincipalId: "tool-1" });
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });
  const result = authority.validateGovernedRequest(
    request(handle, { delegationId: "del-2", subjectPrincipalId: "tool-1" }),
  );
  assert.equal(result.ok, true);
});

test("rejects a grant with an unresolved approval condition", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = scope({ approvalCondition: "human-approval" });
  recordLeaf(authority, s);
  const handle = authority.mintGrant({ grantId: "g-1", scope: s, status: "approved" });
  const result = authority.validateGovernedRequest(request(handle));
  assert.equal(result.reason, "approval-pending");
});

test("cascades revocation from a parent to its descendants", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const parent = authority.mintGrant({
    grantId: "g-parent",
    scope: scope({
      subjectPrincipalId: "hermes-1",
      issuerPrincipalId: "user-1",
      delegationId: "del-1",
    }),
  });
  const child = authority.mintGrant({
    grantId: "g-child",
    scope: scope({
      subjectPrincipalId: "tool-1",
      issuerPrincipalId: "hermes-1",
      delegationId: "del-2",
    }),
  });
  const grandchild = authority.mintGrant({
    grantId: "g-grandchild",
    scope: scope({
      subjectPrincipalId: "tool.git",
      issuerPrincipalId: "tool-1",
      delegationId: "del-3",
    }),
  });

  authority.revokeDescendants(parent);

  const childResult = authority.validateGovernedRequest(
    request(child, { subjectPrincipalId: "tool-1", delegationId: "del-2" }),
  );
  const grandchildResult = authority.validateGovernedRequest(
    request(grandchild, { subjectPrincipalId: "tool.git", delegationId: "del-3" }),
  );
  assert.equal(childResult.reason, "status-revoked");
  assert.equal(grandchildResult.reason, "status-revoked");
});

test("revokes every grant bound to a task", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const a = authority.mintGrant({ grantId: "g-a", scope: scope({ taskId: "task-X" }) });
  const b = authority.mintGrant({
    grantId: "g-b",
    scope: scope({ taskId: "task-X", delegationId: "del-2" }),
  });
  authority.revokeTask("task-X");

  const aResult = authority.validateGovernedRequest(request(a, { taskId: "task-X" }));
  const bResult = authority.validateGovernedRequest(
    request(b, { taskId: "task-X", delegationId: "del-2" }),
  );
  assert.equal(aResult.reason, "status-revoked");
  assert.equal(bResult.reason, "status-revoked");
});

test("emits decision/request/effect/denial/cancel events and never logs the handle or token", () => {
  const events = [];
  const authority = createGovernedAuthority({
    now: () => T0,
    auditSink: (event) => events.push(event),
  });
  const s = scope();
  recordLeaf(authority, s);
  const handle = authority.mintGrant({
    grantId: "g-1",
    scope: s,
    internalToken: "SECRET-INTERNAL-MINT",
  });
  authority.validateGovernedRequest(
    request(handle, { auditCorrelationId: "aud-1", payload: {} }),
  );
  authority.validateGovernedRequest(
    request(handle, { subjectPrincipalId: "wrong", auditCorrelationId: "aud-2" }),
  );
  authority.revokeGrant(handle, "test-revoke");

  assert.deepEqual(
    events.map((e) => e.kind),
    ["decision", "request", "effect", "request", "denial", "cancel"],
  );
  const serialized = JSON.stringify(events);
  assert.ok(!serialized.includes(handle), "handle must never reach the audit log");
  assert.ok(
    !serialized.includes("SECRET-INTERNAL-MINT"),
    "internal token must never reach the audit log",
  );
});

test("isScopeSubset rejects widening and accepts narrowing", () => {
  const parent = scope();
  assert.equal(isScopeSubset(scope({ operations: ["read"] }), parent), true);
  assert.equal(isScopeSubset(scope({ operations: ["read", "write"] }), parent), false);
  assert.equal(
    isScopeSubset(scope({ resourceSelectors: ["/workspace/project-a", "/other"] }), parent),
    false,
  );
  assert.equal(isScopeSubset(scope({ action: "filesystem" }), parent), false);
});

test("pathsWithinSelectors rejects traversal and out-of-root paths", () => {
  const selectors = ["/workspace/project-a"];
  assert.equal(pathsWithinSelectors(["/workspace/project-a/file.txt"], selectors), true);
  assert.equal(pathsWithinSelectors(["/workspace/project-a"], selectors), true);
  assert.equal(pathsWithinSelectors(["/workspace/project-b/file.txt"], selectors), false);
  assert.equal(pathsWithinSelectors(["/workspace/project-a/../../etc/passwd"], selectors), false);
  assert.equal(pathsWithinSelectors(undefined, selectors), true);
});

test("redactAuditRecord routes grantHandle and token through secret scrubbing", () => {
  const out = redactAuditRecord({
    grantHandle: "Authorization: Bearer leakedtoken123",
    token: "token=supersecret",
  });
  assert.ok(!out.grantHandle.includes("leakedtoken123"));
  assert.ok(!out.token.includes("supersecret"));
});
