// CP-LBb: POST /bridge/launch route tests.
//
// Covers:
//   - Loopback + addon-runtime-control enforcement (401/403).
//   - Body validation: malformed, non-loopback, userinfo, fragment,
//     missing port all rejected as invalid-event.
//   - Already-running bridge returns `{ ok: true, alreadyRunning: true,
//     endpoint, version }` without spawning.
//   - Stopped bridge spawns and returns `{ ok: true, alreadyRunning:
//     false, endpoint, version, pid }`.
//   - Spawn failure returns `{ ok: false, reason:
//     "bridge-start-failed", endpoint }` without leaking internal
//     spawn details.
//   - Shape-walker: no secret-shaped value in the response payload.

import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";

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
  /(?:\/Users\/|\/home\/|C:\\|\/private\/)[A-Za-z0-9._/-]+/,
  /~\/[A-Za-z0-9._/-]{4,}/,
  /\b(?:TOKEN|SECRET|API[_-]KEY|PASSWORD|PASSWD|PRIVATE[_-]KEY)\s*=\s*[^\s"'<>]{6,}/i,
  /\bprofile:[A-Za-z0-9._-]{8,}\b/i,
];

const SECRET_FIELD_NAMES = new Set([
  "token", "tokens", "password", "passwd", "apiKey", "api_key", "apikey",
  "secret", "secrets", "credential", "credentials", "privateKey",
  "private_key", "sessionToken", "session_token", "bearer", "bearerToken",
  "bearer_token", "authorization", "auth", "cookie",
]);

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
    assert.ok(!SECRET_FIELD_NAMES.has(key),
      `${path}.${key} is a secret-shaped field name; launch payload must not carry it`);
    assertNoSecretShapedValue(entry, `${path}.${key}`);
  }
}

const tokens = {
  "addon-runtime-read": "read-token",
  "addon-runtime-control": "control-token",
};

/** Stub `launchBridge` for the route handler. Tests override either
 *  the resolved probe or the full launchBridge via `injectLaunchBridge`. */
function makeLaunchStub({ alreadyRunning = false, version = "1.0.0", pid = 4242, failWith } = {}) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    if (failWith) {
      return { ok: false, reason: "bridge-start-failed", endpoint: args.endpoint, code: failWith };
    }
    return {
      ok: true,
      alreadyRunning,
      endpoint: args.endpoint,
      version,
      ...(alreadyRunning ? {} : { pid }),
    };
  };
  fn.calls = calls;
  return fn;
}

/** Stub `ensureBridgeReachable` for the harness host service boot. */
function makeProbeStub({ ok = false, version = null, reason = "bridge-not-running", code = "ECONNREFUSED" } = {}) {
  return async () => ok
    ? { ok: true, version, endpoint: "http://127.0.0.1:47800" }
    : { ok: false, reason, endpoint: "http://127.0.0.1:47800", code };
}

/** Override `launchBridge` on the module so the route uses our stub. */
async function withLaunchBridge(t, stub, fn) {
  const mod = await import("../host/bridge-launcher.mjs");
  const seam = mod.__launchBridgeForTest;
  const previous = seam.value;
  seam.value = stub;
  t.after(() => {
    seam.value = previous;
  });
  return await fn();
}

const load = async () => {
  const module = await import("../host/harness-host-service.mjs").catch((error) => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  });
  assert.equal(typeof module.createHarnessHostService, "function");
  return module.createHarnessHostService;
};

