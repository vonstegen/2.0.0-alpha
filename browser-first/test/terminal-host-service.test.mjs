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

test("createTerminalHostService rejects unknown driver values", () => {
  assert.throws(
    () => createTerminalHostService({ env: { RESONANT_TERMINAL_DRIVER: "ghostty" } }),
    /RESONANT_TERMINAL_DRIVER/,
  );
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
