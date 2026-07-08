// Offline tests for the M5 agent bridge (addons/resonant-community-hub/src/agent-bridge.mjs).
//
// Covers:
//   - Task -> GoalStep projection (read path an agent consumes).
//   - GoalStepStatus -> task action reverse mapping (+ unsupported transitions).
//   - The manifest delegation contract gate (acceptsTasks + taskTypes).
//   - The human-approval gate on agent writes (constitution Art. V), proven both
//     against a fake service AND against the real community-host, where the host's
//     own fail-closed token guard (Art. IV) + approval gate also apply.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  AGENT_TASK_TYPE,
  AgentBridgeError,
  createAgentDelegationBridge,
  communityTaskToGoalStep,
  goalStepIdForTask,
  goalStepStatusToTaskAction,
  taskIdFromGoalStep,
  taskStatusToGoalStepStatus,
} from "../src/agent-bridge.mjs";
import { createCommunityHubService, CommunityHostError } from "../src/community-host.mjs";
import { createTokenVault } from "../src/token-vault.mjs";
import { createCommunityHubServer, dispatch, listen } from "../src/http-server.mjs";

// The real manifest delegation contract — the bridge is configured from exactly
// what ships in the manifest, so a manifest change that disabled delegation would
// break these tests (that's the point).
const MANIFEST = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../examples/addons/community-hub.json", import.meta.url)), "utf8"),
);
const DELEGATION = MANIFEST.delegation;

function fakeService() {
  const calls = [];
  return {
    calls,
    async call(method, params = {}) {
      calls.push({ method, params });
      if (method === "community.list_tasks") {
        return {
          ok: true,
          degraded: false,
          tasks: [
            { id: "task-1", title: "Run the meetup", status: "open", goalStepStatus: "planned", claimedBy: [], dueAt: null, createdAt: "2026-07-01T00:00:00.000Z" },
            { id: "task-2", title: "Edit recap", status: "claimed", goalStepStatus: "active", claimedBy: ["member-9"], dueAt: "2026-07-09T00:00:00.000Z", createdAt: "2026-07-02T00:00:00.000Z" },
          ],
        };
      }
      return { ok: true, method };
    },
  };
}

describe("agent-bridge mapping", () => {
  it("projects a community task into a GoalStep with a reversible id", () => {
    const step = communityTaskToGoalStep({
      id: "task-42",
      title: "Greet newcomers",
      status: "claimed",
      goalStepStatus: "active",
      claimedBy: ["m1", "m2"],
      dueAt: "2026-07-10T00:00:00.000Z",
      createdAt: "2026-07-03T00:00:00.000Z",
    });
    assert.equal(step.id, goalStepIdForTask("task-42"));
    assert.equal(step.status, "active");
    assert.equal(step.label, "Greet newcomers");
    assert.equal(taskIdFromGoalStep(step), "task-42");
    assert.match(step.notes, /claimedBy=m1,m2/);
    assert.match(step.notes, /source=community-task:task-42/);
  });

  it("rejects a task whose upstream status is not a real community task status", () => {
    assert.throws(
      () => communityTaskToGoalStep({ id: "t", title: "x", status: "bogus" }),
      (e) => e instanceof AgentBridgeError && e.code === "bad_upstream_status",
    );
  });

  it("derives the step status from task.status, not the denormalized goalStepStatus (no drift with the TS half)", () => {
    // task.status and task.goalStepStatus deliberately DISAGREE. Both runtime halves
    // key off task.status through the same table, so this must map to "active"
    // (from status:"claimed") and ignore the stale goalStepStatus:"planned".
    const step = communityTaskToGoalStep({
      id: "task-drift",
      title: "Conflicting task",
      status: "claimed",
      goalStepStatus: "planned",
    });
    assert.equal(step.status, "active");
    // The TS half (community-goal-bridge.ts communityTaskToGoalStep) uses
    // taskStatusToGoalStepStatus(task.status) too, so it produces the identical
    // status for this same input — the two halves cannot drift.
    assert.equal(taskStatusToGoalStepStatus("claimed"), "active");
  });

  it("maps agent-writable GoalStepStatus values to claim/unclaim", () => {
    assert.equal(goalStepStatusToTaskAction("active"), "claim");
    assert.equal(goalStepStatusToTaskAction("planned"), "unclaim");
  });

  it("refuses GoalStepStatus values with no v1 write path", () => {
    for (const status of ["completed", "blocked", "cancelled"]) {
      assert.throws(
        () => goalStepStatusToTaskAction(status),
        (e) => e instanceof AgentBridgeError && e.code === "unsupported_transition",
      );
    }
    assert.throws(
      () => goalStepStatusToTaskAction("nope"),
      (e) => e instanceof AgentBridgeError && e.code === "bad_status",
    );
  });
});

