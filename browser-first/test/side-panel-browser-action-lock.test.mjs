import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserActionLock } from "../resonantos-side-panel-extension/src/lib/side-panel-browser-action-lock.js";

const waitMicrotask = () => new Promise((resolve) => queueMicrotask(resolve));

test("browser action lock serializes concurrent browser actions", async () => {
  const { withBrowserActionLock } = createBrowserActionLock();
  const events = [];
  let releaseFirst;

  const first = withBrowserActionLock(async () => {
    events.push("first:start");
    await new Promise((resolve) => {
      releaseFirst = resolve;
    });
    events.push("first:end");
    return "first-result";
  });

  const second = withBrowserActionLock(async () => {
    events.push("second:start");
    events.push("second:end");
    return "second-result";
  });

  await waitMicrotask();
  assert.deepEqual(events, ["first:start"]);

  releaseFirst();
  assert.equal(await first, "first-result");
  assert.equal(await second, "second-result");
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});

test("browser action lock releases the queue after task failure", async () => {
  const { withBrowserActionLock } = createBrowserActionLock();
  const events = [];

  await assert.rejects(
    () => withBrowserActionLock(async () => {
      events.push("failed:start");
      throw new Error("action failed");
    }),
    /action failed/
  );

  const result = await withBrowserActionLock(async () => {
    events.push("next:start");
    return "next-result";
  });

  assert.equal(result, "next-result");
  assert.deepEqual(events, ["failed:start", "next:start"]);
});
