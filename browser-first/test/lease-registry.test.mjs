// Intent citation: docs/architecture/resonantos-browser-architecture/11-resource-governance.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkspaceLeaseRegistry,
} from "../host/workspace-lease.mjs";
import {
  LEASE_KINDS,
  makeLeaseRegistry,
} from "../host/lease-registry.mjs";

test("makeLeaseRegistry exposes all five LeaseKinds via the same acquire API", () => {
  const registry = makeLeaseRegistry();
  for (const kind of LEASE_KINDS) {
    const result = registry.acquire({
      resourceKind: kind,
      resourceId: `${kind}-res-1`,
      holderPrincipalId: "u1",
      ttlMs: 1_000,
    });
    assert.equal(result.ok, true, `${kind} acquire should succeed`);
    assert.equal(result.lease.resourceKind, kind);
  }
  assert.deepEqual(
    registry.list().map((l) => l.resourceKind).sort(),
    [...LEASE_KINDS].sort(),
  );
});

test("makeLeaseRegistry conflict checks cross-exclusivity across all 5 kinds", () => {
  const registry = makeLeaseRegistry();
  const first = registry.acquire({
    resourceKind: "gpu",
    resourceId: "gpu-a",
    holderPrincipalId: "u1",
    exclusive: true,
    ttlMs: 1_000,
  });
  assert.equal(first.ok, true);
  const conflicting = registry.acquire({
    resourceKind: "gpu",
    resourceId: "gpu-a",
    holderPrincipalId: "u2",
    exclusive: true,
    ttlMs: 1_000,
  });
  assert.equal(conflicting.ok, false);
  assert.equal(conflicting.conflictingWith, first.leaseId);
});

test("makeLeaseRegistry shared leases of the same resource coexist", () => {
  const registry = makeLeaseRegistry();
  const first = registry.acquire({
    resourceKind: "provider-route",
    resourceId: "openai-default",
    exclusive: false,
    ttlMs: 1_000,
  });
  const second = registry.acquire({
    resourceKind: "provider-route",
    resourceId: "openai-default",
    exclusive: false,
    ttlMs: 1_000,
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
});

test("makeLeaseRegistry wraps the CP-5 workspace lease surface — same acquire call goes to both views", () => {
  const workspace = createWorkspaceLeaseRegistry({
    now: () => Date.parse("2026-09-02T00:00:00Z"),
  });
  const unified = makeLeaseRegistry({ workspaceLeaseRegistry: workspace });
  const result = unified.acquire({
    resourceKind: "workspace",
    resourceId: "/workspace/project-a",
    holderPrincipalId: "u1",
    ttlMs: 30_000,
  });
  assert.equal(result.ok, true);
  // Both views see the lease.
  assert.ok(unified.inspect(result.leaseId), "unified registry must see the lease");
  assert.ok(workspace.inspect(result.leaseId), "workspace registry must see the lease");
  assert.equal(unified.size({ kind: "workspace" }), 1);
  assert.equal(workspace.size(), 1);
  // Releases through either registry clean both.
  unified.release(result.leaseId);
  assert.equal(unified.size({ kind: "workspace" }), 0);
  assert.equal(workspace.size(), 0);
});

test("createWorkspaceLeaseRegistry exercises the existing CP-5 surface unchanged", () => {
  const now = () => Date.parse("2026-09-02T00:00:00Z");
  const registry = createWorkspaceLeaseRegistry({ now });
  const a = registry.acquire({ resourceId: "/workspace/p", holderPrincipalId: "u1" });
  assert.equal(a.ok, true);
  assert.equal(a.lease.resourceKind, "workspace");
  assert.equal(registry.inspect(a.leaseId)?.resourceId, "/workspace/p");
  assert.equal(registry.size(), 1);
  const conflict = registry.acquire({ resourceId: "/workspace/p", holderPrincipalId: "u2" });
  assert.equal(conflict.ok, false);
  assert.equal(registry.release(a.leaseId), true);
  // After release the conflict is gone.
  const reAcquire = registry.acquire({ resourceId: "/workspace/p", holderPrincipalId: "u2" });
  assert.equal(reAcquire.ok, true);
  registry.clear();
  assert.equal(registry.size(), 0);
});

test("makeLeaseRegistry.wrapWorkspaceLease forwards every call to the CP-5 surface", () => {
  const workspace = createWorkspaceLeaseRegistry({
    now: () => Date.parse("2026-09-02T00:00:00Z"),
  });
  const unified = makeLeaseRegistry({ workspaceLeaseRegistry: workspace });
  const wrapped = unified.wrapWorkspaceLease(workspace);
  const a = wrapped.acquire({ resourceId: "/x", holderPrincipalId: "u1" });
  assert.equal(a.ok, true);
  assert.equal(workspace.size(), 1);
  assert.equal(wrapped.size(), 1);
  assert.ok(wrapped.inspect(a.leaseId));
  wrapped.release(a.leaseId);
  assert.equal(workspace.size(), 0);
  const clearedAcquire = wrapped.acquire({ resourceId: "/x", holderPrincipalId: "u1" });
  assert.equal(clearedAcquire.ok, true);
  wrapped.clear();
  assert.equal(workspace.size(), 0);
});
