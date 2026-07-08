// Offline tests for the polling sync (M3, Art. VI).
// A manual timer queue makes scheduling deterministic — no real waiting.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCommunityPoller } from "../src/poller.mjs";

/** A controllable timer: setTimer enqueues; run() fires the earliest-scheduled cb. */
function manualTimers() {
  let seq = 0;
  const scheduled = new Map();
  const setTimer = (fn, ms) => {
    const id = ++seq;
    scheduled.set(id, { fn, ms });
    return id;
  };
  const clearTimer = (id) => scheduled.delete(id);
  const run = async () => {
    // Fire the most-recently scheduled pending callback (the poller only has one
    // outstanding timer at a time).
    const ids = [...scheduled.keys()];
    if (!ids.length) return false;
    const id = ids[ids.length - 1];
    const { fn } = scheduled.get(id);
    scheduled.delete(id);
    await fn();
    return true;
  };
  return { setTimer, clearTimer, run, pending: () => scheduled.size, last: () => [...scheduled.values()].at(-1) };
}

function stubService(responder) {
  let n = 0;
  return {
    calls: [],
    call(method) {
      this.calls.push(method);
      return Promise.resolve(responder(method, n++));
    },
  };
}

const ok = (method) => {
  if (method === "community.list_events") return { events: [{ id: "e1" }] };
  if (method === "community.list_tasks") return { tasks: [{ id: "t1" }] };
  if (method === "community.list_presence") return { presence: [{ memberId: "m1" }] };
  return {};
};

describe("createCommunityPoller", () => {
  it("builds a reconciled snapshot from the three read surfaces on tick", async () => {
    const service = stubService(ok);
    const snapshots = [];
    const poller = createCommunityPoller({
      service,
      onSnapshot: (s) => snapshots.push(s),
      setTimer: () => 0,
      clearTimer: () => {},
    });
    const snap = await poller.tick();
    assert.deepEqual(snap.events, [{ id: "e1" }]);
    assert.deepEqual(snap.tasks, [{ id: "t1" }]);
    assert.deepEqual(snap.presence, [{ memberId: "m1" }]);
    assert.equal(snap.degraded, false);
    assert.ok(snap.fetchedAt);
    assert.equal(snapshots.length, 1);
  });

  it("start(immediate) polls once, then schedules the next at the base interval", async () => {
    const timers = manualTimers();
    const service = stubService(ok);
    const poller = createCommunityPoller({
      service,
      intervalMs: 20_000,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    await poller.start();
    assert.equal(service.calls.length, 3); // one immediate tick = 3 reads
    assert.equal(timers.pending(), 1);
    assert.equal(timers.last().ms, 20_000);
    // Fire the scheduled poll: another 3 reads + reschedule.
    await timers.run();
    assert.equal(service.calls.length, 6);
    assert.equal(timers.pending(), 1);
    poller.stop();
    assert.equal(poller.isRunning(), false);
  });

  it("keeps the last good snapshot and backs off when a poll throws", async () => {
    let mode = "ok";
    const service = stubService((method) => {
      if (mode === "fail") throw new Error("boom");
      return ok(method);
    });
    const errors = [];
    const poller = createCommunityPoller({
      service,
      intervalMs: 1000,
      onError: (e) => errors.push(e),
      setTimer: () => 0,
      clearTimer: () => {},
    });
    await poller.tick();
    assert.equal(poller.currentDelay(), 1000);
    mode = "fail";
    await poller.tick();
    assert.equal(errors.length, 1);
    assert.ok(poller.currentDelay() > 1000, "delay should back off after an error");
    // Last snapshot is flagged degraded but still carries the previous data.
    assert.equal(poller.getSnapshot().degraded, true);
    assert.deepEqual(poller.getSnapshot().events, [{ id: "e1" }]);
    // Recovery resets the backoff.
    mode = "ok";
    await poller.tick();
    assert.equal(poller.currentDelay(), 1000);
  });

  it("treats a degraded read (backend unreachable) as a backoff signal, not a crash", async () => {
    const service = stubService((method) => {
      if (method === "community.list_events") return { degraded: true, events: [] };
      return ok(method);
    });
    const poller = createCommunityPoller({ service, intervalMs: 1000, setTimer: () => 0, clearTimer: () => {} });
    const snap = await poller.tick();
    assert.equal(snap.degraded, true);
    assert.ok(poller.currentDelay() > 1000);
  });

  it("stop() cancels the outstanding timer", async () => {
    const timers = manualTimers();
    const service = stubService(ok);
    const poller = createCommunityPoller({ service, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
    await poller.start();
    assert.equal(timers.pending(), 1);
    poller.stop();
    assert.equal(timers.pending(), 0);
  });
});
