import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { capabilityClass, loadPlugin, runTool, validateManifest, SdkError } from "./sdk.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const exampleDir = resolve(here, "plugins/hello-resonant");
const augmentorDir = resolve(here, "plugins/augmentor");

test("capability taxonomy maps Public / Privileged / Core-only", () => {
  assert.equal(capabilityClass("notifications"), "public");
  assert.equal(capabilityClass("archive-read"), "public");
  assert.equal(capabilityClass("browser-commit"), "privileged");
  assert.equal(capabilityClass("credential-broker"), "privileged");
  assert.equal(capabilityClass("policy-override"), "core-only");
  assert.equal(capabilityClass("does-not-exist"), null);
});

test("loads and validates the example plugin", async () => {
  const plugin = await loadPlugin(exampleDir, { grantedCapabilities: ["notifications"] });
  assert.equal(plugin.manifest.id, "plugin.hello-resonant");
  assert.deepEqual(plugin.granted, ["notifications"]);
  assert.deepEqual(plugin.warnings, []);
});

test("rejects a manifest missing required fields", () => {
  assert.throws(() => validateManifest({}), SdkError);
});

test("rejects a manifest that requests a core-only capability", () => {
  assert.throws(
    () =>
      validateManifest({
        id: "plugin.bad",
        name: "Bad",
        version: "1.0.0",
        author: "x",
        category: "tool",
        description: "bad",
        runtimeType: "local-module",
        entry: "./plugin.mjs",
        requestedCapabilities: ["policy-override"],
        tools: [],
      }),
    /core-only capability/,
  );
});

test("rejects a tool that requires an undeclared capability", () => {
  assert.throws(
    () =>
      validateManifest({
        id: "plugin.bad",
        name: "Bad",
        version: "1.0.0",
        author: "x",
        category: "tool",
        description: "bad",
        runtimeType: "local-module",
        entry: "./plugin.mjs",
        requestedCapabilities: [],
        tools: [
          {
            name: "bad.do",
            description: "does something",
            requiredCapabilities: ["notifications"],
          },
        ],
      }),
    /not declared in requestedCapabilities/,
  );
});

test("runTool enforces capability grants (deny-by-default)", async () => {
  const plugin = await loadPlugin(exampleDir, { grantedCapabilities: [] });
  const blocked = await runTool(plugin, "hello-resonant.notify", { message: "hi" });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /requires ungranted capabilities/);

  const greeting = await runTool(plugin, "hello-resonant.hello", { name: "Dev" });
  assert.equal(greeting.ok, true);
  assert.match(greeting.result.message, /Hello, Dev/);
});

test("runTool runs a granted tool", async () => {
  const plugin = await loadPlugin(exampleDir, { grantedCapabilities: ["notifications"] });
  const result = await runTool(plugin, "hello-resonant.notify", { message: "demo" });
  assert.equal(result.ok, true);
  assert.equal(result.result.status, "proposed");
  assert.equal(result.result.delivered, undefined);
});

test("augmentor status runs with Public network, run_task blocked without providers", async () => {
  const plugin = await loadPlugin(augmentorDir, {
    grantedCapabilities: ["network", "agent-delegation"],
  });
  assert.deepEqual(plugin.granted, ["network", "agent-delegation"]);

  const status = await runTool(plugin, "augmentor.status");
  assert.equal(status.ok, true);
  assert.equal(status.result.online, "simulated");
  assert.equal(status.result.model, "deepseek-chat");

  const blocked = await runTool(plugin, "augmentor.run_task", {
    prompt: "Summarize the roadmap.",
  });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /requires ungranted capabilities: providers/);
});

test("augmentor run_task proposes (prepare, not commit) with full reviewed grants", async () => {
  const plugin = await loadPlugin(augmentorDir, {
    grantedCapabilities: ["network", "providers", "agent-delegation"],
  });
  const result = await runTool(plugin, "augmentor.run_task", {
    prompt: "Summarize the roadmap.",
  });
  assert.equal(result.ok, true);
  assert.equal(result.result.status, "proposed");
  assert.equal(result.result.proposal.record.type, "deepseek-completion");
});
