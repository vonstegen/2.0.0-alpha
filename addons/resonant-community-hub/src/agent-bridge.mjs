// Community Hub agent bridge — the local-service host seam that lets ResonantOS
// agents READ community tasks as GoalWorkspace steps and ACT on them (claim /
// un-claim) under the manifest's delegation contract (M5).
//
// This is the delegation-fabric entry point that mirrors, at the host boundary,
// the manifest's `delegation` contract on examples/addons/community-hub.json:
//
//   "delegation": {
//     "acceptsTasks": true,
//     "taskTypes": ["community-task"],
//     "requiresHumanApprovalBeforeExecution": true,
//     ...
//   }
//
// Constitution ties enforced here:
//   Art. III/ADR-018 — the add-on only accepts delegated work its manifest
//                      actually declares (`acceptsTasks` + matching `taskType`).
//                      A capability/contract it did not request is refused.
//   Art. V           — agent-initiated writes are human-approval gated. When the
//                      contract says `requiresHumanApprovalBeforeExecution: true`,
//                      a write is refused unless the caller carries `approved:true`.
//   Art. IV          — the actual write still flows through community-host.mjs, so
//                      the fail-closed token guard (no token => refused, never sent
//                      anonymously) and the host's own approval gate BOTH apply.
//
// Reads (task -> GoalStep) need no approval and no token: community tasks are a
// public read (Art. IV). Writes go out only when approval + a member token exist.
//
// Everything is injectable (the community-host `service`, the delegation contract),
// so the whole bridge runs offline under `node --test` with a fake service.

/** The single delegation task type this add-on accepts (manifest `taskTypes`). */
export const AGENT_TASK_TYPE = "community-task";

/** The GoalStepStatus union from src/core/contracts.ts (mirrored for a runtime check). */
export const GOAL_STEP_STATUSES = Object.freeze(["planned", "active", "blocked", "completed", "cancelled"]);

/**
 * Community task lifecycle (open -> claimed -> done) -> GoalStepStatus. This is the
 * SINGLE source of truth for how a community task becomes a GoalStep status, and it
 * is deliberately identical to the TS half (src/modules/community-hub/
 * community-goal-bridge.ts TASK_STATUS_TO_GOAL_STEP_STATUS) and the backend
 * (backend/src/goal-mapping.mjs). Both runtime halves derive the step status from
 * `task.status` through this table so they cannot drift; the backend's denormalized
 * `task.goalStepStatus` is NOT trusted as an independent source (a stale/wrong cache
 * value can never diverge the two halves).
 */
export const TASK_STATUS_TO_GOAL_STEP_STATUS = Object.freeze({
  open: "planned",
  claimed: "active",
  done: "completed",
});

/**
 * @param {string} status a community Task.status
 * @returns {string} the GoalStepStatus
 */
export function taskStatusToGoalStepStatus(status) {
  const mapped = TASK_STATUS_TO_GOAL_STEP_STATUS[status];
  if (!mapped) {
    throw new AgentBridgeError(
      `Task carries an unknown community task status: ${JSON.stringify(status)}`,
      { status: 502, code: "bad_upstream_status" },
    );
  }
  return mapped;
}

/**
 * Reverse map: a desired GoalStepStatus -> the community task write that realizes
 * it. v1 exposes only claim/un-claim on the backend (backend validateClaim), so:
 *   active  -> "claim"    (an agent signs up to work the task)
 *   planned -> "unclaim"  (an agent releases the task back to open)
 * "completed" has no agent write path in v1 (there is no `done` action — a task
 * is completed by an organizer/seed, not by a claimant) and "blocked"/"cancelled"
 * have no community-task equivalent, so all three are refused rather than silently
 * mapped to the wrong action.
 */
export const GOAL_STEP_STATUS_TO_TASK_ACTION = Object.freeze({
  planned: "unclaim",
  active: "claim",
});

