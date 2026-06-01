import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export function sourceContentHash(content) {
  return createHash("sha256").update(String(content ?? ""), "utf8").digest("hex");
}

function normalizedContentHash(contentHash) {
  const normalized = String(contentHash ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error("Source snapshot requires a sha256 content hash.");
  }
  return normalized;
}

export function sourceFileSnapshotPath(contentHash) {
  const hash = normalizedContentHash(contentHash);
  return path.join("CONFIG", "source-file-history", "blobs", hash.slice(0, 2), `${hash}.txt`).replace(/\\/g, "/");
}

export async function writeSourceFileSnapshot({
  memoryRoot,
  contentHash,
  content,
}) {
  if (!memoryRoot) throw new Error("Source snapshot requires a memory root.");
  const snapshotPath = sourceFileSnapshotPath(contentHash);
  const absolutePath = path.join(memoryRoot, snapshotPath);
  if (existsSync(absolutePath)) {
    return {
      path: snapshotPath,
      bytes: Buffer.byteLength(String(content ?? ""), "utf8"),
      contentHash: normalizedContentHash(contentHash),
      reused: true,
    };
  }
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const tempPath = path.join(path.dirname(absolutePath), `.${path.basename(absolutePath)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, String(content ?? ""), { mode: 0o600 });
  await chmod(tempPath, 0o600).catch(() => undefined);
  await rename(tempPath, absolutePath);
  await chmod(absolutePath, 0o600).catch(() => undefined);
  return {
    path: snapshotPath,
    bytes: Buffer.byteLength(String(content ?? ""), "utf8"),
    contentHash: normalizedContentHash(contentHash),
    reused: false,
  };
}

function sourceFileKey(sourceId, relativeFile) {
  return `${String(sourceId ?? "").trim()}::${String(relativeFile ?? "").replace(/\\/g, "/")}`;
}

async function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    return { version: 1, files: {} };
  }
  const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  return {
    version: 1,
    ...parsed,
    files: parsed && typeof parsed.files === "object" && parsed.files ? parsed.files : {},
  };
}

async function writeManifest(manifestPath, manifest) {
  const directory = path.dirname(manifestPath);
  await mkdir(directory, { recursive: true });
  const tempPath = path.join(directory, `.${path.basename(manifestPath)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await chmod(tempPath, 0o600).catch(() => undefined);
  await rename(tempPath, manifestPath);
  await chmod(manifestPath, 0o600).catch(() => undefined);
}

export async function listSourceFileVersions({ manifestPath, sourceId = "", limit = 100 } = {}) {
  if (!manifestPath) throw new Error("Source file version listing requires a manifest path.");
  const manifest = await readManifest(manifestPath);
  const normalizedSourceId = String(sourceId ?? "").trim();
  const entries = Object.values(manifest.files ?? {})
    .filter((entry) => !normalizedSourceId || entry.sourceId === normalizedSourceId)
    .map((entry) => ({
      sourceId: entry.sourceId,
      sourceFile: entry.sourceFile,
      latestHash: entry.latestHash,
      latestVersion: entry.latestVersion,
      latestIntakePath: entry.latestIntakePath ?? "",
      latestSnapshotPath: entry.latestSnapshotPath ?? "",
      latestModifiedAt: entry.latestModifiedAt,
      updatedAt: entry.updatedAt,
      history: Array.isArray(entry.history) ? entry.history : [],
    }))
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
  return {
    manifestVersion: manifest.version ?? 1,
    updatedAt: manifest.updatedAt ?? "",
    entries: entries.slice(0, Math.max(1, Math.min(10_000, Number(limit ?? 100)))),
  };
}

export async function reserveSourceFileVersion({
  manifestPath,
  sourceId,
  relativeFile,
  contentHash,
  sourceModifiedAt,
  now = new Date().toISOString(),
}) {
  if (!manifestPath) throw new Error("Source file versioning requires a manifest path.");
  if (!sourceId) throw new Error("Source file versioning requires a source id.");
  if (!relativeFile) throw new Error("Source file versioning requires a relative source file.");
  if (!contentHash) throw new Error("Source file versioning requires a content hash.");

  const manifest = await readManifest(manifestPath);
  const key = sourceFileKey(sourceId, relativeFile);
  const previous = manifest.files[key] ?? null;
  if (previous?.latestHash === contentHash) {
    return {
      changed: false,
      version: previous.latestVersion ?? 1,
      contentHash,
      previousHash: previous.latestHash,
      previousVersion: previous.latestVersion ?? 1,
    };
  }

  const version = Number(previous?.latestVersion ?? 0) + 1;
  const entry = {
    sourceId,
    sourceFile: String(relativeFile).replace(/\\/g, "/"),
    latestHash: contentHash,
    latestVersion: version,
    latestModifiedAt: sourceModifiedAt || "",
    updatedAt: now,
    history: [
      ...(Array.isArray(previous?.history) ? previous.history : []),
      {
        version,
        contentHash,
        previousHash: previous?.latestHash ?? "",
        sourceModifiedAt: sourceModifiedAt || "",
        intakePath: "",
        recordedAt: now,
      },
    ].slice(-100),
  };

  manifest.files[key] = entry;
  manifest.updatedAt = now;
  await writeManifest(manifestPath, manifest);

  return {
    changed: true,
    version,
    contentHash,
    previousHash: previous?.latestHash ?? "",
    previousVersion: previous?.latestVersion ?? 0,
  };
}

export async function rollbackSourceFileVersionReservation({
  manifestPath,
  sourceId,
  relativeFile,
  version,
  contentHash,
  now = new Date().toISOString(),
}) {
  if (!manifestPath) throw new Error("Source file version rollback requires a manifest path.");
  if (!sourceId) throw new Error("Source file version rollback requires a source id.");
  if (!relativeFile) throw new Error("Source file version rollback requires a relative source file.");
  const manifest = await readManifest(manifestPath);
  const key = sourceFileKey(sourceId, relativeFile);
  const entry = manifest.files[key];
  if (!entry || Number(entry.latestVersion ?? 0) !== Number(version ?? 0) || entry.latestHash !== contentHash) {
    return { rolledBack: false, reason: "reservation-not-current" };
  }
  const history = Array.isArray(entry.history) ? entry.history : [];
  const latestHistory = history[history.length - 1];
  if (Number(latestHistory?.version ?? 0) !== Number(version ?? 0) || latestHistory?.intakePath) {
    return { rolledBack: false, reason: "reservation-already-finalized" };
  }
  const previousHistory = history.slice(0, -1);
  const previous = previousHistory[previousHistory.length - 1];
  if (!previous) {
    delete manifest.files[key];
  } else {
    manifest.files[key] = {
      sourceId: entry.sourceId,
      sourceFile: entry.sourceFile,
      latestHash: previous.contentHash,
      latestVersion: Number(previous.version ?? 1),
      latestModifiedAt: previous.sourceModifiedAt || "",
      latestIntakePath: previous.intakePath || "",
      latestSnapshotPath: previous.snapshotPath || "",
      updatedAt: now,
      history: previousHistory,
    };
  }
  manifest.updatedAt = now;
  await writeManifest(manifestPath, manifest);
  return {
    rolledBack: true,
    sourceId,
    sourceFile: String(relativeFile).replace(/\\/g, "/"),
    restoredVersion: previous ? Number(previous.version ?? 1) : 0,
  };
}

export async function recordSourceFileIntakeArtifact({
  manifestPath,
  sourceId,
  relativeFile,
  version,
  intakePath,
  snapshotPath = "",
  now = new Date().toISOString(),
}) {
  if (!manifestPath) throw new Error("Source file artifact recording requires a manifest path.");
  if (!sourceId) throw new Error("Source file artifact recording requires a source id.");
  if (!relativeFile) throw new Error("Source file artifact recording requires a relative source file.");
  if (!intakePath) throw new Error("Source file artifact recording requires an intake path.");
  const manifest = await readManifest(manifestPath);
  const key = sourceFileKey(sourceId, relativeFile);
  const entry = manifest.files[key];
  if (!entry) {
    throw new Error("Source file version entry was not found.");
  }
  const numericVersion = Number(version ?? entry.latestVersion ?? 0);
  if (numericVersion !== Number(entry.latestVersion ?? 0)) {
    throw new Error("Source file artifact recording must target the latest reserved source version.");
  }
  const history = Array.isArray(entry.history) ? entry.history : [];
  if (!history.some((historyEntry) => Number(historyEntry.version) === numericVersion)) {
    throw new Error("Source file artifact recording target version is missing from history.");
  }
  entry.latestIntakePath = String(intakePath).replace(/\\/g, "/");
  entry.latestSnapshotPath = snapshotPath ? String(snapshotPath).replace(/\\/g, "/") : entry.latestSnapshotPath ?? "";
  entry.updatedAt = now;
  entry.history = history.map((historyEntry) =>
    Number(historyEntry.version) === numericVersion
      ? { ...historyEntry, intakePath: entry.latestIntakePath, snapshotPath: entry.latestSnapshotPath }
      : historyEntry
  );
  manifest.files[key] = entry;
  manifest.updatedAt = now;
  await writeManifest(manifestPath, manifest);
  return {
    sourceId: entry.sourceId,
    sourceFile: entry.sourceFile,
    latestVersion: entry.latestVersion,
    latestIntakePath: entry.latestIntakePath,
    latestSnapshotPath: entry.latestSnapshotPath,
  };
}

export function lineDiffSummary(previousContent, currentContent, { limit = 80 } = {}) {
  const previous = String(previousContent ?? "").split(/\r?\n/);
  const current = String(currentContent ?? "").split(/\r?\n/);
  const maxLines = Math.max(previous.length, current.length);
  const changes = [];
  for (let index = 0; index < maxLines; index += 1) {
    const before = previous[index] ?? "";
    const after = current[index] ?? "";
    if (before === after) continue;
    if (before) {
      changes.push({ type: "removed", line: index + 1, text: before });
    }
    if (after) {
      changes.push({ type: "added", line: index + 1, text: after });
    }
    if (changes.length >= limit) break;
  }
  return {
    changed: changes.length > 0 || previous.length !== current.length,
    previousLines: previous.length,
    currentLines: current.length,
    truncated: changes.length >= limit,
    changes,
  };
}
