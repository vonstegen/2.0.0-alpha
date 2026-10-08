// CP-BR1: deterministic bootstrap lifecycle tests.
//
// Fake processes, fake probes, and a virtual clock. No real process is
// spawned, no real port is touched, no real timer runs. Covers:
//   1.  offline → start → connected
//   2.  connected → start returns alreadyRunning with no second spawn
//   3.  two concurrent starts cause exactly one spawn
//   4.  restart creates a new generation
//   5.  stale old-generation health success cannot replace new state
//   6.  stale old-generation exit cannot mark the new instance offline/failed
//   7.  synchronous spawn failure returns only a public start-failed
//   8.  asynchronous child error returns only a public failure
//   9.  health timeout is bounded and attempts owned-child cleanup
//   10. restart stop/start waits are bounded
//   11. stopForShutdown stops the current owned instance
//   12. stopForShutdown does not stop an externally discovered bridge
//   14. spawn receives pinned node/entry/argv/cwd, shell:false, allowlisted env
//   15. no caller path selects the endpoint; the probe only sees the pinned one
//   18. no token/credential/path/PID/env/raw-error value in public results

import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createBootstrapLifecycle } = await import("../bootstrap/bootstrap-lifecycle.mjs");
const { createBridgePolicy, BRIDGE_ENDPOINT, BRIDGE_ARGV } = await import("../bootstrap/bridge-policy.mjs");

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
];

const FORBIDDEN_PUBLIC_FIELDS = new Set([
  "pid", "ppid", "argv", "argc", "env", "environ", "environment", "cwd", "path",
  "paths", "command", "cmd", "execPath", "executable", "script", "entry",
  "bridgeEntry", "token", "tokens", "secret", "secrets", "credential",
  "credentials", "password", "apiKey", "authorization", "auth", "cookie",
  "child", "process", "error", "exception", "stack", "message", "code",
  "prompt", "memory", "config", "bridgeConfig", "generatedConfig",
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
    assert.ok(!FORBIDDEN_PUBLIC_FIELDS.has(key), `${path}.${key} is a forbidden public field`);
    assertNoSecretShapedValue(entry, `${path}.${key}`);
  }
}

const tick = () => new Promise((resolve) => queueMicrotask(resolve));

function makeClock(startMs = 1_000_000) {
  let nowMs = startMs;
  return {
    nowImpl: () => nowMs,
    // Virtual delay: advances the clock and yields a couple of microtasks
    // so synchronously scheduled fake-child exits win the exit race.
    delayImpl: async (ms) => {
      nowMs += ms;
      await tick();
      await tick();
    },
  };
}

function makeFakeChild({ killBehavior = "exit" } = {}) {
  const child = new EventEmitter();
  child.pid = 4242;
  child.killedWith = [];
  child.unrefCalls = 0;
  child.killBehavior = killBehavior;
  child.unref = () => { child.unrefCalls += 1; };
  child.kill = (signal) => {
    child.killedWith.push(signal);
    if (child.killBehavior === "exit") {
      queueMicrotask(() => child.emit("exit", signal === "SIGKILL" ? 137 : 0, signal));
    }
    return true;
  };
  return child;
}

function makeSpawn() {
  const calls = [];
  const children = [];
  const spawnImpl = (...args) => {
    calls.push(args);
    const child = makeFakeChild();
    children.push(child);
    return child;
  };
  return { calls, children, spawnImpl };
}

function makeProbe(script = [{ ok: true }]) {
  const calls = [];
  let index = 0;
  const probe = async ({ endpoint, timeoutMs } = {}) => {
    calls.push({ endpoint, timeoutMs });
    const step = script[Math.min(index, script.length - 1)];
    index += 1;
    if (step.ok) return { ok: true, version: step.version ?? null, endpoint };
    return { ok: false, reason: "bridge-not-running", endpoint, code: step.code ?? "ECONNREFUSED" };
  };
  return { calls, probe };
}

