// Phase 1.5 Step B unit tests for the terminal-host bridge service.
// The service's pure logic (envelope validation, mapping to HarnessEvent,
// the in-memory driver composition without spawning an adapter) is what we
// can deterministically test without iTerm2 present. Live spawn tests live
// in the smoke test (manual) and Phase 2 lifecycle tests.

import assert from "node:assert/strict";
import test from "node:test";
import {
  createTerminalHostService,
  envelopeToHarnessEvent,
  mintSessionBootstrapGrant,
  validateRosTerminalEventEnvelope,
} from "../host/terminal-host-service.mjs";
import { TERMINAL_HOST_CONTRACT_VERSION } from "../../src/core/terminal-host-contract.ts";

const provenance = {
  addonId: "addon.resonant-terminal-iterm2",
  sessionId: "terminal-host-bus",
  turnId: "terminal",
  bootEpoch: "boot-1",
  generation: 0,
};

test("validateRosTerminalEventEnvelope accepts the five terminal.* types", () => {
  const at = "2026-10-02T11:30:00.000Z";
  for (const event of [
    { type: "terminal.session.started", sessionId: "s1", at },
    { type: "terminal.command.started", sessionId: "s1", at, command: "ls" },
    { type: "terminal.command.ended", sessionId: "s1", at, exitStatus: 0 },
    { type: "terminal.cwd.changed", sessionId: "s1", at, cwd: "/" },
    { type: "terminal.session.terminated", sessionId: "s1", at, exitStatus: 137 },
  ]) {
    const envelope = { version: TERMINAL_HOST_CONTRACT_VERSION, sessionId: "s1", source: "terminal", at, event };
    const result = validateRosTerminalEventEnvelope(envelope);
    assert.equal(result.ok, true, JSON.stringify(event));
  }
});

test("validateRosTerminalEventEnvelope rejects bad envelopes", () => {
  const at = "2026-10-02T11:30:00.000Z";
  const good = { version: TERMINAL_HOST_CONTRACT_VERSION, sessionId: "s1", source: "terminal", at, event: { type: "terminal.session.started", sessionId: "s1", at } };
  const build = (overrides) => {
    const out = { ...good };
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete out[k];
      else out[k] = v;
    }
    return out;
  };
  for (const [envelope, reason] of [
    [build({ version: 2 }), "wrong version"],
    [build({ source: "ros" }), "bad source"],
    [build({ at: "yesterday" }), "bad at"],
    [build({ sessionId: "" }), "empty sessionId"],
    [build({ event: null }), "null event"],
    [build({ event: { type: "harness.session.created", sessionId: "s1", at } }), "non-terminal event.type"],
    [build({ version: undefined }), "missing version"],
    [null, "null envelope"],
    ["string", "string envelope"],
  ]) {
    const result = validateRosTerminalEventEnvelope(envelope);
    assert.equal(result.ok, false, `should reject: ${reason}`);
  }
});

test("envelopeToHarnessEvent maps terminal.* events to the bus discriminator", () => {
  const envelope = {
    version: TERMINAL_HOST_CONTRACT_VERSION,
    sessionId: "s1",
    source: "terminal",
    at: "2026-10-02T11:30:00.000Z",
    event: { type: "terminal.cwd.changed", sessionId: "s1", at: "2026-10-02T11:30:00.000Z", cwd: "/Users/andrewjochl" },
  };
  const event = envelopeToHarnessEvent(envelope, { ...provenance, sequence: 1 });
  assert.equal(event.type, "terminal.cwd.changed");
  assert.deepEqual(event.data, { sessionId: "s1", at: "2026-10-02T11:30:00.000Z", cwd: "/Users/andrewjochl" });
});

test("createTerminalHostService composes in-memory driver without spawning", async () => {
  let spawned = false;
  const svc = createTerminalHostService({
    env: { RESONANT_TERMINAL_DRIVER: "in-memory" },
    spawn: () => { spawned = true; return { stdin: null, stdout: null, stderr: null, on() {}, kill() {}, killed: true }; },
  });
  const { driveId, bus } = await svc.start();
  assert.equal(driveId, "in-memory");
  assert.equal(spawned, false, "in-memory driver must not spawn a process");
  assert.ok(bus, "service must produce a bus even in in-memory mode");

  // A consumer can subscribe and observe the in-memory mode's bus
  let received = null;
  const subscription = bus.subscribe();
  (async () => {
    const { value } = await subscription.next();
    received = value;
  })();

  bus.publish({
    turnId: "terminal",
    type: "terminal.session.started",
    data: { sessionId: "s1", at: "2026-10-02T11:30:00.000Z" },
  });
  // wait one tick
  await new Promise((r) => setImmediate(r));
  assert.equal(received?.type, "terminal.session.started");
  assert.deepEqual(received?.data, { sessionId: "s1", at: "2026-10-02T11:30:00.000Z" });

  await svc.stop();
  assert.equal(svc.status().alive, false);
});