describe("agent-bridge read path", () => {
  it("surfaces community tasks as GoalWorkspace steps (no token, no approval)", async () => {
    const service = fakeService();
    const bridge = createAgentDelegationBridge({ service, delegation: DELEGATION });
    const { degraded, steps } = await bridge.readTasksAsGoalSteps();
    assert.equal(degraded, false);
    assert.equal(steps.length, 2);
    assert.deepEqual(steps.map((s) => s.status), ["planned", "active"]);
    assert.equal(taskIdFromGoalStep(steps[0]), "task-1");
    // A read must never require or attach anything member-specific.
    assert.equal(service.calls.length, 1);
    assert.equal(service.calls[0].method, "community.list_tasks");
  });

  it("degrades (does not throw) when the host reports the backend unreachable", async () => {
    const service = { calls: [], async call() { return { ok: false, degraded: true, error: "backend_unreachable" }; } };
    const bridge = createAgentDelegationBridge({ service, delegation: DELEGATION });
    const out = await bridge.readTasksAsGoalSteps();
    assert.equal(out.degraded, true);
    assert.deepEqual(out.steps, []);
  });
});

describe("agent-bridge delegation contract gate", () => {
  it("refuses task types the manifest does not declare", async () => {
    const service = fakeService();
    const bridge = createAgentDelegationBridge({ service, delegation: DELEGATION });
    await assert.rejects(
      bridge.submitTaskWrite({ taskType: "code-change", taskId: "task-1", action: "claim", approved: true }),
      (e) => e instanceof AgentBridgeError && e.code === "unsupported_task_type" && e.status === 403,
    );
    assert.equal(service.calls.length, 0, "no write should reach the host");
  });

  it("refuses all delegated writes when acceptsTasks is false", async () => {
    const service = fakeService();
    const bridge = createAgentDelegationBridge({
      service,
      delegation: { ...DELEGATION, acceptsTasks: false },
    });
    await assert.rejects(
      bridge.submitTaskWrite({ taskId: "task-1", action: "claim", approved: true }),
      (e) => e instanceof AgentBridgeError && e.code === "delegation_disabled",
    );
    assert.equal(service.calls.length, 0);
  });
});

describe("agent-bridge approval gate (Art. V)", () => {
  it("refuses an unapproved agent write and never reaches the host", async () => {
    const service = fakeService();
    const bridge = createAgentDelegationBridge({ service, delegation: DELEGATION });
    await assert.rejects(
      bridge.submitTaskWrite({ taskId: "task-1", action: "claim" }), // approved defaults false
      (e) => e instanceof AgentBridgeError && e.code === "approval_required" && e.status === 403,
    );
    assert.equal(service.calls.length, 0);
  });

  it("dispatches an approved agent write through the host tagged source:agent + approved", async () => {
    const service = fakeService();
    const bridge = createAgentDelegationBridge({ service, delegation: DELEGATION });
    const res = await bridge.submitTaskWrite({ taskId: "task-1", targetStatus: "active", approved: true });
    assert.equal(res.ok, true);
    assert.equal(service.calls.length, 1);
    assert.deepEqual(service.calls[0], {
      method: "community.claim_task",
      params: { taskId: "task-1", action: "claim", source: "agent", approved: true },
    });
  });
});

