// Intent citation: docs/architecture/resonantos-browser-architecture/10-ground-0-recovery.md
import assert from "node:assert/strict";
import test from "node:test";

import { createGovernedAuthority } from "../host/bridge-governed-authority.mjs";
import { createKnownGoodSet } from "../host/ground-zero.mjs";
import { createGroundZeroService } from "../host/ground-zero-service.mjs";

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
    subjectPrincipalId: "harness-1",
    grantHandle: handle,
    auditCorrelationId: "aud-1",
    ...overrides,
  };
}

const surface = [
  { id: "harness:hermes", kind: "harness" },
  { id: "harness:opencode", kind: "harness" },
  { id: "extension:augmentor-effect", kind: "extension" },
];

function makeService(authority, inventory = surface) {
  return createGroundZeroService({
    governedAuthority: authority,
    surfaceInventory: () => inventory,
    now: () => T0,
  });
}

test("enter revokes every active grant and marks the surface disabled", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = scope();
  recordLeaf(authority, s);
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });
  const service = makeService(authority);

  const snapshot = service.enter({ trigger: "crash-loop" });

  assert.equal(snapshot.state, "ground-zero");
  assert.equal(service.isDisabled(), true);
  assert.deepEqual(snapshot.activeGrantIds, []);
  assert.equal(authority.listActiveGrants().length, 0);
  assert.equal(authority.validateGovernedRequest(request(handle)).reason, "status-revoked");
});

test("enter snapshots the live surface and records a transition", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = scope();
  recordLeaf(authority, s);
  authority.mintGrant({ grantId: "g-1", scope: s });
  const service = makeService(authority);

  const snapshot = service.enter({ trigger: "manual", at: "t1" });

  assert.deepEqual(
    snapshot.quarantine.map((q) => q.item),
    ["harness:hermes", "harness:opencode", "extension:augmentor-effect"],
  );
  assert.equal(snapshot.audit.length, 1);
  assert.equal(snapshot.audit[0].trigger, "manual");
});

test("exit resumes healthy items and leaves unhealthy ones disabled", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const service = makeService(authority);
  service.enter({ trigger: "crash-loop" });

  const resumed = [];
  const snapshot = service.exit({
    order: ["harness:hermes", "harness:opencode", "extension:augmentor-effect"],
    healthCheck: (id) => id !== "harness:opencode",
    resumeItem: (id) => resumed.push(id),
  });

  assert.equal(snapshot.state, "normal");
  assert.equal(service.isDisabled(), false);
  assert.deepEqual(resumed, ["harness:hermes", "extension:augmentor-effect"]);
  assert.deepEqual(
    snapshot.activeGrantIds,
    ["fresh-grant:harness:hermes", "fresh-grant:extension:augmentor-effect"],
  );
  assert.equal(
    snapshot.quarantine.find((q) => q.item === "harness:opencode").disposition,
    "left-disabled",
  );
});

test("refuses to exit from a non-ground-zero state", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const service = makeService(authority);
  assert.throws(
    () => service.exit({ order: [], healthCheck: () => true }),
    /cannot exit Ground-0/,
  );
});

test("refuses to enter twice without an intervening exit", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const service = makeService(authority);
  service.enter({ trigger: "manual" });
  assert.throws(() => service.enter({ trigger: "manual" }), /cannot enter Ground-0/);
});

test("full cycle: enter, exit, then re-enter revokes the fresh authority", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const service = makeService(authority);
  service.enter({ trigger: "crash-loop" });
  service.exit({ order: surface.map((s) => s.id), healthCheck: () => true });

  const reentered = service.enter({ trigger: "rollback" });
  assert.equal(reentered.state, "ground-zero");
  assert.equal(service.isDisabled(), true);
  // Audit history is preserved across the full cycle.
  assert.equal(reentered.audit.length, 3);
});

test("enter proceeds with a verified known-good set", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const good = createKnownGoodSet({ version: "1", manifestIds: ["overview"] });
  const service = createGroundZeroService({
    governedAuthority: authority,
    surfaceInventory: () => surface,
    now: () => T0,
    knownGood: good,
  });
  assert.equal(service.enter({ trigger: "manual" }).state, "ground-zero");
});

test("enter fails closed on a tampered known-good set, without revoking", () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = scope();
  recordLeaf(authority, s);
  authority.mintGrant({ grantId: "g-1", scope: s });
  const good = createKnownGoodSet({ version: "1", manifestIds: ["overview"] });
  const tampered = { ...good, manifestIds: [...good.manifestIds, "injected"] };
  const service = createGroundZeroService({
    governedAuthority: authority,
    surfaceInventory: () => surface,
    now: () => T0,
    knownGood: tampered,
  });

  assert.throws(
    () => service.enter({ trigger: "crash-loop" }),
    /known-good manifest set failed integrity check/,
  );
  // The integrity gate fires before any revocation — the grant survives.
  assert.equal(authority.listActiveGrants().length, 1);
});
