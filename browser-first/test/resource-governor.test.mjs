// Intent citation: docs/architecture/resonantos-browser-architecture/11-resource-governance.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
import assert from "node:assert/strict";
import test from "node:test";

import {
  addUsage,
  admissionDecision,
  admissionEvent,
  fairShareDeficit,
  fairShareRank,
  isBudgetExhausted,
  leaseActive,
  leaseConflicts,
  makeResourceGovernor,
  optionalWorkHeadroom,
  remainingBudget,
  rollUpChildUsage,
} from "../host/resource-governor.mjs";

test("addUsage combines per-dimension usage and omits zeros", () => {
  const out = addUsage({ cpuSeconds: 1, tokens: 0 }, { cpuSeconds: 2, memoryBytes: 4 });
  assert.equal(out.cpuSeconds, 3);
  assert.equal(out.memoryBytes, 4);
  assert.equal(out.tokens, undefined);
});

test("remainingBudget returns zero dimensions only when fully consumed", () => {
  const budget = { hardCeiling: { cpuSeconds: 5, tokens: 100 } };
  const usage = { cpuSeconds: 2, tokens: 100 };
  const remaining = remainingBudget(budget, usage);
  assert.equal(remaining.cpuSeconds, 3);
  assert.equal(remaining.tokens, undefined);
});

test("isBudgetExhausted is true when any hard ceiling is met or exceeded", () => {
  const budget = { hardCeiling: { tokens: 10 } };
  assert.equal(isBudgetExhausted(budget, { tokens: 5 }), false);
  assert.equal(isBudgetExhausted(budget, { tokens: 10 }), true);
  assert.equal(isBudgetExhausted(budget, { tokens: 11 }), true);
  assert.equal(isBudgetExhausted(budget, {}), false);
});

test("rollUpChildUsage reports exceeded dimensions when the child crosses the parent's ceiling", () => {
  const parent = { hardCeiling: { tokens: 10 } };
  const rollup = rollUpChildUsage(parent, { tokens: 4 }, { tokens: 8 }, {
    parentTaskId: "p",
    childTaskId: "c",
  });
  assert.equal(rollup.exhausted, true);
  assert.deepEqual(rollup.exceededDimensions, ["tokens"]);
  assert.equal(rollup.rolledUp.tokens, 12);
});

test("admissionDecision rejects when budget is exhausted, queues at the limit, otherwise admits", () => {
  const budget = { hardCeiling: { tokens: 5 } };
  assert.equal(
    admissionDecision({ running: 0, limit: 1, budget, usage: { tokens: 6 } }),
    "reject",
  );
  assert.equal(
    admissionDecision({ running: 1, limit: 1, budget, usage: { tokens: 1 } }),
    "queue",
  );
  assert.equal(
    admissionDecision({ running: 0, limit: 1, budget, usage: {} }),
    "admit",
  );
});

test("admissionEvent overloads emit the typed GovernorEvent shape", () => {
  assert.deepEqual(admissionEvent("admit", "t1", "2026-01-01T00:00:00Z"), {
    kind: "admitted",
    taskId: "t1",
    at: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(admissionEvent("queue", "t1", "2026-01-01T00:00:00Z"), {
    kind: "queued",
    taskId: "t1",
    at: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(
    admissionEvent("reject", "t1", "2026-01-01T00:00:00Z", { reason: "tokens-exhausted" }),
    {
      kind: "rejected",
      taskId: "t1",
      at: "2026-01-01T00:00:00Z",
      reason: "tokens-exhausted",
    },
  );
});

test("leaseConflicts only fires for the same kind + same resource + at least one exclusive", () => {
  const a = { resourceKind: "workspace", resourceId: "root-a", exclusive: true, expiresAt: "2026-12-31T00:00:00Z" };
  const shared = { resourceKind: "workspace", resourceId: "root-a", exclusive: false, expiresAt: "2026-12-31T00:00:00Z" };
  const different = { resourceKind: "workspace", resourceId: "root-b", exclusive: true, expiresAt: "2026-12-31T00:00:00Z" };
  const browser = { resourceKind: "browser", resourceId: "root-a", exclusive: true, expiresAt: "2026-12-31T00:00:00Z" };
  assert.equal(leaseConflicts(a, shared), true);
  assert.equal(leaseConflicts(shared, a), true);
  assert.equal(leaseConflicts(shared, shared), false);
  assert.equal(leaseConflicts(a, different), false);
  assert.equal(leaseConflicts(a, browser), false);
});

test("leaseActive compares expiresAt against the wall clock", () => {
  const lease = { resourceKind: "workspace", resourceId: "x", exclusive: true, expiresAt: "2026-12-31T00:00:00Z" };
  assert.equal(leaseActive(lease, "2026-01-01T00:00:00Z"), true);
  assert.equal(leaseActive(lease, "2027-01-01T00:00:00Z"), false);
});

test("fairShareDeficit/Rank rank under-share principals ahead of over-share", () => {
  const under = { principalId: "u", allocatedShare: 10, usedShare: 2 };
  const over = { principalId: "o", allocatedShare: 10, usedShare: 18 };
  const zero = { principalId: "z", allocatedShare: 0, usedShare: 0 };
  assert.equal(fairShareDeficit(under), 8);
  assert.equal(fairShareDeficit(over), -8);
  assert.ok(fairShareRank(under) < fairShareRank(over));
  assert.equal(fairShareRank(zero), Number.POSITIVE_INFINITY);
});

test("optionalWorkHeadroom subtracts reserved usage from free headroom", () => {
  const budget = { hardCeiling: { tokens: 100 } };
  const reserved = { tokens: 30 };
  assert.deepEqual(
    optionalWorkHeadroom(budget, { tokens: 10 }, reserved),
    { tokens: 60 },
  );
  assert.deepEqual(
    optionalWorkHeadroom(budget, { tokens: 70 }, reserved),
    {},
  );
});

test("makeResourceGovernor.admit admits/queues/rejects with audit events", () => {
  const events = [];
  const gov = makeResourceGovernor({
    auditSink: (event) => events.push(event),
    now: () => Date.parse("2026-09-02T00:00:00Z"),
  });
  const budget = { hardCeiling: { tokens: 100 } };
  const a = gov.admit({ taskId: "task-1", principalId: "u1", budget, concurrentLimit: 1 });
  assert.equal(a.decision, "admitted");
  // Same task — the running counter is already 1, so a second concurrentLimit=1
  // admit against the same taskId queues at the cap.
  const queued = gov.admit({ taskId: "task-1", principalId: "u1", budget, concurrentLimit: 1 });
  assert.equal(queued.decision, "queued");
  // A child turn drains the budget; the next admit is rejected.
  // 101 units crosses the ceiling so the rollup emits a budget-exhausted
  // GovernorEvent AND isBudgetExhausted gates the next admit.
  gov.rollUp({ parentTaskId: "task-1", childTaskId: "child", childUsage: { tokens: 101 } });
  const rejected = gov.admit({ taskId: "task-1", principalId: "u1", budget, concurrentLimit: 1 });
  assert.equal(rejected.decision, "rejected");
  const kinds = events.map((e) => e.kind);
  assert.deepEqual(kinds, ["admitted", "queued", "budget-exhausted", "rejected"]);
});