function makeLifecycle({
  probeScript,
  spawnImpl,
  policyOverrides = {},
  clock = makeClock(),
} = {}) {
  const spawn = spawnImpl ?? makeSpawn().spawnImpl;
  const probe = probeScript ?? makeProbe().probe;
  const policy = createBridgePolicy({
    nodeExecutable: "/pinned/node",
    envOverrides: { homeDir: "/pinned-home-not-used-in-results", tmpDir: "/pinned-tmp", pathValue: "/pinned/path" },
    ...policyOverrides,
  });
  const timeouts = { probeMs: 100, startHealthMs: 1000, healthPollMs: 100, stopMs: 200, killEscalationMs: 100 };
  const policyWithTestTimeouts = Object.freeze({ ...policy, timeouts });
  const lifecycle = createBootstrapLifecycle({
    policy: policyWithTestTimeouts,
    probe,
    spawnImpl: spawn,
    delayImpl: clock.delayImpl,
    nowImpl: clock.nowImpl,
    createInstanceId: (generation) => `test-gen-${generation}`,
  });
  return { lifecycle, policy: policyWithTestTimeouts, clock };
}

function makeSignalProcess() {
  const calls = [];
  let alive = true;
  const signalProcess = (pid, signal) => {
    calls.push({ pid, signal });
    if (signal === "SIGTERM" || signal === "SIGKILL") {
      alive = false;
    } else if (signal === 0 && !alive) {
      const error = new Error("no such process");
      error.code = "ESRCH";
      throw error;
    }
  };
  return { calls, signalProcess };
}

test("1. offline → start → connected with an owned generation", async () => {
  const spawn = makeSpawn();
  const probeScript = [
    { ok: false }, // initial pre-spawn probe
    { ok: false }, // first health poll
    { ok: true, version: "2.0.0" }, // second health poll
  ];
  const { lifecycle } = makeLifecycle({ probeScript: makeProbe(probeScript).probe, spawnImpl: spawn.spawnImpl });
  assert.equal((await lifecycle.status()).status, "offline");
  const result = await lifecycle.start();
  assert.equal(result.ok, true);
  assert.equal(result.status, "connected");
  assert.equal(result.alreadyRunning, false);
  assert.equal(result.instanceId, "test-gen-1");
  assert.equal(typeof result.startedAt, "string");
  assert.equal(result.version, "2.0.0");
  assert.equal(result.endpoint, BRIDGE_ENDPOINT);
  assert.equal(spawn.calls.length, 1, "exactly one spawn");
  assert.equal(spawn.children[0].unrefCalls, 1, "child outlives the host");
  assert.equal((await lifecycle.status()).status, "connected");
  assertNoSecretShapedValue(result, "$.start");
});

test("2. connected → start returns alreadyRunning and never spawns again", async () => {
  const spawn = makeSpawn();
  const probe = makeProbe([{ ok: false }, { ok: true }]);
  const { lifecycle } = makeLifecycle({ probeScript: probe.probe, spawnImpl: spawn.spawnImpl });
  const first = await lifecycle.start();
  assert.equal(first.alreadyRunning, false);
  const second = await lifecycle.start();
  assert.equal(second.ok, true);
  assert.equal(second.status, "connected");
  assert.equal(second.alreadyRunning, true);
  assert.equal(second.instanceId, first.instanceId);
  assert.equal(spawn.calls.length, 1, "no second spawn");
  assertNoSecretShapedValue(second, "$.second");
});

test("3. two concurrent starts cause exactly one spawn and equal results", async () => {
  const spawn = makeSpawn();
  const probe = makeProbe([{ ok: false }, { ok: true }]);
  const { lifecycle } = makeLifecycle({ probeScript: probe.probe, spawnImpl: spawn.spawnImpl });
  const [a, b] = await Promise.all([lifecycle.start(), lifecycle.start()]);
  assert.equal(spawn.calls.length, 1, "concurrent starts share one spawn");
  assert.deepEqual(a, b, "concurrent starts join the same bounded public result");
  assert.equal(a.alreadyRunning, false);
  assertNoSecretShapedValue(a, "$.a");
});