// End-to-end through the REAL community-host: the bridge + host both apply the
// approval gate, and the host applies the fail-closed token guard (Art. IV).
describe("agent-bridge <-> real community-host integration", () => {
  function realStack({ token } = {}) {
    const claimCalls = [];
    const client = {
      baseUrl: "https://hub.example.com",
      listTasks: async () => ({ tasks: [] }),
      listEvents: async () => ({ events: [] }),
      listPresence: async () => ({ presence: [] }),
      claimTask: async (args) => {
        claimCalls.push(args);
        return { ok: true, task: { id: args.taskId, status: args.action === "unclaim" ? "open" : "claimed" } };
      },
    };
    const vault = createTokenVault({ env: {} });
    if (token) vault.set(token);
    const service = createCommunityHubService({ client, vault });
    const bridge = createAgentDelegationBridge({ service, delegation: DELEGATION });
    return { bridge, service, client, vault, claimCalls };
  }

  it("an approved write reaches the API client with the member token attached", async () => {
    const { bridge, claimCalls } = realStack({ token: "member-token-abc" });
    const res = await bridge.submitTaskWrite({ taskId: "task-7", targetStatus: "active", approved: true });
    assert.equal(res.ok, true);
    assert.equal(claimCalls.length, 1);
    assert.deepEqual(claimCalls[0], { taskId: "task-7", action: "claim", token: "member-token-abc" });
  });

  it("the host's fail-closed token guard blocks an approved write when not signed in (Art. IV)", async () => {
    const { bridge, claimCalls } = realStack({ token: null });
    await assert.rejects(
      bridge.submitTaskWrite({ taskId: "task-7", targetStatus: "active", approved: true }),
      (e) => e instanceof CommunityHostError && e.code === "auth_required" && e.status === 401,
    );
    assert.equal(claimCalls.length, 0, "no anonymous write may go out");
  });

  it("the host's own approval gate still fires if the bridge is bypassed", async () => {
    const { service, claimCalls } = realStack({ token: "tok" });
    // Simulate an agent call that skipped the bridge's gate but still hit the host.
    await assert.rejects(
      service.call("community.claim_task", { taskId: "task-7", action: "claim", source: "agent" }),
      (e) => e instanceof CommunityHostError && e.code === "approval_required",
    );
    assert.equal(claimCalls.length, 0);
  });
});

describe("agent-bridge wiring guards", () => {
  it("requires a service with .call()", () => {
    assert.throws(() => createAgentDelegationBridge({ service: {}, delegation: DELEGATION }), /service with \.call/);
  });
  it("requires a delegation contract with taskTypes[]", () => {
    assert.throws(() => createAgentDelegationBridge({ service: fakeService(), delegation: {} }), /taskTypes/);
  });
  it("exposes the single accepted task type", () => {
    assert.equal(AGENT_TASK_TYPE, "community-task");
    assert.ok(DELEGATION.taskTypes.includes(AGENT_TASK_TYPE));
  });
});

