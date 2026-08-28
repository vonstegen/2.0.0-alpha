// Intent citation: docs/architecture/resonantos-browser-architecture/04-augmentor-extension-model.md
import assert from "node:assert/strict";
import test from "node:test";

import { createAugmentorExtensionEffect } from "../host/augmentor-extension-effect.mjs";

const invocation = (overrides = {}) => ({
  invocationId: "inv-1",
  extensionId: "addon.skill:skill",
  kind: "skill",
  taskId: "task-1",
  delegationId: "del-1",
  principalId: "augmentor-1",
  context: { documentPaths: [] },
  input: {},
  pendingApprovalGates: [],
  lifecycle: "running",
  ...overrides,
});

test("dispatches the extension's declared tool and returns an ok result", async () => {
  let dispatched = null;
  const effect = createAugmentorExtensionEffect({
    findManifest: async () => ({ tools: [{ name: "augmentor.organize" }] }),
    dispatch: async (args) => {
      dispatched = args;
      return { outcome: "allow", response: { ok: true } };
    },
  });
  const result = await effect(invocation());

  assert.equal(result.status, "ok");
  assert.equal(dispatched.addonId, "addon.skill");
  assert.equal(dispatched.toolName, "augmentor.organize");
  assert.deepEqual(result.actionsTaken, ["dispatched augmentor.organize"]);
});

test("returns a failed result when the dispatch denies", async () => {
  const effect = createAugmentorExtensionEffect({
    findManifest: async () => ({ tools: [{ name: "t" }] }),
    dispatch: async () => ({ outcome: "deny", reason: "capability-denied", detail: "missing grants" }),
  });
  const result = await effect(invocation());

  assert.equal(result.status, "failed");
  assert.equal(result.output.error, "missing grants");
});

test("returns a failed result when the extension tool is not found", async () => {
  const effect = createAugmentorExtensionEffect({
    findManifest: async () => null,
    dispatch: async () => {
      throw new Error("dispatch must not be called");
    },
  });
  const result = await effect(invocation());

  assert.equal(result.status, "failed");
  assert.match(result.output.error, /extension tool not found/);
});
