// CP-BR7: terminal connection badges derive from the generic runtime projection.
//
// Covers the CP-BR7 §8 req #6 contract. The terminal surface status
// (used by the `Open in Terminal` affordance and the terminal connection
// badges) reads from the generic runtime projection (CP-BR5) rather than
// from a separate terminal-only status path. The legacy
// `GET /terminal-host/status` route remains where it is still consumed.

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBridgeRuntimesView,
  RUNTIME_STATUS_LABELS,
} from "../resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-view.js";

// CP-BR7 §5.5: the projection is the source of truth for the terminal
// connection badges. The Bridge & Runtimes surface (CP-BR6) already
// renders runtime status from the projection; CP-BR7 asserts the
// terminal runtime entries carry the public `ready` status when the
// underlying service is alive.

function makeProjection({ runtimes = [] } = {}) {
  return {
    bridgeOverview: {
      status: "connected",
      version: "2.0.0-beta.1",
      endpoint: "http://127.0.0.1:47773",
      startedAt: "2026-10-06T00:00:00.000Z",
      uptimeSeconds: 12,
      generation: 1,
      instanceId: "instance-1",
      bootEpoch: "epoch-1",
      publicFailureCode: null,
    },
    runtimeList: runtimes,
    connectorList: [],
    activeSessions: [],
    projectionGeneration: 1,
    producedAt: "2026-10-06T00:00:00.000Z",
    updateMechanism: "polling",
  };
}

const TERMINAL_RUNTIME = {
  addonId: "addon.resonant-terminal-ghostty",
  runtimeId: "addon.resonant-terminal-ghostty",
  runtimeType: "local-service",
  status: "ready",
  generation: 1,
  activeSessionCount: 1,
  startedAt: "2026-10-06T00:00:00.000Z",
  lastTransitionAt: "2026-10-06T00:00:00.000Z",
  publicFailureCode: null,
  factoryId: "com.resonantos.factory.terminal-host.ghostty",
  classification: "local-service",
  displayLabel: "Ghostty",
};

// ---------------------------------------------------------------------------
// Req #6: connection badges derive from the generic runtime projection
// ---------------------------------------------------------------------------

test("CP-BR7 req #6: terminal runtime status surfaces in the projection as 'ready' when alive", () => {
  const projection = makeProjection({ runtimes: [TERMINAL_RUNTIME] });
  const bootstrap = {
    status: "connected",
    failureCode: null,
    endpoint: "http://127.0.0.1:47773",
    version: "2.0.0-beta.1",
    instanceId: "instance-1",
    generation: 1,
    startedAt: "2026-10-06T00:00:00.000Z",
    retries: 0,
    lastDisconnectAt: null,
  };
  const view = buildBridgeRuntimesView({ projection, bootstrapSnapshot: bootstrap });
  const ghostty = view.runtimes.find((r) => r.addonId === "addon.resonant-terminal-ghostty");
  assert.ok(ghostty, "Ghostty runtime is present in the projection");
  assert.equal(ghostty.status, "ready");
  assert.equal(ghostty.statusLabel, RUNTIME_STATUS_LABELS.ready);
  assert.equal(ghostty.tone, "ok");
  assert.equal(ghostty.activeSessionCount, 1);
});

test("CP-BR7 req #6: terminal runtime surfaces as 'degraded' with a public failure code", () => {
  const projection = makeProjection({
    runtimes: [
      {
        ...TERMINAL_RUNTIME,
        status: "degraded",
        publicFailureCode: "addon-health-stale",
      },
    ],
  });
  const bootstrap = {
    status: "connected",
    failureCode: null,
    endpoint: "http://127.0.0.1:47773",
    version: "2.0.0-beta.1",
    instanceId: "instance-1",
    generation: 1,
    startedAt: "2026-10-06T00:00:00.000Z",
    retries: 0,
    lastDisconnectAt: null,
  };
  const view = buildBridgeRuntimesView({ projection, bootstrapSnapshot: bootstrap });
  const ghostty = view.runtimes.find((r) => r.addonId === "addon.resonant-terminal-ghostty");
  assert.equal(ghostty.status, "degraded");
  assert.equal(ghostty.publicFailureCode, "addon-health-stale");
  assert.equal(ghostty.tone, "warn");
});

test("CP-BR7 req #6: terminal runtime surfaces as 'inactive' when disabled", () => {
  const projection = makeProjection({
    runtimes: [{ ...TERMINAL_RUNTIME, status: "inactive" }],
  });
  const bootstrap = {
    status: "connected",
    failureCode: null,
    endpoint: "http://127.0.0.1:47773",
    version: "2.0.0-beta.1",
    instanceId: "instance-1",
    generation: 1,
    startedAt: "2026-10-06T00:00:00.000Z",
    retries: 0,
    lastDisconnectAt: null,
  };
  const view = buildBridgeRuntimesView({ projection, bootstrapSnapshot: bootstrap });
  const ghostty = view.runtimes.find((r) => r.addonId === "addon.resonant-terminal-ghostty");
  assert.equal(ghostty.status, "inactive");
  assert.equal(ghostty.statusLabel, RUNTIME_STATUS_LABELS.inactive);
});

test("CP-BR7 req #6: the projection never carries a secret-shaped terminal field", () => {
  const hostile = {
    ...TERMINAL_RUNTIME,
    token: "Bearer abcdef-secret",
    pid: 1234,
    childArgv: ["--secret"],
  };
  const projection = makeProjection({ runtimes: [hostile] });
  // The view model rejects the projection because of the unknown `token` field.
  assert.throws(
    () => buildBridgeRuntimesView({
      projection,
      bootstrapSnapshot: { status: "connected", failureCode: null, endpoint: null, version: null, instanceId: null, generation: null, startedAt: null, retries: 0, lastDisconnectAt: null },
    }),
    /unknown field/i,
  );
});
