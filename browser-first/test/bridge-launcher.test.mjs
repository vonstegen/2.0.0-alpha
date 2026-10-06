// CP-LBa: idempotent bridge launcher unit tests.
//
// The launcher is a host-owned seam. Tests stub the `probe` and
// `spawnImpl` so we never touch a real port or real child process.
// Coverage:
//   * already-running short-circuits with NO spawn.
//   * healthy spawn returns `{ ok: true, alreadyRunning: false, pid }`.
//   * spawn that never becomes healthy returns
//     `{ ok: false, reason: "bridge-start-failed" }`.
//   * spawn receives the pinned entry + fixed argv
//     (`<bridgeEntry> --bridge-port=<port>`) + env allowlist.
//   * `process.env` keys never leak into the child env.
//   * no secret-shaped value is in the result payload.
//   * spawn error → bridge-start-failed.
//   * already-running branch does not invoke `spawnImpl`.

import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";

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

/** Fake `spawnImpl` that records the call and returns a fake child
 *  EventEmitter. The test can trigger `error` to simulate spawn
 *  failure. */
function makeFakeSpawn() {
  const calls = [];
  const makeChild = () => {
    const child = new EventEmitter();
    child.pid = 12345;
    child.unref = () => {};
    return child;
  };
  const spawn = (...args) => {
    calls.push(args);
    return makeChild();
  };
  const failing = (code = "ESPAWN") => (...args) => {
    calls.push(args);
    const child = makeChild();
    setImmediate(() => child.emit("error", Object.assign(new Error("spawn fail"), { code })));
    return child;
  };
  return { spawn, calls, failing };
}

const ENDPOINT = "http://127.0.0.1:47773";
const ENTRY = "/Users/host/projects/resonant-os/2.0.0-alpha/browser-first/host/run-bridge-minimal.mjs";

const ENV_ALLOWLIST = {
  RESONANT_TERMINAL_DRIVER: "ghostty",
  PATH: "/usr/bin:/bin",
};