async function fixture(t, options = {}) {
  const create = await load();
  const health = options.health ?? null;
  const launch = options.launch ?? makeLaunchStub({ alreadyRunning: true });
  return await withLaunchBridge(t, launch, async () => {
    const host = await create({
      env: {},
      store: {
        read: async () => null,
        write: async () => undefined,
      },
      providerHost: {
        executeRawProviderChat: async () => ({ reply: "answer" }),
        executeProviderStatus: async () => ({
          providers: [{ configured: true, models: [{ allowed: true }] }],
        }),
      },
      terminalHost: {
        service: { status: () => ({ alive: true, driveId: "ghostty", adapterId: "addon.resonant-terminal-ghostty", sessions: [] }) },
        start: { bus: {} },
      },
    });
    t.after(() => host.close());
    const call = (url, body = {}, overrides = {}) => {
      const baseUrl = url.split("?")[0];
      const route = host.harnessRoutes.find((r) => r.path === baseUrl);
      return import("../host/bridge-server.mjs").then(({ evaluateBridgeRequestForSelfTest }) =>
        evaluateBridgeRequestForSelfTest({
          method: "POST",
          url,
          body,
          routes: host.harnessRoutes,
          bridgeToken: "bridge-token",
          bridgeCapabilityTokens: tokens,
          listenerPort: 47773,
          headers: {
            host: "127.0.0.1:47773",
            "x-resonantos-bridge-token": "bridge-token",
            "x-resonantos-bridge-capability-token": tokens[route?.requiredCapability],
          },
          rawHeaders: ["Host", "127.0.0.1:47773"],
          ...overrides,
        })
      );
    };
    return {
      host,
      launchCalls: launch.calls,
      call,
    };
  });
}

test("POST /bridge/launch route is registered loopback-only with addon-runtime-control", async (t) => {
  const f = await fixture(t);
  const route = f.host.harnessRoutes.find((r) => r.path === "/bridge/launch");
  assert.ok(route, "expected POST /bridge/launch route to be registered");
  assert.equal(route.method, "POST");
  assert.equal(route.requiredCapability, "addon-runtime-control");
  assert.equal(route.loopbackHostOnly, true);
});

test("POST /bridge/launch requires addon-runtime-control (forbidden without it)", async (t) => {
  const f = await fixture(t);
  const result = await f.call("/bridge/launch", {}, {
    headers: { host: "127.0.0.1:47773", "x-resonantos-bridge-token": "bridge-token" },
  });
  assert.equal(result.status, 403);
  assert.equal(result.payload.code, "permission-denied");
});

test("POST /bridge/launch requires loopback host (forbidden off-loopback)", async (t) => {
  const f = await fixture(t);
  const result = await f.call("/bridge/launch", {}, {
    headers: {
      host: "evil.test:47773",
      "x-resonantos-bridge-token": "bridge-token",
      "x-resonantos-bridge-capability-token": tokens["addon-runtime-control"],
    },
    rawHeaders: ["Host", "evil.test:47773"],
  });
  assert.equal(result.status, 403);
  assert.equal(result.payload.code, "permission-denied");
});

test("POST /bridge/launch returns invalid-event on non-loopback endpoint URL", async (t) => {
  const f = await fixture(t);
  const result = await f.call("/bridge/launch", { endpoint: "http://192.168.1.5:47773" });
  assert.equal(result.status, 400);
  assert.equal(result.payload.code, "invalid-event");
});

test("POST /bridge/launch returns invalid-event when endpoint has userinfo", async (t) => {
  const f = await fixture(t);
  const result = await f.call("/bridge/launch", { endpoint: "http://user:pass@127.0.0.1:47800" });
  assert.equal(result.status, 400);
  assert.equal(result.payload.code, "invalid-event");
});

test("POST /bridge/launch returns invalid-event when endpoint has a fragment or query", async (t) => {
  const f = await fixture(t);
  const resultQ = await f.call("/bridge/launch", { endpoint: "http://127.0.0.1:47800?token=evil" });
  assert.equal(resultQ.status, 400);
  assert.equal(resultQ.payload.code, "invalid-event");
  const resultH = await f.call("/bridge/launch", { endpoint: "http://127.0.0.1:47800#frag" });
  assert.equal(resultH.status, 400);
  assert.equal(resultH.payload.code, "invalid-event");
});

