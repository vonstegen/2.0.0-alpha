// Intent citation: docs/architecture/resonantos-browser-architecture/04-augmentor-extension-model.md
// Intent citation: docs/architecture/ADR-054-principal-delegation-chain-task-scoped-authority.md
import assert from "node:assert/strict";
import test from "node:test";

import { dispatchGovernedAugmentorExtension } from "../host/augmentor-extension-dispatcher.mjs";
import { createGovernedAuthority } from "../host/bridge-governed-authority.mjs";

const T0 = Date.parse("2026-08-27T06:00:00Z");

function scope(overrides = {}) {
  return {
    action: "archive-read",
    resourceSelectors: ["/workspace/project-a"],
    operations: ["read"],
    taskId: "task-1",
    delegationId: "del-1",
    issuerPrincipalId: "user-1",
    subjectPrincipalId: "augmentor-1",
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

function request(handle, overrides = {}) {
  return {
    taskId: "task-1",
    delegationId: "del-1",
    subjectPrincipalId: "augmentor-1",
    grantHandle: handle,
    auditCorrelationId: "aud-1",
    payload: {
      extensionId: "addon.augmentor-skill-example",
      kind: "skill",
      input: { workspaceTree: "/workspace/project-a" },
      requiredCapabilities: ["archive-read"],
      pendingApprovalGates: [],
    },
    ...overrides,
  };
}

function makeAuthority() {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = scope();
  recordLeaf(authority, s);
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });
  return { authority, handle };
}

const runEffect = async (invocation) => ({
  status: "ok",
  extensionId: invocation.extensionId,
  evidence: [],
  actionsTaken: ["read workspace tree"],
  approvedGates: [],
  auditCorrelationId: invocation.invocationId,
});

test("invokes an extension under a task grant when its declared capability is granted", async () => {
  const { authority, handle } = makeAuthority();
  const result = await dispatchGovernedAugmentorExtension({
    request: request(handle),
    governedAuthority: authority,
    runEffect,
  });
  assert.equal(result.outcome, "allow");
  assert.deepEqual(result.effectiveCapabilities, ["archive-read"]);
  assert.equal(result.result.status, "ok");
});

test("denies a capability the grant does not cover (Core authorizes every effect)", async () => {
  const { authority, handle } = makeAuthority();
  const result = await dispatchGovernedAugmentorExtension({
    request: request(handle, { payload: { extensionId: "addon.x", kind: "tool", input: {}, requiredCapabilities: ["network"] } }),
    governedAuthority: authority,
    runEffect,
  });
  assert.equal(result.outcome, "deny");
  assert.equal(result.reason, "capability-not-granted");
  assert.match(result.detail, /network/);
});

test("denies a forged subject before any effect", async () => {
  const { authority, handle } = makeAuthority();
  const result = await dispatchGovernedAugmentorExtension({
    request: request(handle, { subjectPrincipalId: "attacker" }),
    governedAuthority: authority,
    runEffect,
  });
  assert.equal(result.outcome, "deny");
  assert.equal(result.reason, "subject-mismatch");
});

test("denies an expired grant before any effect", async () => {
  const authority = createGovernedAuthority({ now: () => Date.parse("2026-08-27T13:00:00Z") });
  const s = scope();
  recordLeaf(authority, s);
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });
  const result = await dispatchGovernedAugmentorExtension({
    request: request(handle),
    governedAuthority: authority,
    runEffect,
  });
  assert.equal(result.outcome, "deny");
  assert.equal(result.reason, "expired");
});

test("authorizes each invocation independently (valid allows, widened denies)", async () => {
  const { authority, handle } = makeAuthority();
  const allowed = await dispatchGovernedAugmentorExtension({
    request: request(handle),
    governedAuthority: authority,
    runEffect,
  });
  const widened = await dispatchGovernedAugmentorExtension({
    request: request(handle, { payload: { extensionId: "addon.y", kind: "tool", input: {}, requiredCapabilities: ["archive-read", "archive-intake-write"] } }),
    governedAuthority: authority,
    runEffect,
  });
  assert.equal(allowed.outcome, "allow");
  assert.deepEqual(allowed.effectiveCapabilities, ["archive-read"]);
  assert.equal(widened.outcome, "deny");
  assert.equal(widened.reason, "capability-not-granted");
});

test("denies when the host-mediated effect executor is not configured", async () => {
  const { authority, handle } = makeAuthority();
  const result = await dispatchGovernedAugmentorExtension({
    request: request(handle),
    governedAuthority: authority,
    // runEffect omitted -> effect-unavailable
  });
  assert.equal(result.outcome, "deny");
  assert.equal(result.reason, "effect-unavailable");
});
