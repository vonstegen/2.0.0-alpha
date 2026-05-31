import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDelegationStatusMessage,
  delegationTargetsForFilter
} from "../resonantos-side-panel-extension/src/lib/delegation-status.js";

test("delegation status resolves target filters", () => {
  assert.deepEqual(delegationTargetsForFilter(""), ["hermes", "opencode", "engineer"]);
  assert.deepEqual(delegationTargetsForFilter("Open Code"), ["opencode"]);
  assert.deepEqual(delegationTargetsForFilter("hermes"), ["hermes"]);
  assert.deepEqual(delegationTargetsForFilter("unknown"), []);
});

test("delegation status builds recent delegated work summary", async () => {
  const calls = [];
  const message = await buildDelegationStatusMessage({
    filter: "all",
    limit: 3,
    bridgeRequest: async (route, options) => {
      calls.push([route, options.body.target]);
      return {
        delegations: [
          {
            id: `${options.body.target}-1`,
            mission: `${options.body.target} mission`,
            path: `BrowserFirst/Delegations/${options.body.target}/task.md`,
            resultArtifactPath: `BrowserFirst/DelegationArtifacts/${options.body.target}/task-result.md`,
            resultExcerpt: `${options.body.target} result`,
            status: "completed",
            target: options.body.target,
            updatedAt: options.body.target === "opencode" ? "2026-05-31T10:00:00.000Z" : "2026-05-31T09:00:00.000Z"
          }
        ]
      };
    }
  });

  assert.deepEqual(calls, [
    ["/addons/delegate/list", "hermes"],
    ["/addons/delegate/list", "opencode"],
    ["/addons/delegate/list", "engineer"]
  ]);
  assert.match(message, /Recent delegated work/);
  assert.match(message, /OpenCode · completed · opencode mission/);
  assert.match(message, /Result: opencode result/);
  assert.match(message, /Artifact: BrowserFirst\/DelegationArtifacts\/opencode\/task-result\.md/);
});

test("delegation status preserves available work when one target fails", async () => {
  const message = await buildDelegationStatusMessage({
    filter: "all",
    limit: 3,
    bridgeRequest: async (_route, options) => {
      if (options.body.target === "hermes") throw new Error("Hermes list unavailable");
      return {
        delegations: options.body.target === "opencode"
          ? [{
              mission: "inspect failed tests",
              path: "BrowserFirst/Delegations/opencode/task.md",
              resultExcerpt: "OpenCode inspected the failure.",
              status: "completed",
              target: "opencode",
              updatedAt: "2026-05-31T10:00:00.000Z"
            }]
          : []
      };
    }
  });

  assert.match(message, /OpenCode · completed · inspect failed tests/);
  assert.match(message, /Unavailable targets: Hermes/);
});