test("POST /bridge/launch returns invalid-event when endpoint is malformed", async (t) => {
  const f = await fixture(t);
  const result = await f.call("/bridge/launch", { endpoint: "not-a-url" });
  assert.equal(result.status, 400);
  assert.equal(result.payload.code, "invalid-event");
});

test("POST /bridge/launch returns invalid-event when endpoint has no port", async (t) => {
  const f = await fixture(t);
  const result = await f.call("/bridge/launch", { endpoint: "http://127.0.0.1" });
  assert.equal(result.status, 400);
  assert.equal(result.payload.code, "invalid-event");
});

test("POST /bridge/launch returns invalid-event when extra fields are present (command/argv/secret)", async (t) => {
  const f = await fixture(t);
  const result = await f.call("/bridge/launch", {
    endpoint: "http://127.0.0.1:47800",
    command: "/bin/sh",
    argv: ["-c", "rm -rf /"],
    env: { OPENAI_API_KEY: "sk-leak" },
  });
  assert.equal(result.status, 400);
  assert.equal(result.payload.code, "invalid-event");
});

test("POST /bridge/launch returns alreadyRunning receipt without re-spawning when the bridge is up", async (t) => {
  const launch = makeLaunchStub({ alreadyRunning: true, version: "2.0.0-test" });
  const f = await fixture(t, { launch });
  const result = await f.call("/bridge/launch", {});
  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.alreadyRunning, true);
  assert.equal(result.payload.version, "2.0.0-test");
  assert.match(result.payload.endpoint, /^http:\/\/127\.0\.0\.1:/);
  // No pid field is surfaced for an already-running bridge.
  assert.equal(typeof result.payload.pid, "undefined");
  // launchBridge was called exactly once (the route).
  assert.equal(f.launchCalls.length, 1);
  assertNoSecretShapedValue(result.payload, "$.payload");
});

test("POST /bridge/launch spawns the pinned entry and returns pid on a healthy spawn", async (t) => {
  const launch = makeLaunchStub({ alreadyRunning: false, version: "3.1.4-pwn", pid: 99001 });
  const f = await fixture(t, { launch });
  const result = await f.call("/bridge/launch", { endpoint: "http://127.0.0.1:47800" });
  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.alreadyRunning, false);
  assert.equal(result.payload.version, "3.1.4-pwn");
  assert.equal(result.payload.pid, 99001);
  assert.equal(result.payload.endpoint, "http://127.0.0.1:47800");
  // bridgeEntry passed to launchBridge must be the pinned
  // absolute path of run-bridge-minimal.mjs.
  const call = f.launchCalls[0];
  assert.match(call.bridgeEntry, /run-bridge-minimal\.mjs$/);
  assert.ok(call.bridgeEntry.startsWith("/"));
  assert.equal(call.endpoint, "http://127.0.0.1:47800");
  assertNoSecretShapedValue(result.payload, "$.payload");
});

test("POST /bridge/launch maps bridge-start-failed to a public rejection without surfacing spawn details", async (t) => {
  const launch = makeLaunchStub({ failWith: "ETIMEOUT" });
  const f = await fixture(t, { launch });
  const result = await f.call("/bridge/launch", {});
  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.reason, "bridge-start-failed");
  assert.match(result.payload.endpoint, /^http:\/\/127\.0\.0\.1:/);
  // Internal spawn details (code, pid) are NOT surfaced.
  assert.equal(typeof result.payload.code, "undefined");
  assert.equal(typeof result.payload.pid, "undefined");
  assertNoSecretShapedValue(result.payload, "$.payload");
});

test("POST /bridge/launch shape-walker rejects payloads that leak token/path/credential strings", async () => {
  for (const hostile of [
    "sk-1234567890abcdefghij",
    "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.signature",
    "/Users/leaked/Home/.ssh/id_rsa",
    "TOKEN=supersecretvalue",
    "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
  ]) {
    assert.throws(
      () => assertNoSecretShapedValue({
        ok: true,
        endpoint: hostile,
        version: "1.0.0",
        alreadyRunning: true,
      }, "$.payload"),
    );
  }
});