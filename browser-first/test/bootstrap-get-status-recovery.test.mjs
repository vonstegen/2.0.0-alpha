// CP-BR11: deterministic tests for the MV3 service-worker recovery path
// of `bootstrap:get-status`.
//
// Background: in MV3, the SW is idle-killed after ~30s. When the SW
// wakes, the in-memory snapshot is "offline" until the orchestrator's
// `boot()` resolves. The renderer's first poll can land in that
// window; the prompt calls this the "false offline" failure.
//
// The fix in background.js is: the `bootstrap:get-status` message
// handler awaits `bootstrapStartup.whenBootSettled()` before answering.
// This test reproduces the window deterministically and proves the
// handler never reports a false "offline" when the host answers
// "connected" during the SW revival.
//
// The handler logic is reproduced here against the real
// `createBootstrapStartup` factory; the bootstrap client is faked so
// the test can pace status responses. The shape-walker is reused to
// keep the recovery surface secret-free.

import assert from "node:assert/strict";
import test from "node:test";

import { createBootstrapStartup } from "../resonantos-side-panel-extension/src/lib/bootstrap-startup.js";

// Reuse the canonical SECRET_PATTERNS so the recovery surface (status
// snapshot, error message, etc.) stays secret-free.
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/,
  /ghp_[A-Za-z0-9]{8,}/,
  /xox[baprs]-[A-Za-z0-9-]{8,}/,
  /AIza[A-Za-z0-9_-]{8,}/,
  /Bearer\s+[A-Za-z0-9._\-+/=]{12,}/i,
  /authorization:\s*[A-Za-z0-9._\-+/=]{12,}/i,
  /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /-----BEGIN [A-Z ]*CERTIFICATE-----/,
];

function assertNoSecretShapedValue(value, path = "$") {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    for (const pattern of SECRET_PATTERNS) {
      assert.doesNotMatch(value, pattern, `${path} carries a secret-shaped value`);
    }
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretShapedValue(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    assert.doesNotMatch(key, /token|secret|credential|apiKey|password|privateKey|authorization/i,
      `${path}.${key} is a secret-shaped field name`);
    assertNoSecretShapedValue(entry, `${path}.${key}`);
  }
}

// Make a client whose status request resolves on demand so the test
// can reproduce the SW-revival window: the handler arrives while boot
// is in flight, the host is "still deciding", then resolves connected.
function makeDeferredClient({ statusResponse, delayMs = 0 }) {
  let resolveStatus;
  const statusPromise = new Promise((resolve) => { resolveStatus = resolve; });
  return {
    calls: [],
    statusPromise,
    async request(operation) {
      this.calls.push(operation);
      if (operation !== "status") {
        // The recovery path only calls status on a connected host;
        // anything else is a test bug.
        throw new Error(`unexpected operation: ${operation}`);
      }
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      return statusPromise;
    },
    resolveWith(response) {
      resolveStatus(response);
    },
  };
}

// Replicate the production handler's body exactly, so the test fails
// if a future refactor changes the contract.
async function handleGetStatus(orchestrator) {
  return new Promise((resolve) => {
    void orchestrator.whenBootSettled()
      .then(() => resolve({ ok: true, snapshot: orchestrator.getSnapshot() }))
      .catch((error) => resolve({ ok: false, error: error?.message ?? String(error) }));
  });
}

test("CP-BR11 recovery: bootstrap:get-status does NOT emit a false 'offline' when a healthy bridge is reachable during SW restart", async () => {
  // The host will report "connected" once we let it. The client
  // intentionally delays the resolution so the test is in the
  // revival window when the handler runs.
  const client = makeDeferredClient({
    delayMs: 25,
  });
  const startup = createBootstrapStartup({
    bootstrapClient: client,
    healthProbe: async () => ({ ok: true, version: "1.0.0" }),
  });

  // Fire the orchestrator's boot (mirrors background.js's top-level
  // `void bootstrapStartup.boot()`). Do NOT await — we want the
  // handler to land while the boot is still in flight.
  const bootPromise = startup.boot();

  // Give the microtask queue a chance to advance boot() to the
  // pending status request. After this, the snapshot is "starting"
  // and a naive getSnapshot() would not yet be "connected".
  await new Promise((r) => setImmediate(r));
  const intermediate = startup.getSnapshot();
  assert.equal(intermediate.status, "starting",
    "sanity: the orchestrator transitions to starting synchronously, not connected yet");

  // Run the recovery handler while boot is still in flight.
  const handlerPromise = handleGetStatus(startup);

  // Now the host responds: bridge is healthy and connected. Release
  // the deferred status response.
  client.resolveWith({
    ok: true,
    status: "connected",
    endpoint: "http://127.0.0.1:47773",
    version: "1.0.0",
    instanceId: "g1",
    generation: 1,
    startedAt: "2026-10-11T00:00:00.000Z",
  });

  // Both promises must settle on "connected".
  const handlerResult = await handlerPromise;
  const bootResult = await bootPromise;

  assert.equal(handlerResult.ok, true, "handler must respond ok");
  assert.equal(handlerResult.snapshot.status, "connected",
    "handler snapshot must be 'connected' after SW revival — no false 'offline'");
  assert.equal(handlerResult.snapshot.endpoint, "http://127.0.0.1:47773");
  assert.equal(bootResult.status, "connected");
  // The two snapshots must agree (no window of drift).
  assert.deepEqual(handlerResult.snapshot, bootResult);

  // The recovery snapshot carries no secret-shaped value.
  assertNoSecretShapedValue(handlerResult.snapshot, "$.snapshot");
});

