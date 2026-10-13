// CP-BR9 req #8: the terminal-host service owner drives both "enable a
// terminal add-on" and "Open in Terminal" — for EVERY concurrently live
// terminal add-on (multi-live terminals).
//
// Unit coverage for terminal-host-service-owner.mjs: attach/detach
// semantics (per-addon idempotent, same-addon replace, never refuse),
// the per-addon facade dispatch order (add-on hint -> session index ->
// sole active -> boot-composition fallback), merged status/bus views,
// and fail-closed behavior. No real process is spawned.

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
      return { accepted: true, driveId, sessionId: args?.sessionId };
    },
    async terminateSession(args) {
      calls.push(["terminateSession", args]);
      return { ok: true };
    },
    ...extras,
  };
}

/** Minimal async-iterator bus with a scripted frame list. */
function makeBus(frames) {
  return {
    subscribe() {
      let index = 0;
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          if (index >= frames.length) return new Promise(() => {});
          return { done: false, value: frames[index++] };
        },
        async return() {
          return { done: true, value: undefined };
        },
      };
    },
  };
}

test("CP-BR9 req #8: the facade delegates to the attached active service", async () => {
  const owner = createTerminalHostServiceOwner();
  const ghostty = makeService("ghostty", GHOSTTY);
  const started = { adapterId: GHOSTTY, driveId: "ghostty", bus: makeBus([]) };
  assert.deepEqual(owner.attach({ addonId: GHOSTTY, service: ghostty, started }), { ok: true });
  assert.deepEqual(owner.ownerAddonIds(), [GHOSTTY]);

  const facade = owner.facade({ fallback: null });
  assert.deepEqual(facade.service.status(), {
    alive: true,
    driveId: "ghostty",
    adapterId: GHOSTTY,
    sessions: [],
  });
  // The same live instance drives enable (status) and launch (launchBootstrap).
  const result = await facade.service.launchBootstrap({ sessionId: "s1", commandSuffix: "pi" });
  assert.deepEqual(result, { accepted: true, driveId: "ghostty", sessionId: "s1" });
  assert.deepEqual(ghostty.calls, [["launchBootstrap", { sessionId: "s1", commandSuffix: "pi" }]]);
  assert.equal(facade.start.adapterId, GHOSTTY);
  assert.equal(facade.start.bus, started.bus);
  assert.equal(facade.start.driveId, "ghostty");
  assert.deepEqual([...owner._activesForTests().keys()], [GHOSTTY]);
});

test("CP-BR9 multi-live: two terminal add-ons attach concurrently and dispatch per add-on", async () => {
  const owner = createTerminalHostServiceOwner();
  const ghostty = makeService("ghostty", GHOSTTY);
  const iterm2 = makeService("iterm2", ITERM2);
  assert.equal(owner.attach({ addonId: GHOSTTY, service: ghostty, started: {} }).ok, true);
  assert.equal(owner.attach({ addonId: ITERM2, service: iterm2, started: {} }).ok, true);
  assert.deepEqual(owner.ownerAddonIds(), [GHOSTTY, ITERM2]);

  const facade = owner.facade({ fallback: null });
  // Per-add-on status never bleeds across terminals.
  assert.equal(facade.service.status(GHOSTTY).driveId, "ghostty");
  assert.equal(facade.service.status(ITERM2).driveId, "iterm2");
  assert.deepEqual(facade.service.status("addon.nope"), {
    alive: false,
    driveId: null,
    adapterId: null,
    sessions: [],
  });
  // Merged status: connected if any is live, sessions are the union.
  const merged = facade.service.status();
  assert.equal(merged.alive, true);
  assert.equal(merged.driveId, "ghostty", "first live terminal names the merged identity");

  // Launch dispatch honors the terminal add-on hint, and the hint is
  // stripped before the per-add-on service sees the payload.
  const launched = await facade.service.launchBootstrap({
    sessionId: "s1",
    commandSuffix: "pi",
    terminalAddonId: ITERM2,
  });
  assert.equal(launched.driveId, "iterm2");
  assert.deepEqual(iterm2.calls, [["launchBootstrap", { sessionId: "s1", commandSuffix: "pi" }]]);
  assert.deepEqual(ghostty.calls, [], "ghostty is not touched by an iTerm2 launch");

  // Session-addressed RPCs follow the index learned from the launch.
  await facade.service.terminateSession({ sessionId: "s1" });
  assert.deepEqual(iterm2.calls[1], ["terminateSession", { sessionId: "s1" }]);
  assert.deepEqual(ghostty.calls, []);

  // An unknown add-on address fails closed: no terminal is called.
  await assert.rejects(
    () => facade.service.launchBootstrap({ sessionId: "s9", terminalAddonId: "addon.nope" }),
    (error) => error?.code === "runtime-unavailable",
  );
  assert.equal(ghostty.calls.length, 0);
  assert.equal(iterm2.calls.length, 2, "no extra call after the failed dispatch");

  // A stale detach (wrong pair) cannot evict either owner.
  assert.equal(owner.detach({ addonId: ITERM2, service: makeService("iterm2", ITERM2) }), false);
  assert.equal(owner.detach({ addonId: GHOSTTY, service: makeService("ghostty", GHOSTTY) }), false);
  assert.deepEqual(owner.ownerAddonIds(), [GHOSTTY, ITERM2]);

  // The exact attached pair detaches; the sibling keeps its terminal.
  assert.equal(owner.detach({ addonId: GHOSTTY, service: ghostty }), true);
  assert.deepEqual(owner.ownerAddonIds(), [ITERM2]);
  assert.equal(facade.service.status().driveId, "iterm2", "merged view follows the remaining terminal");
});