/** A refusal from the agent bridge's own contract/approval guards. */
export class AgentBridgeError extends Error {
  constructor(message, { status = 400, code = "bad_request" } = {}) {
    super(message);
    this.name = "AgentBridgeError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Map a desired GoalStepStatus onto the community task action that achieves it.
 * @param {string} status a GoalStepStatus
 * @returns {"claim"|"unclaim"}
 */
export function goalStepStatusToTaskAction(status) {
  const action = GOAL_STEP_STATUS_TO_TASK_ACTION[status];
  if (!action) {
    if (GOAL_STEP_STATUSES.includes(status)) {
      throw new AgentBridgeError(
        `GoalStepStatus "${status}" has no community-task write path in v1 (only planned/active are agent-writable).`,
        { status: 422, code: "unsupported_transition" },
      );
    }
    throw new AgentBridgeError(`Unknown GoalStepStatus: ${JSON.stringify(status)}`, { status: 400, code: "bad_status" });
  }
  return action;
}

/**
 * Project one shaped community task (as returned by `community.list_tasks`) into a
 * plain GoalStep-shaped object an agent can read. The step status is derived
 * authoritatively from `task.status` through TASK_STATUS_TO_GOAL_STEP_STATUS — the
 * exact same source of truth the TS half uses — so the two runtime halves cannot
 * drift. The backend's denormalized `task.goalStepStatus` is intentionally ignored
 * here; if it ever disagreed with `task.status`, both halves still agree because
 * both key off `task.status`.
 * @param {object} task
 * @param {() => number} [now]
 */
export function communityTaskToGoalStep(task, now = Date.now) {
  if (!task || typeof task !== "object" || !task.id) {
    throw new AgentBridgeError("communityTaskToGoalStep requires a task with an id.", { code: "bad_task" });
  }
  const status = taskStatusToGoalStepStatus(task.status);
  const createdAt = task.createdAt ?? new Date(now()).toISOString();
  const noteParts = [];
  if (Array.isArray(task.claimedBy) && task.claimedBy.length) noteParts.push(`claimedBy=${task.claimedBy.join(",")}`);
  if (task.dueAt) noteParts.push(`dueAt=${task.dueAt}`);
  noteParts.push(`source=community-task:${task.id}`);
  return {
    id: goalStepIdForTask(task.id),
    label: String(task.title ?? task.id).trim() || task.id,
    status,
    createdAt,
    updatedAt: createdAt,
    completedAt: status === "completed" ? createdAt : undefined,
    notes: noteParts.join("; "),
  };
}

/** Deterministic, reversible GoalStep id for a community task (so writes can round-trip). */
export const COMMUNITY_STEP_ID_PREFIX = "goal-step-community";
export function goalStepIdForTask(taskId) {
  return `${COMMUNITY_STEP_ID_PREFIX}::${String(taskId)}`;
}
/** Recover the community task id from a GoalStep produced by this bridge (else null). */
export function taskIdFromGoalStep(step) {
  const id = String(step?.id ?? "");
  const prefix = `${COMMUNITY_STEP_ID_PREFIX}::`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : null;
}

function assertDelegationContract(delegation) {
  if (!delegation || typeof delegation !== "object") {
    throw new Error("createAgentDelegationBridge requires the manifest delegation contract.");
  }
  if (!Array.isArray(delegation.taskTypes)) {
    throw new Error("delegation contract must declare taskTypes[].");
  }
  return delegation;
}

/**
 * @param {object} opts
 * @param {{ call(method: string, params?: object): Promise<any> }} opts.service
 *        the community-host service (community-host.mjs) — the ONLY path to a write.
 * @param {object} opts.delegation  the manifest `delegation` contract object.
 * @param {() => number} [opts.now]
 */
export function createAgentDelegationBridge({ service, delegation, now = Date.now } = {}) {
  if (!service || typeof service.call !== "function") {
    throw new Error("createAgentDelegationBridge requires a community-host service with .call().");
  }
  const contract = assertDelegationContract(delegation);

  /** Does the manifest actually let this add-on accept this delegated task type? */
  function acceptsTaskType(taskType) {
    return contract.acceptsTasks === true && contract.taskTypes.includes(taskType);
  }

  return {
    acceptsTaskType,

    /**
     * READ path: surface open community tasks to an agent as GoalWorkspace steps.
     * No approval, no token — public read (Art. IV). Degrades with the host: if the
     * backend is unreachable the host returns `{ degraded: true }` and we surface
     * `{ degraded: true, steps: [] }` rather than throwing.
     */
    async readTasksAsGoalSteps() {
      const res = await service.call("community.list_tasks");
      if (res && res.degraded) {
        return { degraded: true, steps: [], error: res.error ?? "backend_unreachable" };
      }
      const tasks = Array.isArray(res?.tasks) ? res.tasks : [];
      return { degraded: false, steps: tasks.map((t) => communityTaskToGoalStep(t, now)) };
    },

    /**
     * WRITE path: an agent acts on a community task. Enforces the manifest contract
     * (acceptsTasks + taskType) and the approval gate, then dispatches through the
     * community-host with `source: "agent"` so the host's own guards apply too.
     *
     * @param {object} req
     * @param {string} [req.taskType]      defaults to the sole accepted type.
     * @param {string} req.taskId
     * @param {"claim"|"unclaim"} [req.action]   explicit action, OR:
     * @param {string} [req.targetStatus]        a GoalStepStatus to translate to an action.
     * @param {boolean} [req.approved]     human approval for THIS agent write.
     */
    async submitTaskWrite({ taskType = AGENT_TASK_TYPE, taskId, action, targetStatus, approved = false } = {}) {
      if (!acceptsTaskType(taskType)) {
        // Either delegation is off, or the type isn't one this manifest declares.
        const code = contract.acceptsTasks === true ? "unsupported_task_type" : "delegation_disabled";
        throw new AgentBridgeError(
          `This add-on does not accept delegated "${taskType}" tasks (manifest delegation contract).`,
          { status: 403, code },
        );
      }
      const id = String(taskId ?? "").trim();
      if (!id) throw new AgentBridgeError("submitTaskWrite requires a taskId.", { code: "bad_request" });

      const resolvedAction = action ?? goalStepStatusToTaskAction(targetStatus);
      if (resolvedAction !== "claim" && resolvedAction !== "unclaim") {
        throw new AgentBridgeError(`Unsupported task action: ${JSON.stringify(resolvedAction)}`, { code: "bad_action" });
      }

      // Approval gate keyed off the manifest contract (Art. V). This is the
      // delegation-level gate; community-host applies the same gate again on
      // `source: "agent"`, so a write cannot slip through with only one satisfied.
      if (contract.requiresHumanApprovalBeforeExecution === true && approved !== true) {
        throw new AgentBridgeError(
          `Agent write to community task ${id} requires human approval before execution (delegation contract).`,
          { status: 403, code: "approval_required" },
        );
      }

      // Forward the caller's REAL approval decision to the host — never a hardcoded
      // `true`. This keeps the host's own approval gate (community-host.assertApproved)
      // an independent second lock: if the manifest contract ever failed to require
      // approval (or was tampered/omitted), an unapproved agent write still arrives at
      // the host as `approved: false` and is refused there. Laundering `approved: true`
      // would collapse the two Art. V locks into one.
      return service.call("community.claim_task", {
        taskId: id,
        action: resolvedAction,
        source: "agent",
        approved: approved === true,
      });
    },
  };
}
