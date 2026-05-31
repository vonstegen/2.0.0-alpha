import assert from "node:assert/strict";
import test from "node:test";

import {
  delegationTargetLabel,
  startDelegationLifecycle
} from "../resonantos-side-panel-extension/src/lib/delegation-lifecycle.js";

test("delegation lifecycle labels approved add-on targets", () => {
  assert.equal(delegationTargetLabel("hermes"), "Hermes");
  assert.equal(delegationTargetLabel("opencode"), "OpenCode");
  assert.equal(delegationTargetLabel("engineer"), "Resonant Engineer");
});

test("delegation lifecycle reports completed Hermes artifacts", async () => {
  const calls = [];
  const message = await startDelegationLifecycle(
    { target: "hermes", path: "BrowserFirst/Delegations/hermes/test.md" },
    {
      bridgeRequest: async (route, options) => {
        calls.push([route, options]);
        return {
          artifact: {
            finalSummary: "Hermes found the key implementation risk and wrote the review artifact."
          },
          resultArtifactPath: "BrowserFirst/DelegationArtifacts/hermes/test-result.md",
          status: "completed"
        };
      }
    }
  );

  assert.deepEqual(calls, [[
    "/hermes/delegation/start",
    { method: "POST", body: { path: "BrowserFirst/Delegations/hermes/test.md" } }
  ]]);
  assert.match(message, /Hermes execution completed/);
  assert.match(message, /Result: Hermes found the key implementation risk/);
  assert.match(message, /test-result\.md/);
});

test("delegation lifecycle bounds long artifact summaries", async () => {
  const longSummary = "A".repeat(800);
  const message = await startDelegationLifecycle(
    { target: "opencode", path: "BrowserFirst/Delegations/opencode/test.md" },
    {
      bridgeRequest: async () => ({
        artifact: { finalSummary: longSummary },
        resultArtifactPath: "BrowserFirst/DelegationArtifacts/opencode/test-result.md",
        status: "completed"
      })
    }
  );

  assert.match(message, /OpenCode execution completed/);
  assert.match(message, /Result: A+/);
  assert.ok(message.length < 800);
  assert.match(message, /\.\.\./);
});

test("delegation lifecycle fetches artifact summary when start response is thin", async () => {
  const calls = [];
  const message = await startDelegationLifecycle(
    { target: "hermes", path: "BrowserFirst/Delegations/hermes/thin.md" },
    {
      bridgeRequest: async (route, options) => {
        calls.push([route, options]);
        if (route === "/hermes/delegation/artifact") {
          return { finalSummary: "Hermes artifact was read after the completed start response." };
        }
        return {
          resultArtifactPath: "BrowserFirst/DelegationArtifacts/hermes/thin-result.md",
          status: "completed"
        };
      }
    }
  );

  assert.deepEqual(calls.map(([route]) => route), [
    "/hermes/delegation/start",
    "/hermes/delegation/artifact"
  ]);
  assert.match(message, /Result: Hermes artifact was read after the completed start response/);
});

test("delegation lifecycle reports blocked runtime with next action", async () => {
  const message = await startDelegationLifecycle(
    { target: "opencode", path: "BrowserFirst/Delegations/opencode/test.md" },
    {
      bridgeRequest: async () => ({
        blockedReason: "OpenCode execution requires explicit enablement",
        status: "blocked"
      })
    }
  );

  assert.match(message, /OpenCode packet was created, but execution is blocked/);
  assert.match(message, /explicit enablement/);
  assert.match(message, /configure OpenCode/);
  assert.match(message, /Boundary: OpenCode remains an add-on worker/);
  assert.match(message, /ResonantOS mediates shell, filesystem, provider, wallet, and Living Archive access/);
});
