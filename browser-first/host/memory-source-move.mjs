import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, copyFile, lstat, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_MOVE_FILES = 25_000;

function safeSlug(value) {
  return String(value ?? "source")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "source";
}

function pathHash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function contentHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function ensureInside(child, parent, message) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(message);
  }
}

function isSameOrInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function memoryDomainForOwnership(ownership) {
  if (ownership === "human-knowledge") return path.join("HUMAN_KNOWLEDGE", "sources");
  if (ownership === "external-knowledge") return path.join("EXTERNAL_KNOWLEDGE", "sources");
  return path.join("INTAKE", "imports", "mixed");
}

export function moveConfirmationPhrase(preflight) {
  return `MOVE ${preflight.sourceName}`;
}

export function assertSafeMoveSource(sourcePath, memoryRoot) {
  const source = path.resolve(sourcePath);
  const root = path.parse(source).root;
  const home = path.resolve(os.homedir());
  const memory = path.resolve(memoryRoot);
  if (!source || source === root) {
    throw new Error("Move import cannot target a filesystem root.");
  }
  if (source === home) {
    throw new Error("Move import cannot target the user's home folder.");
  }
  if (isSameOrInside(source, memory)) {
    throw new Error("Move import cannot move a folder that is already inside ResonantOS Memory.");
  }
  const protectedNames = new Set(["Applications", "Library", "System", "Volumes", "bin", "dev", "etc", "private", "sbin", "usr", "var"]);
  const parts = source.split(path.sep).filter(Boolean);
  if (process.platform === "darwin" && parts.length === 1 && protectedNames.has(parts[0])) {
    throw new Error("Move import cannot target a protected system folder.");
  }
  const relativeToHome = path.relative(home, source);
  if (!relativeToHome.startsWith("..") && !path.isAbsolute(relativeToHome) && relativeToHome.split(path.sep).filter(Boolean).length < 1) {
    throw new Error("Move import requires a specific source folder, not a broad user root.");
  }
}

export function shouldDeregisterMovedSourceAfterRollback(report) {
  return Number.isInteger(report?.skippedCount) &&
    report.skippedCount === 0 &&
    Number.isInteger(report?.skippedDirectoryCount) &&
    report.skippedDirectoryCount === 0 &&
    report.sourceRootRestored === true &&
    Number.isInteger(report?.skippedRootCleanupCount) &&
    report.skippedRootCleanupCount === 0;
}

async function listMoveEntries(sourcePath, limit = MAX_MOVE_FILES) {
  const source = path.resolve(sourcePath);
  const files = [];
  const directories = [];
  const blocked = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true }).catch((error) => {
      blocked.push({ path: path.relative(source, current).replace(/\\/g, "/") || ".", reason: error.message });
      return [];
    });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relative = path.relative(source, fullPath).replace(/\\/g, "/");
      const info = await lstat(fullPath).catch((error) => {
        blocked.push({ path: relative, reason: error.message });
        return null;
      });
      if (!info) continue;
      if (info.isSymbolicLink()) {
        blocked.push({ path: relative, reason: "symlink-blocked" });
        continue;
      }
      if (entry.isDirectory()) {
        directories.push(fullPath);
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        blocked.push({ path: relative, reason: "non-regular-file-blocked" });
        continue;
      }
      files.push({
        absolutePath: fullPath,
        relativePath: relative,
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
        hidden: relative.split("/").some((part) => part.startsWith(".")),
      });
      if (files.length > limit) {
        blocked.push({ path: relative, reason: `file-limit-${limit}-exceeded` });
        return;
      }
    }
  }
  await walk(source);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  directories.sort((a, b) => path.relative(source, a).localeCompare(path.relative(source, b)));
  blocked.sort((a, b) => String(a.path).localeCompare(String(b.path)));
  return { files, directories, blocked };
}

