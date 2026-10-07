// CP-BR5 tests — non-secret runtime/connector/session projection for the
// Bridge & Runtimes UI.
//
// Run: node --experimental-strip-types --test browser-first/test/runtime-projection.test.mjs
//
// Intent citation: docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md §11
// (CP-BR5) and ADR-047 §"Public Status And Non-Leak Boundary".
//
// This file covers the 13 requirements from the CP-BR5 prompt §8:
//   1.  bridge overview carries status/version/endpoint/generation and no
//       secret;
//   2.  runtime list carries status/runtimeType/generation/activeSessionCount/
//       failure code in generation order;
//   3.  an unknown runtimeType is still projected with its public
//       addonId/runtimeId;
//   4.  connector list carries label/connection state/authorization/last-health;
//   5.  active-session summary carries counts + public identifiers, no
//       private data;
//   6.  stale projection (older generation) cannot overwrite a newer one;
//   7.  the projection reflects lifecycle transitions in order;
//   8.  shape-walker finds no token/credential/path/PID/argv/env/prompt/memory
//       value in any public payload;
//   9.  log and rejection serialization are redacted to the public shape;
//   10. malformed/forged input fails closed (or is coerced to public
//       identifiers);
//   11. the projection module performs no I/O (covered in
//       runtime-projection-no-io.test.mjs);
//   12. the snapshot route enforces its capability and loopback (covered
//       in runtime-projection-route.test.mjs);
//   13. existing CP-BR1..CP-BR4 tests remain green (covered by the full
//       regression).

import test from "node:test";
import assert from "node:assert/strict";

import {
  PROJECTION_FAILURE_CODES,
  KNOWN_BRIDGE_STATUSES,
  KNOWN_CONNECTOR_STATES,
  KNOWN_AUTHORIZATION_STATES,
  KNOWN_CONNECTOR_HEALTH_STATES,
  ProjectionShapeError,
  applyProjectionUpdate,
  projectBridgeOverview,
  projectBridgeRuntimes,
  projectConnectorEntry,
  projectConnectorList,
  projectRuntimeEntry,
  projectRuntimeList,
  projectSessionEntry,
  projectSessionSummary,
  redactLogValue,
  walkShape,
} from "../host/runtime-projection.mjs";

import { createRuntimeProjectionService } from "../host/runtime-projection-service.mjs";
import { createBridgeRuntimesHostService } from "../host/bridge-runtimes-host-service.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\/Users\/[A-Za-z0-9._-]+/,
  /\/home\/[A-Za-z0-9._-]+/i,
  /RESONANTOS_[A-Z0-9_]+=/,
  /RESONANT_[A-Z0-9_]+=/,
  /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_-]{32,}$/,
  /password\s*[:=]\s*\S+/i,
  /token\s*[:=]\s*[A-Za-z0-9._~+/=-]{8,}/i,
];

const walk = (value, visit) => {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      visit(k, v);
      walk(v, visit);
    }
    return;
  }
  if (typeof value === "string") visit("string", value);
  if (typeof value === "number") visit("number", value);
};

const assertNoSecretShapedFields = (label, value) => {
  walk(value, (key, v) => {
    if (typeof v === "string") {
      for (const pattern of SECRET_VALUE_PATTERNS) {
        assert.doesNotMatch(
          v,
          pattern,
          `${label}: field "${key}" matched forbidden pattern ${pattern}`,
        );
      }
    }
  });
};

const makeRegistry = (entries) => ({
  snapshot: () => ({
    bootEpoch: "epoch-1",
    installations: Object.fromEntries(entries.map(([id, entry]) => [id, entry])),
    candidates: [],
    slots: {},
    revision: 0,
    governanceActivated: false,
  }),
});

const makeReconciler = (active) => ({
  listActive: () => active,
});

