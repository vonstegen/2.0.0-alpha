// CP-BR5 shape-walker tests — malicious or forged input must never
// surface a token/credential/path/PID/argv/env/prompt/memory value in
// any public payload. The shape-walker is a recursive visitor that the
// projection redaction tests use to assert every public payload is
// secret-free.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ProjectionShapeError,
  redactLogValue,
  walkShape,
  projectBridgeOverview,
  projectBridgeRuntimes,
  projectRuntimeEntry,
  projectRuntimeList,
  projectConnectorEntry,
  projectConnectorList,
  projectSessionEntry,
  projectSessionSummary,
} from "../host/runtime-projection.mjs";
import { createRuntimeProjectionService } from "../host/runtime-projection-service.mjs";

// ---------------------------------------------------------------------------
// Forbidden shapes
// ---------------------------------------------------------------------------

const FORBIDDEN_KEYS = new Set([
  "token",
  "accessToken",
  "bearer",
  "password",
  "secret",
  "privateKey",
  "credential",
  "authFile",
  "tokenFile",
  "argv",
  "pid",
  "childArgv",
  "memory",
  "prompt",
  "promptContent",
  "memoryContent",
  "privatePath",
  "rawError",
  "stack",
  "home",
  "userPath",
]);

// ---------------------------------------------------------------------------
// walkShape contract
// ---------------------------------------------------------------------------

test("walkShape: visits every key in nested objects and arrays", () => {
  const seen = new Map();
  const value = {
    a: 1,
    b: [1, 2, { c: 3, d: [4, 5] }],
    e: { f: { g: "hello" } },
    h: null,
  };
  walkShape(value, (key, v) => {
    seen.set(key, (seen.get(key) ?? 0) + 1);
  });
  // At least once for each top-level key, each array index, each
  // nested key, plus the string value for "g".
  assert.ok(seen.get("a") >= 1);
  assert.ok(seen.get("b") >= 1);
  assert.ok(seen.get("c") >= 1);
  assert.ok(seen.get("d") >= 1);
  assert.ok(seen.get("f") >= 1);
  assert.ok(seen.get("g") >= 1);
});

test("walkShape: handles nulls and primitives without throwing", () => {
  assert.doesNotThrow(() => walkShape(null, () => {}));
  assert.doesNotThrow(() => walkShape(undefined, () => {}));
  assert.doesNotThrow(() => walkShape(42, () => {}));
  assert.doesNotThrow(() => walkShape("hello", () => {}));
});

test("walkShape: visits each node exactly once", () => {
  const visited = [];
  const value = { a: 1, b: 2, c: 3, d: [4, 5] };
  walkShape(value, (key, v) => {
    if (key !== null) visited.push(`${key}:${typeof v === "object" ? JSON.stringify(v) : v}`);
  });
  // The walker visits every node: each leaf, each array container, and
  // each object key — exactly once.
  assert.deepEqual(visited.sort(), ["0:4", "1:5", "a:1", "b:2", "c:3", "d:[4,5]"]);
});

// ---------------------------------------------------------------------------
// Bridge overview: malicious input is whitelisted out
// ---------------------------------------------------------------------------

test("shape-walker req #1: bridge overview drops every forbidden key", () => {
  const overview = projectBridgeOverview({
    status: "connected",
    version: "alpha",
    endpoint: "http://127.0.0.1:47773",
    // All of these are dropped before the public object is built.
    token: "Bearer abcdefghijklmnop",
    accessToken: "t0ken_value",
    password: "hunter2",
    secret: "shh",
    pid: 12345,
    argv: ["node", "run-bridge-minimal.mjs"],
    env: { PATH: "/usr/bin" },
    memory: "user prompt content",
    prompt: "user prompt content",
    home: "/Users/alice",
  });
  // The result has only the whitelisted keys; none of the forbidden
  // names are present.
  for (const key of Object.keys(overview)) {
    assert.ok(!FORBIDDEN_KEYS.has(key), `bridge overview leaked forbidden key: ${key}`);
  }
});