function movePreflightFingerprint({ sourcePath, destinationRoot, kind, ownership, files, directories }) {
  const source = path.resolve(sourcePath);
  const payload = {
    sourcePath: source,
    destinationRoot: path.resolve(destinationRoot),
    kind,
    ownership,
    files: files.map((file) => ({
      path: file.relativePath,
      size: file.size,
      modifiedAt: file.modifiedAt,
      hidden: Boolean(file.hidden),
      contentHash: file.contentHash,
    })),
    directories: directories.map((directory) => path.relative(source, directory).replace(/\\/g, "/")).sort(),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function attachPreflightContentHashes(files, blocked) {
  for (const file of files) {
    try {
      file.contentHash = contentHash(await readFile(file.absolutePath));
    } catch (error) {
      blocked.push({ path: file.relativePath, reason: `hash-read-failed: ${error.message}` });
    }
  }
}

async function verifiedFileHash(filePath, expectedHash, message) {
  const actualHash = contentHash(await readFile(filePath));
  if (actualHash !== expectedHash) {
    throw new Error(`${message}: expected ${expectedHash}, got ${actualHash}`);
  }
  return actualHash;
}

async function moveFileAcrossVolumes(sourcePath, destinationPath, expectedHash) {
  try {
    await rename(sourcePath, destinationPath);
    await verifiedFileHash(destinationPath, expectedHash, "Move import destination hash mismatch after rename");
    return "rename";
  } catch (error) {
    if (error?.code !== "EXDEV") {
      throw error;
    }
    await copyFile(sourcePath, destinationPath);
    await verifiedFileHash(destinationPath, expectedHash, "Move import destination hash mismatch after cross-volume copy");
    await rm(sourcePath, { force: true });
    return "copy-unlink";
  }
}

async function rollbackMovedEntries(moved) {
  const restored = [];
  const skipped = [];
  for (const entry of [...moved].reverse()) {
    const result = await restoreMovedEntry(entry);
    if (result.restored) {
      restored.push(result.restored);
    } else {
      skipped.push(result.skipped);
    }
  }
  await cleanupEmptyDestinationDirs(moved);
  return { restored, skipped };
}

async function rollbackCreatedDirectories(directories) {
  const restored = [];
  const skipped = [];
  const ordered = [...directories].sort((a, b) => b.relativePath.length - a.relativePath.length);
  for (const entry of ordered) {
    try {
      await mkdir(entry.sourcePath, { recursive: true });
    } catch (error) {
      skipped.push({ relativePath: entry.relativePath, reason: "directory-restore-failed", error: error.message });
      continue;
    }
    try {
      await rmdir(entry.destinationPath);
      restored.push({ relativePath: entry.relativePath, sourcePath: entry.sourcePath });
    } catch (error) {
      if (error?.code === "ENOENT") {
        restored.push({ relativePath: entry.relativePath, sourcePath: entry.sourcePath });
        continue;
      }
      skipped.push({ relativePath: entry.relativePath, reason: "directory-destination-cleanup-failed", error: error.message });
    }
  }
  return { restored, skipped };
}

async function rollbackMoveRoot(manifest) {
  if (!manifest?.sourcePath || !manifest?.destinationRoot) {
    return {
      restored: false,
      skippedCleanup: { reason: "manifest-root-missing" },
    };
  }
  try {
    await mkdir(manifest.sourcePath, { recursive: true });
  } catch (error) {
    return {
      restored: false,
      skippedCleanup: { path: manifest.sourcePath, reason: "source-root-restore-failed", error: error.message },
    };
  }
  try {
    await rmdir(manifest.destinationRoot);
    return { restored: true, skippedCleanup: null };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { restored: true, skippedCleanup: null };
    }
    return {
      restored: true,
      skippedCleanup: { path: manifest.destinationRoot, reason: "destination-root-cleanup-failed", error: error.message },
    };
  }
}

async function restoreMovedEntry(entry) {
  if (!existsSync(entry.destinationPath)) {
    return { skipped: { relativePath: entry.relativePath, reason: "destination-missing" } };
  }
  if (existsSync(entry.sourcePath)) {
    return { skipped: { relativePath: entry.relativePath, reason: "source-path-already-exists" } };
  }
  try {
    await verifiedFileHash(entry.destinationPath, entry.beforeHash, "Move import rollback source hash mismatch");
  } catch (error) {
    return { skipped: { relativePath: entry.relativePath, reason: "destination-hash-mismatch", error: error.message } };
  }
  try {
    await mkdir(path.dirname(entry.sourcePath), { recursive: true });
  } catch (error) {
    return { skipped: { relativePath: entry.relativePath, reason: "source-parent-restore-failed", error: error.message } };
  }
  await rename(entry.destinationPath, entry.sourcePath);
  try {
    await verifiedFileHash(entry.sourcePath, entry.beforeHash, "Move import rollback restored hash mismatch");
  } catch (error) {
    return { skipped: { relativePath: entry.relativePath, reason: "restored-hash-mismatch", error: error.message } };
  }
  return { restored: { relativePath: entry.relativePath, sourcePath: entry.sourcePath } };
}

async function cleanupEmptyDestinationDirs(entries) {
  const directories = [...new Set(entries.map((entry) => path.dirname(entry.destinationPath)))]
    .sort((a, b) => b.length - a.length);
  for (const directory of directories) {
    await rmdir(directory).catch(() => undefined);
  }
}

async function cleanupMovedSourceRoot(sourcePath, directories) {
  for (const directory of directories.sort((a, b) => b.length - a.length)) {
    await rmdir(directory).catch(() => undefined);
  }
  try {
    await rmdir(sourcePath);
    return "removed";
  } catch (error) {
    if (error?.code === "ENOENT") return "removed";
    if (error?.code === "ENOTEMPTY" || error?.code === "EEXIST") return "preserved-new-content";
    throw error;
  }
}

export async function buildMoveImportPreflight({ sourcePath, memoryRoot, kind = "folder", ownership = "mixed-library" }) {
  const source = path.resolve(sourcePath);
  assertSafeMoveSource(source, memoryRoot);
  if (!existsSync(source)) {
    throw new Error("Move import source does not exist.");
  }
  const details = await stat(source);
  if (!details.isDirectory()) {
    throw new Error("Move import source must be a folder.");
  }
  const sourceName = path.basename(source) || "source";
  const destinationRoot = path.join(
    path.resolve(memoryRoot),
    memoryDomainForOwnership(ownership),
    `${safeSlug(sourceName)}-${pathHash(source)}`,
  );
  if (isSameOrInside(destinationRoot, source)) {
    throw new Error("Move import destination cannot be inside the source folder.");
  }
  const { files, directories, blocked: traversalBlocked } = await listMoveEntries(source);
  const blocked = [...traversalBlocked];
  await attachPreflightContentHashes(files, blocked);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const hiddenFiles = files.filter((file) => file.hidden).length;
  if (existsSync(destinationRoot)) {
    blocked.push({ path: destinationRoot, reason: "destination-already-exists" });
  }
  const preflightFingerprint = movePreflightFingerprint({
    sourcePath: source,
    destinationRoot,
    kind,
    ownership,
    files,
    directories,
  });
  return {
    okToMove: blocked.length === 0,
    sourcePath: source,
    sourceName,
    destinationRoot,
    kind,
    ownership,
    importMode: "move-on-import",
    fileCount: files.length,
    directoryCount: directories.length,
    totalBytes,
    hiddenFiles,
    blocked,
    confirmationPhrase: `MOVE ${sourceName}`,
    preflightFingerprint,
    files: files.slice(0, 25).map((file) => ({
      relativePath: file.relativePath,
      size: file.size,
      modifiedAt: file.modifiedAt,
      hidden: file.hidden,
    })),
  };
}

export async function executeMoveImport({
  sourcePath,
  memoryRoot,
  kind = "folder",
  ownership = "mixed-library",
  confirmation,
  expectedPreflightFingerprint,
  actor = "resonantos-browser-first",
  moveFile = moveFileAcrossVolumes,
  beforeMoveFileRead = null,
  beforeSourceCleanup = null,
}) {
  const preflight = await buildMoveImportPreflight({ sourcePath, memoryRoot, kind, ownership });
  if (!preflight.okToMove) {
    throw new Error(`Move import preflight failed: ${preflight.blocked.map((entry) => entry.reason).join(", ")}`);
  }
  if (String(confirmation ?? "").trim() !== moveConfirmationPhrase(preflight)) {
    throw new Error(`Move import requires confirmation phrase: ${moveConfirmationPhrase(preflight)}`);
  }
  if (!expectedPreflightFingerprint) {
    throw new Error("Move import requires a matching preflight fingerprint.");
  }
  if (String(expectedPreflightFingerprint) !== preflight.preflightFingerprint) {
    throw new Error("Move import source changed after preflight. Run preflight again before moving.");
  }
  const { files, directories, blocked } = await listMoveEntries(preflight.sourcePath);
  await attachPreflightContentHashes(files, blocked);
  if (blocked.length) {
    throw new Error(`Move import source changed after preflight: ${blocked.map((entry) => entry.reason).join(", ")}`);
  }
  const executionFingerprint = movePreflightFingerprint({
    sourcePath: preflight.sourcePath,
    destinationRoot: preflight.destinationRoot,
    kind,
    ownership,
    files,
    directories,
  });
  if (executionFingerprint !== preflight.preflightFingerprint) {
    throw new Error("Move import source changed after preflight. Run preflight again before moving.");
  }
  const now = new Date().toISOString();
  const moveId = `move-${Date.now()}-${pathHash(`${preflight.sourcePath}-${now}`)}`;
  const metadataRoot = path.join(path.resolve(memoryRoot), "CONFIG", "move-imports", moveId);
  const ledgerPath = path.join(metadataRoot, "move-ledger.jsonl");
  const manifestPath = path.join(metadataRoot, "manifest.json");
  await mkdir(metadataRoot, { recursive: true });
  await mkdir(preflight.destinationRoot, { recursive: true });
  const manifest = {
    moveId,
    actor,
    startedAt: now,
    sourcePath: preflight.sourcePath,
    destinationRoot: preflight.destinationRoot,
    kind,
    ownership,
    importMode: "move-on-import",
    fileCount: files.length,
    directoryCount: directories.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    preflightFingerprint: preflight.preflightFingerprint,
    approvedPreflightFingerprint: String(expectedPreflightFingerprint),
    ledgerPath,
    status: "running",
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await writeFile(ledgerPath, "", { mode: 0o600 });

  const moved = [];
  const createdDirectories = [];
  const failed = [];
  for (const directory of directories) {
    const relativePath = path.relative(preflight.sourcePath, directory).replace(/\\/g, "/");
    const destination = path.join(preflight.destinationRoot, relativePath);
    ensureInside(destination, preflight.destinationRoot, "Move import directory destination escaped managed memory root.");
    const ledgerEntry = {
      moveId,
      at: new Date().toISOString(),
      action: "create-directory",
      sourcePath: directory,
      destinationPath: destination,
      relativePath,
      status: "created-directory",
    };
    await mkdir(destination, { recursive: true });
    createdDirectories.push(ledgerEntry);
    await appendFile(ledgerPath, `${JSON.stringify(ledgerEntry)}\n`, { mode: 0o600 });
  }
  for (const file of files) {
    const destination = path.join(preflight.destinationRoot, file.relativePath);
    ensureInside(destination, preflight.destinationRoot, "Move import destination escaped managed memory root.");
    await mkdir(path.dirname(destination), { recursive: true });
    const ledgerEntry = {
      moveId,
      at: new Date().toISOString(),
      action: "move-file",
      sourcePath: file.absolutePath,
      destinationPath: destination,
      relativePath: file.relativePath,
      size: file.size,
      beforeHash: file.contentHash,
      status: "pending",
    };
    try {
      if (typeof beforeMoveFileRead === "function") {
        await beforeMoveFileRead(file);
      }
      const currentHash = contentHash(await readFile(file.absolutePath));
      if (currentHash !== file.contentHash) {
        throw new Error(`Move import source bytes changed after preflight for ${file.relativePath}`);
      }
      ledgerEntry.moveMethod = await moveFile(file.absolutePath, destination, file.contentHash);
      ledgerEntry.afterHash = await verifiedFileHash(destination, file.contentHash, "Move import destination hash mismatch");
      ledgerEntry.status = "moved";
      moved.push(ledgerEntry);
    } catch (error) {
      ledgerEntry.status = "failed";
      ledgerEntry.error = error.message;
      failed.push(ledgerEntry);
      if (existsSync(destination) && existsSync(file.absolutePath)) {
        await rm(destination, { force: true }).catch(() => undefined);
      } else if (existsSync(destination) && !existsSync(file.absolutePath)) {
        const restore = await restoreMovedEntry(ledgerEntry);
        if (restore.restored) {
          ledgerEntry.failureRestore = "restored-source";
        } else {
          ledgerEntry.failureRestore = "skipped";
          ledgerEntry.failureRestoreReason = restore.skipped?.reason;
        }
      }
    }
    await appendFile(ledgerPath, `${JSON.stringify(ledgerEntry)}\n`, { mode: 0o600 });
    if (failed.length) break;
  }

  let automaticRollback = { restored: [], skipped: [] };
  let automaticDirectoryRollback = { restored: [], skipped: [] };
  let automaticRootRollback = { restored: false, skippedCleanup: null };
  let sourceCleanupStatus = "not-run";
  if (failed.length) {
    automaticRollback = await rollbackMovedEntries(moved);
    automaticDirectoryRollback = await rollbackCreatedDirectories(createdDirectories);
    automaticRootRollback = await rollbackMoveRoot(manifest);
    sourceCleanupStatus = "rolled-back";
  } else {
    if (typeof beforeSourceCleanup === "function") {
      await beforeSourceCleanup({ sourcePath: preflight.sourcePath, destinationRoot: preflight.destinationRoot });
    }
    sourceCleanupStatus = await cleanupMovedSourceRoot(preflight.sourcePath, directories);
  }

  const finishedAt = new Date().toISOString();
  const finalManifest = {
    ...manifest,
    finishedAt,
    movedCount: moved.length,
    createdDirectoryCount: createdDirectories.length,
    failedCount: failed.length,
    rollbackRestoredCount: automaticRollback.restored.length,
    rollbackSkippedCount: automaticRollback.skipped.length,
    rollbackRestoredDirectoryCount: automaticDirectoryRollback.restored.length,
    rollbackSkippedDirectoryCount: automaticDirectoryRollback.skipped.length,
    rollbackSourceRootRestored: automaticRootRollback.restored,
    rollbackSkippedRootCleanupCount: automaticRootRollback.skippedCleanup ? 1 : 0,
    sourceCleanupStatus,
    status: failed.length ? "partial-failure-rolled-back" : "moved",
  };
  await writeFile(manifestPath, `${JSON.stringify(finalManifest, null, 2)}\n`, { mode: 0o600 });
  return {
    ...finalManifest,
    ledgerPath,
    manifestPath,
    source: {
      path: preflight.destinationRoot,
      kind,
      ownership,
      importMode: "move-on-import",
      originalPath: preflight.sourcePath,
      moveId,
      manifestPath,
      ledgerPath,
    },
    failures: failed.map((entry) => ({ relativePath: entry.relativePath, error: entry.error })),
    automaticRollback,
    automaticDirectoryRollback,
    automaticRootRollback,
  };
}

export async function rollbackMoveImport({ ledgerPath, confirmation }) {
  const resolvedLedger = path.resolve(ledgerPath);
  if (!existsSync(resolvedLedger)) {
    throw new Error("Move import rollback ledger was not found.");
  }
  if (String(confirmation ?? "").trim() !== "ROLLBACK MOVE") {
    throw new Error("Move import rollback requires confirmation phrase: ROLLBACK MOVE");
  }
  const lines = (await readFile(resolvedLedger, "utf8")).split(/\r?\n/).filter(Boolean);
  const entries = lines.map((line) => JSON.parse(line));
  const moved = entries.filter((entry) => entry.status === "moved").reverse();
  const createdDirectories = entries.filter((entry) => entry.status === "created-directory");
  const restored = [];
  const skipped = [];
  for (const entry of moved) {
    const result = await restoreMovedEntry(entry);
    if (result.restored) {
      restored.push(result.restored);
    } else {
      skipped.push(result.skipped);
    }
  }
  const directoryRollback = await rollbackCreatedDirectories(createdDirectories);
  await cleanupEmptyDestinationDirs(moved);
  const rolledBackAt = new Date().toISOString();
  const rollbackReportPath = path.join(path.dirname(resolvedLedger), "rollback-report.json");
  const manifestPath = path.join(path.dirname(resolvedLedger), "manifest.json");
  let manifest = null;
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch {
      manifest = null;
    }
  }
  const rootRollback = await rollbackMoveRoot(manifest);
  const report = {
    rolledBackAt,
    ledgerPath: resolvedLedger,
    restoredCount: restored.length,
    skippedCount: skipped.length,
    restoredDirectoryCount: directoryRollback.restored.length,
    skippedDirectoryCount: directoryRollback.skipped.length,
    sourceRootRestored: rootRollback.restored,
    skippedRootCleanupCount: rootRollback.skippedCleanup ? 1 : 0,
    restored,
    skipped,
    restoredDirectories: directoryRollback.restored,
    skippedDirectories: directoryRollback.skipped,
    skippedRootCleanup: rootRollback.skippedCleanup,
  };
  await writeFile(rollbackReportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  if (manifest) {
    try {
      await writeFile(manifestPath, `${JSON.stringify({
        ...manifest,
        rollbackStatus: skipped.length || directoryRollback.skipped.length || rootRollback.skippedCleanup ? "partial" : "restored",
        rolledBackAt,
        rollbackReportPath,
        rollbackRestoredCount: restored.length,
        rollbackSkippedCount: skipped.length,
        rollbackRestoredDirectoryCount: directoryRollback.restored.length,
        rollbackSkippedDirectoryCount: directoryRollback.skipped.length,
        rollbackSourceRootRestored: rootRollback.restored,
        rollbackSkippedRootCleanupCount: rootRollback.skippedCleanup ? 1 : 0,
      }, null, 2)}\n`, { mode: 0o600 });
    } catch {
      // Rollback is the safety operation; a stale or corrupt manifest must not undo a successful restore.
    }
  }
  return report;
}