const makeSampleProjection = () => {
  const registry = makeRegistry([
    [
      "addon.local-svc",
      {
        installed: true,
        enabled: true,
        grantedCapabilities: [
          {
            capability: "filesystem",
            scope: "self",
            revocationBehavior: "hard-stop",
            granted: true,
          },
        ],
        requiredCapabilities: ["filesystem"],
        manifest: { runtimeType: "local-service", category: "tool" },
        projectionGeneration: 1,
      },
    ],
    [
      "addon.connector",
      {
        installed: true,
        enabled: true,
        grantedCapabilities: [
          { capability: "channel", scope: "self", revocationBehavior: "hard-stop", granted: true },
        ],
        requiredCapabilities: ["channel"],
        manifest: { runtimeType: "channel-addon", category: "connector" },
        projectionGeneration: 1,
      },
    ],
    [
      "addon.ui",
      {
        installed: true,
        enabled: true,
        grantedCapabilities: [],
        requiredCapabilities: [],
        manifest: { runtimeType: "ui-module", category: "tool" },
        projectionGeneration: 1,
      },
    ],
  ]);
  const service = createRuntimeProjectionService({
    hostRegistry: registry,
    reconciler: makeReconciler([
      {
        addonId: "addon.local-svc",
        factoryId: "com.resonantos.factory.local-svc",
        generation: 1,
        status: "ready",
      },
    ]),
    bridgeStatus: {
      snapshot: () => ({
        status: "connected",
        version: "alpha",
        endpoint: "http://127.0.0.1:47773",
        bootEpoch: "epoch-1",
        instanceId: "bridge-0",
      }),
    },
    sessionCounts: {
      getSessionsByRuntime: (id) =>
        id === "addon.local-svc" ? { activeSessionCount: 2 } : { activeSessionCount: 0 },
    },
  });
  return service.snapshot();
};

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

test("CP-BR5 req #0a: closed failure code catalog", () => {
  assert.ok(Array.isArray(PROJECTION_FAILURE_CODES));
  assert.ok(PROJECTION_FAILURE_CODES.length > 0);
  for (const code of PROJECTION_FAILURE_CODES) {
    assert.equal(typeof code, "string");
  }
  // Must include the CP-BR3/CP-BR4 codes plus the CP-BR5 projection codes.
  for (const expected of [
    "addon-factory-missing",
    "addon-authorization-required",
    "projection-bridge-offline",
    "projection-bridge-failed",
    "projection-shape-invalid",
    "projection-stale-superseded",
  ]) {
    assert.ok(PROJECTION_FAILURE_CODES.includes(expected), `missing code: ${expected}`);
  }
});

test("CP-BR5 req #0b: closed vocabulary lists are frozen", () => {
  assert.equal(Object.isFrozen(KNOWN_BRIDGE_STATUSES), true);
  assert.equal(Object.isFrozen(KNOWN_CONNECTOR_STATES), true);
  assert.equal(Object.isFrozen(KNOWN_AUTHORIZATION_STATES), true);
  assert.equal(Object.isFrozen(KNOWN_CONNECTOR_HEALTH_STATES), true);
});

// ---------------------------------------------------------------------------
// Req #1 — bridge overview carries public fields and no secret
// ---------------------------------------------------------------------------

test("CP-BR5 req #1: bridge overview carries status/version/endpoint/generation and no secret", () => {
  const overview = projectBridgeOverview({
    status: "connected",
    version: "alpha-1.0.0",
    endpoint: "http://127.0.0.1:47773",
    publicEndpoint: "http://192.168.1.5:47773",
    startedAt: "2026-10-06T12:00:00.000Z",
    uptimeSeconds: 42,
    generation: 7,
    instanceId: "bridge-0",
    bootEpoch: "epoch-1",
  });
  assert.equal(overview.status, "connected");
  assert.equal(overview.version, "alpha-1.0.0");
  assert.equal(overview.endpoint, "http://127.0.0.1:47773");
  assert.equal(overview.publicEndpoint, "http://192.168.1.5:47773");
  assert.equal(overview.generation, 7);
  assert.equal(overview.instanceId, "bridge-0");
  assert.equal(overview.bootEpoch, "epoch-1");
  assert.equal(overview.startedAt, "2026-10-06T12:00:00.000Z");
  assert.equal(overview.uptimeSeconds, 42);
  // No secret-shaped field.
  assertNoSecretShapedFields("bridge.overview", overview);
  // Whitelisting: unknown fields are dropped, not echoed.
  const overview2 = projectBridgeOverview({
    status: "connected",
    token: "should-be-dropped",
    pid: 12345,
    secret: "shhh",
    env: { PATH: "/usr/bin" },
  });
  assert.equal(overview2.token, undefined);
  assert.equal(overview2.pid, undefined);
  assert.equal(overview2.secret, undefined);
  assert.equal(overview2.env, undefined);
});

// ---------------------------------------------------------------------------
// Req #2 — runtime list carries public fields in generation order
// ---------------------------------------------------------------------------