test("createTerminalHostService spawns adapter with allowlist-scoped env (iterm2)", async () => {
  let capturedEnv = null;
  // Minimal readable-stream shim: readline + .on("data") both work.
  const noopStream = { on() {}, setEncoding() {}, pause() {}, resume() {} };
  const fakeChild = {
    stdin: null,
    stdout: noopStream,
    stderr: noopStream,
    on() {},
    kill() {},
    killed: true,
  };
  const svc = createTerminalHostService({
    env: {
      RESONANT_TERMINAL_DRIVER: "iterm2",
      PATH: "/usr/bin:/bin",
      HOME: "/Users/test",
      RESONANT_OTHER: "should-not-leak",
      SECRET_TOKEN: "should-not-leak",
    },
    spawn: (_entrypoint, _args, envArg) => {
      capturedEnv = envArg;
      return fakeChild;
    },
  });
  const { driveId } = await svc.start();
  assert.equal(driveId, "iterm2");
  assert.ok(capturedEnv, "spawn should have been called");
  // Allowlist enforcement: only PATH, HOME, RESONANT_TERMINAL_DRIVER
  const keys = Object.keys(capturedEnv).sort();
  assert.deepEqual(keys, ["HOME", "PATH", "RESONANT_TERMINAL_DRIVER"]);
  assert.equal(capturedEnv.RESONANT_TERMINAL_DRIVER, "iterm2");
  assert.equal(capturedEnv.PATH, "/usr/bin:/bin");
  assert.equal(capturedEnv.HOME, "/Users/test");
  await svc.stop();
});

test("createTerminalHostService rejects unknown driver values", () => {
  assert.throws(
    () => createTerminalHostService({ env: { RESONANT_TERMINAL_DRIVER: "wezterm" } }),
    /RESONANT_TERMINAL_DRIVER/,
  );
});

test("createTerminalHostService accepts ghostty driver and uses Node + ghostty/ cwd", async () => {
  let captured = null;
  const fakeChild = { stdin: null, stdout: { on() {}, setEncoding() {}, pause() {}, resume() {} }, stderr: { on() {}, setEncoding() {}, pause() {}, resume() {} }, on() {}, kill() {}, killed: true };
  const svc = createTerminalHostService({
    env: { RESONANT_TERMINAL_DRIVER: "ghostty" },
    spawn: (entrypoint, args, envArg) => {
      captured = { entrypoint, args, envArg };
      return fakeChild;
    },
  });
  const { driveId } = await svc.start();
  assert.equal(driveId, "ghostty");
  assert.ok(captured, "spawn should have been called");
  assert.equal(captured.entrypoint, "node");
  assert.deepEqual(captured.args, ["adapter.mjs"]);
  // Env allowlist must be honored on the ghostty path too
  const envKeys = Object.keys(captured.envArg).sort();
  assert.deepEqual(envKeys, ["RESONANT_TERMINAL_DRIVER"]);
  assert.equal(captured.envArg.RESONANT_TERMINAL_DRIVER, "ghostty");
  await svc.stop();
});

test("launchBootstrap refuses in-memory mode (no stdio surface)", async () => {
  const svc = createTerminalHostService({ env: { RESONANT_TERMINAL_DRIVER: "in-memory" } });
  await svc.start();
  await assert.rejects(
    () => svc.launchBootstrap({ sessionId: "s1", bootstrapCommand: "ros attach" }),
    /in-memory driver has no stdio surface/,
  );
  await svc.stop();
});

test("mintSessionBootstrapGrant mints a broker-grade token, not a placeholder (F4)", () => {
  const grant = mintSessionBootstrapGrant({
    sessionId: "s1",
    purpose: "attach",
    now: () => new Date("2026-10-02T12:00:00.000Z"),
  });
  assert.equal(grant.sessionId, "s1");
  assert.equal(grant.purpose, "attach");
  assert.equal(grant.issuedAt, "2026-10-02T12:00:00.000Z");
  assert.equal(grant.expiresAt, "2026-10-02T12:01:00.000Z");
  // 32 random bytes -> 43-char base64url (same format as createBridgeToken());
  // never the old tok-<uuid> placeholder.
  assert.match(grant.token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!grant.token.startsWith("tok-"), "token must not be a tok-<uuid> placeholder");
});
