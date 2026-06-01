import assert from "node:assert/strict";
import test from "node:test";
import { createMemorySourceIntakeHostService } from "../host/memory-source-intake-host-service.mjs";

function baseDependencies(overrides = {}) {
  return {
    appendMemorySourceAudit: async () => ({}),
    appendMemorySourceRepairHistory: async (entry) => entry,
    appendMemorySourceSyncHistory: async (entry) => entry,
    classifyMemorySourceFile: () => "compatible",
    executeArchiveReviewRequest: async () => ({}),
    executeMemorySourceScan: async () => ({
      totalScanned: 0,
      limitReached: false,
      categories: {},
      recommendation: "No source files found.",
    }),
    expandUserPath: (value) => value,
    listFilesRecursive: async () => [],
    memoryRoot: () => "/tmp/resonantos-memory",
    memorySourceFileManifestPath: () => "/tmp/resonantos-memory/CONFIG/source-file-versions.json",
    readMemorySettings: async () => ({ sources: [] }),
    redactDiagnosticText: (value) => String(value ?? ""),
    safeFileSlug: (value) => String(value ?? "source").replace(/[^a-z0-9._-]+/gi, "-"),
    ...overrides,
  };
}

test("memory source intake host service fails fast when a dependency is missing", () => {
  const dependencies = baseDependencies();
  delete dependencies.readMemorySettings;
  assert.throws(
    () => createMemorySourceIntakeHostService(dependencies),
    /Memory source intake host service missing dependency: readMemorySettings/,
  );
});

test("memory source intake host service owns source review and sync executors", () => {
  const service = createMemorySourceIntakeHostService(baseDependencies());
  assert.equal(typeof service.executeMemorySourceReview, "function");
  assert.equal(typeof service.executeMemorySourceIntake, "function");
  assert.equal(typeof service.executeMemorySourceFileIntake, "function");
  assert.equal(typeof service.executeMemorySourceSync, "function");
  assert.equal(typeof service.executeMemorySourceVersionsRepair, "function");
  assert.equal(typeof service.executeMemorySourceDiff, "function");
});

test("memory source intake host service blocks disabled sources before filesystem review", async () => {
  const service = createMemorySourceIntakeHostService(baseDependencies({
    readMemorySettings: async () => ({
      sources: [{
        id: "source-disabled",
        path: "/should/not/be/read",
        kind: "folder",
        ownership: "human-knowledge",
        importMode: "copy",
        disabledAt: "2026-06-01T00:00:00.000Z",
      }],
    }),
  }));

  await assert.rejects(
    () => service.executeMemorySourceReview({ sourceId: "source-disabled" }),
    /Memory source is disabled/,
  );
});