test("CP-BR9 multi-live: same-addon re-attach replaces the stale service (crash recovery)", async () => {
  const owner = createTerminalHostServiceOwner();
  const stale = makeService("ghostty", GHOSTTY);
  const fresh = makeService("ghostty", GHOSTTY);
  owner.attach({ addonId: GHOSTTY, service: stale, started: {} });
  const facade = owner.facade({ fallback: null });

  // Route a session through the stale service, then replace it (the
  // factory's dead-service restart path re-attaches without detaching).
  await facade.service.launchBootstrap({ sessionId: "s1", commandSuffix: "pi", terminalAddonId: GHOSTTY });
  assert.equal(owner.attach({ addonId: GHOSTTY, service: fresh, started: {} }).ok, true);
  assert.deepEqual(owner.ownerAddonIds(), [GHOSTTY], "replace keeps one entry per add-on");

  // New work reaches the fresh service; the stale service's session
  // route was pruned, so nothing is ever delivered to the dead adapter.
  assert.equal(facade.service.status(GHOSTTY).adapterId, GHOSTTY);
  assert.deepEqual(stale.calls.length, 1, "stale service receives no further calls");

  // Idempotent re-attach of the live pair is a no-op.
  assert.equal(owner.attach({ addonId: GHOSTTY, service: fresh, started: {} }).ok, true);
  assert.deepEqual(owner.ownerAddonIds(), [GHOSTTY]);
});

test("CP-BR9 multi-live: the merged bus fans in every live terminal bus", async () => {
  const owner = createTerminalHostServiceOwner();
  const ghosttyBus = makeBus([{ sessionId: "g1", type: "terminal.event" }]);
  const iterm2Bus = makeBus([{ sessionId: "i1", type: "terminal.event" }]);
  owner.attach({
    addonId: GHOSTTY,
    service: makeService("ghostty", GHOSTTY),
    started: { adapterId: GHOSTTY, driveId: "ghostty", bus: ghosttyBus },
  });
  owner.attach({
    addonId: ITERM2,
    service: makeService("iterm2", ITERM2),
    started: { adapterId: ITERM2, driveId: "iterm2", bus: iterm2Bus },
  });
  const facade = owner.facade({ fallback: null });
  const iterator = facade.start.bus.subscribe()[Symbol.asyncIterator]();
  const seen = new Set([(await iterator.next()).value.sessionId, (await iterator.next()).value.sessionId]);
  assert.deepEqual(seen, new Set(["g1", "i1"]), "one frame from each live bus");
  await iterator.return();
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
  const ghosttyStarted = { adapterId: GHOSTTY, driveId: "ghostty", bus: makeBus([]) };
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
  assert.deepEqual(owner.ownerAddonIds(), []);
});

test("CP-BR9 req #8: attach validates its entry shape", () => {
  const owner = createTerminalHostServiceOwner();
  assert.throws(() => owner.attach({}), TypeError);
  assert.throws(() => owner.attach({ addonId: "", service: {}, started: {} }), TypeError);
  assert.throws(() => owner.attach({ addonId: GHOSTTY, service: null, started: {} }), TypeError);
});
