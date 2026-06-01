import { existsSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertPromotionCanRestore } from "./archive-promotion-guards.mjs";
import { promotionBackupPath } from "./archive-promotion-paths.mjs";
import { assertPromotionVerifierMatchesDraft } from "./archive-promotion-policy.mjs";
import { assertArchiveReviewTransitionAllowed } from "./archive-review-policy.mjs";
import { mergePromotedMarkdownBody, summarizePromotedPageForIndex, upsertWikiIndexCatalogEntry } from "./archive-merge.mjs";
import { buildDeterministicWikiDraft } from "./memory-ingest-draft.mjs";

export function createArchiveReviewService({
  memoryRoot,
  userRoot,
  listFilesRecursive,
  safeFileSlug,
  safeMemoryRelativePath,
  frontmatterValue,
  writeFrontmatterValue,
  markdownTitle,
  artifactKind,
  artifactInsights,
  markdownSection,
  compactExcerpt,
  runArchiveIngestWriter,
  runArchiveSemanticVerifier,
} = {}) {
  function assertDependency(name, value) {
    if (!value) {
      throw new Error(`Archive review service missing dependency: ${name}`);
    }
  }
  for (const [name, value] of Object.entries({
    memoryRoot,
    userRoot,
    listFilesRecursive,
    safeFileSlug,
    safeMemoryRelativePath,
    frontmatterValue,
    writeFrontmatterValue,
    markdownTitle,
    artifactKind,
    artifactInsights,
    markdownSection,
    compactExcerpt,
    runArchiveIngestWriter,
    runArchiveSemanticVerifier,
  })) {
    assertDependency(name, value);
  }

  async function executeArchiveIntake(payload) {
    const title = String(payload.title ?? "Browser note").trim().slice(0, 180);
    const content = String(payload.content ?? "").trim();
    if (!content) {
      throw new Error("Archive intake requires content.");
    }
    const intakeDir = path.join(memoryRoot(), "INTAKE", "browser");
    await mkdir(intakeDir, { recursive: true });
    const now = new Date();
    const fileName = `${now.toISOString().replace(/[:.]/g, "-")}-${safeFileSlug(title)}.md`;
    const filePath = path.join(intakeDir, fileName);
    const frontmatter = {
      source: "resonantos-browser-first",
      actor: "augmentor.browser",
      title,
      createdAt: now.toISOString(),
      url: payload.url ?? null,
      sourceMessageId: payload.sourceMessageId ?? null,
    };
    const body = [
      "---",
      ...Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
      "---",
      "",
      `# ${title}`,
      "",
      content,
      "",
    ].join("\n");
    await writeFile(filePath, body);
    const logPath = path.join(memoryRoot(), "INTAKE", "browser", "log.md");
    await appendFile(logPath, `## [${now.toISOString()}] browser-intake | ${title}\n- file: ${fileName}\n\n`);
    return {
      path: path.relative(memoryRoot(), filePath),
      bytes: Buffer.byteLength(body, "utf8"),
    };
  }

  async function executeArchiveIntakeList(payload = {}) {
    const limit = Math.max(1, Math.min(100, Number(payload.limit ?? 40)));
    const intakeRoot = path.join(memoryRoot(), "INTAKE");
    const files = await listFilesRecursive(intakeRoot, (filePath) => /\.(md|markdown)$/i.test(filePath), 2_000);
    const entries = await Promise.all(files
      .filter((filePath) => path.basename(filePath).toLowerCase() !== "log.md")
      .map(async (filePath) => {
        const [details, content] = await Promise.all([
          stat(filePath),
          readFile(filePath, "utf8").catch(() => ""),
        ]);
        const relativePath = path.relative(memoryRoot(), filePath);
        return {
          path: relativePath,
          title: markdownTitle(content, path.basename(filePath, path.extname(filePath))),
          kind: artifactKind(content, filePath),
          bytes: details.size,
          createdAt: frontmatterValue(content, "createdAt") || details.birthtime.toISOString(),
          insights: artifactInsights(content),
          modifiedAt: details.mtime.toISOString(),
          excerpt: content
            .replace(/^---[\s\S]*?---\s*/m, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 260),
        };
      }));
    entries.sort((left, right) => String(right.modifiedAt).localeCompare(String(left.modifiedAt)));
    return { root: path.relative(userRoot(), intakeRoot), entries: entries.slice(0, limit) };
  }

  async function executeArchiveIntakeRead(payload) {
    const filePath = safeMemoryRelativePath(payload.path, "INTAKE");
    if (!/\.(md|markdown)$/i.test(filePath)) {
      throw new Error("Archive artifact preview only supports markdown intake files.");
    }
    const [details, content] = await Promise.all([stat(filePath), readFile(filePath, "utf8")]);
    return {
      path: path.relative(memoryRoot(), filePath),
      title: markdownTitle(content, path.basename(filePath, path.extname(filePath))),
      kind: artifactKind(content, filePath),
      bytes: details.size,
      insights: artifactInsights(content),
      modifiedAt: details.mtime.toISOString(),
      content: content.slice(0, 24_000),
      truncated: content.length > 24_000,
    };
  }

  async function executeMemoryWikiPageRead(payload = {}) {
    const filePath = safeMemoryRelativePath(payload.path, "AI_MEMORY/wiki");
    if (!/\.(md|markdown)$/i.test(filePath)) {
      throw new Error("AI Memory page preview only supports markdown wiki pages.");
    }
    const [details, content] = await Promise.all([stat(filePath), readFile(filePath, "utf8")]);
    return {
      path: path.relative(memoryRoot(), filePath),
      title: markdownTitle(content, path.basename(filePath, path.extname(filePath))),
      bytes: details.size,
      modifiedAt: details.mtime.toISOString(),
      content: content.slice(0, 24_000),
      truncated: content.length > 24_000,
    };
  }

  async function executeArchiveReviewRequest(payload) {
    const artifactPath = String(payload.path ?? "").trim();
    const filePath = safeMemoryRelativePath(artifactPath, "INTAKE");
    if (!/\.(md|markdown)$/i.test(filePath)) {
      throw new Error("Archive review requests only support markdown intake artifacts.");
    }
    const content = await readFile(filePath, "utf8");
    const now = new Date();
    const title = markdownTitle(content, path.basename(filePath, path.extname(filePath)));
    const reason = String(payload.reason ?? "Review this intake artifact for possible Living Archive promotion.").trim().slice(0, 800);
    const requestDir = path.join(memoryRoot(), "REVIEW", "requests");
    await mkdir(requestDir, { recursive: true });
    const requestFile = `${now.toISOString().replace(/[:.]/g, "-")}-${safeFileSlug(title)}.md`;
    const requestPath = path.join(requestDir, requestFile);
    const requestBody = [
      "---",
      `source: ${JSON.stringify("resonantos-browser-first")}`,
      `type: ${JSON.stringify("archive-review-request")}`,
      `status: ${JSON.stringify("pending")}`,
      `createdAt: ${JSON.stringify(now.toISOString())}`,
      `artifactPath: ${JSON.stringify(artifactPath)}`,
      "---",
      "",
      `# Review Request: ${title}`,
      "",
      "## Reason",
      reason,
      "",
      "## Source Artifact",
      artifactPath,
      "",
      "## Boundary",
      "This request asks the Strategist-owned ingest path to evaluate the artifact. It does not promote or mutate trusted AI Memory by itself.",
      "",
    ].join("\n");
    await writeFile(requestPath, requestBody);
    return {
      path: path.relative(memoryRoot(), requestPath),
      sourceArtifactPath: artifactPath,
      status: "pending",
    };
  }

  async function executeArchiveReviewList(payload = {}) {
    const limit = Math.max(1, Math.min(100, Number(payload.limit ?? 30)));
    const requestsRoot = path.join(memoryRoot(), "REVIEW", "requests");
    const files = await listFilesRecursive(requestsRoot, (filePath) => /\.(md|markdown)$/i.test(filePath), 1_000);
    const requests = await Promise.all(files.map(async (filePath) => {
      const [details, content] = await Promise.all([
        stat(filePath),
        readFile(filePath, "utf8").catch(() => ""),
      ]);
      const reasonMatch = /## Reason\s+([\s\S]*?)(?:\n## |\s*$)/m.exec(content);
      const draftArtifactPath = frontmatterValue(content, "draftArtifactPath") || "";
      let draftState = {};
      if (draftArtifactPath) {
        try {
          const draftFile = safeMemoryRelativePath(draftArtifactPath, "REVIEW/artifacts");
          if (existsSync(draftFile)) {
            const draftContent = await readFile(draftFile, "utf8");
            draftState = {
              draftStatus: frontmatterValue(draftContent, "status") || "",
              draftVerificationStatus: frontmatterValue(draftContent, "verificationStatus") || "",
              draftVerifierArtifactPath: frontmatterValue(draftContent, "verifierArtifactPath") || "",
              draftRevisionStatus: frontmatterValue(draftContent, "revisionStatus") || "",
              revisedDraftPath: frontmatterValue(draftContent, "revisedDraftPath") || "",
              supersedesDraftPath: frontmatterValue(draftContent, "supersedesDraftPath") || "",
              promotionStatus: frontmatterValue(draftContent, "promotionStatus") || "",
              promotedPage: frontmatterValue(draftContent, "promotedPage") || "",
              promotedAt: frontmatterValue(draftContent, "promotedAt") || "",
              backupPath: frontmatterValue(draftContent, "backupPath") || "",
              rollbackStatus: frontmatterValue(draftContent, "rollbackStatus") || "",
              restoredAt: frontmatterValue(draftContent, "restoredAt") || "",
            };
          }
        } catch {
          draftState = { draftStatus: "unreadable" };
        }
      }
      return {
        path: path.relative(memoryRoot(), filePath),
        title: markdownTitle(content, path.basename(filePath, path.extname(filePath))).replace(/^Review Request:\s*/i, ""),
        status: frontmatterValue(content, "status") || "pending",
        artifactPath: frontmatterValue(content, "artifactPath") || "",
        draftArtifactPath,
        createdAt: frontmatterValue(content, "createdAt") || details.birthtime.toISOString(),
        modifiedAt: details.mtime.toISOString(),
        reason: String(reasonMatch?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
        ...draftState,
      };
    }));
    requests.sort((left, right) => String(right.modifiedAt).localeCompare(String(left.modifiedAt)));
    return { root: path.relative(userRoot(), requestsRoot), requests: requests.slice(0, limit) };
  }

  async function executeArchiveReviewTransition(payload = {}) {
    const requestPath = String(payload.path ?? "").trim();
    const nextStatus = String(payload.status ?? "").trim();
    const allowedStatuses = new Set(["pending", "in-progress", "approved", "rejected"]);
    if (!allowedStatuses.has(nextStatus)) {
      throw new Error("Review request status must be pending, in-progress, approved, or rejected.");
    }
    const filePath = safeMemoryRelativePath(requestPath, "REVIEW/requests");
    if (!/\.(md|markdown)$/i.test(filePath)) {
      throw new Error("Archive review status changes only support markdown review requests.");
    }
    const previous = await readFile(filePath, "utf8");
    if (frontmatterValue(previous, "type") !== "archive-review-request") {
      throw new Error("Archive review status changes require a review request file.");
    }
    const now = new Date().toISOString();
    const actor = String(payload.actor ?? "resonantos-browser-first").trim().slice(0, 120) || "resonantos-browser-first";
    const actorType = String(payload.actorType ?? "").trim().slice(0, 80);
    assertArchiveReviewTransitionAllowed({
      metadata: {
        humanReviewRequired: frontmatterValue(previous, "humanReviewRequired"),
        requiresHumanReview: frontmatterValue(previous, "requiresHumanReview"),
        reviewMode: frontmatterValue(previous, "reviewMode"),
        reviewGate: frontmatterValue(previous, "reviewGate"),
        escalationStatus: frontmatterValue(previous, "escalationStatus"),
        humanReviewState: frontmatterValue(previous, "humanReviewState"),
      },
      fromStatus: frontmatterValue(previous, "status") || "pending",
      toStatus: nextStatus,
      actor,
      actorType,
    });
    let next = writeFrontmatterValue(previous, "status", nextStatus);
    next = writeFrontmatterValue(next, "updatedAt", now);
    next = writeFrontmatterValue(next, "updatedBy", actor);
    next = `${next.trimEnd()}\n\n## Status Event\n- at: ${now}\n- status: ${nextStatus}\n- actor: ${actor}\n`;
    await writeFile(filePath, next);
    return {
      path: requestPath,
      status: nextStatus,
      updatedAt: now,
    };
  }

  async function executeArchiveReviewDraft(payload = {}) {
    const requestPath = String(payload.path ?? "").trim();
    const requestFile = safeMemoryRelativePath(requestPath, "REVIEW/requests");
    if (!/\.(md|markdown)$/i.test(requestFile)) {
      throw new Error("Archive draft generation only supports markdown review requests.");
    }
    const requestContent = await readFile(requestFile, "utf8");
    if (frontmatterValue(requestContent, "type") !== "archive-review-request") {
      throw new Error("Archive draft generation requires a review request.");
    }
    const artifactPath = frontmatterValue(requestContent, "artifactPath");
    const sourceFile = safeMemoryRelativePath(artifactPath, "INTAKE");
    const sourceContent = await readFile(sourceFile, "utf8");
    const sourceTitle = markdownTitle(sourceContent, path.basename(sourceFile, path.extname(sourceFile)));
    const now = new Date();
    const proposedPage = String(payload.proposedPage ?? `AI_MEMORY/wiki/sources/${safeFileSlug(sourceTitle)}.md`).replace(/\\/g, "/");
    if (!proposedPage.startsWith("AI_MEMORY/wiki/") || !proposedPage.endsWith(".md") || proposedPage.includes("..")) {
      throw new Error("Proposed page must be a markdown path inside AI_MEMORY/wiki.");
    }
    const artifactsDir = path.join(memoryRoot(), "REVIEW", "artifacts");
    await mkdir(artifactsDir, { recursive: true });
    const artifactFile = `${now.toISOString().replace(/[:.]/g, "-")}-${safeFileSlug(sourceTitle)}-draft.md`;
    const artifactFilePath = path.join(artifactsDir, artifactFile);
    const deterministic = buildDeterministicWikiDraft({
      sourceContent,
      sourcePath: artifactPath,
      sourceTitle,
      proposedPage,
      requestPath,
    });
    const existingIndex = await readFile(path.join(memoryRoot(), "AI_MEMORY", "wiki", "index.md"), "utf8").catch(() => "");
    const writer = await runArchiveIngestWriter({
      sourceContent,
      sourcePath: artifactPath,
      sourceTitle,
      proposedPage,
      requestPath,
      existingIndex,
      requestedModel: payload.model,
      deterministicContent: deterministic.proposedContent,
    });
    const body = [
      "---",
      `source: ${JSON.stringify("resonantos-browser-first")}`,
      `type: ${JSON.stringify("archive-draft-wiki-update")}`,
      `status: ${JSON.stringify("draft")}`,
      `verificationStatus: ${JSON.stringify("unverified")}`,
      `createdAt: ${JSON.stringify(now.toISOString())}`,
      `requestPath: ${JSON.stringify(requestPath)}`,
      `artifactPath: ${JSON.stringify(artifactPath)}`,
      `proposedPage: ${JSON.stringify(writer.proposedPage || proposedPage)}`,
      `providerId: ${JSON.stringify(writer.providerId || "")}`,
      `model: ${JSON.stringify(writer.model || "deterministic-wiki-draft")}`,
      "---",
      "",
      `# Draft Wiki Update: ${sourceTitle}`,
      "",
      "## Boundary",
      "This is a draft artifact. It is not trusted AI Memory until verification and promotion complete.",
      "",
      "## Source Summary",
      writer.summary || deterministic.summary,
      "",
      "## Proposed Page",
      writer.proposedPage || proposedPage,
      "",
      "## Proposed Content",
      writer.proposedContent || deterministic.proposedContent,
      "",
      "## Suggested Cross Links",
      (writer.crossLinks?.length ? writer.crossLinks : deterministic.crossLinks).map((link) => `- ${link}`).join("\n") || "- None yet.",
      "",
      "## Contradictions Or Caveats",
      (writer.contradictionsOrCaveats?.length ? writer.contradictionsOrCaveats : deterministic.contradictionsOrCaveats).map((item) => `- ${item}`).join("\n") || "- No contradictions detected in deterministic draft.",
      "",
    ].join("\n");
    await writeFile(artifactFilePath, body);
    const relativeArtifactPath = path.relative(memoryRoot(), artifactFilePath);
    const updatedRequest = writeFrontmatterValue(
      writeFrontmatterValue(requestContent, "draftArtifactPath", relativeArtifactPath),
      "status",
      "in-progress",
    );
    await writeFile(requestFile, `${updatedRequest.trimEnd()}\n\n## Draft Event\n- at: ${now.toISOString()}\n- draft: ${relativeArtifactPath}\n`);
    return {
      path: relativeArtifactPath,
      requestPath,
      proposedPage: writer.proposedPage || proposedPage,
      status: "draft",
      verificationStatus: "unverified",
    };
  }

  async function executeArchiveReviewArtifactRead(payload = {}) {
    const artifactPath = String(payload.path ?? "").trim();
    const filePath = safeMemoryRelativePath(artifactPath, "REVIEW/artifacts");
    if (!/\.(md|markdown)$/i.test(filePath)) {
      throw new Error("Archive review artifact preview only supports markdown files.");
    }
    const [details, content] = await Promise.all([stat(filePath), readFile(filePath, "utf8")]);
    return {
      path: path.relative(memoryRoot(), filePath),
      title: markdownTitle(content, path.basename(filePath, path.extname(filePath))),
      bytes: details.size,
      status: frontmatterValue(content, "status") || "",
      verificationStatus: frontmatterValue(content, "verificationStatus") || "",
      promotionStatus: frontmatterValue(content, "promotionStatus") || "",
      promotedPage: frontmatterValue(content, "promotedPage") || frontmatterValue(content, "proposedPage") || "",
      promotedAt: frontmatterValue(content, "promotedAt") || "",
      backupPath: frontmatterValue(content, "backupPath") || "",
      rollbackStatus: frontmatterValue(content, "rollbackStatus") || "",
      restoredAt: frontmatterValue(content, "restoredAt") || "",
      restoreBackupPath: frontmatterValue(content, "restoreBackupPath") || "",
      modifiedAt: details.mtime.toISOString(),
      content: content.slice(0, 24_000),
      truncated: content.length > 24_000,
    };
  }

  async function executeArchiveReviewArtifactVerify(payload = {}) {
    const artifactPath = String(payload.path ?? "").trim();
    const artifactFile = safeMemoryRelativePath(artifactPath, "REVIEW/artifacts");
    if (!/\.(md|markdown)$/i.test(artifactFile)) {
      throw new Error("Archive artifact verification only supports markdown review artifacts.");
    }
    const artifactContent = await readFile(artifactFile, "utf8");
    if (frontmatterValue(artifactContent, "type") !== "archive-draft-wiki-update") {
      throw new Error("Archive artifact verification requires a draft wiki-update artifact.");
    }
    const requestPath = frontmatterValue(artifactContent, "requestPath");
    const sourceArtifactPath = frontmatterValue(artifactContent, "artifactPath");
    const proposedPage = frontmatterValue(artifactContent, "proposedPage");
    const proposedContent = markdownSection(artifactContent, "Proposed Content");
    if (!requestPath || !sourceArtifactPath || !proposedPage || !proposedContent) {
      throw new Error("Draft artifact is missing request, source, proposed page, or proposed content.");
    }
    const sourceFile = safeMemoryRelativePath(sourceArtifactPath, "INTAKE");
    const sourceContent = await readFile(sourceFile, "utf8");
    const sourceExcerpt = compactExcerpt(sourceContent, 4_000);
    const proposedExcerpt = proposedContent.replace(/\s+/g, " ").slice(0, 4_000);
    const deterministicFindings = [];
    const sourceTokens = new Set(sourceExcerpt.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 4));
    const proposedTokens = proposedExcerpt.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 4);
    const unsupportedSignals = proposedTokens
      .filter((token) => !sourceTokens.has(token))
      .filter((token, index, list) => list.indexOf(token) === index)
      .slice(0, 8);
    if (proposedContent.length < 80) {
      deterministicFindings.push("Proposed content is very short; verify whether it preserved the source meaning.");
    }
    if (unsupportedSignals.length > 5) {
      deterministicFindings.push(`Draft contains terms not obvious in the source excerpt: ${unsupportedSignals.join(", ")}.`);
    }
    const deterministicStatus = deterministicFindings.length ? "needs-revision" : "verified";
    const semantic = payload.skipSemantic === true
      ? {
          semanticStatus: "skipped",
          semanticSummary: "Semantic verification skipped by request.",
          semanticFindings: [],
          providerId: "",
          model: "",
          usage: null,
        }
      : await runArchiveSemanticVerifier({
          artifactPath,
          requestPath,
          sourceContent,
          proposedPage,
          proposedContent,
          requestedModel: payload.model,
        });
    const finalStatus = deterministicStatus === "needs-revision" || semantic.semanticStatus === "needs-revision"
      ? "needs-revision"
      : "verified";
    const now = new Date().toISOString();
    const verificationDir = path.join(memoryRoot(), "REVIEW", "verifications");
    await mkdir(verificationDir, { recursive: true });
    const verificationPath = path.join(
      verificationDir,
      `${now.replace(/[:.]/g, "-")}-${safeFileSlug(path.basename(artifactPath, path.extname(artifactPath)))}-verification.md`,
    );
    const verificationBody = [
      "---",
      `source: ${JSON.stringify("resonantos-browser-first")}`,
      `type: ${JSON.stringify("archive-artifact-verification")}`,
      `status: ${JSON.stringify(finalStatus)}`,
      `createdAt: ${JSON.stringify(now)}`,
      `artifactPath: ${JSON.stringify(artifactPath)}`,
      `requestPath: ${JSON.stringify(requestPath)}`,
      `proposedPage: ${JSON.stringify(proposedPage)}`,
      `semanticStatus: ${JSON.stringify(semantic.semanticStatus)}`,
      `semanticProviderId: ${JSON.stringify(semantic.providerId)}`,
      `semanticModel: ${JSON.stringify(semantic.model)}`,
      "---",
      "",
      `# Verification: ${path.basename(proposedPage)}`,
      "",
      "## Status",
      finalStatus,
      "",
      "## Deterministic Findings",
      deterministicFindings.length ? deterministicFindings.map((finding) => `- ${finding}`).join("\n") : "- No deterministic blocking issue found.",
      "",
      "## Semantic Findings",
      `- status: ${semantic.semanticStatus}`,
      `- summary: ${semantic.semanticSummary}`,
      ...(semantic.semanticFindings ?? []).map((finding) => `- ${finding}`),
      "",
      "## Boundary",
      "Verification challenges the draft. Promotion is a separate trusted-memory write step.",
      "",
    ].join("\n");
    await writeFile(verificationPath, verificationBody);
    const relativeVerificationPath = path.relative(memoryRoot(), verificationPath);
    let updatedArtifact = artifactContent;
    updatedArtifact = writeFrontmatterValue(updatedArtifact, "verificationStatus", finalStatus);
    updatedArtifact = writeFrontmatterValue(updatedArtifact, "verifiedAt", now);
    updatedArtifact = writeFrontmatterValue(updatedArtifact, "verifierArtifactPath", relativeVerificationPath);
    updatedArtifact = `${updatedArtifact.trimEnd()}\n\n## Verification Event\n- at: ${now}\n- status: ${finalStatus}\n- verification: ${relativeVerificationPath}\n`;
    await writeFile(artifactFile, updatedArtifact);
    return {
      path: artifactPath,
      status: finalStatus,
      verificationPath: relativeVerificationPath,
      deterministicFindings,
      semantic,
    };
  }

  async function executeArchiveReviewArtifactRevise(payload = {}) {
    const artifactPath = String(payload.path ?? "").trim();
    const artifactFile = safeMemoryRelativePath(artifactPath, "REVIEW/artifacts");
    if (!/\.(md|markdown)$/i.test(artifactFile)) {
      throw new Error("Archive artifact revision only supports markdown review artifacts.");
    }
    const artifactContent = await readFile(artifactFile, "utf8");
    if (frontmatterValue(artifactContent, "type") !== "archive-draft-wiki-update") {
      throw new Error("Archive artifact revision requires a draft wiki-update artifact.");
    }
    const requestPath = frontmatterValue(artifactContent, "requestPath");
    const sourceArtifactPath = frontmatterValue(artifactContent, "artifactPath");
    const proposedPage = frontmatterValue(artifactContent, "proposedPage");
    const sourceFile = safeMemoryRelativePath(sourceArtifactPath, "INTAKE");
    const sourceContent = await readFile(sourceFile, "utf8");
    const sourceTitle = markdownTitle(sourceContent, path.basename(sourceFile, path.extname(sourceFile)));
    const verificationPath = frontmatterValue(artifactContent, "verifierArtifactPath");
    const verificationContent = verificationPath
      ? await readFile(safeMemoryRelativePath(verificationPath, "REVIEW/verifications"), "utf8").catch(() => "")
      : "";
    const revisionInstruction = String(payload.instruction ?? "").trim().slice(0, 2_000);
    const deterministic = buildDeterministicWikiDraft({
      sourceContent,
      sourcePath: sourceArtifactPath,
      sourceTitle,
      proposedPage,
      requestPath,
    });
    const existingIndex = await readFile(path.join(memoryRoot(), "AI_MEMORY", "wiki", "index.md"), "utf8").catch(() => "");
    const writer = await runArchiveIngestWriter({
      sourceContent: [
        sourceContent,
        "",
        "## Verification Feedback",
        markdownSection(verificationContent, "Deterministic Findings"),
        markdownSection(verificationContent, "Semantic Findings"),
        "",
        "## Human Revision Instruction",
        revisionInstruction,
      ].join("\n"),
      sourcePath: sourceArtifactPath,
      sourceTitle,
      proposedPage,
      requestPath,
      existingIndex,
      requestedModel: payload.model,
      deterministicContent: deterministic.proposedContent,
    });
    const now = new Date();
    const artifactsDir = path.join(memoryRoot(), "REVIEW", "artifacts");
    await mkdir(artifactsDir, { recursive: true });
    const revisedFile = `${now.toISOString().replace(/[:.]/g, "-")}-${safeFileSlug(sourceTitle)}-revised-draft.md`;
    const revisedPath = path.join(artifactsDir, revisedFile);
    const body = [
      "---",
      `source: ${JSON.stringify("resonantos-browser-first")}`,
      `type: ${JSON.stringify("archive-draft-wiki-update")}`,
      `status: ${JSON.stringify("draft")}`,
      `verificationStatus: ${JSON.stringify("unverified")}`,
      `revisionStatus: ${JSON.stringify("revised")}`,
      `createdAt: ${JSON.stringify(now.toISOString())}`,
      `requestPath: ${JSON.stringify(requestPath)}`,
      `artifactPath: ${JSON.stringify(sourceArtifactPath)}`,
      `supersedesDraftPath: ${JSON.stringify(artifactPath)}`,
      `proposedPage: ${JSON.stringify(writer.proposedPage || proposedPage)}`,
      `providerId: ${JSON.stringify(writer.providerId || "")}`,
      `model: ${JSON.stringify(writer.model || "deterministic-wiki-draft")}`,
      "---",
      "",
      `# Revised Draft Wiki Update: ${sourceTitle}`,
      "",
      "## Boundary",
      "This is a revised draft artifact. It is not trusted AI Memory until verification and promotion complete.",
      "",
      "## Revision Basis",
      revisionInstruction || "Revision generated from verification feedback.",
      "",
      "## Source Summary",
      writer.summary || deterministic.summary,
      "",
      "## Proposed Page",
      writer.proposedPage || proposedPage,
      "",
      "## Proposed Content",
      writer.proposedContent || deterministic.proposedContent,
      "",
      "## Suggested Cross Links",
      (writer.crossLinks?.length ? writer.crossLinks : deterministic.crossLinks).map((link) => `- ${link}`).join("\n") || "- None yet.",
      "",
      "## Contradictions Or Caveats",
      (writer.contradictionsOrCaveats?.length ? writer.contradictionsOrCaveats : deterministic.contradictionsOrCaveats).map((item) => `- ${item}`).join("\n") || "- No contradictions detected in revised deterministic draft.",
      "",
    ].join("\n");
    await writeFile(revisedPath, body);
    const relativeRevisedPath = path.relative(memoryRoot(), revisedPath);
    let updatedPrevious = artifactContent;
    updatedPrevious = writeFrontmatterValue(updatedPrevious, "revisionStatus", "superseded");
    updatedPrevious = writeFrontmatterValue(updatedPrevious, "revisedDraftPath", relativeRevisedPath);
    updatedPrevious = `${updatedPrevious.trimEnd()}\n\n## Revision Event\n- at: ${now.toISOString()}\n- revisedDraft: ${relativeRevisedPath}\n`;
    await writeFile(artifactFile, updatedPrevious);
    return {
      path: relativeRevisedPath,
      supersedesDraftPath: artifactPath,
      proposedPage: writer.proposedPage || proposedPage,
      status: "draft",
      verificationStatus: "unverified",
      revisionStatus: "revised",
    };
  }

  async function executeArchiveVerificationRead(payload = {}) {
    const verificationPath = String(payload.path ?? "").trim();
    const filePath = safeMemoryRelativePath(verificationPath, "REVIEW/verifications");
    if (!/\.(md|markdown)$/i.test(filePath)) {
      throw new Error("Archive verification preview only supports markdown files.");
    }
    const [details, content] = await Promise.all([stat(filePath), readFile(filePath, "utf8")]);
    return {
      path: path.relative(memoryRoot(), filePath),
      title: markdownTitle(content, path.basename(filePath, path.extname(filePath))),
      bytes: details.size,
      status: frontmatterValue(content, "status") || "",
      semanticStatus: frontmatterValue(content, "semanticStatus") || "",
      artifactPath: frontmatterValue(content, "artifactPath") || "",
      requestPath: frontmatterValue(content, "requestPath") || "",
      modifiedAt: details.mtime.toISOString(),
      content: content.slice(0, 24_000),
      truncated: content.length > 24_000,
    };
  }

  async function executeArchiveReviewArtifactPromote(payload = {}) {
    const artifactPath = String(payload.path ?? "").trim();
    const artifactFile = safeMemoryRelativePath(artifactPath, "REVIEW/artifacts");
    if (!/\.(md|markdown)$/i.test(artifactFile)) {
      throw new Error("Archive promotion only supports markdown review artifacts.");
    }
    const artifactContent = await readFile(artifactFile, "utf8");
    if (frontmatterValue(artifactContent, "type") !== "archive-draft-wiki-update") {
      throw new Error("Archive promotion requires a draft wiki-update artifact.");
    }
    const verifierArtifactPath = frontmatterValue(artifactContent, "verifierArtifactPath");
    if (!verifierArtifactPath) {
      throw new Error("Archive promotion requires a verifier artifact.");
    }
    const verifierFile = safeMemoryRelativePath(verifierArtifactPath, "REVIEW/verifications");
    const verifierContent = await readFile(verifierFile, "utf8");
    assertPromotionVerifierMatchesDraft({
      draftPath: artifactPath,
      draft: {
        artifactPath: frontmatterValue(artifactContent, "artifactPath"),
        requestPath: frontmatterValue(artifactContent, "requestPath"),
        proposedPage: frontmatterValue(artifactContent, "proposedPage"),
        verificationStatus: frontmatterValue(artifactContent, "verificationStatus"),
        verifierArtifactPath,
      },
      verifier: {
        artifactPath: frontmatterValue(verifierContent, "artifactPath"),
        requestPath: frontmatterValue(verifierContent, "requestPath"),
        proposedPage: frontmatterValue(verifierContent, "proposedPage"),
        status: frontmatterValue(verifierContent, "status"),
      },
    });
    const proposedPage = frontmatterValue(artifactContent, "proposedPage");
    const pageFile = safeMemoryRelativePath(proposedPage, "AI_MEMORY/wiki");
    if (!/\.(md|markdown)$/i.test(pageFile)) {
      throw new Error("Archive promotion target must be a markdown page.");
    }
    if (!proposedPage.startsWith("AI_MEMORY/wiki/")) {
      throw new Error("Archive promotion target must stay inside AI_MEMORY/wiki.");
    }
    const proposedContent = markdownSection(artifactContent, "Proposed Content");
    if (!proposedContent) {
      throw new Error("Draft artifact has no Proposed Content section to promote.");
    }
    const now = new Date().toISOString();
    await mkdir(path.dirname(pageFile), { recursive: true });
    let backupPath = "";
    let existingPageContent = "";
    if (existsSync(pageFile)) {
      existingPageContent = await readFile(pageFile, "utf8");
      const backupFile = promotionBackupPath({
        memoryRoot: memoryRoot(),
        pagePath: proposedPage,
        timestamp: now,
        category: "promotions",
      });
      await mkdir(path.dirname(backupFile), { recursive: true });
      await copyFile(pageFile, backupFile);
      backupPath = path.relative(memoryRoot(), backupFile);
    }
    const pageTitle = markdownTitle(artifactContent, path.basename(pageFile, path.extname(pageFile))).replace(/^Draft Wiki Update:\s*/i, "");
    const mergedContent = mergePromotedMarkdownBody({
      existingContent: existingPageContent,
      promotedBody: proposedContent,
      sourcePath: frontmatterValue(artifactContent, "artifactPath") || "",
      artifactPath,
      promotedAt: now,
    });
    const pageBody = [
      "---",
      `source: ${JSON.stringify("resonantos-browser-first")}`,
      `type: ${JSON.stringify("ai-memory-page")}`,
      `title: ${JSON.stringify(pageTitle)}`,
      `updatedAt: ${JSON.stringify(now)}`,
      `reviewArtifact: ${JSON.stringify(artifactPath)}`,
      `sourceArtifact: ${JSON.stringify(frontmatterValue(artifactContent, "artifactPath") || "")}`,
      "---",
      "",
      mergedContent,
      "",
    ].join("\n");
    await writeFile(pageFile, pageBody);
    let updatedArtifact = artifactContent;
    updatedArtifact = writeFrontmatterValue(updatedArtifact, "promotionStatus", "promoted");
    updatedArtifact = writeFrontmatterValue(updatedArtifact, "promotedAt", now);
    updatedArtifact = writeFrontmatterValue(updatedArtifact, "promotedPage", proposedPage);
    if (backupPath) {
      updatedArtifact = writeFrontmatterValue(updatedArtifact, "backupPath", backupPath);
    }
    updatedArtifact = `${updatedArtifact.trimEnd()}\n\n## Promotion Event\n- at: ${now}\n- actor: resonantos-browser-first\n- page: ${proposedPage}\n${backupPath ? `- backup: ${backupPath}\n` : ""}`;
    await writeFile(artifactFile, updatedArtifact);
    const indexPath = path.join(memoryRoot(), "AI_MEMORY", "wiki", "index.md");
    const logPath = path.join(memoryRoot(), "AI_MEMORY", "wiki", "log.md");
    await mkdir(path.dirname(indexPath), { recursive: true });
    const existingIndex = existsSync(indexPath) ? await readFile(indexPath, "utf8").catch(() => "") : "";
    const nextIndex = upsertWikiIndexCatalogEntry({
      existingIndex,
      pagePath: proposedPage,
      title: pageTitle,
      summary: summarizePromotedPageForIndex(proposedContent),
      sourceArtifact: frontmatterValue(artifactContent, "artifactPath") || "",
      promotedAt: now,
    });
    await writeFile(indexPath, nextIndex);
    await appendFile(logPath, `## [${now}] trusted_wiki_promote | ${pageTitle}\n- page: ${proposedPage}\n- review artifact: ${artifactPath}\n${backupPath ? `- backup: ${backupPath}\n` : ""}\n`);
    return {
      path: artifactPath,
      status: "promoted",
      promotedPage: proposedPage,
      promotedAt: now,
      backupPath,
    };
  }

  async function executeArchivePromotionList(payload = {}) {
    const limit = Math.max(1, Math.min(100, Number(payload.limit ?? 20)));
    const artifactsRoot = path.join(memoryRoot(), "REVIEW", "artifacts");
    const files = await listFilesRecursive(artifactsRoot, (filePath) => /\.(md|markdown)$/i.test(filePath), 2_000);
    const promotions = [];
    for (const filePath of files) {
      const [details, content] = await Promise.all([
        stat(filePath),
        readFile(filePath, "utf8").catch(() => ""),
      ]);
      if (frontmatterValue(content, "promotionStatus") !== "promoted") {
        continue;
      }
      const title = markdownTitle(content, path.basename(filePath, path.extname(filePath)))
        .replace(/^Draft Wiki Update:\s*/i, "");
      promotions.push({
        path: path.relative(memoryRoot(), filePath),
        title,
        status: "promoted",
        promotedPage: frontmatterValue(content, "promotedPage") || frontmatterValue(content, "proposedPage") || "",
        promotedAt: frontmatterValue(content, "promotedAt") || details.mtime.toISOString(),
        backupPath: frontmatterValue(content, "backupPath") || "",
        rollbackStatus: frontmatterValue(content, "rollbackStatus") || "",
        restoredAt: frontmatterValue(content, "restoredAt") || "",
        restoreBackupPath: frontmatterValue(content, "restoreBackupPath") || "",
        artifactPath: frontmatterValue(content, "artifactPath") || "",
        requestPath: frontmatterValue(content, "requestPath") || "",
        modifiedAt: details.mtime.toISOString(),
      });
    }
    promotions.sort((left, right) =>
      String(right.promotedAt || right.modifiedAt).localeCompare(String(left.promotedAt || left.modifiedAt))
    );
    return {
      root: path.relative(userRoot(), artifactsRoot),
      promotions: promotions.slice(0, limit),
    };
  }

  async function executeArchivePromotionRestore(payload = {}) {
    const artifactPath = String(payload.path ?? "").trim();
    const artifactFile = safeMemoryRelativePath(artifactPath, "REVIEW/artifacts");
    if (!/\.(md|markdown)$/i.test(artifactFile)) {
      throw new Error("Archive promotion restore only supports markdown review artifacts.");
    }
    const artifactContent = await readFile(artifactFile, "utf8");
    if (frontmatterValue(artifactContent, "type") !== "archive-draft-wiki-update") {
      throw new Error("Archive promotion restore requires a draft wiki-update artifact.");
    }
    const promotedPage = frontmatterValue(artifactContent, "promotedPage") || frontmatterValue(artifactContent, "proposedPage");
    const backupPath = frontmatterValue(artifactContent, "backupPath");
    assertPromotionCanRestore({
      promotionStatus: frontmatterValue(artifactContent, "promotionStatus"),
      rollbackStatus: frontmatterValue(artifactContent, "rollbackStatus"),
      backupPath,
    });
    const pageFile = safeMemoryRelativePath(promotedPage, "AI_MEMORY/wiki");
    const backupFile = safeMemoryRelativePath(backupPath, "AI_MEMORY/backups/promotions");
    if (!existsSync(backupFile)) {
      throw new Error("Recorded promotion backup was not found.");
    }
    const now = new Date().toISOString();
    let restoreBackupPath = "";
    if (existsSync(pageFile)) {
      const restoreBackupFile = promotionBackupPath({
        memoryRoot: memoryRoot(),
        pagePath: promotedPage,
        timestamp: now,
        category: "restores",
      });
      await mkdir(path.dirname(restoreBackupFile), { recursive: true });
      await copyFile(pageFile, restoreBackupFile);
      restoreBackupPath = path.relative(memoryRoot(), restoreBackupFile);
    }
    await mkdir(path.dirname(pageFile), { recursive: true });
    await copyFile(backupFile, pageFile);
    let updatedArtifact = artifactContent;
    updatedArtifact = writeFrontmatterValue(updatedArtifact, "rollbackStatus", "restored");
    updatedArtifact = writeFrontmatterValue(updatedArtifact, "restoredAt", now);
    updatedArtifact = writeFrontmatterValue(updatedArtifact, "restoreBackupPath", restoreBackupPath);
    updatedArtifact = `${updatedArtifact.trimEnd()}\n\n## Restore Event\n- at: ${now}\n- actor: resonantos-browser-first\n- page: ${promotedPage}\n- restored-from: ${backupPath}\n${restoreBackupPath ? `- previous-current-backup: ${restoreBackupPath}\n` : ""}`;
    await writeFile(artifactFile, updatedArtifact);
    const logPath = path.join(memoryRoot(), "AI_MEMORY", "wiki", "log.md");
    await mkdir(path.dirname(logPath), { recursive: true });
    await appendFile(logPath, `## [${now}] trusted_wiki_restore | ${path.basename(promotedPage)}\n- page: ${promotedPage}\n- restored from: ${backupPath}\n- review artifact: ${artifactPath}\n${restoreBackupPath ? `- previous current backup: ${restoreBackupPath}\n` : ""}\n`);
    return {
      path: artifactPath,
      status: "restored",
      promotedPage,
      backupPath,
      restoredAt: now,
      restoreBackupPath,
    };
  }

  return {
    executeArchiveIntake,
    executeArchiveIntakeList,
    executeArchiveIntakeRead,
    executeArchivePromotionList,
    executeArchivePromotionRestore,
    executeArchiveReviewArtifactPromote,
    executeArchiveReviewArtifactRead,
    executeArchiveReviewArtifactRevise,
    executeArchiveReviewArtifactVerify,
    executeArchiveReviewDraft,
    executeArchiveReviewList,
    executeArchiveReviewRequest,
    executeArchiveReviewTransition,
    executeArchiveVerificationRead,
    executeMemoryWikiPageRead,
  };
}
