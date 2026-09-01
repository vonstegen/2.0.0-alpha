// Intent citation: docs/architecture/resonantos-browser-architecture/CP5-PHASE5-CONTINUATION.md
// Intent citation: docs/architecture/resonantos-browser-architecture/IMPLEMENTATION_TRACKING.md (row 99)
//
// CP-5 Phase 5 row 99: unit tests for the bridge-side workspace-lease
// registry. The bridge uses this registry to gate `opencodeRuntimeDispatch`
// (and only that transport — Hermes, OpenClaw, etc. are out of scope for
// Phase 5 §5.1.1). The registry is the single authority on which workspace
// is held; every consumer must go through it.

import assert from "node:assert/strict";
import test from "node:test";

import { makeRegistry, defaultRegistry, DEFAULT_TTL_MS } from "../host/workspace-lease.mjs";

function withClock(initial = 1_700_000_000_000) {
  let now = initial;
  return {
    now: () => now,
    advance: (ms) => { now += ms; },
  };
}

test("acquire returns a lease and release removes it", () => {
  const clock = withClock();
  const registry = makeRegistry({ now: clock.now });
  const lease = registry.acquire({ resourceId: "/tmp/ws-a", holder: "task:1" });
  assert.equal(lease.ok, true);
  assert.equal(typeof lease.leaseId, "string");
  assert.equal(lease.resourceId, "/tmp/ws-a");
  assert.equal(lease.holder, "task:1");
  assert.equal(lease.expiresAt, clock.now() + DEFAULT_TTL_MS);
  assert.equal(registry.size(), 1);

  const inspect = registry.inspect(lease.leaseId);
  assert.equal(inspect.resourceId, "/tmp/ws-a");

  const release = registry.release(lease.leaseId);
  assert.equal(release.ok, true);
  assert.equal(registry.size(), 0);
  assert.equal(registry.inspect(lease.leaseId), null);
});

test("acquire rejects a second holder for the same resource", () => {
  const registry = makeRegistry();
  const first = registry.acquire({ resourceId: "/tmp/ws-b", holder: "task:1" });
  assert.equal(first.ok, true);
  const second = registry.acquire({ resourceId: "/tmp/ws-b", holder: "task:2" });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "conflict");
  assert.equal(second.currentHolder, "task:1");
  assert.equal(typeof second.expiresAt, "number");
});

test("different resources do not conflict", () => {
  const registry = makeRegistry();
  const a = registry.acquire({ resourceId: "/tmp/ws-c", holder: "task:1" });
  const b = registry.acquire({ resourceId: "/tmp/ws-d", holder: "task:1" });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(registry.size(), 2);
});

test("expired leases are pruned on the next acquire", () => {
  const clock = withClock();
  const registry = makeRegistry({ now: clock.now });
  const a = registry.acquire({ resourceId: "/tmp/ws-e", holder: "task:1", ttlMs: 1000 });
  assert.equal(a.ok, true);
  clock.advance(2000);
  const b = registry.acquire({ resourceId: "/tmp/ws-e", holder: "task:2" });
  assert.equal(b.ok, true, "the expired lease should have been pruned");
  assert.equal(b.currentHolder, undefined);
});

test("acquire rejects an empty resourceId or holder", () => {
  const registry = makeRegistry();
  assert.equal(registry.acquire({ resourceId: "", holder: "task:x" }).ok, false);
  assert.equal(registry.acquire({ resourceId: "/tmp", holder: "" }).ok, false);
  assert.equal(registry.acquire({}).ok, false);
});

test("release rejects unknown or empty lease ids", () => {
  const registry = makeRegistry();
  assert.equal(registry.release("").ok, false);
  assert.equal(registry.release("not-a-lease").ok, false);
});

test("custom idFactory and ttlMs are honored", () => {
  const clock = withClock();
  const registry = makeRegistry({ idFactory: () => "fixed-id", defaultTtlMs: 1234, now: clock.now });
  const lease = registry.acquire({ resourceId: "/tmp/ws-f", holder: "task:1" });
  assert.equal(lease.leaseId, "fixed-id");
  assert.equal(lease.expiresAt, clock.now() + 1234);
});

test("defaultRegistry is a working process-global registry", () => {
  // The default registry is a singleton. The test must use a unique
  // resourceId to avoid colliding with other test cases that may have
  // left state behind. We clean up at the end.
  const resourceId = `/tmp/ws-default-${Date.now()}-${Math.random()}`;
  const lease = defaultRegistry.acquire({ resourceId, holder: "task:default" });
  assert.equal(lease.ok, true);
  defaultRegistry.release(lease.leaseId);
});
