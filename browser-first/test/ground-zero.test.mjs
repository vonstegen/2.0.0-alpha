// Intent citation: docs/architecture/resonantos-browser-architecture/10-ground-0-recovery.md
import assert from "node:assert/strict";
import test from "node:test";

import {
  createKnownGoodSet,
  driveRecoveryLadder,
  enterGroundZero,
  reEnableFromGroundZero,
  serializeKnownGoodSet,
  verifyKnownGoodSet,
} from "../host/ground-zero.mjs";

function snapshot(overrides = {}) {
  return {
    state: "normal",
    activeGrantIds: ["grant-1", "grant-2"],
    optionalItems: [
      { id: "addon.hermes", kind: "harness" },
      { id: "addon.browser", kind: "extension" },
    ],
    quarantine: [],
    audit: [],
    ...overrides,
  };
}

test("enters Ground-0 by revoking every grant and quarantining optional items", () => {
  const next = enterGroundZero(snapshot(), { trigger: "crash-loop", at: "2026-08-28T12:00:00Z" });

  assert.equal(next.state, "ground-zero");
  assert.deepEqual(next.activeGrantIds, []); // no pre-recovery authority survives
  assert.deepEqual(next.quarantine.map((q) => q.item), ["addon.hermes", "addon.browser"]);
  assert.equal(next.audit.length, 1);
  assert.ok(next.audit[0].effects.includes("revoked 2 active grants"));
  assert.ok(next.audit[0].effects.includes("quarantined 2 optional items"));
});

test("refuses to enter Ground-0 from a non-normal state", () => {
  assert.throws(
    () => enterGroundZero(snapshot({ state: "ground-zero" }), { trigger: "x", at: "y" }),
    /cannot enter Ground-0/,
  );
});

test("re-enables healthy items in dependency order with fresh grants, never old ones", () => {
  const entered = enterGroundZero(snapshot(), { trigger: "crash-loop", at: "t1" });
  const reenabled = reEnableFromGroundZero(entered, {
    order: ["addon.browser", "addon.hermes"], // dependency order
    healthCheck: (id) => id !== "addon.hermes", // hermes fails its health check
    at: "t2",
  });

  assert.equal(reenabled.state, "normal");
  assert.deepEqual(reenabled.activeGrantIds, ["fresh-grant:addon.browser"]);
  // Old grants are never revived.
  assert.ok(!reenabled.activeGrantIds.includes("grant-1"));
  assert.ok(!reenabled.activeGrantIds.includes("grant-2"));
  assert.equal(reenabled.quarantine.find((q) => q.item === "addon.browser").disposition, "accepted");
  assert.equal(reenabled.quarantine.find((q) => q.item === "addon.hermes").disposition, "left-disabled");
});

test("leaves omitted items disabled", () => {
  const entered = enterGroundZero(snapshot(), { trigger: "manual", at: "t1" });
  const reenabled = reEnableFromGroundZero(entered, {
    order: ["addon.browser"], // addon.hermes omitted
    healthCheck: () => true,
    at: "t2",
  });
  assert.equal(reenabled.quarantine.find((q) => q.item === "addon.hermes").disposition, undefined);
  assert.deepEqual(reenabled.activeGrantIds, ["fresh-grant:addon.browser"]);
});

test("refuses to re-enable from a non-ground-zero state", () => {
  assert.throws(
    () => reEnableFromGroundZero(snapshot(), { order: [], healthCheck: () => true, at: "y" }),
    /cannot re-enable/,
  );
});

// ---- CP-8 recovery drill cases (doc 10 exit gate) ----

test("crash-loop recovery: no pre-recovery grant id ever resurfaces after re-enable", () => {
  const entered = enterGroundZero(snapshot(), { trigger: "crash-loop", at: "t1" });
  const reenabled = reEnableFromGroundZero(entered, {
    order: ["addon.browser", "addon.hermes"],
    healthCheck: () => true,
    at: "t2",
  });

  assert.deepEqual(reenabled.activeGrantIds, ["fresh-grant:addon.browser", "fresh-grant:addon.hermes"]);
  assert.ok(!reenabled.activeGrantIds.some((id) => id === "grant-1" || id === "grant-2"));
});

test("interrupted recovery: a snapshot stuck in re-enabling refuses further entry", () => {
  // An interrupted recovery leaves state at "re-enabling"; entry must fail
  // closed rather than silently re-deriving Ground-0.
  assert.throws(
    () => enterGroundZero(snapshot({ state: "re-enabling" }), { trigger: "crash-loop", at: "t2" }),
    /cannot enter Ground-0 from state "re-enabling"/,
  );
});

test("interrupted recovery: partial re-enable leaves the rest disabled", () => {
  const entered = enterGroundZero(snapshot(), { trigger: "manual", at: "t1" });
  const partial = reEnableFromGroundZero(entered, {
    order: ["addon.browser"], // recovery interrupted before addon.hermes
    healthCheck: () => true,
    at: "t2",
  });

  assert.equal(partial.quarantine.find((q) => q.item === "addon.hermes").disposition, undefined);
  assert.deepEqual(partial.activeGrantIds, ["fresh-grant:addon.browser"]);
});

test("rollback: re-entering Ground-0 after exit revokes the fresh grants", () => {
  const entered = enterGroundZero(snapshot(), { trigger: "crash-loop", at: "t1" });
  const reenabled = reEnableFromGroundZero(entered, {
    order: ["addon.browser", "addon.hermes"],
    healthCheck: () => true,
    at: "t2",
  });
  const rolledBack = enterGroundZero(reenabled, { trigger: "rollback", at: "t3" });

  assert.equal(rolledBack.state, "ground-zero");
  assert.deepEqual(rolledBack.activeGrantIds, []);
  assert.equal(rolledBack.audit.length, 3);
});

test("known-good set verifies intact and rejects tampering", () => {
  const set = createKnownGoodSet({ version: "1", manifestIds: ["overview", "archive", "strategist"] });
  assert.equal(verifyKnownGoodSet(set), true);
  assert.equal(verifyKnownGoodSet({ ...set, manifestIds: [...set.manifestIds, "compute"] }), false);
  assert.equal(verifyKnownGoodSet({ ...set, version: "2" }), false);
});

test("known-good digest is order-independent and deterministic", () => {
  const a = createKnownGoodSet({ version: "1", manifestIds: ["b", "a"] });
  const b = createKnownGoodSet({ version: "1", manifestIds: ["a", "b"] });
  assert.equal(a.configDigest, b.configDigest);
  assert.equal(serializeKnownGoodSet(a), serializeKnownGoodSet(b));
});

test("Ground-0 drives the recovery ladder: entry activates, exit hands off", () => {
  const ladder = {
    active: false,
    lastNormalThreadId: "thread-main-desktop",
    checklist: [
      { id: "facts", status: "pending" },
      { id: "better-brain", status: "pending" },
      { id: "report", status: "pending" },
    ],
    changeLog: [],
  };
  const active = driveRecoveryLadder("ground-zero", ladder, "t1");
  assert.equal(active.active, true);
  assert.deepEqual(active.checklist.map((s) => s.status), ["active", "pending", "pending"]);

  const exited = driveRecoveryLadder("normal", active, "t2");
  assert.equal(exited.active, false);
  assert.equal(exited.checklist.find((s) => s.id === "report").status, "complete");
  assert.equal(exited.lastNormalThreadId, "thread-main-desktop");
});