// The agent delegation path must be reachable THROUGH the running host, not just as
// an in-process bridge object. These drive the real http-server dispatch (and a
// guarded live loopback POST) so the manifest contract + approval gates actually run
// against an agent that reaches the loopback server.
describe("agent-bridge over the real http-server host", () => {
  function httpStack({ token, delegation = DELEGATION } = {}) {
    const claimCalls = [];
    const client = {
      baseUrl: "https://hub.example.com",
      listTasks: async () => ({
        tasks: [
          { id: "task-1", title: "Run the meetup", status: "open", goalStepStatus: "planned", claimedBy: [], dueAt: null, createdAt: "2026-07-01T00:00:00.000Z" },
          { id: "task-2", title: "Edit recap", status: "claimed", goalStepStatus: "active", claimedBy: ["m9"], dueAt: null, createdAt: "2026-07-02T00:00:00.000Z" },
        ],
      }),
      listEvents: async () => ({ events: [] }),
      listPresence: async () => ({ presence: [] }),
      claimTask: async (args) => {
        claimCalls.push(args);
        return { ok: true, task: { id: args.taskId, status: args.action === "unclaim" ? "open" : "claimed" } };
      },
    };
    const vault = createTokenVault({ env: {} });
    if (token) vault.set(token);
    const service = createCommunityHubService({ client, vault });
    const agentBridge = createAgentDelegationBridge({ service, delegation });
    const server = createCommunityHubServer({ service, poller: null, agentBridge });
    return { client, vault, service, agentBridge, server, claimCalls };
  }

  it("reads community tasks as GoalSteps via community.list_task_steps through dispatch", async () => {
    const { agentBridge, service } = httpStack();
    const { status, body } = await dispatch({ service, agentBridge }, { method: "community.list_task_steps" });
    assert.equal(status, 200);
    assert.equal(body.result.degraded, false);
    assert.deepEqual(body.result.steps.map((s) => s.status), ["planned", "active"]);
    assert.equal(taskIdFromGoalStep(body.result.steps[0]), "task-1");
  });

  it("performs an approved agent write via community.submit_task_write through dispatch (token reaches the client)", async () => {
    const { agentBridge, service, claimCalls } = httpStack({ token: "member-token-http" });
    const { status, body } = await dispatch(
      { service, agentBridge },
      { method: "community.submit_task_write", params: { taskId: "task-1", targetStatus: "active", approved: true } },
    );
    assert.equal(status, 200);
    assert.equal(body.result.ok, true);
    assert.deepEqual(claimCalls, [{ taskId: "task-1", action: "claim", token: "member-token-http" }]);
  });

  it("refuses an UNapproved agent write via dispatch at the delegation gate (never reaches the client)", async () => {
    const { agentBridge, service, claimCalls } = httpStack({ token: "member-token-http" });
    await assert.rejects(
      dispatch({ service, agentBridge }, { method: "community.submit_task_write", params: { taskId: "task-1", action: "claim" } }),
      (e) => e.code === "approval_required" && e.status === 403,
    );
    assert.equal(claimCalls.length, 0);
  });

  it("does NOT launder approved:true — the host's own gate still refuses when the delegation gate is off (defense in depth)", async () => {
    // Delegation contract with the approval gate disabled: the bridge skips its own
    // gate, but it forwards the caller's real approved:false to the host, so the
    // host's independent Art. V gate refuses the write. The two locks stay separate.
    const { agentBridge, service, claimCalls } = httpStack({
      token: "member-token-http",
      delegation: { ...DELEGATION, requiresHumanApprovalBeforeExecution: false },
    });
    await assert.rejects(
      dispatch({ service, agentBridge }, { method: "community.submit_task_write", params: { taskId: "task-1", action: "claim", approved: false } }),
      (e) => e instanceof CommunityHostError && e.code === "approval_required",
    );
    assert.equal(claimCalls.length, 0, "no unapproved agent write may reach the API client");
  });

  it("fails closed for agent methods when no bridge is wired", async () => {
    const { service } = httpStack();
    await assert.rejects(
      dispatch({ service, agentBridge: null }, { method: "community.list_task_steps" }),
      (e) => e.code === "agent_delegation_unavailable" && e.status === 501,
    );
  });

  it("round-trips an approved agent write over a live loopback POST", async (t) => {
    const { server, claimCalls } = httpStack({ token: "member-token-live" });
    let bound;
    try {
      bound = await listen(server, { port: 0 });
    } catch (error) {
      if (error?.code === "EPERM" || error?.code === "EACCES") return t.skip("loopback bind denied in this sandbox");
      throw error;
    }
    try {
      const readRes = await fetch(bound.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "r1", method: "community.list_task_steps" }),
      });
      const readBody = await readRes.json();
      assert.equal(readRes.status, 200);
      assert.deepEqual(readBody.result.steps.map((s) => s.status), ["planned", "active"]);

      const writeRes = await fetch(bound.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "w1", method: "community.submit_task_write", params: { taskId: "task-2", targetStatus: "planned", approved: true } }),
      });
      const writeBody = await writeRes.json();
      assert.equal(writeRes.status, 200);
      assert.equal(writeBody.id, "w1");
      assert.equal(writeBody.result.ok, true);
      assert.deepEqual(claimCalls, [{ taskId: "task-2", action: "unclaim", token: "member-token-live" }]);
    } finally {
      await new Promise((resolve) => server.close(() => resolve()));
    }
  });
});
