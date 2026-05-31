import assert from "node:assert/strict";
import test from "node:test";

import { createSidePanelMessageRouter } from "../resonantos-side-panel-extension/src/lib/side-panel-message-router.js";

test("side panel message router cancels the active browser job from page overlay stop", async () => {
  const cancelled = [];
  const responses = [];
  const router = createSidePanelMessageRouter({
    cancelBrowserJob: async (jobId) => cancelled.push(jobId),
    getActiveBrowserJobId: () => "job-active"
  });

  const handled = router({
    channel: "resonantos.browser_first.side_panel",
    reason: "Stopped from page overlay",
    type: "cancel_control_run"
  }, {}, (response) => responses.push(response));

  assert.equal(handled, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(cancelled, ["job-active"]);
  assert.deepEqual(responses, [{ ok: true }]);
});

test("side panel message router ignores unrelated channels and message types", () => {
  const router = createSidePanelMessageRouter({
    cancelBrowserJob: async () => {
      throw new Error("should not cancel");
    },
    getActiveBrowserJobId: () => "job-active"
  });

  assert.equal(router({ channel: "other", type: "cancel_control_run" }, {}, () => undefined), false);
  assert.equal(router({ channel: "resonantos.browser_first.side_panel", type: "unknown" }, {}, () => undefined), false);
});

test("side panel message router reports cancellation failures", async () => {
  const responses = [];
  const router = createSidePanelMessageRouter({
    cancelBrowserJob: async () => {
      throw new Error("job is already terminal");
    },
    getActiveBrowserJobId: () => "job-terminal"
  });

  const handled = router({
    channel: "resonantos.browser_first.side_panel",
    type: "cancel_control_run"
  }, {}, (response) => responses.push(response));

  assert.equal(handled, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(responses, [{ ok: false, error: "job is already terminal" }]);
});
