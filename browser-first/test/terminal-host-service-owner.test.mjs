// CP-BR9 req #8: exactly one live terminal-host service owner drives both
// "enable a terminal add-on" and "Open in Terminal".
//
// Unit coverage for terminal-host-service-owner.mjs: attach/detach
// semantics, the terminal singleton, the facade delegation order
// (active first, boot-composition fallback second), and fail-closed
// behavior when no service exists. No real process is spawned.

import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalHostServiceOwner } from "../host/terminal-host-service-owner.mjs";

const GHOSTTY = "addon.resonant-terminal-ghostty";
const ITERM2 = "addon.resonant-terminal-iterm2";

function makeService(driveId, addonId, extras = {}) {
  const calls = [];
  return {
    calls,
    async start() {
      return { adapterId: addonId, driveId, bus: { driveId } };
    },
    async stop() {},
    status() {
      return { alive: true, driveId, adapterId: addonId, sessions: [] };
    },
    async launchBootstrap(args) {
      calls.push(["launchBootstrap", args]);
      return { accepted: true, driveId };
    },
    async terminateSession(args) {
      calls.push(["terminateSession", args]);
      return { ok: true };
    },
    ...extras,
  };
}

test("CP-BR9 req #8: the facade delegates to the attached active service", async () => {
  const owner = createTerminalHostServiceOwner();
  const ghostty = makeService("ghostty", GHOSTTY);
  const started = { adapterId: GHOSTTY, driveId: "ghostty", bus: { driveId: "ghostty" } };
  assert.deepEqual(owner.attach({ addonId: GHOSTTY, service: ghostty, started }), { ok: true });
  assert.equal(owner.ownerAddonId(), GHOSTTY);

  const facade = owner.facade({ fallback: null });
  assert.deepEqual(facade.service.status(), {
    alive: true,
    driveId: "ghostty",
    adapterId: GHOSTTY,
    sessions: [],
  });
  // The same live instance drives enable (status) and launch (launchBootstrap).
  const result = await facade.service.launchBootstrap({ sessionId: "s1", commandSuffix: "pi" });
  assert.deepEqual(result, { accepted: true, driveId: "ghostty" });
  assert.deepEqual(ghostty.calls, [["launchBootstrap", { sessionId: "s1", commandSuffix: "pi" }]]);
  assert.equal(facade.start.adapterId, GHOSTTY);
  assert.equal(facade.start.bus, started.bus);
  assert.equal(facade.start.driveId, "ghostty");
  assert.deepEqual(owner.snapshot(), { addonId: GHOSTTY, driveId: "ghostty", alive: true });
});

test("CP-BR9 req #8: the terminal singleton refuses a second live attachment", async () => {
  const owner = createTerminalHostServiceOwner();
  const ghostty = makeService("ghostty", GHOSTTY);
  const iterm2 = makeService("iterm2", ITERM2);
  assert.equal(owner.attach({ addonId: GHOSTTY, service: ghostty, started: {} }).ok, true);
  const refused = owner.attach({ addonId: ITERM2, service: iterm2, started: {} });
  assert.deepEqual(refused, { ok: false, reason: "terminal-service-owned" });
  assert.equal(owner.ownerAddonId(), GHOSTTY, "the incumbent keeps the singleton");

  // A stale detach (wrong pair) cannot evict the incumbent.
  assert.equal(owner.detach({ addonId: ITERM2, service: iterm2 }), false);
  assert.equal(owner.detach({ addonId: GHOSTTY, service: makeService("ghostty", GHOSTTY) }), false);
  assert.equal(owner.ownerAddonId(), GHOSTTY);

  // The exact attached pair detaches; a new attachment then succeeds.
  assert.equal(owner.detach({ addonId: GHOSTTY, service: ghostty }), true);
  assert.equal(owner.ownerAddonId(), null);
  assert.equal(owner.attach({ addonId: ITERM2, service: iterm2, started: {} }).ok, true);
  assert.equal(owner.ownerAddonId(), ITERM2);
});

test("CP-BR9 req #8: the facade falls back to the boot composition, then prefers the active service", async () => {
  const owner = createTerminalHostServiceOwner();
  const fallbackService = makeService("in-memory", ITERM2);
  const fallbackStarted = { adapterId: ITERM2, driveId: "in-memory", bus: { inMemory: true } };
  const facade = owner.facade({ fallback: { service: fallbackService, started: fallbackStarted } });

  // No active service: the fallback answers (this is the default
  // ROS-started bridge composition before any terminal add-on is ready).
  assert.equal(facade.service.status().driveId, "in-memory");
  assert.equal(facade.start.bus, fallbackStarted.bus);

  const ghostty = makeService("ghostty", GHOSTTY);
  const ghosttyStarted = { adapterId: GHOSTTY, driveId: "ghostty", bus: { driveId: "ghostty" } };
  owner.attach({ addonId: GHOSTTY, service: ghostty, started: ghosttyStarted });
  assert.equal(facade.service.status().driveId, "ghostty", "active wins over fallback");
  assert.equal(facade.start.bus, ghosttyStarted.bus);

  owner.detach({ addonId: GHOSTTY, service: ghostty });
  assert.equal(facade.service.status().driveId, "in-memory", "fallback resumes after detach");
});

test("CP-BR9 req #8: the facade fails closed with no active service and no fallback", async () => {
  const owner = createTerminalHostServiceOwner();
  const facade = owner.facade({ fallback: null });
  assert.deepEqual(facade.service.status(), {
    alive: false,
    driveId: null,
    adapterId: null,
    sessions: [],
  });
  assert.equal(facade.start.adapterId, null);
  assert.equal(facade.start.bus, null);
  await assert.rejects(
    () => facade.service.launchBootstrap({ sessionId: "s1" }),
    (error) => error?.code === "runtime-unavailable",
  );
  await assert.rejects(
    () => facade.service.terminateSession({ sessionId: "s1" }),
    (error) => error?.code === "runtime-unavailable",
  );
  assert.equal(owner.snapshot(), null);
});

test("CP-BR9 req #8: attach validates its entry shape", () => {
  const owner = createTerminalHostServiceOwner();
  assert.throws(() => owner.attach({}), TypeError);
  assert.throws(() => owner.attach({ addonId: "", service: {}, started: {} }), TypeError);
  assert.throws(() => owner.attach({ addonId: GHOSTTY, service: null, started: {} }), TypeError);
});