test("4. restart fences the old generation and creates a new one", async () => {
  const spawn = makeSpawn();
  const probe = makeProbe([
    { ok: false }, { ok: true }, // start gen 1
    { ok: false },               // restart pre-spawn probe (old owned stopped)
    { ok: true },                // gen 2 health
  ]);
  const { lifecycle } = makeLifecycle({ probeScript: probe.probe, spawnImpl: spawn.spawnImpl });
  const started = await lifecycle.start();
  const gen1Child = spawn.children[0];
  const restarted = await lifecycle.restart();
  assert.equal(restarted.ok, true);
  assert.equal(restarted.status, "connected");
  assert.equal(restarted.instanceId, "test-gen-3", "restart allocates a fresh generation");
  assert.notEqual(restarted.instanceId, started.instanceId);
  assert.equal(spawn.calls.length, 2, "exactly one new spawn");
  assert.deepEqual(gen1Child.killedWith, ["SIGTERM"], "old owned child stopped with SIGTERM first");
  const state = lifecycle.__stateForTest();
  assert.equal(state.generation, 3);
  assert.equal(state.phase, "connected");
  assertNoSecretShapedValue(restarted, "$.restart");
});

test("5. stale health success for a dead starting child never becomes connected", async () => {
  const spawn = makeSpawn();
  // Probe: pre-spawn fail, then a probe the test resolves manually.
  let resolveHealth;
  const healthGate = new Promise((resolve) => { resolveHealth = resolve; });
  let probeCalls = 0;
  const probe = async ({ endpoint } = {}) => {
    probeCalls += 1;
    if (probeCalls === 1) return { ok: false, reason: "bridge-not-running", endpoint, code: "ECONNREFUSED" };
    await healthGate;
    return { ok: true, version: null, endpoint };
  };
  const { lifecycle } = makeLifecycle({ probeScript: probe, spawnImpl: spawn.spawnImpl });
  const startPromise = lifecycle.start();
  // Let the spawn happen and the health-wait probe begin.
  await tick(); await tick(); await tick(); await tick(); await tick();
  assert.equal(spawn.calls.length, 1);
  // The starting child dies BEFORE the healthy answer arrives.
  spawn.children[0].emit("exit", 1, null);
  resolveHealth();
  const result = await startPromise;
  assert.equal(result.ok, false, "stale health success must not connect");
  assert.equal(result.failureCode, "start-failed");
  assert.equal(lifecycle.__stateForTest().phase, "failed");
  assertNoSecretShapedValue(result, "$.staleHealth");
});

test("6. stale old-generation exit/error cannot mark the new instance offline or failed", async () => {
  const spawn = makeSpawn();
  const probe = makeProbe([
    { ok: false }, { ok: true }, // gen 1
    { ok: false }, { ok: true }, // restart gen 3
  ]);
  const { lifecycle } = makeLifecycle({ probeScript: probe.probe, spawnImpl: spawn.spawnImpl });
  await lifecycle.start();
  const gen1Child = spawn.children[0];
  await lifecycle.restart();
  assert.equal(lifecycle.__stateForTest().phase, "connected");
  // Late signals from the fenced generation arrive after gen 2 is live.
  gen1Child.emit("error", Object.assign(new Error("late"), { code: "ECONNRESET" }));
  gen1Child.emit("exit", 1, null);
  const status = await lifecycle.status();
  assert.equal(status.status, "connected");
  assert.equal(status.instanceId, "test-gen-3");
  assert.equal(lifecycle.__stateForTest().phase, "connected");
  assertNoSecretShapedValue(status, "$.status");
});

test("7. synchronous spawn failure returns only a public start-failed", async () => {
  const probe = makeProbe([{ ok: false }]);
  const spawnImpl = () => { throw Object.assign(new Error("spawn /pinned/node ENOENT"), { code: "ENOENT" }); };
  const { lifecycle } = makeLifecycle({ probeScript: probe.probe, spawnImpl });
  const result = await lifecycle.start();
  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(result.failureCode, "start-failed");
  assert.deepEqual(Object.keys(result).sort(), ["endpoint", "failureCode", "ok", "status"].sort(),
    "no platform error code, message, or path leaks");
  assertNoSecretShapedValue(result, "$.spawnFailure");
});

test("8. asynchronous child error during startup returns only a public failure", async () => {
  const probe = makeProbe([{ ok: false }, { ok: false }, { ok: false }, { ok: false }]);
  const spawn = makeSpawn();
  const { lifecycle } = makeLifecycle({ probeScript: probe.probe, spawnImpl: spawn.spawnImpl });
  const startPromise = lifecycle.start();
  await tick(); await tick();
  spawn.children[0].emit("error", Object.assign(new Error("EACCES /private/secret/path"), { code: "EACCES" }));
  const result = await startPromise;
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, "start-failed");
  assert.deepEqual(Object.keys(result).sort(), ["endpoint", "failureCode", "ok", "status"].sort());
  assertNoSecretShapedValue(result, "$.asyncError");
});

