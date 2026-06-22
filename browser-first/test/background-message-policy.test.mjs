import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeInlineAssistantBody,
  sanitizeResonantContextSnapshot
} from "../resonantos-side-panel-extension/src/lib/background-message-policy.js";

test("background policy sanitizes inline assistant payloads", () => {
  const payload = sanitizeInlineAssistantBody({
    action: "TRANSLATE",
    prompt: "token=abc1234567890",
    selection: "hello\0world",
    pageContext: `A ${"x".repeat(6000)}`,
    __proto__: { polluted: true },
  });

  assert.equal(payload.action, "translate");
  assert.equal(payload.prompt, "[redacted]");
  assert.equal(payload.selection, "hello world");
  assert.equal(payload.pageContext.length, 5000);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(Object.keys(payload), ["action", "prompt", "selection", "pageContext"]);
});

test("background policy defaults unknown inline actions to summarize", () => {
  assert.equal(sanitizeInlineAssistantBody({ action: "wallet_sign" }).action, "summarize");
  assert.equal(sanitizeInlineAssistantBody(null).action, "summarize");
});

test("background policy bounds and redacts Resonant Context snapshots", () => {
  const snapshot = sanitizeResonantContextSnapshot({
    title: "Example",
    url: "javascript:alert(1)",
    text: `Visible sk-abcdefghijklmnop ${"x".repeat(8000)}`,
    sections: Array.from({ length: 12 }, (_, index) => ({ label: `Section ${index}`, text: `api_key=secret-${index}` })),
  }, {
    tabId: 42,
    url: "https://example.com/page",
  });

  assert.equal(snapshot.tabId, 42);
  assert.equal(snapshot.url, "https://example.com/page");
  assert.equal(snapshot.text.includes("sk-abcdefghijklmnop"), false);
  assert.equal(snapshot.text.length, 7000);
  assert.equal(snapshot.sections.length, 8);
  assert.match(snapshot.sections[0].text, /\[redacted\]/);
});
