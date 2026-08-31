// Intent citation: docs/architecture/resonantos-browser-architecture/11-resource-governance.md
import { describe, expect, it } from "vitest";

import type { ResourceBudget } from "./index";
import {
  addUsage,
  admissionDecision,
  admissionEvent,
  fairShareDeficit,
  fairShareRank,
  isBudgetExhausted,
  leaseActive,
  leaseConflicts,
  optionalWorkHeadroom,
  remainingBudget,
  rollUpChildUsage,
} from "./index";

function budget(hardCeiling: ResourceBudget["hardCeiling"]): ResourceBudget {
  return {
    priority: 1,
    deadline: "2026-08-28T12:00:00Z",
    concurrencyClass: "shared",
    estimated: {},
    hardCeiling,
    requiredNodeRoles: [],
    networkMode: "none",
    workspaceMode: "isolated",
    secretPolicy: "none",
    onExhaustion: "stop",
  };
}

describe("resource governor primitives", () => {
  it("adds usage per-dimension, omitting zero dimensions", () => {
    expect(addUsage({ cpuSeconds: 1, tokens: 2 }, { cpuSeconds: 3, memoryBytes: 4 })).toEqual({
      cpuSeconds: 4,
      tokens: 2,
      memoryBytes: 4,
    });
  });

  it("computes remaining headroom under the hard ceiling", () => {
    const remaining = remainingBudget(
      budget({ tokens: 10, cpuSeconds: 5 }),
      { tokens: 8, cpuSeconds: 5 },
    );
    expect(remaining).toEqual({ tokens: 2 }); // cpu exhausted -> omitted
  });

  it("detects budget exhaustion deterministically", () => {
    const b = budget({ tokens: 10 });
    expect(isBudgetExhausted(b, { tokens: 10 })).toBe(true);
    expect(isBudgetExhausted(b, { tokens: 9 })).toBe(false);
    // A dimension with no ceiling never exhausts.
    expect(isBudgetExhausted(b, { cpuSeconds: 999 })).toBe(false);
  });

  it("rolls child usage into the parent budget and flags ceiling crossing", () => {
    const rollup = rollUpChildUsage(
      budget({ tokens: 10 }),
      { tokens: 8 },
      { tokens: 5 },
      { parentTaskId: "parent-1", childTaskId: "child-1" },
    );
    expect(rollup.rolledUp).toEqual({ tokens: 13 });
    expect(rollup.exhausted).toBe(true);
    expect(rollup.exceededDimensions).toEqual(["tokens"]);
    expect(rollup.remaining).toEqual({});
  });

  it("rolls child usage without exhaustion when under the ceiling", () => {
    const rollup = rollUpChildUsage(
      budget({ tokens: 10 }),
      { tokens: 3 },
      { tokens: 4 },
      { parentTaskId: "p", childTaskId: "c" },
    );
    expect(rollup.exhausted).toBe(false);
    expect(rollup.exceededDimensions).toEqual([]);
    expect(rollup.remaining).toEqual({ tokens: 3 });
  });

  it("admits, queues, and rejects deterministically", () => {
    const b = budget({ tokens: 10 });
    expect(admissionDecision({ running: 2, limit: 3, budget: b, usage: { tokens: 1 } })).toBe("admit");
    expect(admissionDecision({ running: 3, limit: 3, budget: b, usage: { tokens: 1 } })).toBe("queue");
    expect(admissionDecision({ running: 0, limit: 3, budget: b, usage: { tokens: 10 } })).toBe("reject");
  });
});

describe("leases, fair-share, governor events, and reserved capacity", () => {
  it("detects lease conflicts only on the same exclusive resource", () => {
    const base = {
      leaseId: "l",
      resourceKind: "workspace" as const,
      resourceId: "/workspace/a",
      holderPrincipalId: "p",
      expiresAt: "2026-08-29T00:00:00Z",
    };
    const exclusive = { ...base, exclusive: true };
    const shared = { ...base, exclusive: false };

    expect(leaseConflicts(exclusive, { ...exclusive, leaseId: "l2" })).toBe(true);
    expect(leaseConflicts(exclusive, shared)).toBe(true); // one exclusive suffices
    expect(leaseConflicts(shared, { ...shared, leaseId: "l3" })).toBe(false); // both shared
    expect(leaseConflicts(exclusive, { ...exclusive, resourceId: "/workspace/b" })).toBe(false);
    expect(leaseConflicts(exclusive, { ...exclusive, resourceKind: "gpu" })).toBe(false);
  });

  it("reports lease liveness by expiry", () => {
    const lease = {
      leaseId: "l",
      resourceKind: "workspace" as const,
      resourceId: "/w",
      holderPrincipalId: "p",
      exclusive: true,
      expiresAt: "2026-08-29T00:00:00Z",
    };
    expect(leaseActive(lease, "2026-08-28T00:00:00Z")).toBe(true);
    expect(leaseActive(lease, "2026-08-29T00:00:00Z")).toBe(false);
  });

  it("computes fair-share deficit and ranks under-share principals first", () => {
    expect(fairShareDeficit({ principalId: "a", allocatedShare: 0.3, usedShare: 0.1 })).toBeCloseTo(0.2);
    expect(fairShareDeficit({ principalId: "b", allocatedShare: 0.3, usedShare: 0.5 })).toBeCloseTo(-0.2);

    const underShare = { principalId: "under", allocatedShare: 0.3, usedShare: 0.1 };
    const overShare = { principalId: "over", allocatedShare: 0.3, usedShare: 0.6 };
    expect(fairShareRank(underShare)).toBeLessThan(fairShareRank(overShare));
    expect(fairShareRank({ principalId: "zero", allocatedShare: 0, usedShare: 0 })).toBe(Number.POSITIVE_INFINITY);
  });

  it("maps admission outcomes to typed governor events", () => {
    expect(admissionEvent("admit", "t1", "2026-08-28T00:00:00Z")).toEqual({
      kind: "admitted",
      taskId: "t1",
      at: "2026-08-28T00:00:00Z",
    });
    expect(admissionEvent("queue", "t2", "at").kind).toBe("queued");
    const rejected = admissionEvent("reject", "t3", "at");
    expect(rejected).toEqual({ kind: "rejected", taskId: "t3", at: "at", reason: "budget-exhausted" });
    expect(admissionEvent("reject", "t4", "at", { reason: "rate-limit" }).reason).toBe("rate-limit");
  });

  it("reserves interactive and Ground-0 capacity away from optional work", () => {
    const b = budget({ tokens: 10, gpuSeconds: 4 });
    const reserved = { tokens: 2, gpuSeconds: 4 };
    const headroom = optionalWorkHeadroom(b, { tokens: 3 }, reserved);
    // tokens: 10 - 3 = 7 free, minus 2 reserved -> 5; gpu fully reserved -> omitted.
    expect(headroom).toEqual({ tokens: 5 });
  });
});
