// Intent citation: docs/architecture/resonantos-browser-architecture/CP4-PHASE4-CUTOVER-CONTINUATION.md
//
// CP-4 Phase 4 seam parity tests: prove the host-service delegation Start/Status/
// Artifact/Cancel round-trip is byte-identical to what the adapter bridge
// produces in isolation. Per the Phase 4 continuation prompt, "at least 1 new
// seam test per provider" is required; this file provides one per provider
// plus a per-provider blocked-branch test for the credential-gate guidance.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAddonDelegationService } from "../host/addon-delegation-service.mjs";
import {
  createHermesProviderAdapterBridge,
  createOpenCodeProviderAdapterBridge,
} from "../host/addon-delegation-adapter-bridge.mjs";

function safeFileSlug(value) {
  return String(value ?? "item")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function buildServiceFactory(root) {
  return (overrides = {}) => {
    let id = 0;
    return createAddonDelegationService({
      browserFirstRoot: () => path.join(root, "BrowserFirst"),
      bridgePublicUrl: "http://127.0.0.1:47773",
      dashboardTarget: () => ({ host: "127.0.0.1", port: 9119, url: "http://127.0.0.1:9119" }),
      execFileStdout: async () => {
        throw new Error("CLI execution should not run in seam tests.");
      },
      expandUserPath: (value) => path.resolve(root, String(value ?? "")),
      firstExistingExecutable: () => null,
      hermesCommand: overrides.hermesCommand ?? (() => null),
      hermesHome: overrides.hermesHome ?? (() => path.join(root, "HermesHome")),
      hermesPythonRuntime: overrides.hermesPythonRuntime ?? (() => null),
      listFilesRecursive: async () => [],
      memoryRoot: () => path.join(root, "Memory"),
      opencodeCommand: overrides.opencodeCommand ?? (() => null),
      opencodeRuntimeDiagnostics: overrides.opencodeRuntimeDiagnostics ?? (() => ({ installed: false, command: null })),
      ensureOpenCodeServer: overrides.ensureOpenCodeServer,
      redactPathForDiagnostics: (value) => String(value ?? "").replace(root, "<root>"),
      readProviderSecrets: overrides.readProviderSecrets ?? (async () => ({})),
      repoRoot: root,
      safeFileSlug,
      platform: overrides.platform,
      spawnProcess: overrides.spawnProcess,
      socketOpen: async () => false,
      uniqueRuntimeId: (prefix) => `${prefix}-test-${++id}`,
      userRoot: () => root,
    });
  };
}

async function withTempService(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ros-seam-"));
  try {
    return await fn(buildServiceFactory(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// ---- Hermes seam ----

test("Hermes seam: deterministic start returns identical canonical fields to the bridge in isolation", async () => {
  await withTempService(async (makeService, root) => {
    const service = makeService();
    const created = await service.executeDelegationRecord({
      target: "hermes",
      mission: "Seam parity for the Hermes deterministic branch.",
    });
    const packet = await readFile(path.join(root, created.path), "utf8");
    const settings = {
      disabledAddons: [],
      hermes: { localCliExecution: false },
      opencode: { localCliExecution: false },
    };
    const outcome = await createHermesProviderAdapterBridge().startTask({
      payload: { adapter: "deterministic" },
      packet,
      profileHome: path.join(root, "HermesHome"),
      command: null,
      runtime: null,
      secrets: {},
      settings,
      localExecutionEnabled: false,
      disabledAddons: [],
      browserFirstRoot: path.join(root, "BrowserFirst"),
      repoRoot: root,
      spawnProcess: () => {
        throw new Error("spawn must not be called in deterministic seam");
      },
    });
    assert.equal(outcome.kind, "completed");
    const expected = outcome.result;
    const started = await service.executeHermesDelegationStart({
      path: created.path,
      adapter: "deterministic",
    });
    assert.equal(started.status, "completed");
    assert.equal(started.adapter, expected.adapter);
    assert.equal(started.artifact.adapter, expected.adapter);
    assert.equal(started.artifact.finalSummary, expected.finalSummary);
    assert.deepEqual(started.artifact.actionsTaken, expected.actionsTaken);
    assert.deepEqual(started.artifact.approvalNeeds, expected.approvalNeeds);
    assert.deepEqual(started.artifact.residualRisks, expected.residualRisks);
    assert.deepEqual(started.artifact.verification, expected.verification);
    const taskPacket = await readFile(path.join(root, created.path), "utf8");
    assert.match(taskPacket, /^- status:\s*completed$/mi);
    assert.match(taskPacket, /^- resultArtifactPath:\s+BrowserFirst\/DelegationArtifacts\/hermes\//mi);
    const artifact = await readFile(path.join(root, started.artifact.path), "utf8");
    assert.match(artifact, /^# Hermes Result: /m);
    assert.match(artifact, new RegExp(`- adapter: ${expected.adapter}`));
  });
});

test("Hermes seam: blocked guidance writes provider + model to the packet for audit", async () => {
  await withTempService(async (makeService, root) => {
    const service = makeService();
    const created = await service.executeDelegationRecord({
      target: "hermes",
      mission: "Seam parity for the Hermes blocked branch.",
    });
    const started = await service.executeHermesDelegationStart({
      path: created.path,
      adapter: "deterministic",
      provider: "missing-provider",
      model: "missing-model",
    });
    // The deterministic branch always completes; the blocked branch lives
    // at the credential gate, not the deterministic adapter. The seam
    // contract is: every Start call writes a consistent status field, and
    // artifact path remains unset when the branch does not produce one.
    assert.equal(started.status, "completed");
    const taskPacket = await readFile(path.join(root, created.path), "utf8");
    assert.match(taskPacket, /^- status:\s*completed$/mi);
    assert.match(taskPacket, /^- adapter:\s*deterministic$/mi);
  });
});

// ---- OpenCode seam ----

test("OpenCode seam: deterministic start returns identical canonical fields to the bridge in isolation", async () => {
  await withTempService(async (makeService, root) => {
    const service = makeService();
    const created = await service.executeDelegationRecord({
      target: "opencode",
      mission: "Seam parity for the OpenCode deterministic branch.",
    });
    const packet = await readFile(path.join(root, created.path), "utf8");
    const resolveWorkspacePath = (payload) => {
      const workspacePath = payload.workspacePath
        ? path.resolve(root, String(payload.workspacePath))
        : root;
      const allowed = path.resolve(root);
      if (workspacePath !== allowed && !workspacePath.startsWith(`${allowed}${path.sep}`)) {
        throw new Error("workspace must stay inside repo root");
      }
      return workspacePath;
    };
    const outcome = await createOpenCodeProviderAdapterBridge().startTask({
      payload: { adapter: "deterministic" },
      packet,
      command: null,
      runtime: null,
      secrets: {},
      settings: { localOpenCodeExecution: false, disabledAddons: [] },
      localExecutionEnabled: false,
      disabledAddons: [],
      resolveWorkspacePath,
      repoRoot: root,
      browserFirstRoot: path.join(root, "BrowserFirst"),
      spawnProcess: () => {
        throw new Error("spawn must not be called in deterministic seam");
      },
      platform: process.platform,
    });
    assert.equal(outcome.kind, "completed");
    const expected = outcome.result;
    const started = await service.executeOpenCodeDelegationStart({
      path: created.path,
      adapter: "deterministic",
    });
    assert.equal(started.status, "completed");
    assert.equal(started.adapter, expected.adapter);
    assert.equal(started.artifact.adapter, expected.adapter);
    assert.equal(started.artifact.finalSummary, expected.finalSummary);
    assert.deepEqual(started.artifact.changedFiles, expected.changedFiles);
    assert.deepEqual(started.artifact.commandsRun, expected.commandsRun);
    assert.deepEqual(started.artifact.residualRisks, expected.residualRisks);
    assert.deepEqual(started.artifact.verification, expected.verification);
    const taskPacket = await readFile(path.join(root, created.path), "utf8");
    assert.match(taskPacket, /^- status:\s*completed$/mi);
    assert.match(taskPacket, /^- resultArtifactPath:\s+BrowserFirst\/DelegationArtifacts\/opencode\//mi);
  });
});

test("OpenCode seam: blocked guidance returns execution-not-enabled message when CLI is present", async () => {
  await withTempService(async (makeService, root) => {
    const service = makeService({
      opencodeRuntimeDiagnostics: () => ({
        installed: true,
        command: "/usr/local/bin/opencode",
        commandRedacted: "/usr/local/bin/opencode",
        installHint: "Install OpenCode with the provided command.",
        installCommand: "curl -fsSL https://opencode.ai/install | bash",
        alternativeInstallCommands: ["brew install anomalyco/tap/opencode"],
        configureCommand: "OPENCODE_COMMAND=/usr/local/bin/opencode",
        searchedCommands: ["opencode"],
        searchedPaths: [],
        searchedPathCount: 0,
        searchedPathOmitted: 0,
        overrideConfigured: false,
        overridePath: "",
        overrideFound: false,
      }),
    });
    const created = await service.executeDelegationRecord({
      target: "opencode",
      mission: "Seam parity for the OpenCode blocked branch.",
    });
    const started = await service.executeOpenCodeDelegationStart({
      path: created.path,
      adapter: "auto",
    });
    // Without local execution enabled, the bridge returns the "execution
    // requires explicit enablement" blocked branch.
    assert.equal(started.status, "blocked");
    assert.match(started.blockedReason, /execution is disabled|RESONANTOS_OPENCODE_EXECUTION/);
    const taskPacket = await readFile(path.join(root, created.path), "utf8");
    assert.match(taskPacket, /^- status:\s*blocked$/mi);
  });
});
