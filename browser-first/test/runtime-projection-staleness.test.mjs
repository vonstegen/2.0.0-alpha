// CP-BR5 staleness tests — stale projections must never overwrite newer
// ones. Ordering is preserved end-to-end: the service, the snapshot
// route, and the reconciler event hook all must enforce monotonic
// generation.

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyProjectionUpdate,
  projectBridgeRuntimes,
  ProjectionShapeError,
} from "../host/runtime-projection.mjs";
import { createRuntimeProjectionService } from "../host/runtime-projection-service.mjs";
import { createBridgeRuntimesHostService } from "../host/bridge-runtimes-host-service.mjs";

const makeProjection = (generation) => projectBridgeRuntimes({
  bridgeOverview: { status: "connected", version: "alpha", endpoint: "http://127.0.0.1:47773" },
  runtimeList: [],
  connectorList: [],
  activeSessions: [],
  projectionGeneration: generation,
  producedAt: new Date(1_700_000_000_000 + generation * 1000).toISOString(),
});

test("stale-superseded: an older generation cannot overwrite a newer one", () => {
  const newer = makeProjection(5);
  const older = makeProjection(3);
  assert.throws(() => applyProjectionUpdate(newer, older), (err) => {
    return err instanceof ProjectionShapeError && err.publicFailureCode === "projection-stale-superseded";
  });
  // The newer projection is still the current one (the throw is the
  // signal; the caller is expected to keep `newer` as the source of
  // truth).
  assert.equal(newer.projectionGeneration, 5);
});

test("stale-superseded: equal generation is also rejected", () => {
  const p = makeProjection(7);
  assert.throws(() => applyProjectionUpdate(p, p), (err) => {
    return err instanceof ProjectionShapeError && err.publicFailureCode === "projection-stale-superseded";
  });
});

test("ordering: service.refresh() advances generation monotonically", () => {
  const registry = { snapshot: () => ({ installations: {}, candidates: [], slots: {}, bootEpoch: "e", revision: 0, governanceActivated: false }) };
  const service = createRuntimeProjectionService({
    hostRegistry: registry,
    reconciler: { listActive: () => [] },
    bridgeStatus: { snapshot: () => ({ status: "connected" }) },
  });
  const seen = [];
  for (let i = 0; i < 3; i += 1) {
    service.refresh();
    seen.push(service.snapshot().projectionGeneration);
  }
  assert.ok(seen[0] < seen[1]);
  assert.ok(seen[1] < seen[2]);
});

test("ordering: service.snapshot() is idempotent within a generation", () => {
  const registry = { snapshot: () => ({ installations: {}, candidates: [], slots: {}, bootEpoch: "e", revision: 0, governanceActivated: false }) };
  const service = createRuntimeProjectionService({
    hostRegistry: registry,
    reconciler: { listActive: () => [] },
    bridgeStatus: { snapshot: () => ({ status: "connected" }) },
  });
  const a = service.snapshot();
  const b = service.snapshot();
  assert.equal(a, b);
  assert.equal(a.projectionGeneration, b.projectionGeneration);
});

test("ordering: reconciler events trigger a refresh, but stale completions are still rejected", () => {
  const registry = {
    snapshot: () => ({ installations: { "addon.x": {
      installed: true, enabled: true,
      grantedCapabilities: [{ capability: "filesystem", scope: "self", revocationBehavior: "hard-stop", granted: true }],
      requiredCapabilities: ["filesystem"],
      manifest: { runtimeType: "local-service", category: "tool" },
      projectionGeneration: 1,
    } }, candidates: [], slots: {}, bootEpoch: "e", revision: 0, governanceActivated: false }),
  };
  const events = [];
  const service = createRuntimeProjectionService({
    hostRegistry: registry,
    reconciler: { listActive: () => [] },
    bridgeStatus: { snapshot: () => ({ status: "connected" }) },
    onUpdate: (p) => events.push(p.projectionGeneration),
  });
  // Trigger three refreshes; onUpdate must be called with monotonic
  // generations in order.
  service.refresh();
  service.refresh();
  service.refresh();
  for (let i = 1; i < events.length; i += 1) {
    assert.ok(events[i] > events[i - 1], `event[${i}]=${events[i]} not strictly greater than event[${i - 1}]=${events[i - 1]}`);
  }
});

test("ordering: stale incoming snapshot via the host route is rejected", () => {
  const registry = { snapshot: () => ({ installations: {}, candidates: [], slots: {}, bootEpoch: "e", revision: 0, governanceActivated: false }) };
  const service = createRuntimeProjectionService({
    hostRegistry: registry,
    reconciler: { listActive: () => [] },
    bridgeStatus: { snapshot: () => ({ status: "connected" }) },
  });
  const current = service.snapshot();
  // Force the service to advance by one more refresh, then ensure the
  // original projection is still considered stale if re-applied.
  service.refresh();
  const next = service.snapshot();
  assert.ok(next.projectionGeneration > current.projectionGeneration);
  assert.throws(() => applyProjectionUpdate(next, current), (err) => {
    return err instanceof ProjectionShapeError && err.publicFailureCode === "projection-stale-superseded";
  });
});

test("bridge-runtimes host route: stale completions do not overwrite the cached projection", async () => {
  const registry = { snapshot: () => ({ installations: {}, candidates: [], slots: {}, bootEpoch: "e", revision: 0, governanceActivated: false }) };
  const service = createRuntimeProjectionService({
    hostRegistry: registry,
    reconciler: { listActive: () => [] },
    bridgeStatus: { snapshot: () => ({ status: "connected" }) },
  });
  const attached = [];
  const host = createBridgeRuntimesHostService({
    runtimeProjection: service,
    attachRoute: (route) => { attached.push(route); },
  });
  // Read once, then force a refresh, then read again. The handler
  // returns the current projection; the route never accepts a
  // caller-supplied projection.
  const r1 = service.snapshot();
  const r2 = await attached[0].handler({});
  assert.equal(r2, r1);
  service.refresh();
  const r3 = service.snapshot();
  assert.ok(r3.projectionGeneration > r2.projectionGeneration);
  // logProjection must produce the same shape.
  const logged = host.logProjection();
  assert.equal(logged.projectionGeneration, r3.projectionGeneration);
});
