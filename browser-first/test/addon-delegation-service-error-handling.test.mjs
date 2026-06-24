import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAddonDelegationService } from "../host/addon-delegation-service.mjs";

function safeFileSlug(value) {
  return String(value ?? "item")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function createService(root) {
  let id = 0;
  const browserFirstRoot = () => path.join(root, "BrowserFirst");
  return createAddonDelegationService({
    browserFirstRoot,
    bridgePublicUrl: "http://127.0.0.1:47773",
    dashboardTarget: () => ({ host: "127.0.0.1", port: 9119, url: "http://127.0.0.1:9119" }),
    execFileStdout: async () => {
      throw new Error("CLI execution should not run in deterministic tests.");
    },
    expandUserPath: (value) => path.resolve(root, String(value ?? "")),
    firstExistingExecutable: () => null,
    hermesCommand: () => null,
    hermesHome: () => path.join(root, "HermesHome"),
    listFilesRecursive: async () => [],
    memoryRoot: () => path.join(root, "Memory"),
    opencodeCommand: () => null,
    opencodeRuntimeDiagnostics: () => ({ installed: false, command: null }),
    redactPathForDiagnostics: (value) => String(value ?? "").replace(root, "<root>"),
    repoRoot: root,
    safeFileSlug,
    socketOpen: async () => false,
    uniqueRuntimeId: (prefix) => `${prefix}-test-${++id}`,
    userRoot: () => root,
  });
}

async function withTempService(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ros-delegation-errors-"));
  try {
    return await fn(createService(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function blockArtifactRoot(root) {
  const browserFirstRoot = path.join(root, "BrowserFirst");
  await mkdir(browserFirstRoot, { recursive: true });
  await writeFile(path.join(browserFirstRoot, "DelegationArtifacts"), "not a directory");
}

async function assertFinalizationFailureIsTerminal(target) {
  await withTempService(async (service, root) => {
    const created = await service.executeDelegationRecord({
      target,
      mission: `Exercise ${target} finalization failure handling.`,
    });
    await blockArtifactRoot(root);

    const started = target === "hermes"
      ? await service.executeHermesDelegationStart({ path: created.path, adapter: "deterministic" })
      : await service.executeOpenCodeDelegationStart({ path: created.path, adapter: "deterministic" });

    assert.equal(started.status, "failed");
    assert.match(started.failureReason, /DelegationArtifacts|not a directory|ENOTDIR|EEXIST/i);

    const taskPacket = await readFile(path.join(root, created.path), "utf8");
    assert.match(taskPacket, /^- status:\s*failed$/mi);
    assert.doesNotMatch(taskPacket, /^- status:\s*running$/mi);
    assert.match(taskPacket, /^- failureReason:\s*.+$/mi);
  });
}

test("Hermes delegation records failed status when artifact finalization fails", async () => {
  await assertFinalizationFailureIsTerminal("hermes");
});

test("OpenCode delegation records failed status when artifact finalization fails", async () => {
  await assertFinalizationFailureIsTerminal("opencode");
});