test("9. health timeout is bounded and attempts owned-child cleanup", async () => {
  const spawn = makeSpawn();
  const probe = makeProbe([{ ok: false }]); // never healthy
  const { lifecycle, clock } = makeLifecycle({ probeScript: probe.probe, spawnImpl: spawn.spawnImpl });
  const startWall = clock.nowImpl();
  const result = await lifecycle.start();
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, "health-timeout");
  const child = spawn.children[0];
  assert.deepEqual(child.killedWith, ["SIGTERM"], "bounded cleanup signals only the owned child");
  const elapsed = clock.nowImpl() - startWall;
  assert.ok(elapsed <= 1000 + 200 + 100, `wait must be bounded by start+stop budgets, got ${elapsed}`);
  assert.equal(lifecycle.__stateForTest().phase, "failed");
  assertNoSecretShapedValue(result, "$.timeout");
});

test("10a. restart stop wait is bounded when the owned child ignores SIGTERM", async () => {
  const spawn = makeSpawn();
  const probe = makeProbe([{ ok: false }, { ok: true }]);
  const { lifecycle } = makeLifecycle({ probeScript: probe.probe, spawnImpl: spawn.spawnImpl });
  await lifecycle.start();
  spawn.children[0].killBehavior = "never"; // wedged child
  const result = await lifecycle.restart();
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, "restart-failed");
  assert.deepEqual(spawn.children[0].killedWith, ["SIGTERM", "SIGKILL"], "TERM then bounded KILL escalation");
  assert.equal(spawn.calls.length, 1, "no new spawn after a failed stop");
  assertNoSecretShapedValue(result, "$.restartStop");
});

test("10b. restart start wait is bounded when the new generation never becomes healthy", async () => {
  const spawn = makeSpawn();
  const probe = makeProbe([{ ok: false }, { ok: true }, { ok: false }]); // gen2 never healthy
  const { lifecycle } = makeLifecycle({ probeScript: probe.probe, spawnImpl: spawn.spawnImpl });
  await lifecycle.start();
  const result = await lifecycle.restart();
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, "health-timeout");
  assert.equal(spawn.calls.length, 2);
  assert.deepEqual(spawn.children[0].killedWith, ["SIGTERM"], "old generation stopped");
  assert.deepEqual(spawn.children[1].killedWith, ["SIGTERM"], "timed-out generation cleaned up");
  assertNoSecretShapedValue(result, "$.restartStart");
});

test("11. stopForShutdown stops the current owned instance", async () => {
  const spawn = makeSpawn();
  const probe = makeProbe([{ ok: false }, { ok: true }, { ok: false }]);
  const { lifecycle } = makeLifecycle({ probeScript: probe.probe, spawnImpl: spawn.spawnImpl });
  await lifecycle.start();
  const stopped = await lifecycle.stopForShutdown();
  assert.equal(stopped.ok, true);
  assert.equal(stopped.status, "offline");
  assert.deepEqual(spawn.children[0].killedWith, ["SIGTERM"]);
  assert.equal((await lifecycle.status()).status, "offline");
  // Idempotent: a second shutdown stops nothing.
  const again = await lifecycle.stopForShutdown();
  assert.equal(again.ok, true);
  assert.deepEqual(spawn.children[0].killedWith, ["SIGTERM"], "no second kill");
  assertNoSecretShapedValue(stopped, "$.stopped");
});

