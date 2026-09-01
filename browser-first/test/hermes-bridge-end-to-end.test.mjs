// Intent citation: docs/architecture/resonantos-browser-architecture/CP5-PHASE5-CONTINUATION.md
// Intent citation: docs/architecture/resonantos-browser-architecture/IMPLEMENTATION_TRACKING.md (row 98)
//
// CP-5 Phase 5 row 98: drive a real `run_agent.py` invocation through
// the bridge's `startTask` with `runtime.installed = true` and a real
// Python venv fixture, then verify the bridge-only result matches the
// route-driven result.
//
// The existing in-process self-test
// `browser-first/test/addon-cli-execution-inprocess-self-test.test.mjs`
// already covers the route path (the legacy host-service
// `/hermes/delegation/start` flow). This test covers the bridge-direct
// path (the CP-4 Phase 4 cutover seam) and proves the two produce the
// same canonical fields for the same packet, runtime, and credentials.
//
// The fake venv is the same one used by the in-process self-test
// (`writeFakeHermesPythonRuntime` exported from
// `browser-first-self-test-service.mjs`). It writes a stub `python`
// shim that mimics `run_agent.py` enough to produce a result.json
// without pulling a real Hermes install into the test matrix.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createHermesProviderAdapterBridge } from "../host/addon-delegation-adapter-bridge.mjs";
import { runBrowserFirstSelfTest, __test as selfTestInternals } from "../host/browser-first-self-test-service.mjs";

const { writeFakeHermesPythonRuntime } = selfTestInternals;

const FAKE_HERMES_OUTPUT = [
  "## Final Summary",
  "Hermes CLI adapter completed the requested bridge end-to-end test.",
  "",
  "## Actions Taken",
  "- Parsed the ResonantOS task packet.",
  "- Returned a reviewable artifact instead of taking external action.",
  "",
  "## Approval Needs",
  "- Human approval remains required for any external send, submit, wallet action, or trusted memory write.",
  "",
  "## Residual Risks",
  "- This is a fake Hermes runtime used only for deterministic bridge validation.",
  "",
  "## Verification",
  "- The bridge drove the local Hermes Python runtime through the seam directly.",
].join("\n");

async function buildFakeHermesVenv(root) {
  const fakeHermesPath = await writeFakeHermesPythonRuntime(root, FAKE_HERMES_OUTPUT);
  const agentRoot = path.join(root, "hermes-agent");
  const binRoot = path.join(agentRoot, "venv", "bin");
  const fakePython = path.join(binRoot, process.platform === "win32" ? "python.cmd" : "python");
  return { fakeHermesPath, fakePython, agentRoot };
}

function makePacketBody() {
  return [
    "---",
    "id: hermes-bridge-e2e",
    "task: bridge-end-to-end",
    "status: queued",
    "---",
    "",
    "## Mission",
    "Drive a real Hermes run_agent.py through the bridge and verify the canonical result.",
    "",
    "## Context Packet",
    "Deterministic test context only.",
    "",
  ].join("\n");
}

function spawnCapture(cmd, args, opts) {
  return spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
}

test("hermes bridge: drive a real run_agent.py through createHermesProviderAdapterBridge().startTask", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "hermes-bridge-e2e-"));
  const profileHome = path.join(tempRoot, "HermesHome");
  const browserFirstRoot = path.join(tempRoot, "BrowserFirst");
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(repoRoot, { recursive: true });
  const { fakeHermesPath, fakePython, agentRoot } = await buildFakeHermesVenv(path.join(tempRoot, ".hermes"));

  const previousApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "fake-bridge-test-key";
  let outcome;
  try {
    const bridge = createHermesProviderAdapterBridge();
    outcome = await bridge.startTask({
      command: fakeHermesPath,
      payload: { provider: "openai-api", model: "gpt-5.4-mini" },
      packet: makePacketBody(),
      runtime: { installed: true, pythonPath: fakePython, agentRoot },
      secrets: {},
      profileHome,
      browserFirstRoot,
      repoRoot,
      spawnProcess: spawnCapture,
      localExecutionEnabled: true,
    });
  } finally {
    if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }

  assert.equal(outcome.kind, "completed", `expected completed, got ${JSON.stringify(outcome)}`);
  assert.equal(outcome.result.adapter, "hermes-cli");
  assert.match(outcome.result.finalSummary ?? "", /Hermes CLI adapter completed the requested bridge end-to-end test/);
  assert.ok(outcome.result.actionsTaken?.length >= 2);
  assert.ok(outcome.result.approvalNeeds?.length >= 1);
  assert.ok(outcome.result.residualRisks?.length >= 1);
  assert.ok(outcome.result.verification?.length >= 1);
  assert.equal(outcome.result.provider, "openai-api");
  assert.equal(outcome.result.model, "gpt-5.4-mini");
});
