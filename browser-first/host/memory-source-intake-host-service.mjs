import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { computeWikiHealth } from "./memory-wiki-health.mjs";
import { runWikiLint } from "./memory-wiki-lint.mjs";
import { searchMemoryWiki } from "./memory-search.mjs";
import {
  markdownBody,
  markdownSection,
  markdownTitle,
  safeMemoryRelativePathForRoot,
} from "./archive-review-host-service.mjs";
import {
  lineDiffSummary,
  listSourceFileVersions,
  recordSourceFileIntakeArtifact,
  reserveSourceFileVersion,
  rollbackSourceFileVersionReservation,
  sourceContentHash,
  writeSourceFileSnapshot,
} from "./memory-source-versioning.mjs";
import {
  assertResolvedSourceFileInsideSource,
  assertSourceRootDirectory,
  normalizeSourceRelativeFile,
  resolveSourceRelativeFile,
} from "./memory-source-paths.mjs";

const sourceFileIntakeLimit = 200;
const textSourceExtensions = new Set([".md", ".markdown", ".txt", ".csv", ".json"]);

function requireDependency(dependencies, name) {
  const value = dependencies[name];
  if (typeof value !== "function") {
    throw new Error(`Memory source intake host service missing dependency: ${name}`);
  }
  return value;
}

function sourceReviewEligibleFiles(review) {
  return (review.candidates ?? [])
    .filter((candidate) =>
      candidate.category === "compatible" &&
      ["new", "changed"].includes(candidate.versionStatus)
    )
    .map((candidate) => candidate.path);
}

