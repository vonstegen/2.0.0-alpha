// Unit: Task.status -> GoalStepStatus mapping (spec FR-T3).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TASK_STATUS_TO_GOAL_STEP_STATUS,
  taskStatusToGoalStepStatus,
} from "../src/goal-mapping.mjs";

// The five values the ResonantOS core union allows (src/core/contracts.ts).
const GOAL_STEP_STATUSES = new Set(["planned", "active", "blocked", "completed", "cancelled"]);

test("maps every community task status to a valid GoalStepStatus", () => {
  assert.equal(taskStatusToGoalStepStatus("open"), "planned");
  assert.equal(taskStatusToGoalStepStatus("claimed"), "active");
  assert.equal(taskStatusToGoalStepStatus("done"), "completed");
  for (const value of Object.values(TASK_STATUS_TO_GOAL_STEP_STATUS)) {
    assert.ok(GOAL_STEP_STATUSES.has(value), `${value} must be a GoalStepStatus`);
  }
});

test("throws on an unknown status rather than emitting a bad step status", () => {
  assert.throws(() => taskStatusToGoalStepStatus("archived"), /Unknown community task status/);
});