test("12. stopForShutdown leaves an externally discovered bridge untouched", async () => {
  const spawn = makeSpawn();
  // Bridge is healthy but this host never spawned it.
  const probe = makeProbe([{ ok: true, version: null }, { ok: true, version: null }, { ok: true, version: null }]);
  const { lifecycle } = makeLifecycle({ probeScript: probe.probe, spawnImpl: spawn.spawnImpl });
  const started = await lifecycle.start();
  assert.equal(started.ok, true);
  assert.equal(started.alreadyRunning, true);
  assert.equal(started.instanceId, undefined, "no generation is adopted for a foreign bridge");
  assert.equal(spawn.calls.length, 0, "no spawn behind a healthy foreign bridge");
  const stopped = await lifecycle.stopForShutdown();
  assert.equal(stopped.ok, true);
  assert.equal(stopped.status, "offline");
  assert.equal(spawn.children.length, 0, "nothing was ever spawned, so nothing can be killed");
  // The foreign bridge is still healthy afterwards.
  const after = await lifecycle.status();
  assert.equal(after.status, "connected");
  assert.equal(after.instanceId, undefined);
  assertNoSecretShapedValue(started, "$.started");
  assertNoSecretShapedValue(stopped, "$.stopped");
});

test("12b. restart refuses a healthy bridge it does not own", async () => {
  const spawn = makeSpawn();
  const probe = makeProbe([{ ok: true, version: null }, { ok: true, version: null }]);
  const { lifecycle } = makeLifecycle({ probeScript: probe.probe, spawnImpl: spawn.spawnImpl });
  const result = await lifecycle.restart();
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, "restart-failed");
  assert.equal(result.status, "connected", "the foreign bridge reality is reported");
  assert.equal(spawn.calls.length, 0, "no spawn behind a foreign bridge");
  assertNoSecretShapedValue(result, "$.restartRefused");
});

test("14. spawn receives the pinned node, entry, argv, cwd, shell:false, and allowlisted env only", async () => {
  const spawn = makeSpawn();
  const probe = makeProbe([{ ok: false }, { ok: true }]);
  const { lifecycle, policy } = makeLifecycle({ probeScript: probe.probe, spawnImpl: spawn.spawnImpl });
  await lifecycle.start();
  assert.equal(spawn.calls.length, 1);
  const [command, argv, options] = spawn.calls[0];
  assert.equal(command, "/pinned/node", "pinned Node executable, never ambient lookup");
  assert.deepEqual(argv, [policy.bridgeEntry, ...BRIDGE_ARGV], "pinned entry + fixed argv shape");
  assert.equal(argv.length, 2);
  assert.match(argv[0], /browser-first\/host\/run-bridge-minimal\.mjs$/);
  assert.equal(options.cwd, policy.bridgeCwd, "pinned working directory");
  assert.equal(options.shell, false, "no shell");
  assert.equal(options.detached, true);
  assert.equal(options.stdio, "ignore");
  const env = options.env;
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH", "RESONANT_TERMINAL_HOST_BRIDGE", "TMPDIR"].sort());
  assert.equal(env.RESONANT_TERMINAL_HOST_BRIDGE, "1");
  const allowlist = new Set(["HOME", "PATH", "TMPDIR", "RESONANT_TERMINAL_HOST_BRIDGE"]);
  for (const key of Object.keys(process.env)) {
    if (allowlist.has(key)) continue;
    assert.equal(Object.prototype.hasOwnProperty.call(env, key), false,
      `process.env key '${key}' must not leak into the child env`);
  }
  for (const forbidden of [
    "RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN",
    "RESONANTOS_BROWSER_FIRST_CAPABILITY_BOOTSTRAP_TOKEN",
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "RESONANTOS_HARNESS_BINDINGS",
    "RESONANTOS_BROWSER_FIRST_USER_ROOT", "RESONANT_TERMINAL_DRIVER",
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(env, forbidden), false,
      `${forbidden} must never enter the child env`);
  }
});

test("15. no caller input can select the endpoint; the probe only ever sees the pinned one", async () => {
  const spawn = makeSpawn();
  const probe = makeProbe([{ ok: false }, { ok: true }, { ok: true }]);
  const { lifecycle } = makeLifecycle({ probeScript: probe.probe, spawnImpl: spawn.spawnImpl });
  await lifecycle.start();
  await lifecycle.status();
  for (const call of probe.calls) {
    assert.equal(call.endpoint, BRIDGE_ENDPOINT, "probe endpoint is host-pinned");
    assert.ok(call.timeoutMs > 0 && call.timeoutMs <= 100, "probe waits are bounded");
  }
  const lifecycle2 = createBootstrapLifecycle({
    policy: createBridgePolicy({ nodeExecutable: "/pinned/node" }),
    probe: probe.probe,
    spawnImpl: spawn.spawnImpl,
    delayImpl: makeClock().delayImpl,
  });
  // There is no endpoint parameter anywhere on the public surface.
  assert.equal(lifecycle2.start.length, 0);
  assert.equal(lifecycle2.restart.length, 0);
  assert.equal(lifecycle2.stopForShutdown.length, 0);
  assert.equal(lifecycle2.status.length, 0);
});

