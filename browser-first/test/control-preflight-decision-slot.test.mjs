import assert from "node:assert/strict";
import test from "node:test";

import {
  createControlPreflightDecisionSlot,
  normalizeControlPreflightDecision,
} from "../resonantos-side-panel-extension/src/lib/control-preflight-decision-slot.js";

test("control preflight decision slot normalizes missing fields deterministically", () => {
  assert.deepEqual(normalizeControlPreflightDecision({
    goal: "click the safe button",
    siteKey: "example.com",
  }, { now: () => "2026-06-02T10:00:00.000Z" }), {
    id: "",
    goal: "click the safe button",
    siteKey: "example.com",
    taskClass: "general",
    mode: "not-required",
    permissionMode: "",
    decidedAt: "2026-06-02T10:00:00.000Z",
    source: "control-preflight",
    reason: "",
  });
});

test("control preflight decision slot preserves explicit scoped decision metadata", () => {
  const decision = normalizeControlPreflightDecision({
    decidedAt: "2026-05-31T12:00:00.000Z",
    goal: "search current news",
    id: "decision-1",
    mode: "skipped-by-consent",
    permissionMode: "trusted-for-safe-actions",
    reason: "Stored safe task-class consent.",
    siteKey: "www.bing.com",
    source: "task-consent-store",
    taskClass: "research",
  }, { now: () => "ignored" });

  assert.deepEqual(decision, {
    decidedAt: "2026-05-31T12:00:00.000Z",
    goal: "search current news",
    id: "decision-1",
    mode: "skipped-by-consent",
    permissionMode: "trusted-for-safe-actions",
    reason: "Stored safe task-class consent.",
    siteKey: "www.bing.com",
    source: "task-consent-store",
    taskClass: "research",
  });
});

test("control preflight decision slot consumes each decision once", () => {
  const slot = createControlPreflightDecisionSlot({ now: () => "2026-06-02T10:00:00.000Z" });

  assert.equal(slot.get(), null);
  const stored = slot.set({ id: "approval-1", goal: "open resonantos.com" });

  assert.equal(slot.get(), stored);
  assert.equal(slot.consume(), stored);
  assert.equal(slot.consume(), null);
  assert.equal(slot.get(), null);
});

test("control preflight decision slot clears when set to null", () => {
  const slot = createControlPreflightDecisionSlot({ now: () => "2026-06-02T10:00:00.000Z" });

  slot.set({ id: "approval-1" });
  assert.notEqual(slot.get(), null);
  assert.equal(slot.set(null), null);
  assert.equal(slot.consume(), null);
});
