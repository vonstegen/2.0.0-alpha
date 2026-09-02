// Intent citation: docs/architecture/resonantos-browser-architecture/11-resource-governance.md
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResourceGovernorPanel,
  planStopMutation,
  type ResourceGovernorPanelState,
} from "./resource-governor-panel";
import type {
  FairShareAccount,
  ResourceBudget,
  ResourceLease,
  ResourceReservation,
  ResourceUsage,
} from "../../sdk/resources";

function budget(): ResourceBudget {
  return {
    priority: 1,
    deadline: "2026-09-03T00:00:00Z",
    concurrencyClass: "shared",
    estimated: { tokens: 10 },
    hardCeiling: { tokens: 100, cpuSeconds: 30 },
    requiredNodeRoles: [],
    networkMode: "none",
    workspaceMode: "isolated",
    secretPolicy: "none",
    onExhaustion: "stop",
  };
}

test("buildResourceGovernorPanel projects the executor/budget/usage/status rows", () => {
  const panel = buildResourceGovernorPanel({
    budgets: [
      { taskId: "task-1", budget: budget(), usage: { tokens: 25, cpuSeconds: 5 } },
    ],
    reservations: [
      {
        reservationId: "res-1",
        taskId: "task-1",
        resourceKind: "tokens",
        amount: 5,
        heldByPrincipalId: "user-1",
        expiresAt: "2026-09-02T12:00:00Z",
      } satisfies ResourceReservation,
    ],
    fairShares: [
      { principalId: "user-1", allocatedShare: 10, usedShare: 2 },
      { principalId: "user-2", allocatedShare: 10, usedShare: 12 },
    ],
    leases: [
      {
        leaseId: "lease-1",
        resourceKind: "workspace",
        resourceId: "/workspace/p",
        holderPrincipalId: "user-1",
        exclusive: true,
        expiresAt: "2026-09-02T12:00:00Z",
      } satisfies ResourceLease,
    ],
    status: [{ taskId: "task-1", decision: "admit", at: "2026-09-02T10:00:00Z" }],
    executors: [
      { taskId: "task-1", principalId: "user-1", providerId: "opencode", status: "running" },
    ],
  });
  assert.equal(panel.budgets.length, 1);
  assert.equal(panel.budgets[0].remaining.tokens, 75);
  assert.equal(panel.budgets[0].exhausted, false);
  assert.equal(panel.usage[0].tokens, 25);
  assert.equal(panel.status[0].decision, "admit");
  assert.equal(panel.fairShares.length, 2);
  // under-share ranks before over-share; user-1 deficit > user-2 deficit.
  assert.equal(panel.fairShares[0].principalId, "user-1");
  assert.equal(panel.leases[0].leaseId, "lease-1");
});

test("planStopMutation only mutates running executors and collects their leases + reservations", () => {
  const panel: ResourceGovernorPanelState = {
    executors: [
      { taskId: "task-1", principalId: "user-1", providerId: "opencode", status: "running" },
      { taskId: "task-2", principalId: "user-2", providerId: "hermes", status: "completed" },
      { taskId: "task-3", principalId: "user-1", providerId: "pi", status: "queued" },
    ],
    budgets: [],
    usage: [],
    status: [],
    fairShares: [],
    leases: [],
  };
  const plan = planStopMutation({
    panelState: panel,
    reservationIdsByTask: { "task-1": ["res-a", "res-b"] },
    leaseIdsByTask: { "task-1": ["lease-a"], "task-3": ["lease-b"] },
  });
  assert.deepEqual(plan.cancelTaskIds, ["task-1"]);
  assert.deepEqual(plan.revokeReservationIds, ["res-a", "res-b"]);
  assert.deepEqual(plan.releaseLeaseIds, ["lease-a"]);
});

test("Stop is the only mutation channel — every other control derives from a selector", () => {
  const budgetRow = budget();
  const panel = buildResourceGovernorPanel({
    budgets: [{ taskId: "task-1", budget: budgetRow, usage: {} }],
    reservations: [],
    fairShares: [],
    leases: [],
    status: [{ taskId: "task-1", decision: "queue", reason: "queue-at-limit", at: "2026-09-02T10:00:00Z" }],
    executors: [
      { taskId: "task-1", principalId: "user-1", providerId: "opencode", status: "queued" },
      { taskId: "task-2", principalId: "user-1", providerId: "opencode", status: "running" },
    ],
  });
  // The executor, budget, usage, status fields are read-only projections of
  // the governor snapshot; the only deterministic mutation path is planStopMutation.
  assert.deepEqual(panel.executors.map((e) => e.status), ["queued", "running"]);
  assert.equal(panel.budgets[0].remaining.tokens, 100);
  assert.equal(panel.status[0].decision, "queue");
  const plan = planStopMutation({
    panelState: panel,
    reservationIdsByTask: { "task-2": ["res-only"] },
    leaseIdsByTask: { "task-2": ["lease-only"] },
  });
  assert.deepEqual(plan.cancelTaskIds, ["task-2"]);
  assert.deepEqual(plan.revokeReservationIds, ["res-only"]);
  assert.deepEqual(plan.releaseLeaseIds, ["lease-only"]);
});

test("fairShare rank sorts under-share principals ahead of over-share (zero allocation ranks last)", () => {
  const panel = buildResourceGovernorPanel({
    budgets: [],
    reservations: [],
    fairShares: [
      { principalId: "zero", allocatedShare: 0, usedShare: 0 },
      { principalId: "under", allocatedShare: 10, usedShare: 2 } satisfies FairShareAccount,
      { principalId: "over", allocatedShare: 10, usedShare: 18 } satisfies FairShareAccount,
    ],
    leases: [],
    status: [],
    executors: [],
  });
  assert.deepEqual(
    panel.fairShares.map((row) => row.principalId),
    ["under", "over", "zero"],
  );
});