test("launchBridge short-circuits when the probe reports already-running and never spawns", async () => {
  const probe = async () => ({ ok: true, version: "9.9.9", endpoint: ENDPOINT });
  const { spawn: spawnImpl, calls: spawnCalls } = makeFakeSpawn();
  const { launchBridge } = await import("../host/bridge-launcher.mjs");
  const result = await launchBridge({
    endpoint: ENDPOINT,
    bridgeEntry: ENTRY,
    env: ENV_ALLOWLIST,
    probe,
    spawnImpl,
    timeoutMs: 1000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyRunning, true);
  assert.equal(result.endpoint, ENDPOINT);
  assert.equal(result.version, "9.9.9");
  assert.equal(spawnCalls.length, 0, "already-running must not spawn");
  assertNoSecretShapedValue(result, "$.result");
});

test("launchBridge spawns the pinned bridge entry with --bridge-port=<port> + env allowlist when stopped", async () => {
  let probeCalls = 0;
  const probe = async () => {
    probeCalls += 1;
    if (probeCalls < 3) return { ok: false, reason: "bridge-not-running", endpoint: ENDPOINT, code: "ECONNREFUSED" };
    return { ok: true, version: "1.2.3", endpoint: ENDPOINT };
  };
  const { spawn: spawnImpl, calls: spawnCalls } = makeFakeSpawn();
  const { launchBridge } = await import("../host/bridge-launcher.mjs");
  const result = await launchBridge({
    endpoint: ENDPOINT,
    bridgeEntry: ENTRY,
    env: ENV_ALLOWLIST,
    probe,
    spawnImpl,
    timeoutMs: 5000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyRunning, false);
  assert.equal(result.endpoint, ENDPOINT);
  assert.equal(result.version, "1.2.3");
  assert.equal(result.pid, 12345);
  assert.equal(spawnCalls.length, 1, "spawn exactly once");
  // argv shape is pinned.
  const [command, argv, options] = spawnCalls[0];
  assert.equal(command, ENTRY, "spawn executes the pinned bridge entry");
  assert.deepEqual(argv, ["--bridge-port=47773"], "fixed argv shape only");
  assert.equal(options.detached, true, "child is detached");
  assert.equal(options.stdio, "ignore", "stdio is suppressed");
  // Env allowlist: RESONANT_TERMINAL_HOST_BRIDGE=1 + caller-supplied allowlist keys.
  assert.equal(options.env.RESONANT_TERMINAL_HOST_BRIDGE, "1");
  assert.equal(options.env.RESONANT_TERMINAL_DRIVER, "ghostty");
  assert.equal(options.env.PATH, "/usr/bin:/bin");
  // Ensure no `process.env` key leaks in. We compare against the
  // captured process.env snapshot: any key present in
  // `process.env` but NOT in the allowlist must NOT be in
  // `options.env`.
  const allow = new Set(["RESONANT_TERMINAL_HOST_BRIDGE", "RESONANT_TERMINAL_DRIVER", "PATH"]);
  for (const key of Object.keys(process.env)) {
    if (allow.has(key)) continue;
    assert.equal(Object.prototype.hasOwnProperty.call(options.env, key), false,
      `process.env key '${key}' must not leak into child env`);
  }
  // No secret-shaped value in the result.
  assertNoSecretShapedValue(result, "$.result");
});

test("launchBridge returns bridge-start-failed when the spawn never becomes healthy", async () => {
  const probe = async () => ({ ok: false, reason: "bridge-not-running", endpoint: ENDPOINT, code: "ECONNREFUSED" });
  const { spawn: spawnImpl, calls: spawnCalls } = makeFakeSpawn();
  const { launchBridge } = await import("../host/bridge-launcher.mjs");
  const result = await launchBridge({
    endpoint: ENDPOINT,
    bridgeEntry: ENTRY,
    env: ENV_ALLOWLIST,
    probe,
    spawnImpl,
    timeoutMs: 500,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bridge-start-failed");
  assert.equal(result.endpoint, ENDPOINT);
  assert.equal(typeof result.code, "string");
  assert.equal(spawnCalls.length, 1, "spawn was attempted exactly once");
  assertNoSecretShapedValue(result, "$.result");
});

test("launchBridge fails closed when spawn throws synchronously", async () => {
  const probe = async () => ({ ok: false, reason: "bridge-not-running", endpoint: ENDPOINT, code: "ECONNREFUSED" });
  const spawnImpl = () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); };
  const { launchBridge } = await import("../host/bridge-launcher.mjs");
  const result = await launchBridge({
    endpoint: ENDPOINT,
    bridgeEntry: ENTRY,
    env: ENV_ALLOWLIST,
    probe,
    spawnImpl,
    timeoutMs: 500,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bridge-start-failed");
  assert.equal(result.code, "ENOENT");
  assertNoSecretShapedValue(result, "$.result");
});

test("launchBridge fails closed when the spawned child emits an async error", async () => {
  const probe = async () => ({ ok: false, reason: "bridge-not-running", endpoint: ENDPOINT, code: "ECONNREFUSED" });
  const failingSpawn = makeFakeSpawn().failing("EPERM");
  const { launchBridge } = await import("../host/bridge-launcher.mjs");
  const result = await launchBridge({
    endpoint: ENDPOINT,
    bridgeEntry: ENTRY,
    env: ENV_ALLOWLIST,
    probe,
    spawnImpl: failingSpawn,
    timeoutMs: 500,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bridge-start-failed");
  assert.equal(result.code, "EPERM");
  assertNoSecretShapedValue(result, "$.result");
});

test("launchBridge env allowlist strips any caller-supplied credential-shaped keys", async () => {
  const probe = async () => ({ ok: false, reason: "bridge-not-running", endpoint: ENDPOINT, code: "ECONNREFUSED" });
  const { spawn: spawnImpl, calls: spawnCalls } = makeFakeSpawn();
  const hostileEnv = {
    RESONANT_TERMINAL_DRIVER: "ghostty",
    PATH: "/bin",
    RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN: "Bearer super-secret",
    OPENAI_API_KEY: "sk-deadbeefdeadbeef",
    ANTHROPIC_API_KEY: "sk-deadbeefdeadbeef",
    RESONANT_PROVIDER_SECRET: "API_KEY=leaked",
  };
  const { launchBridge } = await import("../host/bridge-launcher.mjs");
  await launchBridge({
    endpoint: ENDPOINT,
    bridgeEntry: ENTRY,
    env: hostileEnv,
    probe,
    spawnImpl,
    timeoutMs: 300,
  });
  const env = spawnCalls[0][2].env;
  // Hostile keys must NOT be in the child env.
  for (const forbidden of [
    "RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "RESONANT_PROVIDER_SECRET",
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(env, forbidden), false,
      `${forbidden} must not be in child env`);
  }
  // The allowlist keys MUST be in the child env.
  assert.equal(env.RESONANT_TERMINAL_HOST_BRIDGE, "1");
  assert.equal(env.RESONANT_TERMINAL_DRIVER, "ghostty");
  assert.equal(env.PATH, "/bin");
});

test("launchBridge env allowlist still works when RESONANT_TERMINAL_DRIVER + PATH are absent", async () => {
  const probe = async () => ({ ok: false, reason: "bridge-not-running", endpoint: ENDPOINT, code: "ECONNREFUSED" });
  const { spawn: spawnImpl, calls: spawnCalls } = makeFakeSpawn();
  const { launchBridge } = await import("../host/bridge-launcher.mjs");
  await launchBridge({
    endpoint: ENDPOINT,
    bridgeEntry: ENTRY,
    env: {},
    probe,
    spawnImpl,
    timeoutMs: 300,
  });
  const env = spawnCalls[0][2].env;
  assert.equal(env.RESONANT_TERMINAL_HOST_BRIDGE, "1");
  assert.equal(Object.prototype.hasOwnProperty.call(env, "PATH"), false,
    "PATH is dropped when not explicitly allowlisted");
  assert.equal(Object.prototype.hasOwnProperty.call(env, "RESONANT_TERMINAL_DRIVER"), false,
    "RESONANT_TERMINAL_DRIVER is dropped when not explicitly allowlisted");
});

test("launchBridge fails closed when the spawn impl returns null", async () => {
  const probe = async () => ({ ok: false, reason: "bridge-not-running", endpoint: ENDPOINT, code: "ECONNREFUSED" });
  const spawnImpl = () => null;
  const { launchBridge } = await import("../host/bridge-launcher.mjs");
  const result = await launchBridge({
    endpoint: ENDPOINT,
    bridgeEntry: ENTRY,
    env: ENV_ALLOWLIST,
    probe,
    spawnImpl,
    timeoutMs: 300,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bridge-start-failed");
  assert.equal(result.code, "SPAWN_NULL");
});