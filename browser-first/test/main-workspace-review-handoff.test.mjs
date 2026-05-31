import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  renderReviewQueueNotice,
  runReviewableCapture
} from "../resonantos-side-panel-extension/src/lib/main-workspace-review-handoff.js";

function setupDom() {
  const dom = new JSDOM("<!doctype html><div id=\"notice\" hidden></div>", { url: "https://resonantos.local/" });
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  return {
    cleanup: () => {
      delete globalThis.document;
      delete globalThis.Event;
    },
    notice: dom.window.document.querySelector("#notice")
  };
}

test("review queue notice renders only for successful reviewable captures", () => {
  const { cleanup, notice } = setupDom();
  try {
    assert.equal(renderReviewQueueNotice({ container: notice, result: { ok: true } }), false);
    assert.equal(notice.hidden, true);

    const opened = [];
    assert.equal(renderReviewQueueNotice({
      container: notice,
      onOpenReviewQueue: (result) => opened.push(result.reviewRequestPath),
      result: { ok: true, reviewRequestPath: "REVIEW/requests/page.md" }
    }), true);
    assert.equal(notice.hidden, false);
    assert.equal(notice.dataset.kind, "review-queue");
    assert.match(notice.textContent, /Review queued/);
    assert.match(notice.textContent, /draft, verify, and promote/);

    notice.querySelector("button").click();
    assert.deepEqual(opened, ["REVIEW/requests/page.md"]);
  } finally {
    cleanup();
  }
});

test("run reviewable capture preserves the action result and emits handoff", async () => {
  const { cleanup, notice } = setupDom();
  try {
    const opened = [];
    const result = await runReviewableCapture(
      async () => ({ ok: true, path: "INTAKE/browser/page.md", reviewRequestPath: "REVIEW/requests/page.md" }),
      { noticeContainer: notice, onOpenReviewQueue: (handoff) => opened.push(handoff.path) }
    );

    assert.equal(result.path, "INTAKE/browser/page.md");
    assert.match(notice.textContent, /Open Review/);
    notice.querySelector("button").click();
    assert.deepEqual(opened, ["INTAKE/browser/page.md"]);
  } finally {
    cleanup();
  }
});
