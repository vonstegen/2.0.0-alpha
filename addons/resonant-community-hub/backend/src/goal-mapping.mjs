// Map a community Task.status onto the ResonantOS GoalStepStatus union so agents
// can pick tasks up via GoalWorkspace (spec FR-T3; acceptance §9 "maps to a
// GoalStepStatus an agent can read").
//
// Source of truth for the target union: src/core/contracts.ts
//   export type GoalStepStatus = "planned" | "active" | "blocked" | "completed" | "cancelled";
//
// Community task lifecycle (spec §5): open -> claimed -> done.
//   open    -> planned    (nobody working it yet; an agent could plan/claim it)
//   claimed -> active     (a member/agent has signed up and is working it)
//   done    -> completed  (finished)
// "blocked" and "cancelled" have no community-task equivalent in v1 and are
// therefore never emitted by this read path; they remain reserved for M5 when the
// agent bridge can surface blockers back onto the task.

/** @typedef {"open"|"claimed"|"done"} TaskStatus */
/** @typedef {"planned"|"active"|"blocked"|"completed"|"cancelled"} GoalStepStatus */

/** @type {Readonly<Record<TaskStatus, GoalStepStatus>>} */
export const TASK_STATUS_TO_GOAL_STEP_STATUS = Object.freeze({
  open: "planned",
  claimed: "active",
  done: "completed",
});

/**
 * @param {string} status
 * @returns {GoalStepStatus}
 */
export function taskStatusToGoalStepStatus(status) {
  const mapped = TASK_STATUS_TO_GOAL_STEP_STATUS[status];
  if (!mapped) {
    throw new Error(`Unknown community task status: ${JSON.stringify(status)}`);
  }
  return mapped;
}
