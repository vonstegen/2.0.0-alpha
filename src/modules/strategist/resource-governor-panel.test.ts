// @vitest-environment node
// Intent citation: docs/architecture/resonantos-browser-architecture/11-resource-governance.md
import { describe, expect, it } from "vitest";

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

describe("buildResourceGovernorPanel", () => {
  it("projects the executor/budget/usage/status rows", () => {
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
    expect(panel.budgets.length).toBe(1);
    expect(panel.budgets[0].remaining.tokens).toBe(75);
    expect(panel.budgets[0].exhausted).toBe(false);
    expect(panel.usage[0].tokens).toBe(25);
    expect(panel.status[0].decision).toBe("admit");
    expect(panel.fairShares.length).toBe(2);
    // under-share ranks before over-share; user-1 deficit > user-2 deficit.
    expect(panel.fairShares[0].principalId).toBe("user-1");
    expect(panel.leases[0].leaseId).toBe("lease-1");
  });
});

describe("planStopMutation", () => {
  it("only mutates running executors and collects their leases + reservations", () => {
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
    expect(plan.cancelTaskIds).toEqual(["task-1"]);
    expect(plan.revokeReservationIds).toEqual(["res-a", "res-b"]);
    expect(plan.releaseLeaseIds).toEqual(["lease-a"]);
  });
});

describe("Stop mutation channel", () => {
  it("is the only mutation path; other controls are selectors", () => {
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
    expect(panel.executors.map((e) => e.status)).toEqual(["queued", "running"]);
    expect(panel.budgets[0].remaining.tokens).toBe(100);
    expect(panel.status[0].decision).toBe("queue");
    const plan = planStopMutation({
      panelState: panel,
      reservationIdsByTask: { "task-2": ["res-only"] },
      leaseIdsByTask: { "task-2": ["lease-only"] },
    });
    expect(plan.cancelTaskIds).toEqual(["task-2"]);
    expect(plan.revokeReservationIds).toEqual(["res-only"]);
    expect(plan.releaseLeaseIds).toEqual(["lease-only"]);
  });
});

describe("fairShare rank", () => {
  it("sorts under-share principals ahead of over-share (zero allocation ranks last)", () => {
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
    expect(panel.fairShares.map((row) => row.principalId)).toEqual(["under", "over", "zero"]);
  });
});