// ---------------------------------------------------------------------------
// Runtime list: malicious input is whitelisted out
// ---------------------------------------------------------------------------

test("shape-walker req #2: runtime list drops every forbidden key", () => {
  const list = projectRuntimeList([
    {
      addonId: "addon.x",
      runtimeId: "addon.x",
      runtimeType: "local-service",
      status: "ready",
      generation: 0,
      activeSessionCount: 0,
      token: "Bearer abcdef",
      pid: 12345,
      argv: ["node", "x"],
      env: { PATH: "/usr/bin" },
      memory: "prompt",
    },
  ]);
  for (const entry of list) {
    for (const key of Object.keys(entry)) {
      assert.ok(!FORBIDDEN_KEYS.has(key), `runtime entry leaked forbidden key: ${key}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Connector list: malicious input is whitelisted out
// ---------------------------------------------------------------------------

test("shape-walker req #3: connector list drops every forbidden key", () => {
  const list = projectConnectorList([
    {
      addonId: "addon.c",
      label: "C",
      runtimeType: "channel-addon",
      connectionState: "installed",
      authorizationState: "granted",
      token: "Bearer abc",
      argv: ["node", "x"],
      secret: "shh",
    },
  ]);
  for (const entry of list) {
    for (const key of Object.keys(entry)) {
      assert.ok(!FORBIDDEN_KEYS.has(key), `connector entry leaked forbidden key: ${key}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Session summary: malicious input is whitelisted out
// ---------------------------------------------------------------------------

test("shape-walker req #4: session summary drops every forbidden key", () => {
  const list = projectSessionSummary([
    {
      addonId: "addon.x",
      runtimeId: "addon.x",
      activeSessionCount: 1,
      promptContent: "user prompt",
      memory: "memory",
      token: "t0ken",
    },
  ]);
  for (const entry of list) {
    for (const key of Object.keys(entry)) {
      assert.ok(!FORBIDDEN_KEYS.has(key), `session entry leaked forbidden key: ${key}`);
    }
    // The closed shape: only addonId, runtimeId, activeSessionCount.
    assert.deepEqual(Object.keys(entry).sort(), ["activeSessionCount", "addonId", "runtimeId"]);
  }
});

// ---------------------------------------------------------------------------
// Composed projection: hostile entire payload cannot leak
// ---------------------------------------------------------------------------

test("shape-walker req #5: composed projection drops every forbidden key at every depth", () => {
  const projection = projectBridgeRuntimes({
    bridgeOverview: {
      status: "connected",
      version: "alpha",
      endpoint: "http://127.0.0.1:47773",
      token: "Bearer abcdef",
      secret: "shh",
    },
    runtimeList: [{
      addonId: "addon.x",
      runtimeId: "addon.x",
      runtimeType: "local-service",
      status: "ready",
      generation: 0,
      activeSessionCount: 0,
      pid: 12345,
      argv: ["node", "x"],
      env: { PATH: "/usr/bin" },
      memory: "prompt",
    }],
    connectorList: [{
      addonId: "addon.c",
      label: "C",
      runtimeType: "channel-addon",
      connectionState: "installed",
      authorizationState: "granted",
      token: "Bearer abc",
    }],
    activeSessions: [{
      addonId: "addon.x",
      runtimeId: "addon.x",
      activeSessionCount: 1,
      promptContent: "user prompt",
    }],
    projectionGeneration: 1,
    producedAt: "2026-10-06T12:00:00.000Z",
  });
  walkShape(projection, (key, value) => {
    if (typeof key === "string") {
      assert.ok(!FORBIDDEN_KEYS.has(key), `composed projection leaked forbidden key: ${key}`);
    }
  });
  // Whitelist at the top level too.
  for (const key of Object.keys(projection)) {
    assert.ok(!FORBIDDEN_KEYS.has(key), `composed projection top-level leaked forbidden key: ${key}`);
  }
});

// ---------------------------------------------------------------------------
// redactLogValue: hostile input is fully redacted
// ---------------------------------------------------------------------------

test("shape-walker req #6: redactLogValue strips every forbidden key at any depth", () => {
  const raw = {
    bridgeOverview: { status: "connected", token: "Bearer abc", secret: "shh" },
    runtimeList: [
      { addonId: "addon.x", pid: 12345, argv: ["node"], env: { PATH: "/usr/bin" } },
    ],
    connectorList: [
      { addonId: "addon.c", token: "t0ken" },
    ],
    activeSessions: [
      { addonId: "addon.x", promptContent: "user prompt", memory: "memory" },
    ],
  };
  const redacted = redactLogValue(raw);
  walkShape(redacted, (key, value) => {
    if (typeof key === "string") {
      assert.ok(!FORBIDDEN_KEYS.has(key) || value === "[REDACTED]",
        `redactLogValue did not redact forbidden key: ${key} (value: ${JSON.stringify(value)})`);
    }
  });
  // Explicit spot checks.
  assert.equal(redacted.bridgeOverview.token, "[REDACTED]");
  assert.equal(redacted.bridgeOverview.secret, "[REDACTED]");
  assert.equal(redacted.runtimeList[0].pid, "[REDACTED]");
  assert.equal(redacted.runtimeList[0].argv, "[REDACTED]");
  assert.equal(redacted.runtimeList[0].env, "[REDACTED]");
  assert.equal(redacted.connectorList[0].token, "[REDACTED]");
  assert.equal(redacted.activeSessions[0].promptContent, "[REDACTED]");
  assert.equal(redacted.activeSessions[0].memory, "[REDACTED]");
});

// ---------------------------------------------------------------------------
// End-to-end: a real host composition cannot leak secrets even when the
// host registry is poisoned.
// ---------------------------------------------------------------------------

test("shape-walker req #7: a hostile host registry cannot leak a token into the projection", () => {
  const registry = {
    snapshot: () => ({
      bootEpoch: "epoch-1",
      installations: {
        "addon.x": {
          installed: true,
          enabled: true,
          // The hostile host projection smuggles a token + PID. The
          // projection's whitelist must drop both.
          token: "Bearer abcdefghijklmnop",
          pid: 12345,
          grantedCapabilities: [{ capability: "filesystem", scope: "self", revocationBehavior: "hard-stop", granted: true }],
          requiredCapabilities: ["filesystem"],
          manifest: { runtimeType: "local-service", category: "tool" },
          projectionGeneration: 1,
        },
      },
      candidates: [],
      slots: {},
      revision: 0,
      governanceActivated: false,
    }),
  };
  const service = createRuntimeProjectionService({
    hostRegistry: registry,
    reconciler: { listActive: () => [] },
    bridgeStatus: { snapshot: () => ({ status: "connected" }) },
  });
  const projection = service.snapshot();
  // Walk every key; assert no forbidden key is reachable.
  walkShape(projection, (key, value) => {
    if (typeof key === "string") {
      assert.ok(!FORBIDDEN_KEYS.has(key),
        `host-projection leaked forbidden key through service: ${key} (value: ${JSON.stringify(value)})`);
    }
  });
});

// ---------------------------------------------------------------------------
// Malformed input: fail closed
// ---------------------------------------------------------------------------

test("shape-walker req #8: token-shaped values in numeric fields fail closed", () => {
  // Token-shaped strings in a non-string field should fail closed at
  // the boundary, not be silently coerced to a string.
  assert.throws(() => projectRuntimeEntry({
    addonId: "addon.x",
    runtimeId: "addon.x",
    runtimeType: "local-service",
    status: "ready",
    generation: "Bearer abcdefghijklmnop", // wrong type
    activeSessionCount: 0,
  }), (err) => err instanceof ProjectionShapeError);
  assert.throws(() => projectSessionEntry({
    addonId: "addon.x",
    runtimeId: "addon.x",
    activeSessionCount: "Bearer abcdef", // wrong type
  }), (err) => err instanceof ProjectionShapeError);
});
