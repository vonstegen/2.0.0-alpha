// Community Hub <-> GoalWorkspace mapping for the agent bridge (M5).
//
// Spec FR-T3 + acceptance §9 ("A member can claim a task; it maps to a
// GoalStepStatus an agent can read"): this module is where a community task
// becomes something a ResonantOS agent can read and act on through the shared
// GoalWorkspace primitive (src/core/goal-workspace.ts).
//
// It is the shell-side (TypeScript) half of the M5 agent bridge. The host-side
// enforcement half — the manifest delegation contract + approval gate — lives in
// addons/resonant-community-hub/src/agent-bridge.mjs. Both mirror the same tiny
// mapping tables (as community-view-model.ts and backend/src/goal-mapping.mjs
// already do); the tests pin both to the same expected values so they can't drift.
//
// This module is pure (no React, no I/O) so it is unit-testable under vitest and
// builds real GoalStep/GoalWorkspace values via the core factories, proving the
// mapping is type-compatible with the actual contracts rather than a lookalike.

import { createGoalStep, createGoalWorkspace } from "../../core/goal-workspace";
import type { GoalStep, GoalStepStatus, GoalWorkspace } from "../../core/contracts";
import type { CommunityTask, TaskStatus } from "./community-view-model";

/** Community task lifecycle (open -> claimed -> done) mapped onto GoalStepStatus. */
export const TASK_STATUS_TO_GOAL_STEP_STATUS = {
  open: "planned",
  claimed: "active",
  done: "completed",
} as const satisfies Record<TaskStatus, GoalStepStatus>;

export function taskStatusToGoalStepStatus(status: TaskStatus): GoalStepStatus {
  const mapped = TASK_STATUS_TO_GOAL_STEP_STATUS[status];
  if (!mapped) {
    throw new Error(`Unknown community task status: ${JSON.stringify(status)}`);
  }
  return mapped;
}

export type TaskClaimAction = "claim" | "unclaim";

/**
 * Reverse map: the GoalStepStatus an agent wants -> the community task write that
 * realizes it. v1 only exposes claim / un-claim (backend validateClaim), so:
 *   active  -> claim    (sign up / start working the task)
 *   planned -> unclaim  (release the task back to open)
 * "completed" (no `done` write path in v1), "blocked" and "cancelled" (no
 * community-task equivalent) are refused rather than mis-mapped.
 */
export const GOAL_STEP_STATUS_TO_TASK_ACTION: Partial<Record<GoalStepStatus, TaskClaimAction>> = {
  planned: "unclaim",
  active: "claim",
};

export class UnsupportedGoalStepTransitionError extends Error {
  readonly status: GoalStepStatus;
  constructor(status: GoalStepStatus) {
    super(
      `GoalStepStatus "${status}" has no community-task write path in v1 (only planned/active are agent-writable).`,
    );
    this.name = "UnsupportedGoalStepTransitionError";
    this.status = status;
  }
}

export function goalStepStatusToTaskAction(status: GoalStepStatus): TaskClaimAction {
  const action = GOAL_STEP_STATUS_TO_TASK_ACTION[status];
  if (!action) throw new UnsupportedGoalStepTransitionError(status);
  return action;
}

/** Deterministic, reversible GoalStep id for a community task (writes round-trip). */
export const COMMUNITY_STEP_ID_PREFIX = "goal-step-community";
export function goalStepIdForTask(taskId: string): string {
  return `${COMMUNITY_STEP_ID_PREFIX}::${taskId}`;
}
export function taskIdFromGoalStep(step: Pick<GoalStep, "id">): string | null {
  const id = step?.id ?? "";
  const prefix = `${COMMUNITY_STEP_ID_PREFIX}::`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : null;
}

function communityStepNotes(task: CommunityTask): string {
  const parts: string[] = [];
  if (Array.isArray(task.claimedBy) && task.claimedBy.length) parts.push(`claimedBy=${task.claimedBy.join(",")}`);
  if (task.dueAt) parts.push(`dueAt=${task.dueAt}`);
  parts.push(`source=community-task:${task.id}`);
  return parts.join("; ");
}

/**
 * Map one community task to a real GoalStep (built via the core factory, then given
 * a deterministic id so the agent write path can recover the task id). The step's
 * status is derived authoritatively from `task.status` — we do not trust the
 * denormalized `task.goalStepStatus` blindly.
 */
export function communityTaskToGoalStep(
  task: CommunityTask,
  opts: { createdAt?: string; ownerAgentId?: string } = {},
): GoalStep {
  const status = taskStatusToGoalStepStatus(task.status);
  const createdAt = opts.createdAt ?? task.createdAt ?? new Date().toISOString();
  const base = createGoalStep({
    label: (task.title ?? task.id) || task.id,
    status,
    createdAt,
    ownerAgentId: opts.ownerAgentId,
    notes: communityStepNotes(task),
  });
  return {
    ...base,
    id: goalStepIdForTask(task.id),
    completedAt: status === "completed" ? createdAt : base.completedAt,
  };
}

export function communityTasksToGoalSteps(
  tasks: CommunityTask[],
  opts: { ownerAgentId?: string } = {},
): GoalStep[] {
  return (tasks ?? []).map((task) => communityTaskToGoalStep(task, opts));
}

/**
 * Project the community task board into a full GoalWorkspace whose steps are the
 * community tasks — the "Task <-> GoalWorkspace step" mapping M5 calls for. Agents
 * read this workspace exactly like any other (buildGoalWorkspaceStatus, etc.).
 */
export function buildCommunityGoalWorkspace(
  tasks: CommunityTask[],
  opts: { createdAt?: string; owningAgentId?: string; threadId?: string } = {},
): GoalWorkspace {
  const createdAt = opts.createdAt ?? new Date().toISOString();
  const workspace = createGoalWorkspace({
    mission: "Track and action open community tasks from the Community Hub.",
    title: "Community tasks",
    createdAt,
    owningAgentId: opts.owningAgentId,
    threadId: opts.threadId,
    successCriteria: ["Community tasks are surfaced and progressed with human approval on each write."],
    allowedTools: ["community.list_tasks", "community.claim_task"],
  });
  return {
    ...workspace,
    steps: communityTasksToGoalSteps(tasks, { ownerAgentId: opts.owningAgentId }),
  };
}

/** A host RPC intent an agent dispatches through the bridge to act on a task. */
export interface CommunityAgentWriteIntent {
  method: "community.claim_task";
  params: { taskId: string; action: TaskClaimAction; source: "agent"; approved: boolean };
}

/**
 * Build the approval-gated agent write for moving a task's step to `targetStatus`.
 * `approved` defaults to false so the host/delegation gate refuses it until a human
 * approves (constitution Art. V) — the caller flips it to true only after approval.
 */
export function planTaskClaimForStepStatus(
  taskId: string,
  targetStatus: GoalStepStatus,
  opts: { approved?: boolean } = {},
): CommunityAgentWriteIntent {
  const action = goalStepStatusToTaskAction(targetStatus);
  return {
    method: "community.claim_task",
    params: { taskId, action, source: "agent", approved: opts.approved === true },
  };
}
