import assert from "node:assert/strict";
import test from "node:test";

import {
  delegationBlockerGuidance,
  delegationGuidanceText
} from "../resonantos-side-panel-extension/src/lib/delegation-guidance.js";

test("delegation guidance explains missing runtime without making add-ons trusted", () => {
  const guidance = delegationBlockerGuidance({
    runtimeAvailable: false,
    target: "hermes"
  });

  assert.match(guidance.reason, /Hermes runtime was not detected/);
  assert.match(guidance.nextAction, /Install or start Hermes/);
  assert.match(guidance.boundary, /Hermes is an add-on worker/);
  assert.match(guidance.boundary, /Living Archive writes capability-gated/);
});

test("delegation guidance distinguishes disabled execution from missing runtime", () => {
  const text = delegationGuidanceText({
    executionEnabled: false,
    runtimeAvailable: true,
    target: "opencode"
  });

  assert.match(text, /OpenCode execution is disabled/);
  assert.match(text, /Enable OpenCode execution in Settings > Add-ons/);
  assert.match(text, /Boundary:/);
});