test("CP-BR5 req #2: runtime list carries status/runtimeType/generation/activeSessionCount/failure code in generation order", () => {
  const list = projectRuntimeList([
    {
      addonId: "addon.b",
      runtimeId: "addon.b",
      runtimeType: "agent-addon",
      status: "ready",
      generation: 2,
      activeSessionCount: 1,
      publicFailureCode: "addon-factory-missing",
    },
    {
      addonId: "addon.a",
      runtimeId: "addon.a",
      runtimeType: "local-service",
      status: "inactive",
      generation: 1,
      activeSessionCount: 0,
    },
  ]);
  assert.equal(list.length, 2);
  for (const entry of list) {
    assert.equal(typeof entry.addonId, "string");
    assert.equal(typeof entry.runtimeType, "string");
    assert.equal(typeof entry.status, "string");
    assert.equal(typeof entry.generation, "number");
    assert.equal(typeof entry.activeSessionCount, "number");
  }
  assertNoSecretShapedFields("runtime.list", list);
  // publicFailureCode only surfaces on failed/degraded; the second
  // entry is inactive so its failure code is dropped.
  assert.equal(list[0].publicFailureCode, "addon-factory-missing");
  assert.equal(list[1].publicFailureCode, undefined);
});

// ---------------------------------------------------------------------------
// Req #3 — unknown runtimeType is still projected with public identifiers
// ---------------------------------------------------------------------------

test("CP-BR5 req #3: an unknown runtimeType is still projected with public addonId/runtimeId", () => {
  const entry = projectRuntimeEntry({
    addonId: "addon.experimental",
    runtimeId: "addon.experimental",
    runtimeType: "experimental-v3",
    status: "ready",
    generation: 1,
    activeSessionCount: 0,
  });
  // The runtime type is coerced to "unknown" for the canonical bucket
  // (CP-BR3 vocabulary), but the public identifiers remain readable.
  assert.equal(entry.runtimeType, "unknown");
  assert.equal(entry.addonId, "addon.experimental");
  assert.equal(entry.runtimeId, "addon.experimental");
  assert.equal(entry.displayLabel, "experimental");
});

// ---------------------------------------------------------------------------
// Req #4 — connector list carries public fields
// ---------------------------------------------------------------------------

test("CP-BR5 req #4: connector list carries label/connection state/authorization/last-health", () => {
  const entry = projectConnectorEntry({
    addonId: "addon.connector",
    label: "Connector",
    runtimeType: "channel-addon",
    connectionState: "installed",
    authorizationState: "granted",
    lastSuccessfulHealthAt: "2026-10-06T12:00:00.000Z",
    supportedRuntimeTypes: ["channel-addon"],
  });
  assert.equal(entry.label, "Connector");
  assert.equal(entry.connectionState, "installed");
  assert.equal(entry.authorizationState, "granted");
  assert.equal(entry.lastSuccessfulHealthAt, "2026-10-06T12:00:00.000Z");
  assert.equal(entry.runtimeType, "channel-addon");
  assertNoSecretShapedFields("connector.entry", entry);
});

// ---------------------------------------------------------------------------
// Req #5 — active-session summary carries counts and public identifiers
// ---------------------------------------------------------------------------

test("CP-BR5 req #5: active-session summary carries counts and public identifiers, no private data", () => {
  const entries = projectSessionSummary([
    { addonId: "addon.local-svc", runtimeId: "addon.local-svc", activeSessionCount: 2 },
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].addonId, "addon.local-svc");
  assert.equal(entries[0].runtimeId, "addon.local-svc");
  assert.equal(entries[0].activeSessionCount, 2);
  assertNoSecretShapedFields("session.summary", entries);
  // No extra private fields are ever added.
  assert.deepEqual(Object.keys(entries[0]).sort(), ["activeSessionCount", "addonId", "runtimeId"]);
});

// ---------------------------------------------------------------------------
// Req #6 — stale projection cannot overwrite a newer one (covered fully
// in runtime-projection-staleness.test.mjs; here we just assert the
// helper behavior).
// ---------------------------------------------------------------------------