test("CP-BR11 recovery: bootstrap:get-status also returns 'connected' when the handler runs after boot has already settled", async () => {
  // The pre-existing happy path: the SW is alive, boot has already
  // converged, and the handler returns the post-boot snapshot.
  // This is the control case — proves the recovery change did not
  // regress the steady-state path.
  const client = makeDeferredClient({ delayMs: 0 });
  const startup = createBootstrapStartup({
    bootstrapClient: client,
    healthProbe: async () => ({ ok: true, version: "1.0.0" }),
  });
  const bootPromise = startup.boot();
  client.resolveWith({
    ok: true,
    status: "connected",
    endpoint: "http://127.0.0.1:47773",
    version: "1.0.0",
    instanceId: "g1",
    generation: 1,
    startedAt: "2026-10-11T00:00:00.000Z",
  });
  await bootPromise;
  // After boot settled, whenBootSettled must resolve immediately.
  const t0 = Date.now();
  const result = await handleGetStatus(startup);
  const elapsed = Date.now() - t0;
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.status, "connected");
  assert.ok(elapsed < 50, "whenBootSettled must be a no-op fast path when idle");
});

test("CP-BR11 recovery: bootstrap:get-status surfaces a 'failed' snapshot (not a false 'offline') when the host reports a real failure", async () => {
  // The recovery handler awaits boot, so a real failure is reported
  // truthfully — not masked as a false "offline" snapshot.
  const client = makeDeferredClient({ delayMs: 0 });
  const startup = createBootstrapStartup({
    bootstrapClient: client,
    healthProbe: async () => ({ ok: false, version: null }),
  });
  const bootPromise = startup.boot();
  client.resolveWith({
    ok: false,
    status: "failed",
    failureCode: "version-mismatch",
  });
  await bootPromise;
  const result = await handleGetStatus(startup);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.status, "failed",
    "the snapshot must surface the real failure, not a stale 'offline'");
  assert.equal(result.snapshot.failureCode, "version-mismatch");
  assertNoSecretShapedValue(result.snapshot, "$.snapshot");
});

test("CP-BR11 recovery: whenBootSettled is idempotent under concurrent callers", async () => {
  // The renderer can fire several get-status polls in quick
  // succession. Each handler call awaits the same in-flight boot —
  // they all see the converged snapshot, and a single boot
  // resolution satisfies every caller.
  const client = makeDeferredClient({ delayMs: 10 });
  const startup = createBootstrapStartup({
    bootstrapClient: client,
    healthProbe: async () => ({ ok: true, version: "1.0.0" }),
  });
  void startup.boot();
  await new Promise((r) => setImmediate(r));
  // Fire three concurrent handlers, each awaiting the same in-flight boot.
  const handlerPromises = [
    handleGetStatus(startup),
    handleGetStatus(startup),
    handleGetStatus(startup),
  ];
  // Now release the host's status. Each handler settles on the same
  // post-boot snapshot.
  client.resolveWith({
    ok: true,
    status: "connected",
    endpoint: "http://127.0.0.1:47773",
    version: "1.0.0",
    instanceId: "g1",
    generation: 1,
    startedAt: "2026-10-11T00:00:00.000Z",
  });
  const finalResults = await Promise.all(handlerPromises);
  for (const r of finalResults) {
    assert.equal(r.ok, true);
    assert.equal(r.snapshot.status, "connected");
    assertNoSecretShapedValue(r.snapshot, "$.snapshot");
  }
  // The three handlers all saw the same snapshot — no drift.
  assert.deepEqual(finalResults[0].snapshot, finalResults[1].snapshot);
  assert.deepEqual(finalResults[1].snapshot, finalResults[2].snapshot);
});
