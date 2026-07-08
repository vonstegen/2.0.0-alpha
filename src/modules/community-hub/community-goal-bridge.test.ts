// Vitest: Community task <-> GoalWorkspace step mapping (M5, spec FR-T3).
//
// These tests exercise the mapping against the REAL core primitives in
// src/core/goal-workspace.ts / contracts.ts — the produced steps flow through
// updateGoalStepStatus and buildGoalWorkspaceStatus unchanged — so a drift between
// the community mapping and the actual GoalStepStatus union fails the build here.

import { describe, expect, it } from "vitest";

import {
  buildGoalWorkspaceStatus,
  updateGoalStepStatus,
} from "../../core/goal-workspace";
import type { GoalStepStatus } from "../../core/contracts";
import type { CommunityTask } from "./community-view-model";
import {
  GOAL_STEP_STATUS_TO_TASK_ACTION,
  UnsupportedGoalStepTransitionError,
  buildCommunityGoalWorkspace,
  communityTaskToGoalStep,
  goalStepIdForTask,
  goalStepStatusToTaskAction,
  planTaskClaimForStepStatus,
  taskIdFromGoalStep,
  taskStatusToGoalStepStatus,
} from "./community-goal-bridge";

// The exact five values the core union allows.
const GOAL_STEP_STATUSES: GoalStepStatus[] = ["planned", "active", "blocked", "completed", "cancelled"];

const task = (over: Partial<CommunityTask> = {}): CommunityTask => ({
  id: "task-1",
  title: "Run the July meetup",
  description: null,
  status: "open",
  goalStepStatus: "planned",
  claimedBy: [],
  dueAt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  ...over,
});

describe("task status -> GoalStepStatus", () => {
  it("maps the full community lifecycle onto valid GoalStepStatus values", () => {
    expect(taskStatusToGoalStepStatus("open")).toBe("planned");
    expect(taskStatusToGoalStepStatus("claimed")).toBe("active");
    expect(taskStatusToGoalStepStatus("done")).toBe("completed");
    for (const status of ["open", "claimed", "done"] as CommunityTask["status"][]) {
      expect(GOAL_STEP_STATUSES).toContain(taskStatusToGoalStepStatus(status));
    }
  });
});

describe("communityTaskToGoalStep", () => {
  it("produces a real GoalStep with a reversible, deterministic id", () => {
    const step = communityTaskToGoalStep(task({ id: "task-42", status: "claimed", claimedBy: ["m1"] }));
    expect(step.id).toBe(goalStepIdForTask("task-42"));
    expect(step.status).toBe("active");
    expect(step.label).toBe("Run the July meetup");
    expect(step.createdAt).toBe("2026-07-01T00:00:00.000Z");
    expect(step.updatedAt).toBe(step.createdAt);
    expect(taskIdFromGoalStep(step)).toBe("task-42");
    expect(step.notes).toMatch(/source=community-task:task-42/);
    expect(step.notes).toMatch(/claimedBy=m1/);
  });

  it("stamps completedAt for a done task", () => {
    const step = communityTaskToGoalStep(task({ status: "done" }));
    expect(step.status).toBe("completed");
    expect(step.completedAt).toBe(step.createdAt);
  });

  it("returns null taskId for a non-community step id", () => {
    expect(taskIdFromGoalStep({ id: "goal-step-something-else" })).toBeNull();
  });
});

describe("buildCommunityGoalWorkspace", () => {
  it("projects tasks into a GoalWorkspace whose steps the core status builder reads", () => {
    const tasks = [
      task({ id: "t1", status: "open" }),
      task({ id: "t2", status: "claimed" }),
      task({ id: "t3", status: "done" }),
    ];
    const ws = buildCommunityGoalWorkspace(tasks, { createdAt: "2026-07-05T00:00:00.000Z" });
    expect(ws.steps).toHaveLength(3);
    expect(ws.steps?.map((s) => s.status)).toEqual(["planned", "active", "completed"]);

    // The workspace is a first-class GoalWorkspace: the core status roll-up reads it.
    const status = buildGoalWorkspaceStatus({ goalWorkspaces: [ws] });
    const item = status.active.find((g) => g.id === ws.id);
    expect(item).toBeDefined();
    expect(item?.totalSteps).toBe(3);
    expect(item?.plannedSteps).toBe(1);
    expect(item?.activeSteps).toBe(1);
    expect(item?.completedSteps).toBe(1);
  });

  it("lets the core mutate a mapped step by its deterministic id", () => {
    const ws = buildCommunityGoalWorkspace([task({ id: "t9", status: "open" })]);
    const state = { goalWorkspaces: [ws] } as Parameters<typeof updateGoalStepStatus>[0];
    const next = updateGoalStepStatus(state, ws.id, goalStepIdForTask("t9"), "active");
    const step = next.goalWorkspaces[0].steps?.find((s) => s.id === goalStepIdForTask("t9"));
    expect(step?.status).toBe("active");
  });
});

describe("reverse mapping: GoalStepStatus -> task action", () => {
  it("maps agent-writable statuses to claim/unclaim", () => {
    expect(goalStepStatusToTaskAction("active")).toBe("claim");
    expect(goalStepStatusToTaskAction("planned")).toBe("unclaim");
    expect(GOAL_STEP_STATUS_TO_TASK_ACTION).toEqual({ planned: "unclaim", active: "claim" });
  });

  it("refuses statuses with no v1 community write path", () => {
    for (const status of ["completed", "blocked", "cancelled"] as GoalStepStatus[]) {
      expect(() => goalStepStatusToTaskAction(status)).toThrow(UnsupportedGoalStepTransitionError);
    }
  });
});

describe("planTaskClaimForStepStatus (approval-gated agent write)", () => {
  it("defaults approved:false so the host/delegation gate refuses until a human approves", () => {
    const intent = planTaskClaimForStepStatus("task-1", "active");
    expect(intent).toEqual({
      method: "community.claim_task",
      params: { taskId: "task-1", action: "claim", source: "agent", approved: false },
    });
  });

  it("carries approved:true only when explicitly approved", () => {
    const intent = planTaskClaimForStepStatus("task-1", "planned", { approved: true });
    expect(intent.params).toEqual({ taskId: "task-1", action: "unclaim", source: "agent", approved: true });
  });
});
