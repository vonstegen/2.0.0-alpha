import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  assertSafeMoveSource,
  buildMoveImportPreflight,
  executeMoveImport,
  rollbackMoveImport,
  shouldDeregisterMovedSourceAfterRollback,
} from "../host/memory-source-move.mjs";

async function fixtureRoot(name) {
  return mkdtemp(path.join(os.tmpdir(), `resonantos-${name}-`));
}

test("move import preflight rejects broad user root and existing memory root", async () => {
  const root = await fixtureRoot("move-safety");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(memoryRoot, { recursive: true });
  try {
    assert.throws(() => assertSafeMoveSource(os.homedir(), memoryRoot), /home folder/);
    assert.throws(() => assertSafeMoveSource(memoryRoot, memoryRoot), /already inside ResonantOS Memory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move rollback deregistration requires zero skipped files", () => {
  assert.equal(shouldDeregisterMovedSourceAfterRollback({ restoredCount: 2, skippedCount: 0, skippedDirectoryCount: 0, sourceRootRestored: true, skippedRootCleanupCount: 0 }), true);
  assert.equal(shouldDeregisterMovedSourceAfterRollback({ restoredCount: 1, skippedCount: 1, skippedDirectoryCount: 0, sourceRootRestored: true, skippedRootCleanupCount: 0 }), false);
  assert.equal(shouldDeregisterMovedSourceAfterRollback({ skippedCount: 2, skippedDirectoryCount: 0, sourceRootRestored: true, skippedRootCleanupCount: 0 }), false);
  assert.equal(shouldDeregisterMovedSourceAfterRollback({ skippedCount: 0, skippedDirectoryCount: 1, sourceRootRestored: true, skippedRootCleanupCount: 0 }), false);
  assert.equal(shouldDeregisterMovedSourceAfterRollback({ skippedCount: 0, skippedDirectoryCount: 0, sourceRootRestored: false, skippedRootCleanupCount: 0 }), false);
  assert.equal(shouldDeregisterMovedSourceAfterRollback({ skippedCount: 0, skippedDirectoryCount: 0, sourceRootRestored: true, skippedRootCleanupCount: 1 }), false);
  assert.equal(shouldDeregisterMovedSourceAfterRollback({}), false);
  assert.equal(shouldDeregisterMovedSourceAfterRollback(null), false);
  assert.equal(shouldDeregisterMovedSourceAfterRollback({ skippedCount: "0", skippedDirectoryCount: 0, sourceRootRestored: true, skippedRootCleanupCount: 0 }), false);
});

test("move import preflight preserves hidden Obsidian structure in counts", async () => {
  const root = await fixtureRoot("move-preflight");
  const source = path.join(root, "Knowledge Vault");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(path.join(source, ".obsidian"), { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(path.join(source, "note.md"), "# Note\n");
  await writeFile(path.join(source, ".obsidian", "app.json"), "{}\n");
  try {
    const preflight = await buildMoveImportPreflight({
      sourcePath: source,
      memoryRoot,
      kind: "obsidian-vault",
      ownership: "human-knowledge",
    });
    assert.equal(preflight.okToMove, true);
    assert.equal(preflight.fileCount, 2);
    assert.equal(preflight.hiddenFiles, 1);
    assert.match(preflight.destinationRoot, /HUMAN_KNOWLEDGE/);
    assert.equal(preflight.confirmationPhrase, "MOVE Knowledge Vault");
    assert.match(preflight.preflightFingerprint, /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move import preserves empty directories and restores them on rollback", async () => {
  const root = await fixtureRoot("move-empty-dirs");
  const source = path.join(root, "Vault With Empty Dirs");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(path.join(source, "01 Notes", "Empty Branch", "Nested Empty"), { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  try {
    const preflight = await buildMoveImportPreflight({
      sourcePath: source,
      memoryRoot,
      kind: "folder",
      ownership: "human-knowledge",
    });
    assert.equal(preflight.okToMove, true);
    assert.equal(preflight.fileCount, 0);
    assert.equal(preflight.directoryCount, 3);

    const result = await executeMoveImport({
      sourcePath: source,
      memoryRoot,
      kind: "folder",
      ownership: "human-knowledge",
      confirmation: "MOVE Vault With Empty Dirs",
      expectedPreflightFingerprint: preflight.preflightFingerprint,
    });
    assert.equal(result.status, "moved");
    assert.equal(result.movedCount, 0);
    assert.equal(result.createdDirectoryCount, 3);
    assert.equal(existsSync(path.join(result.source.path, "01 Notes", "Empty Branch", "Nested Empty")), true);
    assert.equal(existsSync(source), false);

    const rollback = await rollbackMoveImport({
      ledgerPath: result.ledgerPath,
      confirmation: "ROLLBACK MOVE",
    });
    assert.equal(rollback.restoredCount, 0);
    assert.equal(rollback.skippedCount, 0);
    assert.equal(rollback.restoredDirectoryCount, 3);
    assert.equal(rollback.skippedDirectoryCount, 0);
    assert.equal(rollback.sourceRootRestored, true);
    assert.equal(rollback.skippedRootCleanupCount, 0);
    assert.equal(existsSync(path.join(source, "01 Notes", "Empty Branch", "Nested Empty")), true);
    assert.equal(existsSync(path.join(result.source.path, "01 Notes", "Empty Branch", "Nested Empty")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move import can roll back a completely empty source folder", async () => {
  const root = await fixtureRoot("move-empty-root");
  const source = path.join(root, "Empty Vault");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(source, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  try {
    const preflight = await buildMoveImportPreflight({
      sourcePath: source,
      memoryRoot,
      kind: "folder",
      ownership: "human-knowledge",
    });
    assert.equal(preflight.okToMove, true);
    assert.equal(preflight.fileCount, 0);
    assert.equal(preflight.directoryCount, 0);

    const result = await executeMoveImport({
      sourcePath: source,
      memoryRoot,
      kind: "folder",
      ownership: "human-knowledge",
      confirmation: "MOVE Empty Vault",
      expectedPreflightFingerprint: preflight.preflightFingerprint,
    });
    assert.equal(result.status, "moved");
    assert.equal(existsSync(result.source.path), true);
    assert.equal(existsSync(source), false);

    const rollback = await rollbackMoveImport({
      ledgerPath: result.ledgerPath,
      confirmation: "ROLLBACK MOVE",
    });
    assert.equal(rollback.restoredCount, 0);
    assert.equal(rollback.restoredDirectoryCount, 0);
    assert.equal(rollback.sourceRootRestored, true);
    assert.equal(rollback.skippedRootCleanupCount, 0);
    assert.equal(existsSync(source), true);
    assert.equal(existsSync(result.source.path), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move rollback reports managed directory cleanup conflicts", async () => {
  const root = await fixtureRoot("move-dir-cleanup-conflict");
  const source = path.join(root, "Directory Cleanup Vault");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(path.join(source, "Empty Branch"), { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  try {
    const preflight = await buildMoveImportPreflight({
      sourcePath: source,
      memoryRoot,
      kind: "folder",
      ownership: "human-knowledge",
    });
    const result = await executeMoveImport({
      sourcePath: source,
      memoryRoot,
      kind: "folder",
      ownership: "human-knowledge",
      confirmation: "MOVE Directory Cleanup Vault",
      expectedPreflightFingerprint: preflight.preflightFingerprint,
    });
    await writeFile(path.join(result.source.path, "Empty Branch", "new-managed-file.md"), "# New managed file\n");

    const rollback = await rollbackMoveImport({
      ledgerPath: result.ledgerPath,
      confirmation: "ROLLBACK MOVE",
    });
    assert.equal(rollback.sourceRootRestored, true);
    assert.equal(rollback.skippedDirectoryCount, 1);
    assert.equal(rollback.skippedDirectories[0].reason, "directory-destination-cleanup-failed");
    assert.equal(shouldDeregisterMovedSourceAfterRollback(rollback), false);
    assert.equal(existsSync(path.join(source, "Empty Branch")), true);
    assert.equal(existsSync(path.join(result.source.path, "Empty Branch", "new-managed-file.md")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move import preflight blocks symlinked content", async (t) => {
  const root = await fixtureRoot("move-symlink");
  const source = path.join(root, "Vault");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(source, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(path.join(root, "outside.txt"), "outside\n");
  try {
    try {
      await symlink(path.join(root, "outside.txt"), path.join(source, "linked.txt"));
    } catch (error) {
      t.skip(`symlink unavailable in this environment: ${error.message}`);
      return;
    }
    const preflight = await buildMoveImportPreflight({
      sourcePath: source,
      memoryRoot,
      ownership: "human-knowledge",
    });
    assert.equal(preflight.okToMove, false);
    assert.deepEqual(preflight.blocked, [{ path: "linked.txt", reason: "symlink-blocked" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move import executes into managed memory and rollback restores originals", async () => {
  const root = await fixtureRoot("move-execute");
  const source = path.join(root, "Research");
  const nested = path.join(source, "nested");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(nested, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(path.join(source, "index.md"), "# Research\n");
  await writeFile(path.join(nested, "paper.txt"), "paper notes\n");

  try {
    const preflight = await buildMoveImportPreflight({ sourcePath: source, memoryRoot, ownership: "external-knowledge" });
    const result = await executeMoveImport({
      sourcePath: source,
      memoryRoot,
      ownership: "external-knowledge",
      confirmation: "MOVE Research",
      expectedPreflightFingerprint: preflight.preflightFingerprint,
    });
    assert.equal(result.status, "moved");
    assert.equal(result.movedCount, 2);
    assert.equal(result.sourceCleanupStatus, "removed");
    assert.equal(existsSync(source), false);
    assert.equal(existsSync(path.join(result.destinationRoot, "index.md")), true);
    assert.equal(existsSync(path.join(result.destinationRoot, "nested", "paper.txt")), true);
    const ledger = await readFile(result.ledgerPath, "utf8");
    assert.match(ledger, /"status":"moved"/);
    assert.match(ledger, /"afterHash":/);
    assert.match(result.destinationRoot, /EXTERNAL_KNOWLEDGE/);

    const rollback = await rollbackMoveImport({
      ledgerPath: result.ledgerPath,
      confirmation: "ROLLBACK MOVE",
    });
    assert.equal(rollback.restoredCount, 2);
    const rolledBackManifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    assert.equal(rolledBackManifest.rollbackStatus, "restored");
    assert.equal(rolledBackManifest.rollbackRestoredCount, 2);
    assert.equal(rolledBackManifest.rollbackSkippedCount, 0);
    assert.match(rolledBackManifest.rollbackReportPath, /rollback-report\.json$/);
    assert.equal(existsSync(path.join(source, "index.md")), true);
    assert.equal(existsSync(path.join(source, "nested", "paper.txt")), true);
    assert.equal(existsSync(path.join(result.destinationRoot, "index.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move import preserves new source files that appear before source cleanup", async () => {
  const root = await fixtureRoot("move-preserve-new-source");
  const source = path.join(root, "Live Source");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(source, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(path.join(source, "approved.md"), "approved\n");
  try {
    const preflight = await buildMoveImportPreflight({ sourcePath: source, memoryRoot });
    const result = await executeMoveImport({
      sourcePath: source,
      memoryRoot,
      confirmation: preflight.confirmationPhrase,
      expectedPreflightFingerprint: preflight.preflightFingerprint,
      beforeSourceCleanup: async ({ sourcePath }) => {
        await writeFile(path.join(sourcePath, "new-after-move.md"), "new evidence\n");
      },
    });
    assert.equal(result.status, "moved");
    assert.equal(result.sourceCleanupStatus, "preserved-new-content");
    assert.equal(await readFile(path.join(source, "new-after-move.md"), "utf8"), "new evidence\n");
    assert.equal(existsSync(path.join(source, "approved.md")), false);
    assert.equal(await readFile(path.join(result.destinationRoot, "approved.md"), "utf8"), "approved\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move rollback restores moved files without deleting preserved new source files", async () => {
  const root = await fixtureRoot("move-rollback-preserved-source");
  const source = path.join(root, "Live Source");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(source, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(path.join(source, "approved.md"), "approved\n");
  try {
    const preflight = await buildMoveImportPreflight({ sourcePath: source, memoryRoot });
    const result = await executeMoveImport({
      sourcePath: source,
      memoryRoot,
      confirmation: preflight.confirmationPhrase,
      expectedPreflightFingerprint: preflight.preflightFingerprint,
      beforeSourceCleanup: async ({ sourcePath }) => {
        await writeFile(path.join(sourcePath, "new-after-move.md"), "new evidence\n");
      },
    });
    assert.equal(result.sourceCleanupStatus, "preserved-new-content");

    const rollback = await rollbackMoveImport({
      ledgerPath: result.ledgerPath,
      confirmation: "ROLLBACK MOVE",
    });
    assert.equal(rollback.restoredCount, 1);
    assert.equal(rollback.skippedCount, 0);
    const rolledBackManifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    assert.equal(rolledBackManifest.rollbackStatus, "restored");
    assert.equal(rolledBackManifest.rollbackRestoredCount, 1);
    assert.equal(await readFile(path.join(source, "approved.md"), "utf8"), "approved\n");
    assert.equal(await readFile(path.join(source, "new-after-move.md"), "utf8"), "new evidence\n");
    assert.equal(existsSync(path.join(result.destinationRoot, "approved.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move import supports verified copy-unlink relocation", async () => {
  const root = await fixtureRoot("move-copy-unlink");
  const source = path.join(root, "Cross Volume");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(source, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(path.join(source, "note.md"), "copy me\n");
  try {
    const preflight = await buildMoveImportPreflight({ sourcePath: source, memoryRoot });
    const result = await executeMoveImport({
      sourcePath: source,
      memoryRoot,
      confirmation: "MOVE Cross Volume",
      expectedPreflightFingerprint: preflight.preflightFingerprint,
      moveFile: async (sourcePath, destinationPath) => {
        const bytes = await readFile(sourcePath);
        await writeFile(destinationPath, bytes);
        await rm(sourcePath, { force: true });
        return "copy-unlink";
      },
    });
    assert.equal(result.status, "moved");
    assert.equal(existsSync(source), false);
    assert.equal(existsSync(path.join(result.destinationRoot, "note.md")), true);
    assert.match(await readFile(result.ledgerPath, "utf8"), /"moveMethod":"copy-unlink"/);
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    assert.equal(manifest.preflightFingerprint, preflight.preflightFingerprint);
    assert.equal(manifest.approvedPreflightFingerprint, preflight.preflightFingerprint);
    assert.equal(manifest.status, "moved");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move import rejects destination hash mismatch and keeps original source", async () => {
  const root = await fixtureRoot("move-hash-mismatch");
  const source = path.join(root, "Hash Guard");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(source, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(path.join(source, "note.md"), "correct bytes\n");
  try {
    const preflight = await buildMoveImportPreflight({ sourcePath: source, memoryRoot });
    const result = await executeMoveImport({
      sourcePath: source,
      memoryRoot,
      confirmation: "MOVE Hash Guard",
      expectedPreflightFingerprint: preflight.preflightFingerprint,
      moveFile: async (_sourcePath, destinationPath) => {
        await writeFile(destinationPath, "corrupt bytes\n");
        return "bad-copy";
      },
    });
    assert.equal(result.status, "partial-failure-rolled-back");
    assert.equal(result.failedCount, 1);
    assert.equal(existsSync(path.join(source, "note.md")), true);
    assert.equal(existsSync(path.join(result.destinationRoot, "note.md")), false);
    assert.match(result.failures[0].error, /destination hash mismatch/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move import automatically rolls back earlier files after a later move fails", async () => {
  const root = await fixtureRoot("move-auto-rollback");
  const source = path.join(root, "Rollback Guard");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(source, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(path.join(source, "a.md"), "first\n");
  await writeFile(path.join(source, "b.md"), "second\n");
  let calls = 0;
  try {
    const preflight = await buildMoveImportPreflight({ sourcePath: source, memoryRoot });
    const result = await executeMoveImport({
      sourcePath: source,
      memoryRoot,
      confirmation: "MOVE Rollback Guard",
      expectedPreflightFingerprint: preflight.preflightFingerprint,
      moveFile: async (sourcePath, destinationPath) => {
        calls += 1;
        if (calls === 2) {
          throw new Error("simulated move failure");
        }
        const bytes = await readFile(sourcePath);
        await writeFile(destinationPath, bytes);
        await rm(sourcePath, { force: true });
        return "test-move";
      },
    });
    assert.equal(result.status, "partial-failure-rolled-back");
    assert.equal(result.movedCount, 1);
    assert.equal(result.failedCount, 1);
    assert.equal(result.rollbackRestoredCount, 1);
    assert.equal(result.rollbackSourceRootRestored, true);
    assert.equal(result.rollbackSkippedRootCleanupCount, 0);
    assert.equal(existsSync(path.join(source, "a.md")), true);
    assert.equal(existsSync(path.join(source, "b.md")), true);
    assert.equal(existsSync(path.join(result.destinationRoot, "a.md")), false);
    assert.equal(existsSync(result.destinationRoot), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move import automatic rollback reports destination root cleanup conflicts", async () => {
  const root = await fixtureRoot("move-auto-root-conflict");
  const source = path.join(root, "Root Conflict");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(source, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(path.join(source, "a.md"), "first\n");
  await writeFile(path.join(source, "b.md"), "second\n");
  let calls = 0;
  try {
    const preflight = await buildMoveImportPreflight({ sourcePath: source, memoryRoot });
    const result = await executeMoveImport({
      sourcePath: source,
      memoryRoot,
      confirmation: preflight.confirmationPhrase,
      expectedPreflightFingerprint: preflight.preflightFingerprint,
      moveFile: async (sourcePath, destinationPath) => {
        calls += 1;
        if (calls === 2) {
          await writeFile(path.join(path.dirname(destinationPath), "unexpected-managed-leftover.md"), "leftover\n");
          throw new Error("simulated move failure after managed leftover");
        }
        const bytes = await readFile(sourcePath);
        await writeFile(destinationPath, bytes);
        await rm(sourcePath, { force: true });
        return "test-move";
      },
    });
    assert.equal(result.status, "partial-failure-rolled-back");
    assert.equal(result.rollbackSourceRootRestored, true);
    assert.equal(result.rollbackSkippedRootCleanupCount, 1);
    assert.equal(result.automaticRootRollback.skippedCleanup.reason, "destination-root-cleanup-failed");
    assert.equal(existsSync(path.join(result.destinationRoot, "unexpected-managed-leftover.md")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move import restores the current file when a failed move already removed the source", async () => {
  const root = await fixtureRoot("move-current-failure-restore");
  const source = path.join(root, "Current Failure");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(source, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(path.join(source, "note.md"), "must restore\n");
  try {
    const preflight = await buildMoveImportPreflight({ sourcePath: source, memoryRoot });
    const result = await executeMoveImport({
      sourcePath: source,
      memoryRoot,
      confirmation: preflight.confirmationPhrase,
      expectedPreflightFingerprint: preflight.preflightFingerprint,
      moveFile: async (sourcePath, destinationPath) => {
        const bytes = await readFile(sourcePath);
        await writeFile(destinationPath, bytes);
        await rm(sourcePath, { force: true });
        throw new Error("simulated failure after source removal");
      },
    });
    assert.equal(result.status, "partial-failure-rolled-back");
    assert.equal(result.failedCount, 1);
    assert.equal(await readFile(path.join(source, "note.md"), "utf8"), "must restore\n");
    assert.equal(existsSync(path.join(result.destinationRoot, "note.md")), false);
    const ledger = await readFile(result.ledgerPath, "utf8");
    assert.match(ledger, /"failureRestore":"restored-source"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move rollback refuses to restore corrupted destination bytes", async () => {
  const root = await fixtureRoot("move-rollback-hash");
  const source = path.join(root, "Rollback Hash");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(source, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(path.join(source, "note.md"), "trusted bytes\n");
  try {
    const preflight = await buildMoveImportPreflight({ sourcePath: source, memoryRoot });
    const result = await executeMoveImport({
      sourcePath: source,
      memoryRoot,
      confirmation: "MOVE Rollback Hash",
      expectedPreflightFingerprint: preflight.preflightFingerprint,
    });
    await writeFile(path.join(result.destinationRoot, "note.md"), "tampered bytes\n");
    const rollback = await rollbackMoveImport({
      ledgerPath: result.ledgerPath,
      confirmation: "ROLLBACK MOVE",
    });
    assert.equal(rollback.restoredCount, 0);
    assert.equal(rollback.skippedCount, 1);
    assert.equal(rollback.skipped[0].reason, "destination-hash-mismatch");
    assert.equal(existsSync(path.join(source, "note.md")), false);
    assert.equal(existsSync(path.join(result.destinationRoot, "note.md")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move rollback succeeds even when the move manifest is corrupt", async () => {
  const root = await fixtureRoot("move-rollback-corrupt-manifest");
  const source = path.join(root, "Corrupt Manifest");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(source, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(path.join(source, "note.md"), "restore me\n");
  try {
    const preflight = await buildMoveImportPreflight({ sourcePath: source, memoryRoot });
    const result = await executeMoveImport({
      sourcePath: source,
      memoryRoot,
      confirmation: preflight.confirmationPhrase,
      expectedPreflightFingerprint: preflight.preflightFingerprint,
    });
    await writeFile(result.manifestPath, "{not-json\n");

    const rollback = await rollbackMoveImport({
      ledgerPath: result.ledgerPath,
      confirmation: "ROLLBACK MOVE",
    });
    assert.equal(rollback.restoredCount, 1);
    assert.equal(await readFile(path.join(source, "note.md"), "utf8"), "restore me\n");
    assert.equal(await readFile(result.manifestPath, "utf8"), "{not-json\n");
    assert.equal(existsSync(path.join(path.dirname(result.ledgerPath), "rollback-report.json")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move import requires exact human confirmation phrase", async () => {
  const root = await fixtureRoot("move-confirmation");
  const source = path.join(root, "UnsafeMove");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(source, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(path.join(source, "note.md"), "note\n");
  try {
    const preflight = await buildMoveImportPreflight({ sourcePath: source, memoryRoot });
    await assert.rejects(
      () => executeMoveImport({
        sourcePath: source,
        memoryRoot,
        confirmation: "yes",
        expectedPreflightFingerprint: preflight.preflightFingerprint,
      }),
      /requires confirmation phrase/
    );
    assert.equal(existsSync(path.join(source, "note.md")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move import rejects stale preflight fingerprints before moving files", async () => {
  const root = await fixtureRoot("move-stale-preflight");
  const source = path.join(root, "Changing Source");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(source, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(path.join(source, "note.md"), "original\n");
  try {
    const preflight = await buildMoveImportPreflight({ sourcePath: source, memoryRoot });
    await writeFile(path.join(source, "added-after-preflight.md"), "new evidence\n");
    await assert.rejects(
      () => executeMoveImport({
        sourcePath: source,
        memoryRoot,
        confirmation: preflight.confirmationPhrase,
        expectedPreflightFingerprint: preflight.preflightFingerprint,
      }),
      /source changed after preflight/i
    );
    assert.equal(existsSync(path.join(source, "note.md")), true);
    assert.equal(existsSync(path.join(source, "added-after-preflight.md")), true);
    assert.equal(existsSync(preflight.destinationRoot), false);
    assert.equal(existsSync(path.join(memoryRoot, "CONFIG", "move-imports")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move import fingerprints source content, not only path size and mtime", async () => {
  const root = await fixtureRoot("move-content-fingerprint");
  const source = path.join(root, "Same Metadata");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(source, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  const notePath = path.join(source, "note.md");
  await writeFile(notePath, "alpha\n");
  try {
    const preflight = await buildMoveImportPreflight({ sourcePath: source, memoryRoot });
    const originalTimes = await stat(notePath);
    await writeFile(notePath, "bravo\n");
    await utimes(notePath, originalTimes.atime, originalTimes.mtime);
    await assert.rejects(
      () => executeMoveImport({
        sourcePath: source,
        memoryRoot,
        confirmation: preflight.confirmationPhrase,
        expectedPreflightFingerprint: preflight.preflightFingerprint,
      }),
      /source changed after preflight/i
    );
    assert.equal(await readFile(notePath, "utf8"), "bravo\n");
    assert.equal(existsSync(preflight.destinationRoot), false);
    assert.equal(existsSync(path.join(memoryRoot, "CONFIG", "move-imports")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("move import rejects bytes changed after execution fingerprint validation", async () => {
  const root = await fixtureRoot("move-late-content-change");
  const source = path.join(root, "Late Change");
  const memoryRoot = path.join(root, "ResonantOS_User", "Memory");
  await mkdir(source, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  await writeFile(path.join(source, "note.md"), "approved bytes\n");
  let mutated = false;
  try {
    const preflight = await buildMoveImportPreflight({ sourcePath: source, memoryRoot });
    const result = await executeMoveImport({
      sourcePath: source,
      memoryRoot,
      confirmation: preflight.confirmationPhrase,
      expectedPreflightFingerprint: preflight.preflightFingerprint,
      beforeMoveFileRead: async (file) => {
        if (!mutated && file.relativePath === "note.md") {
          mutated = true;
          await writeFile(file.absolutePath, "changed bytes\n");
        }
      },
    });
    assert.equal(result.status, "partial-failure-rolled-back");
    assert.equal(result.failedCount, 1);
    assert.match(result.failures[0].error, /source bytes changed after preflight/i);
    assert.equal(await readFile(path.join(source, "note.md"), "utf8"), "changed bytes\n");
    assert.equal(existsSync(path.join(result.destinationRoot, "note.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