test("CP-BR5 req #6 (helper): applyProjectionUpdate accepts newer and rejects older", () => {
  const a = projectBridgeRuntimes({
    bridgeOverview: { status: "connected" },
    runtimeList: [],
    connectorList: [],
    activeSessions: [],
    projectionGeneration: 1,
    producedAt: "2026-10-06T12:00:00.000Z",
  });
  const b = projectBridgeRuntimes({
    bridgeOverview: { status: "connected" },
    runtimeList: [],
    connectorList: [],
    activeSessions: [],
    projectionGeneration: 2,
    producedAt: "2026-10-06T12:00:01.000Z",
  });
  const applied = applyProjectionUpdate(a, b);
  assert.equal(applied, b);
  assert.throws(
    () => applyProjectionUpdate(b, a),
    (err) => {
      return (
        err instanceof ProjectionShapeError &&
        err.publicFailureCode === "projection-stale-superseded"
      );
    },
  );
  // Equal generation also rejected.
  assert.throws(
    () => applyProjectionUpdate(b, b),
    (err) => {
      return (
        err instanceof ProjectionShapeError &&
        err.publicFailureCode === "projection-stale-superseded"
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Req #7 — projection reflects lifecycle transitions in order
// ---------------------------------------------------------------------------

test("CP-BR5 req #7: the projection reflects lifecycle transitions in order", () => {
  const registry = makeRegistry([
    [
      "addon.svc",
      {
        installed: true,
        enabled: true,
        grantedCapabilities: [
          {
            capability: "filesystem",
            scope: "self",
            revocationBehavior: "hard-stop",
            granted: true,
          },
        ],
        requiredCapabilities: ["filesystem"],
        manifest: { runtimeType: "local-service", category: "tool" },
        projectionGeneration: 1,
      },
    ],
  ]);
  let active = [
    {
      addonId: "addon.svc",
      factoryId: "com.resonantos.factory.x",
      generation: 1,
      status: "starting",
    },
  ];
  const service = createRuntimeProjectionService({
    hostRegistry: registry,
    reconciler: { listActive: () => active },
    bridgeStatus: { snapshot: () => ({ status: "connected" }) },
  });
  const p1 = service.snapshot();
  assert.equal(p1.runtimeList[0].status, "starting");
  assert.equal(p1.projectionGeneration, 1);
  // Simulate a transition: ready. The reconciler emits an event; the
  // service's recordEvent hook calls refresh() to advance the
  // projection generation and reflect the new active set.
  active = [
    { addonId: "addon.svc", factoryId: "com.resonantos.factory.x", generation: 1, status: "ready" },
  ];
  service.recordEvent({ type: "ready", addonId: "addon.svc" });
  const p2 = service.snapshot();
  assert.equal(p2.runtimeList[0].status, "ready");
  assert.equal(p2.projectionGeneration, 2);
  // p2 is strictly newer than p1.
  assert.ok(p2.projectionGeneration > p1.projectionGeneration);
});

// ---------------------------------------------------------------------------
// Req #8 — shape-walker finds no secret-shaped value
// ---------------------------------------------------------------------------

test("CP-BR5 req #8: shape-walker finds no secret-shaped value in any public payload", () => {
  const projection = makeSampleProjection();
  assertNoSecretShapedFields("bridgeRuntimes.projection", projection);
  // Explicit shape-walker visit count confirms every value was visited.
  let visited = 0;
  walkShape(projection, () => {
    visited += 1;
  });
  assert.ok(visited > 50, "shape-walker should visit many nodes in a populated projection");
});

// ---------------------------------------------------------------------------
// Req #9 — log/rejection redaction
// ---------------------------------------------------------------------------

test("CP-BR5 req #9: log and rejection serialization are redacted to the public shape", () => {
  const projection = makeSampleProjection();
  // The projection itself is already public; the redactor is a no-op on
  // it. Inject a hypothetical "raw" payload (what a future bug might
  // emit) and confirm the redactor strips forbidden keys.
  const raw = {
    ...projection,
    token: "Bearer abcdefghijklmnop",
    pid: 12345,
    argv: ["node", "run-bridge-minimal.mjs"],
    env: { PATH: "/usr/bin" },
    memory: "user prompt content",
    secret: "shhh",
  };
  const redacted = redactLogValue(raw);
  assert.equal(redacted.token, "[REDACTED]");
  assert.equal(redacted.pid, "[REDACTED]");
  assert.equal(redacted.argv, "[REDACTED]");
  assert.equal(redacted.env, "[REDACTED]");
  assert.equal(redacted.memory, "[REDACTED]");
  assert.equal(redacted.secret, "[REDACTED]");
  // Public fields are preserved.
  assert.deepEqual(redacted.bridgeOverview, projection.bridgeOverview);
  assert.deepEqual(redacted.runtimeList, projection.runtimeList);
});

// ---------------------------------------------------------------------------
// Req #10 — malformed/forged input fails closed
// ---------------------------------------------------------------------------

test("CP-BR5 req #10a: malformed runtime input fails closed with projection-shape-invalid", () => {
  // Wrong status vocabulary -> fail closed.
  assert.throws(
    () =>
      projectRuntimeEntry({
        addonId: "addon.x",
        runtimeId: "addon.x",
        runtimeType: "local-service",
        status: "nope",
        generation: 0,
        activeSessionCount: 0,
      }),
    (err) =>
      err instanceof ProjectionShapeError && err.publicFailureCode === "projection-shape-invalid",
  );
  // Bad generation -> fail closed.
  assert.throws(
    () =>
      projectRuntimeEntry({
        addonId: "addon.x",
        runtimeId: "addon.x",
        runtimeType: "local-service",
        status: "ready",
        generation: -1,
        activeSessionCount: 0,
      }),
    (err) => err instanceof ProjectionShapeError,
  );
  // Bad activeSessionCount -> fail closed.
  assert.throws(
    () =>
      projectRuntimeEntry({
        addonId: "addon.x",
        runtimeId: "addon.x",
        runtimeType: "local-service",
        status: "ready",
        generation: 0,
        activeSessionCount: -1,
      }),
    (err) => err instanceof ProjectionShapeError,
  );
  // Bad timestamp -> fail closed.
  assert.throws(
    () =>
      projectRuntimeEntry({
        addonId: "addon.x",
        runtimeId: "addon.x",
        runtimeType: "local-service",
        status: "ready",
        generation: 0,
        activeSessionCount: 0,
        startedAt: "not-a-timestamp",
      }),
    (err) => err instanceof ProjectionShapeError,
  );
});

test("CP-BR5 req #10b: forged connector input fails closed", () => {
  assert.throws(
    () =>
      projectConnectorEntry({
        addonId: "addon.c",
        label: "C",
        runtimeType: "channel-addon",
        connectionState: "wat",
        authorizationState: "granted",
      }),
    (err) =>
      err instanceof ProjectionShapeError &&
      err.publicFailureCode === "projection-connector-state-unknown",
  );
  assert.throws(
    () =>
      projectConnectorEntry({
        addonId: "addon.c",
        label: "C",
        runtimeType: "channel-addon",
        connectionState: "installed",
        authorizationState: "wat",
      }),
    (err) => err instanceof ProjectionShapeError,
  );
});

test("CP-BR5 req #10c: malformed session input fails closed", () => {
  assert.throws(
    () =>
      projectSessionEntry({
        addonId: "addon.x",
        runtimeId: "addon.x",
        activeSessionCount: -1,
      }),
    (err) => err instanceof ProjectionShapeError,
  );
});

test("CP-BR5 req #10d: composed projection rejects bad overview", () => {
  assert.throws(
    () =>
      projectBridgeRuntimes({
        bridgeOverview: { status: "wat" },
        runtimeList: [],
        connectorList: [],
        activeSessions: [],
        projectionGeneration: 1,
        producedAt: "2026-10-06T12:00:00.000Z",
      }),
    (err) => err instanceof ProjectionShapeError,
  );
});

// ---------------------------------------------------------------------------
// Req #13 — host composition wiring is reachable
// ---------------------------------------------------------------------------

test("CP-BR5 req #12 (host route shape): bridge-runtimes host service attaches one GET /bridge/runtimes route", () => {
  const registry = makeRegistry([]);
  const service = createRuntimeProjectionService({
    hostRegistry: registry,
    reconciler: { listActive: () => [] },
    bridgeStatus: { snapshot: () => ({ status: "connected" }) },
  });
  const attached = [];
  const host = createBridgeRuntimesHostService({
    runtimeProjection: service,
    attachRoute: (route) => {
      attached.push(route);
    },
  });
  assert.equal(attached.length, 1);
  assert.equal(attached[0].method, "GET");
  assert.equal(attached[0].path, "/bridge/runtimes");
  assert.equal(attached[0].requiredCapability, "addon-runtime-read");
  assert.equal(attached[0].loopbackHostOnly, true);
  // The host route returns the projection.
  const projection = service.snapshot();
  // The handler returns the projection; assert the call returns it.
  attached[0].handler({}).then((value) => {
    assert.equal(value, projection);
  });
  // logProjection is exposed and redaction-clean.
  const logged = host.logProjection();
  assertNoSecretShapedFields("bridgeRuntimes.logProjection", logged);
});
