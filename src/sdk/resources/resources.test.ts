// Intent citation: docs/architecture/resonantos-browser-architecture/11-resource-governance.md
import { describe, expect, it } from "vitest";

import type { ResourceBudget } from "./index";
import {
  addUsage,
  admissionDecision,
  isBudgetExhausted,
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