export function createMemorySourceIntakeHostService(dependencies = {}) {
  const appendMemorySourceAudit = requireDependency(dependencies, "appendMemorySourceAudit");
  const appendMemorySourceRepairHistory = requireDependency(dependencies, "appendMemorySourceRepairHistory");
  const appendMemorySourceSyncHistory = requireDependency(dependencies, "appendMemorySourceSyncHistory");
  const classifyMemorySourceFile = requireDependency(dependencies, "classifyMemorySourceFile");
  const executeArchiveReviewRequest = requireDependency(dependencies, "executeArchiveReviewRequest");
  const executeMemorySourceScan = requireDependency(dependencies, "executeMemorySourceScan");
  const expandUserPath = requireDependency(dependencies, "expandUserPath");
  const listFilesRecursive = requireDependency(dependencies, "listFilesRecursive");
  const memoryRoot = requireDependency(dependencies, "memoryRoot");
  const memorySourceFileManifestPath = requireDependency(dependencies, "memorySourceFileManifestPath");
  const readMemorySettings = requireDependency(dependencies, "readMemorySettings");
  const redactDiagnosticText = requireDependency(dependencies, "redactDiagnosticText");
  const safeFileSlug = requireDependency(dependencies, "safeFileSlug");

  function safeMemoryRelativePath(relativePath, requiredPrefix = "INTAKE") {
    return safeMemoryRelativePathForRoot(memoryRoot(), relativePath, requiredPrefix);
  }

  async function sourceReviewSnapshot(source, limit = 2_000) {
    const sourcePath = expandUserPath(source.path);
    if (source.disabledAt) {
      throw new Error("Memory source is disabled. Re-enable it before review.");
    }
    if (!existsSync(sourcePath)) {
      throw new Error("Memory source path does not exist.");
    }
    const details = await stat(sourcePath);
    if (!details.isDirectory()) {
      throw new Error("Memory source path must be a folder.");
    }
    const scan = await executeMemorySourceScan({ path: sourcePath, limit });
    const files = await listFilesRecursive(sourcePath, () => true, Math.min(200, limit));
    let versionManifestError = "";
    const versionEntries = await listSourceFileVersions({
      manifestPath: memorySourceFileManifestPath(),
      sourceId: source.id,
      limit: 500,
    }).catch((error) => {
      versionManifestError = error instanceof Error ? error.message : String(error);
      return { entries: [] };
    });
    const versionByFile = new Map((versionEntries.entries ?? []).map((entry) => [entry.sourceFile, entry]));
    const candidates = [];
    for (const filePath of files) {
      const category = classifyMemorySourceFile(filePath, sourcePath);
      if (!["compatible", "processed", "raw-audio"].includes(category)) {
        continue;
      }
      const fileDetails = await stat(filePath).catch(() => null);
      const relativePath = path.relative(sourcePath, filePath).replace(/\\/g, "/");
      const existingVersion = versionByFile.get(relativePath);
      let versionStatus = existingVersion ? "tracked" : "new";
      let currentHash = "";
      const extension = path.extname(filePath).toLowerCase();
      if (versionManifestError && category === "compatible") {
        versionStatus = "version-manifest-unavailable";
      } else if (category === "compatible" && textSourceExtensions.has(extension)) {
        const content = await readFile(filePath, "utf8").catch(() => "");
        currentHash = sourceContentHash(content);
        versionStatus = !existingVersion
          ? "new"
          : existingVersion.latestHash === currentHash
            ? "unchanged"
            : "changed";
      } else if (existingVersion) {
        versionStatus = "tracked";
      }
      candidates.push({
        path: relativePath,
        category,
        bytes: fileDetails?.size ?? 0,
        modifiedAt: fileDetails?.mtime?.toISOString?.() ?? "",
        versionStatus,
        sourceVersion: existingVersion?.latestVersion ?? 0,
        currentHash,
        previousSourceContentHash: existingVersion?.latestHash ?? "",
        error: versionManifestError && category === "compatible" ? versionManifestError : "",
      });
      if (candidates.length >= 25) {
        break;
      }
    }
    return {
      source: {
        id: source.id,
        path: source.path,
        kind: source.kind,
        ownership: source.ownership,
        importMode: source.importMode,
        exists: true,
      },
      scan,
      candidates,
      versionManifestError,
      boundary: "Source review is read-only. Creating intake writes only to ResonantOS Memory/INTAKE and never mutates the source folder.",
    };
  }

  async function executeMemorySourceReview(payload = {}) {
    const sourceId = String(payload.sourceId ?? "").trim();
    if (!sourceId) {
      throw new Error("Memory source review requires a source id.");
    }
    const settings = await readMemorySettings();
    const source = settings.sources.find((entry) => entry.id === sourceId);
    if (!source) {
      throw new Error("Memory source was not found.");
    }
    return sourceReviewSnapshot(source, Math.max(10, Math.min(5_000, Number(payload.limit ?? 2_000))));
  }

  async function executeMemorySourceIntake(payload = {}) {
    const sourceId = String(payload.sourceId ?? "").trim();
    if (!sourceId) {
      throw new Error("Memory source intake requires a source id.");
    }
    const settings = await readMemorySettings();
    const source = settings.sources.find((entry) => entry.id === sourceId);
    if (!source) {
      throw new Error("Memory source was not found.");
    }
    const review = await sourceReviewSnapshot(source, 2_000);
    const now = new Date();
    const sourceName = path.basename(expandUserPath(source.path)) || "source";
    const intakeDir = path.join(memoryRoot(), "INTAKE", "sources");
    await mkdir(intakeDir, { recursive: true });
    const fileName = `${now.toISOString().replace(/[:.]/g, "-")}-${safeFileSlug(sourceName)}-source-review.md`;
    const filePath = path.join(intakeDir, fileName);
    const categoryLines = Object.entries(review.scan.categories ?? {})
      .map(([category, count]) => `- ${category}: ${count}`)
      .join("\n");
    const candidateLines = review.candidates.length
      ? review.candidates.map((candidate) =>
          `- ${candidate.category} | ${candidate.path} | ${candidate.bytes} bytes | ${candidate.modifiedAt || "unknown modified time"}`
        ).join("\n")
      : "- No directly compatible candidates found.";
    const body = [
      "---",
      `source: ${JSON.stringify("resonantos-browser-first")}`,
      `actor: ${JSON.stringify("living-archive.source-review")}`,
      `type: ${JSON.stringify("source-review-intake")}`,
      `title: ${JSON.stringify(`Source Review: ${sourceName}`)}`,
      `createdAt: ${JSON.stringify(now.toISOString())}`,
      `sourceId: ${JSON.stringify(source.id)}`,
      `sourceKind: ${JSON.stringify(source.kind)}`,
      `ownership: ${JSON.stringify(source.ownership)}`,
      `importMode: ${JSON.stringify(source.importMode)}`,
      "---",
      "",
      `# Source Review: ${sourceName}`,
      "",
      "## Boundary",
      review.boundary,
      "",
      "## Source",
      `- path: ${source.path}`,
      `- kind: ${source.kind}`,
      `- ownership: ${source.ownership}`,
      `- import mode: ${source.importMode}`,
      "",
      "## Scan Summary",
      `- total scanned: ${review.scan.totalScanned}`,
      `- limit reached: ${review.scan.limitReached ? "yes" : "no"}`,
      categoryLines,
      "",
      "## Recommendation",
      review.scan.recommendation,
      "",
      "## Intake Candidates",
      candidateLines,
      "",
      "## Next Step",
      "Create a review request from this intake artifact before any AI Memory wiki promotion.",
      "",
    ].join("\n");
    await writeFile(filePath, body, { mode: 0o600 });
    await chmod(filePath, 0o600).catch(() => undefined);
    await appendMemorySourceAudit("intake", source, {
      reason: `Created governed source review intake ${path.relative(memoryRoot(), filePath)}`,
    });
    return {
      path: path.relative(memoryRoot(), filePath),
      bytes: Buffer.byteLength(body, "utf8"),
      sourceId,
      candidates: review.candidates.length,
      recommendation: review.scan.recommendation,
    };
  }

  async function executeMemorySourceFileIntake(payload = {}) {
    const sourceId = String(payload.sourceId ?? "").trim();
    const requestedFiles = Array.isArray(payload.files)
      ? payload.files.map((file) => String(file ?? "").replace(/\\/g, "/").trim()).filter(Boolean)
      : [];
    const invalidRequestedFiles = [];
    const normalizedRequestedFiles = [];
    for (const requestedFile of requestedFiles) {
      try {
        normalizedRequestedFiles.push(normalizeSourceRelativeFile(requestedFile));
      } catch (error) {
        invalidRequestedFiles.push({
          sourceFile: requestedFile,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const uniqueFiles = [...new Set(normalizedRequestedFiles)];
    const duplicateFiles = normalizedRequestedFiles.filter((file, index) => normalizedRequestedFiles.indexOf(file) !== index);
    const selectedFiles = uniqueFiles.slice(0, sourceFileIntakeLimit);
    if (!sourceId) {
      throw new Error("Selected file intake requires a source id.");
    }
    if (!requestedFiles.length) {
      throw new Error("Select at least one source file for intake.");
    }
    const settings = await readMemorySettings();
    const source = settings.sources.find((entry) => entry.id === sourceId);
    if (!source) {
      throw new Error("Memory source was not found.");
    }
    if (source.disabledAt) {
      throw new Error("Memory source is disabled. Re-enable it before intake.");
    }
    const sourcePath = expandUserPath(source.path);
    await assertSourceRootDirectory(sourcePath);
    const intakeDir = path.join(memoryRoot(), "INTAKE", "sources", safeFileSlug(path.basename(sourcePath) || sourceId));
    await mkdir(intakeDir, { recursive: true });
    const fixedNow = process.env.RESONANTOS_BROWSER_FIRST_FILE_INTAKE_FIXED_NOW;
    const now = fixedNow ? new Date(fixedNow) : new Date();
    if (Number.isNaN(now.valueOf())) {
      throw new Error("Invalid fixed source file intake timestamp.");
    }
    const created = [];
    const rejected = [
      ...invalidRequestedFiles,
      ...duplicateFiles.map((sourceFile) => ({
        sourceFile,
        reason: "duplicate request entry ignored",
      })),
      ...uniqueFiles.slice(sourceFileIntakeLimit).map((sourceFile) => ({
        sourceFile,
        reason: `batch limit ${sourceFileIntakeLimit} reached; run another intake batch for remaining files`,
      })),
    ];
    for (const relativeFile of selectedFiles) {
      try {
        const normalizedRelativeFile = relativeFile;
        const sourceFile = resolveSourceRelativeFile(sourcePath, normalizedRelativeFile);
        if (!existsSync(sourceFile)) {
          throw new Error("file missing");
        }
        await assertResolvedSourceFileInsideSource(sourcePath, sourceFile);
        const category = classifyMemorySourceFile(sourceFile, sourcePath);
        if (category !== "compatible") {
          throw new Error(`unsupported category ${category}`);
        }
        const extension = path.extname(sourceFile).toLowerCase();
        if (!textSourceExtensions.has(extension)) {
          throw new Error(`file type ${extension || "unknown"} requires a specialized add-on`);
        }
        const [details, sourceContent] = await Promise.all([
          stat(sourceFile),
          readFile(sourceFile, "utf8"),
        ]);
        const contentHash = sourceContentHash(sourceContent);
        const version = await reserveSourceFileVersion({
          manifestPath: memorySourceFileManifestPath(),
          sourceId: source.id,
          relativeFile: normalizedRelativeFile,
          contentHash,
          sourceModifiedAt: details.mtime.toISOString(),
        });
        if (!version.changed) {
          throw new Error(`unchanged since imported version ${version.version}`);
        }
        const title = markdownTitle(sourceContent, path.basename(sourceFile, path.extname(sourceFile)));
        const intakeFile = `${now.toISOString().replace(/[:.]/g, "-")}-${safeFileSlug(normalizedRelativeFile)}.md`;
        const intakePath = path.join(intakeDir, intakeFile);
        const body = [
          "---",
          `source: ${JSON.stringify("resonantos-browser-first")}`,
          `actor: ${JSON.stringify("living-archive.source-file-intake")}`,
          `type: ${JSON.stringify("source-file-intake")}`,
          `title: ${JSON.stringify(title)}`,
          `createdAt: ${JSON.stringify(now.toISOString())}`,
          `sourceId: ${JSON.stringify(source.id)}`,
          `sourcePath: ${JSON.stringify(source.path)}`,
          `sourceFile: ${JSON.stringify(normalizedRelativeFile)}`,
          `ownership: ${JSON.stringify(source.ownership)}`,
          `importMode: ${JSON.stringify(source.importMode)}`,
          `sourceModifiedAt: ${JSON.stringify(details.mtime.toISOString())}`,
          `sourceContentHash: ${JSON.stringify(version.contentHash)}`,
          `sourceVersion: ${JSON.stringify(version.version)}`,
          `previousSourceContentHash: ${JSON.stringify(version.previousHash)}`,
          "---",
          "",
          `# ${title}`,
          "",
          "## Boundary",
          "This intake artifact is a governed copy of a selected source file. The original source file was not modified.",
          "",
          "## Source File",
          `- source: ${source.path}`,
          `- file: ${normalizedRelativeFile}`,
          `- bytes: ${details.size}`,
          "",
          "## Content",
          sourceContent.trim() || "_Source file was empty._",
          "",
        ].join("\n");
        const relativeIntakePath = path.relative(memoryRoot(), intakePath);
        try {
          await writeFile(intakePath, body, { mode: 0o600 });
          await chmod(intakePath, 0o600).catch(() => undefined);
          const snapshot = await writeSourceFileSnapshot({
            memoryRoot: memoryRoot(),
            contentHash: version.contentHash,
            content: sourceContent,
          });
          await recordSourceFileIntakeArtifact({
            manifestPath: memorySourceFileManifestPath(),
            sourceId: source.id,
            relativeFile: normalizedRelativeFile,
            version: version.version,
            intakePath: relativeIntakePath,
            snapshotPath: snapshot.path,
          });
        } catch (error) {
          await rm(intakePath, { force: true }).catch(() => undefined);
          await rollbackSourceFileVersionReservation({
            manifestPath: memorySourceFileManifestPath(),
            sourceId: source.id,
            relativeFile: normalizedRelativeFile,
            version: version.version,
            contentHash: version.contentHash,
          }).catch(() => undefined);
          throw error;
        }
        created.push({
          path: relativeIntakePath,
          sourceFile: normalizedRelativeFile,
          bytes: Buffer.byteLength(body, "utf8"),
          title,
          sourceContentHash: version.contentHash,
          sourceVersion: version.version,
          previousSourceContentHash: version.previousHash,
        });
      } catch (error) {
        rejected.push({
          sourceFile: String(relativeFile ?? ""),
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!created.length) {
      throw new Error(`No selected source files could be imported. ${rejected.map((entry) => `${entry.sourceFile}: ${entry.reason}`).join("; ")}`);
    }
    await appendMemorySourceAudit("file_intake", source, {
      reason: `Created ${created.length} selected source file intake artifact(s). ${rejected.length} rejected.`,
    });
    return {
      sourceId,
      created,
      rejected,
    };
  }

  async function executeMemorySourceSync(payload = {}) {
    const startedAt = new Date().toISOString();
    const settings = await readMemorySettings();
    const requestedSourceIds = Array.isArray(payload.sourceIds)
      ? new Set(payload.sourceIds.map((sourceId) => String(sourceId ?? "").trim()).filter(Boolean))
      : null;
    const limit = Math.max(10, Math.min(5_000, Number(payload.limit ?? 2_000)));
    const maxFilesPerSource = Math.max(1, Math.min(sourceFileIntakeLimit, Number(payload.maxFilesPerSource ?? sourceFileIntakeLimit)));
    const shouldAutoIntake = settings.autoSync === true && settings.syncMode === "auto-intake-review";
    const syncMode = settings.syncMode ?? "manual-review";
    const result = {
      id: `sync-${randomUUID()}`,
      startedAt,
      finishedAt: "",
      mode: syncMode,
      autoSync: settings.autoSync === true,
      autoIntake: shouldAutoIntake,
      status: syncMode === "paused" ? "paused" : shouldAutoIntake ? "intake-created" : "review-only",
      reviewedSources: 0,
      eligibleFiles: 0,
      createdArtifacts: 0,
      reviewRequests: 0,
      rejectedFiles: 0,
      skippedSources: [],
      sources: [],
    };
    if (syncMode === "paused") {
      result.finishedAt = new Date().toISOString();
      const historyEntry = await appendMemorySourceSyncHistory(result);
      return { ...result, historyEntry };
    }
    for (const source of settings.sources ?? []) {
      if (requestedSourceIds && !requestedSourceIds.has(source.id)) {
        continue;
      }
      if (source.disabledAt) {
        result.skippedSources.push({ sourceId: source.id, path: source.path, reason: "source disabled" });
        continue;
      }
      if (!existsSync(expandUserPath(source.path))) {
        result.skippedSources.push({ sourceId: source.id, path: source.path, reason: "source missing" });
        continue;
      }
      try {
        const review = await sourceReviewSnapshot(source, limit);
        const eligibleFiles = sourceReviewEligibleFiles(review);
        const sourceResult = {
          sourceId: source.id,
          path: source.path,
          candidates: review.candidates.length,
          eligibleFiles: eligibleFiles.length,
          createdArtifacts: 0,
          reviewRequests: 0,
          rejectedFiles: 0,
          status: shouldAutoIntake && eligibleFiles.length ? "intake-created" : "reviewed",
          eligibleFileSamples: eligibleFiles.slice(0, 10),
          createdArtifactSamples: [],
          rejectedFileSamples: [],
        };
        result.reviewedSources += 1;
        result.eligibleFiles += eligibleFiles.length;
        if (shouldAutoIntake && eligibleFiles.length) {
          const intake = await executeMemorySourceFileIntake({
            sourceId: source.id,
            files: eligibleFiles.slice(0, maxFilesPerSource),
          });
          sourceResult.createdArtifacts = intake.created.length;
          sourceResult.rejectedFiles = intake.rejected.length;
          sourceResult.createdArtifactSamples = intake.created.slice(0, 10).map((created) => ({
            sourceFile: created.sourceFile,
            path: created.path,
          }));
          sourceResult.rejectedFileSamples = intake.rejected.slice(0, 10).map((rejected) => ({
            sourceFile: rejected.sourceFile,
            reason: rejected.reason,
          }));
          result.createdArtifacts += intake.created.length;
          result.rejectedFiles += intake.rejected.length;
          for (const created of intake.created) {
            await executeArchiveReviewRequest({
              path: created.path,
              reason: `Auto-sync review request for source file ${created.sourceFile}.`,
            });
            sourceResult.reviewRequests += 1;
            result.reviewRequests += 1;
          }
        }
        result.sources.push(sourceResult);
      } catch (error) {
        result.skippedSources.push({
          sourceId: source.id,
          path: source.path,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await appendMemorySourceAudit("sync", { path: "all configured sources", kind: "folder", ownership: "mixed-library", importMode: "sync" }, {
      reason: shouldAutoIntake
        ? `Auto-sync created ${result.createdArtifacts} intake artifact(s) and ${result.reviewRequests} review request(s).`
        : `Sync reviewed ${result.reviewedSources} source(s) and found ${result.eligibleFiles} eligible file(s).`,
    });
    result.finishedAt = new Date().toISOString();
    const historyEntry = await appendMemorySourceSyncHistory(result);
    return { ...result, historyEntry };
  }

  async function executeMemorySearch(payload) {
    return searchMemoryWiki({
      memoryRoot: memoryRoot(),
      query: payload.query,
      limit: payload.limit,
    });
  }

  async function executeMemoryWikiHealth() {
    return computeWikiHealth({
      wikiRoot: path.join(memoryRoot(), "AI_MEMORY", "wiki"),
    });
  }

  async function executeMemoryWikiLint(payload = {}) {
    return runWikiLint({
      memoryRoot: memoryRoot(),
      actor: "resonantos-browser-first",
      reason: String(payload.reason ?? "manual wiki lint").trim() || "manual wiki lint",
    });
  }

  async function executeMemorySourceVersions(payload = {}) {
    return listSourceFileVersions({
      manifestPath: memorySourceFileManifestPath(),
      sourceId: String(payload.sourceId ?? "").trim(),
      limit: Number(payload.limit ?? 100),
    });
  }

  async function executeMemorySourceVersionsRepair(payload = {}) {
    const sourceId = String(payload.sourceId ?? "").trim();
    const confirmation = String(payload.confirmation ?? "").trim();
    if (!sourceId) {
      throw new Error("Source version repair requires a source id.");
    }
    if (confirmation !== "REPAIR SOURCE VERSIONS") {
      throw new Error("Source version repair requires confirmation phrase: REPAIR SOURCE VERSIONS");
    }
    const settings = await readMemorySettings();
    const source = settings.sources.find((entry) => entry.id === sourceId);
    if (!source) {
      throw new Error("Memory source was not found.");
    }
    const manifestPath = memorySourceFileManifestPath();
    if (!existsSync(manifestPath)) {
      return {
        status: "not-needed",
        sourceId,
        message: "Source version manifest does not exist yet.",
      };
    }
    const manifestContent = await readFile(manifestPath, "utf8");
    try {
      JSON.parse(manifestContent);
      return {
        status: "healthy",
        sourceId,
        message: "Source version manifest is readable; no repair was applied.",
      };
    } catch (error) {
      const now = new Date().toISOString();
      const backupRelativePath = path.join(
        "CONFIG",
        "source-file-history",
        "repairs",
        `${now.replace(/[:.]/g, "-")}-source-file-versions.json`,
      ).replace(/\\/g, "/");
      const backupPath = path.join(memoryRoot(), backupRelativePath);
      await mkdir(path.dirname(backupPath), { recursive: true });
      await writeFile(backupPath, manifestContent, { mode: 0o600 });
      await chmod(backupPath, 0o600).catch(() => undefined);
      const repairedManifest = {
        version: 1,
        updatedAt: now,
        repairedAt: now,
        repairedSourceId: sourceId,
        repairedReason: redactDiagnosticText(error instanceof Error ? error.message : String(error)),
        backupPath: backupRelativePath,
        files: {},
      };
      await writeFile(manifestPath, `${JSON.stringify(repairedManifest, null, 2)}\n`, { mode: 0o600 });
      await chmod(manifestPath, 0o600).catch(() => undefined);
      await appendMemorySourceAudit("version_repair", source, {
        reason: `Backed up unreadable source version manifest to ${backupRelativePath} and reset tracking.`,
      });
      const repairHistoryEntry = await appendMemorySourceRepairHistory({
        id: `repair-${randomUUID()}`,
        sourceId,
        sourcePath: source.path,
        status: "repaired",
        repairedAt: now,
        backupPath: backupRelativePath,
        reason: error instanceof Error ? error.message : String(error),
        message: "Unreadable source version manifest was backed up and reset.",
      });
      return {
        status: "repaired",
        sourceId,
        backupPath: backupRelativePath,
        repairedAt: now,
        repairHistoryEntry,
        message: "Unreadable source version manifest was backed up and reset. Review the source again before intake.",
      };
    }
  }

  async function executeMemorySourceDiff(payload = {}) {
    const sourceId = String(payload.sourceId ?? "").trim();
    const relativeFile = String(payload.file ?? "").replace(/\\/g, "/").trim();
    if (!sourceId) {
      throw new Error("Source diff requires a source id.");
    }
    if (!relativeFile) {
      throw new Error("Source diff requires a source file.");
    }
    const settings = await readMemorySettings();
    const source = settings.sources.find((entry) => entry.id === sourceId);
    if (!source) {
      throw new Error("Memory source was not found.");
    }
    if (source.disabledAt) {
      throw new Error("Memory source is disabled. Re-enable it before diff preview.");
    }
    const sourcePath = expandUserPath(source.path);
    await assertSourceRootDirectory(sourcePath);
    const normalizedRelativeFile = normalizeSourceRelativeFile(relativeFile);
    const sourceFile = resolveSourceRelativeFile(sourcePath, normalizedRelativeFile);
    if (!existsSync(sourceFile)) {
      throw new Error("Source file does not exist.");
    }
    await assertResolvedSourceFileInsideSource(sourcePath, sourceFile);
    const category = classifyMemorySourceFile(sourceFile, sourcePath);
    const extension = path.extname(sourceFile).toLowerCase();
    if (category !== "compatible" || !textSourceExtensions.has(extension)) {
      throw new Error("Source diff only supports compatible text source files.");
    }
    const versions = await listSourceFileVersions({
      manifestPath: memorySourceFileManifestPath(),
      sourceId,
      limit: 500,
    });
    const versionEntry = versions.entries.find((entry) => entry.sourceFile === normalizedRelativeFile);
    if (!versionEntry?.latestIntakePath && !versionEntry?.latestSnapshotPath) {
      return {
        sourceId,
        sourceFile: normalizedRelativeFile,
        status: "unavailable",
        reason: "No previous governed intake artifact is recorded for this source file.",
        changes: [],
      };
    }
    const previousFile = versionEntry.latestSnapshotPath
      ? safeMemoryRelativePath(versionEntry.latestSnapshotPath, "CONFIG/source-file-history")
      : safeMemoryRelativePath(versionEntry.latestIntakePath, "INTAKE");
    const [currentContent, previousStoredContent] = await Promise.all([
      readFile(sourceFile, "utf8"),
      readFile(previousFile, "utf8"),
    ]);
    const previousContent = versionEntry.latestSnapshotPath
      ? previousStoredContent
      : markdownSection(previousStoredContent, "Content") || markdownBody(previousStoredContent);
    const diff = lineDiffSummary(previousContent.trimEnd(), currentContent.trimEnd(), {
      limit: Math.max(10, Math.min(200, Number(payload.limit ?? 80))),
    });
    const currentHash = sourceContentHash(currentContent);
    return {
      sourceId,
      sourceFile: normalizedRelativeFile,
      status: currentHash === versionEntry.latestHash ? "unchanged" : "changed",
      latestVersion: versionEntry.latestVersion,
      latestIntakePath: versionEntry.latestIntakePath,
      latestSnapshotPath: versionEntry.latestSnapshotPath ?? "",
      previousHash: versionEntry.latestHash,
      currentHash,
      ...diff,
    };
  }

  return {
    executeMemorySourceReview,
    executeMemorySourceIntake,
    executeMemorySourceFileIntake,
    executeMemorySourceSync,
    executeMemorySearch,
    executeMemoryWikiHealth,
    executeMemoryWikiLint,
    executeMemorySourceVersions,
    executeMemorySourceVersionsRepair,
    executeMemorySourceDiff,
  };
}