test("version-mismatch stops the owned child and fails closed", async () => {
  const spawn = makeSpawn();
  const probe = makeProbe([{ ok: false }, { ok: true, version: "0.0.1-foreign" }]);
  const { lifecycle } = makeLifecycle({
    probeScript: probe.probe,
    spawnImpl: spawn.spawnImpl,
    policyOverrides: { expectedBridgeVersion: "2.0.0-beta.1" },
  });
  const result = await lifecycle.start();
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, "version-mismatch");
  assert.deepEqual(spawn.children[0].killedWith, ["SIGTERM"], "mismatched owned child is stopped");
  assertNoSecretShapedValue(result, "$.versionMismatch");
});

test("unexpected exit of the connected owned child surfaces failed, not offline", async () => {
  const spawn = makeSpawn();
  const probe = makeProbe([
    { ok: false }, { ok: true },  // gen1 start
    { ok: false }, { ok: true },  // gen2 recovery start
  ]);
  const { lifecycle } = makeLifecycle({ probeScript: probe.probe, spawnImpl: spawn.spawnImpl });
  await lifecycle.start();
  spawn.children[0].emit("exit", 1, null);
  const status = await lifecycle.status();
  assert.equal(status.status, "failed");
  assert.equal(status.failureCode, "unexpected-exit");
  // Recovery: start from failed spawns a fresh generation.
  const restarted = await lifecycle.start();
  assert.equal(restarted.ok, true);
  assert.equal(restarted.instanceId, "test-gen-2");
  assertNoSecretShapedValue(status, "$.unexpectedExit");
});

test("owned child alive but probe failing degrades, and start on degraded does not spawn", async () => {
  const spawn = makeSpawn();
  const probe = makeProbe([
    { ok: false }, { ok: true },  // start
    { ok: false },                // status probe → degraded
  ]);
  const { lifecycle } = makeLifecycle({ probeScript: probe.probe, spawnImpl: spawn.spawnImpl });
  await lifecycle.start();
  const status = await lifecycle.status();
  assert.equal(status.status, "degraded");
  assert.equal(status.instanceId, "test-gen-1");
  const again = await lifecycle.start();
  assert.equal(again.alreadyRunning, true);
  assert.equal(again.status, "degraded");
  assert.equal(spawn.calls.length, 1, "degraded start must not double-spawn");
  assertNoSecretShapedValue(status, "$.degraded");
});

test("16. cross-process ownership: a fresh host stops the bridge it previously started", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ros-bridge-pid-"));
  const pidFile = path.join(tmpDir, "bridge.pid");
  try {
    const spawn = makeSpawn();
    const probe = makeProbe([{ ok: false }, { ok: true }]);
    const { lifecycle: first, policy, clock } = makeLifecycle({
      probeScript: probe.probe,
      spawnImpl: spawn.spawnImpl,
      policyOverrides: { pidFile },
    });
    const started = await first.start();
    assert.equal(started.status, "connected");
    assert.equal(
      JSON.parse(fs.readFileSync(pidFile, "utf8")).pid,
      spawn.children[0].pid,
      "start records the child PID",
    );

    // A fresh host process (no in-process child) stops via the recorded PID.
    const stopSig = makeSignalProcess();
    const stopper = createBootstrapLifecycle({
      policy,
      probe: makeProbe([{ ok: false }]).probe,
      spawnImpl: makeSpawn().spawnImpl,
      delayImpl: clock.delayImpl,
      nowImpl: clock.nowImpl,
      signalProcess: stopSig.signalProcess,
    });
    const stopped = await stopper.stopForShutdown();
    assert.equal(stopped.status, "offline");
    assert.ok(
      stopSig.calls.some((c) => c.pid === spawn.children[0].pid && c.signal === "SIGTERM"),
      "fresh host signals the recorded PID",
    );
    assert.equal(fs.existsSync(pidFile), false, "PID record cleared after stop");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
