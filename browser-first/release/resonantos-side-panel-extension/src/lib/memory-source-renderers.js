// Intent citation: docs/architecture/ADR-027-living-archive-llm-wiki-compliance.md

import { artifactInsightsFromMarkdown } from "./artifact-insights.js";

const formatCount = (value) => Number(value ?? 0).toLocaleString();
const SOURCE_REVIEW_RENDER_LIMIT = 200;
const SOURCE_FILE_INTAKE_BATCH_LIMIT = 200;

export function sourceCard(source, onReview, onCreateIntake, onVersions) {
  const card = document.createElement("article");
  card.className = "memory-source-card";
  if (source.disabledAt) {
    card.dataset.disabled = "true";
  }
  const heading = document.createElement("div");
  heading.className = "memory-promotion-heading";
  const title = document.createElement("strong");
  title.textContent = source.path || "Unnamed source";
  const status = document.createElement("span");
  status.textContent = source.disabledAt ? "disabled" : source.exists ? "connected" : "missing";
  heading.append(title, status);
  const meta = document.createElement("p");
  meta.textContent = `${source.kind || "folder"} · ${source.ownership || "mixed-library"} · ${source.importMode || "copy-on-import"}`;
  const actions = document.createElement("div");
  actions.className = "memory-review-actions";
  const reviewButton = document.createElement("button");
  reviewButton.type = "button";
  reviewButton.textContent = "Review Source";
  reviewButton.disabled = Boolean(source.disabledAt) || !source.exists;
  reviewButton.addEventListener("click", () => onReview(source));
  const intakeButton = document.createElement("button");
  intakeButton.type = "button";
  intakeButton.textContent = "Create Intake Summary";
  intakeButton.disabled = Boolean(source.disabledAt) || !source.exists;
  intakeButton.addEventListener("click", () => onCreateIntake(source));
  const versionsButton = document.createElement("button");
  versionsButton.type = "button";
  versionsButton.textContent = "Versions";
  versionsButton.addEventListener("click", () => onVersions(source));
  actions.append(reviewButton, intakeButton, versionsButton);
  card.append(heading, meta, actions);
  return card;
}

function sourceSyncSkippedCount(entry) {
  return Array.isArray(entry?.skippedSources)
    ? entry.skippedSources.length
    : Number(entry?.skippedSources ?? 0);
}

export function sourceSyncHistoryPanel(entries = []) {
  const panel = document.createElement("div");
  panel.className = "memory-source-sync-history";
  const title = document.createElement("strong");
  title.textContent = "Recent source syncs";
  const help = document.createElement("small");
  help.textContent = "Sync history shows what ResonantOS inspected or queued from connected human sources. It never means trusted wiki pages were written.";
  const list = document.createElement("ol");
  const history = Array.isArray(entries) ? entries.slice(0, 5) : [];
  if (!history.length) {
    const empty = document.createElement("li");
    empty.textContent = "No source sync has run yet.";
    list.append(empty);
  }
  for (const entry of history) {
    const item = document.createElement("li");
    item.className = "memory-source-sync-entry";
    item.dataset.status = entry.status || "unknown";
    const row = document.createElement("div");
    const status = document.createElement("span");
    status.className = "memory-source-status-badge";
    status.dataset.syncStatus = entry.status === "intake-created"
      ? "changed"
      : entry.status === "review-only"
        ? "new"
        : entry.status === "paused"
          ? "unchanged"
          : entry.status === "error"
            ? "blocked"
            : "excluded";
    status.textContent = entry.status || "unknown";
    const meta = document.createElement("code");
    meta.textContent = [
      entry.finishedAt || entry.startedAt || "no timestamp",
      entry.mode || "manual-review",
      entry.autoSync ? "auto sync" : "manual"
    ].join(" · ");
    row.append(status, meta);
    const counts = document.createElement("p");
    counts.textContent = [
      `${formatCount(entry.reviewedSources)} source(s)`,
      `${formatCount(entry.eligibleFiles)} new/changed`,
      `${formatCount(entry.createdArtifacts)} intake artifact(s)`,
      `${formatCount(entry.reviewRequests)} review request(s)`,
      `${formatCount(sourceSyncSkippedCount(entry))} skipped`
    ].join(" · ");
    item.append(row, counts);
    const hasDetails = (Array.isArray(entry.sources) && entry.sources.length) ||
      (Array.isArray(entry.skippedSources) && entry.skippedSources.length);
    if (hasDetails) {
      const details = document.createElement("details");
      details.className = "memory-source-sync-details";
      const summary = document.createElement("summary");
      summary.textContent = "Inspect outcome";
      const detailList = document.createElement("ol");
      for (const source of (entry.sources ?? []).slice(0, 10)) {
        const sourceItem = document.createElement("li");
        const heading = document.createElement("strong");
        heading.textContent = `${source.sourceId || "source"} · ${source.status || "reviewed"}`;
        const sourceCounts = document.createElement("p");
        sourceCounts.textContent = [
          `${formatCount(source.candidates)} candidate(s)`,
          `${formatCount(source.eligibleFiles)} new/changed`,
          `${formatCount(source.createdArtifacts)} intake artifact(s)`,
          `${formatCount(source.reviewRequests)} review request(s)`,
          `${formatCount(source.rejectedFiles)} rejected`
        ].join(" · ");
        sourceItem.append(heading, sourceCounts);
        const eligibleSamples = Array.isArray(source.eligibleFileSamples) ? source.eligibleFileSamples : [];
        if (eligibleSamples.length) {
          const sample = document.createElement("small");
          sample.textContent = `Files: ${eligibleSamples.slice(0, 5).join(", ")}${eligibleSamples.length > 5 ? `, +${eligibleSamples.length - 5} more` : ""}`;
          sourceItem.append(sample);
        }
        const createdSamples = Array.isArray(source.createdArtifactSamples) ? source.createdArtifactSamples : [];
        if (createdSamples.length) {
          const sample = document.createElement("small");
          sample.textContent = `Intake: ${createdSamples.slice(0, 3).map((artifact) => `${artifact.sourceFile || "file"} → ${artifact.path || "artifact"}`).join(" · ")}${createdSamples.length > 3 ? ` · +${createdSamples.length - 3} more` : ""}`;
          sourceItem.append(sample);
        }
        const rejectedSamples = Array.isArray(source.rejectedFileSamples) ? source.rejectedFileSamples : [];
        if (rejectedSamples.length) {
          const sample = document.createElement("small");
          sample.textContent = `Rejected: ${rejectedSamples.slice(0, 3).map((rejected) => `${rejected.sourceFile || "file"} (${rejected.reason || "rejected"})`).join(" · ")}${rejectedSamples.length > 3 ? ` · +${rejectedSamples.length - 3} more` : ""}`;
          sourceItem.append(sample);
        }
        detailList.append(sourceItem);
      }
      for (const skipped of (entry.skippedSources ?? []).slice(0, 10)) {
        const skippedItem = document.createElement("li");
        const heading = document.createElement("strong");
        heading.textContent = `${skipped.sourceId || "source"} · skipped`;
        const body = document.createElement("p");
        body.textContent = [skipped.path, skipped.reason].filter(Boolean).join(" · ") || "Skipped without detail.";
        skippedItem.append(heading, body);
        detailList.append(skippedItem);
      }
      details.append(summary, detailList);
      item.append(details);
    }
    list.append(item);
  }
  panel.append(title, help, list);
  return panel;
}

export function sourceRepairHistoryPanel(entries = []) {
  const panel = document.createElement("div");
  panel.className = "memory-source-repair-history";
  const title = document.createElement("strong");
  title.textContent = "Recent source repairs";
  const help = document.createElement("small");
  help.textContent = "Repair history records source-version tracking resets and backup locations. It is audit evidence, not AI Memory.";
  const list = document.createElement("ol");
  const history = Array.isArray(entries) ? entries.slice(0, 5) : [];
  if (!history.length) {
    const empty = document.createElement("li");
    empty.textContent = "No source-version repairs have run yet.";
    list.append(empty);
  }
  for (const entry of history) {
    const item = document.createElement("li");
    item.className = "memory-source-repair-entry";
    const heading = document.createElement("div");
    const status = document.createElement("span");
    status.className = "memory-source-status-badge";
    status.dataset.syncStatus = entry.status === "repaired" ? "changed" : "blocked";
    status.textContent = entry.status || "unknown";
    const meta = document.createElement("code");
    meta.textContent = [entry.repairedAt || "no timestamp", entry.sourceId || "source"].join(" · ");
    heading.append(status, meta);
    const body = document.createElement("p");
    body.textContent = [
      entry.sourcePath ? `source ${entry.sourcePath}` : "",
      entry.backupPath ? `backup ${entry.backupPath}` : "",
      entry.message || entry.reason || ""
    ].filter(Boolean).join(" · ") || "Repair recorded without detail.";
    item.append(heading, body);
    list.append(item);
  }
  panel.append(title, help, list);
  return panel;
}

export function sourceMoveHistoryPanel(entries = []) {
  const panel = document.createElement("div");
  panel.className = "memory-source-move-history";
  const title = document.createElement("strong");
  title.textContent = "Recent source moves";
  const help = document.createElement("small");
  help.textContent = "Move history shows when a folder became managed Memory and where its rollback ledger lives.";
  const list = document.createElement("ol");
  const history = Array.isArray(entries) ? entries.slice(0, 5) : [];
  if (!history.length) {
    const empty = document.createElement("li");
    empty.textContent = "No move-on-import operation has run yet.";
    list.append(empty);
  }
  for (const entry of history) {
    const item = document.createElement("li");
    item.className = "memory-source-move-entry";
    const heading = document.createElement("div");
    const status = document.createElement("span");
    status.className = "memory-source-status-badge";
    status.dataset.syncStatus = entry.status === "moved" || entry.status === "restored" ? "changed" : "blocked";
    status.textContent = entry.status || "unknown";
    const meta = document.createElement("code");
    meta.textContent = [entry.at || "no timestamp", entry.action || "move", entry.sourceId || "source"].join(" · ");
    heading.append(status, meta);
    const body = document.createElement("p");
    body.textContent = [
      entry.originalPath ? `from ${entry.originalPath}` : "",
      entry.managedPath ? `to ${entry.managedPath}` : "",
      entry.ledgerPath ? `ledger ${entry.ledgerPath}` : "",
      entry.message || ""
    ].filter(Boolean).join(" · ") || "Move recorded without detail.";
    item.append(heading, body);
    list.append(item);
  }
  panel.append(title, help, list);
  return panel;
}

export function sourceVersionsCard(source, result) {
  const card = document.createElement("article");
  card.className = "memory-review-preview";
  const heading = document.createElement("div");
  heading.className = "memory-preview-heading";
  const title = document.createElement("strong");
  title.textContent = `Source versions: ${source.path || source.id}`;
  const meta = document.createElement("code");
  meta.textContent = result.updatedAt ? `manifest updated ${result.updatedAt}` : "no source version manifest yet";
  heading.append(title, meta);
  const list = document.createElement("ol");
  list.className = "memory-source-candidates";
  const entries = Array.isArray(result.entries) ? result.entries : [];
  if (!entries.length) {
    const empty = document.createElement("li");
    empty.textContent = "No imported source-file versions recorded for this source yet.";
    list.append(empty);
  }
  for (const entry of entries) {
    const item = document.createElement("li");
    item.textContent = [
      `v${entry.latestVersion ?? 0}`,
      entry.sourceFile || "unknown file",
      entry.latestModifiedAt || "unknown source modified time",
      `${String(entry.latestHash ?? "").slice(0, 12)}…`
    ].join(" · ");
    list.append(item);
  }
  card.append(heading, list);
  return card;
}

export function sourceReviewCard(review, onImportFiles, onPreviewDiff, onRepairVersions = () => {}) {
  const card = document.createElement("article");
  card.className = "memory-review-preview";
  const heading = document.createElement("div");
  heading.className = "memory-preview-heading";
  const title = document.createElement("strong");
  title.textContent = review.source?.path || "Source review";
  const sourceId = document.createElement("code");
  sourceId.textContent = review.source?.id || "source";
  heading.append(title, sourceId);
  const categories = review.scan?.categories ?? {};
  const summary = document.createElement("p");
  summary.textContent = [
    `${review.scan?.totalScanned ?? 0} scanned`,
    `${categories.compatible ?? 0} compatible`,
    `${categories.processed ?? 0} processed`,
    `${categories["raw-audio"] ?? 0} raw audio`,
    `${categories.unsupported ?? 0} unsupported`
  ].join(" · ");
  const boundary = document.createElement("p");
  boundary.textContent = review.boundary || "Source review is read-only.";
  const recommendation = document.createElement("p");
  recommendation.textContent = review.scan?.recommendation || "Review before intake.";
  const warning = document.createElement("p");
  warning.className = "memory-status";
  warning.dataset.tone = "warning";
  warning.textContent = review.versionManifestError
    ? `Version tracking warning: ${review.versionManifestError}`
    : "";
  warning.hidden = !review.versionManifestError;
  const repairGuidance = document.createElement("div");
  repairGuidance.className = "memory-source-repair-guidance";
  repairGuidance.hidden = !review.versionManifestError;
  const repairTitle = document.createElement("strong");
  repairTitle.textContent = "Repair required before blocked files can enter intake";
  const repairBody = document.createElement("p");
  repairBody.textContent = "Version tracking protects the human source from being re-imported as false-new memory. When it is unavailable, blocked files stay out of selected and bulk intake until the source history is repaired.";
  const repairSteps = document.createElement("ol");
  for (const step of [
    "Run Scan Source again after confirming the folder is still connected.",
    "If the warning remains, repair or restore the source-version manifest from the managed Memory metadata backup.",
    "Only then review changed files and create governed intake; no trusted wiki page is written directly."
  ]) {
    const item = document.createElement("li");
    item.textContent = step;
    repairSteps.append(item);
  }
  const repairActions = document.createElement("div");
  repairActions.className = "memory-review-actions";
  const repairButton = document.createElement("button");
  repairButton.type = "button";
  repairButton.textContent = "Repair Version Tracking";
  repairButton.addEventListener("click", () => onRepairVersions(review));
  repairActions.append(repairButton);
  repairGuidance.append(repairTitle, repairBody, repairSteps, repairActions);

  const filterBar = document.createElement("div");
  filterBar.className = "memory-source-filterbar";
  const categoryFilter = document.createElement("select");
  categoryFilter.setAttribute("aria-label", "Filter source candidates by category");
  categoryFilter.append(
    optionNode("all", "All candidates"),
    optionNode("compatible", "Compatible"),
    optionNode("processed", "Processed"),
    optionNode("raw-audio", "Raw audio"),
    optionNode("unsupported", "Unsupported")
  );
  const statusFilter = document.createElement("select");
  statusFilter.setAttribute("aria-label", "Filter source candidates by sync status");
  statusFilter.append(
    optionNode("all", "All sync states"),
    optionNode("new", "New"),
    optionNode("changed", "Changed"),
    optionNode("unchanged", "Unchanged"),
    optionNode("blocked", "Blocked"),
    optionNode("excluded", "Excluded")
  );
  const textFilter = document.createElement("input");
  textFilter.type = "search";
  textFilter.placeholder = "Filter by filename or folder";
  textFilter.setAttribute("aria-label", "Filter source candidates by text");
  const count = document.createElement("small");
  filterBar.append(categoryFilter, statusFilter, textFilter, count);

  const list = document.createElement("ol");
  list.className = "memory-source-candidates";
  const selected = new Set();
  let importSelectedButton = null;
  const updateSelectedActionState = () => {
    if (importSelectedButton) {
      importSelectedButton.disabled = selected.size === 0;
    }
  };
  const candidates = review.candidates ?? [];
  const eligibleFiles = candidates.filter(isEligibleSourceIntakeCandidate);
  const skippedUnchanged = candidates.filter((candidate) =>
    candidate.category === "compatible" && candidate.versionStatus === "unchanged"
  );
  const blockedFiles = candidates.filter((candidate) =>
    candidate.versionStatus === "version-manifest-unavailable" || candidate.error || candidate.blocked
  );
  const skippedUnsupported = candidates.filter((candidate) =>
    !isEligibleSourceIntakeCandidate(candidate) &&
    !(candidate.category === "compatible" && candidate.versionStatus === "unchanged") &&
    !blockedFiles.includes(candidate)
  );
  const newFiles = candidates.filter((candidate) =>
    candidate.category === "compatible" && candidate.versionStatus === "new"
  );
  const changedFileCandidates = candidates.filter((candidate) =>
    candidate.category === "compatible" && candidate.versionStatus === "changed"
  );
  const deltaSummary = sourceReviewDeltaSummary({
    newFiles,
    changedFiles: changedFileCandidates,
    skippedUnchanged,
    skippedUnsupported,
    blockedFiles,
  });

  const approvalPlan = document.createElement("div");
  approvalPlan.className = "memory-source-approval-plan";
  const approvalTitle = document.createElement("strong");
  approvalTitle.textContent = "Approval plan";
  const approvalBody = document.createElement("p");
  const batchFiles = eligibleFiles.slice(0, SOURCE_FILE_INTAKE_BATCH_LIMIT).map((candidate) => candidate.path);
  const deferredEligibleFiles = Math.max(0, eligibleFiles.length - batchFiles.length);
  approvalBody.textContent = [
    `${eligibleFiles.length} new/changed compatible file(s) ready for governed intake`,
    deferredEligibleFiles
      ? `${batchFiles.length} will be submitted in this batch; ${deferredEligibleFiles} deferred`
      : `${batchFiles.length} will be submitted in this batch`,
    `${skippedUnchanged.length} unchanged file(s) skipped`,
    `${skippedUnsupported.length} raw/processed/unsupported file(s) kept out of wiki intake`,
    `${blockedFiles.length} blocked file(s) require source/version repair`
  ].join(" · ");
  const approvalHelp = document.createElement("small");
  approvalHelp.textContent = "Bulk approval creates intake artifacts and review requests only for eligible files, in host-capped batches. It never writes trusted wiki pages directly.";
  approvalPlan.append(approvalTitle, approvalBody, approvalHelp);
  const emptyAction = document.createElement("p");
  emptyAction.className = "memory-status";
  emptyAction.dataset.tone = "warning";
  emptyAction.hidden = eligibleFiles.length > 0;
  emptyAction.textContent = blockedFiles.length
    ? "No eligible files are available because source/version repair is required first."
    : "No eligible new or changed compatible files are available for intake.";

  const renderCandidates = () => {
    list.replaceChildren();
    const category = categoryFilter.value;
    const status = statusFilter.value;
    const query = textFilter.value.trim().toLowerCase();
    const visible = candidates.filter((candidate) =>
      (category === "all" || candidate.category === category) &&
      (status === "all" || sourceCandidateSyncGroup(candidate) === status) &&
      (!query || String(candidate.path ?? "").toLowerCase().includes(query))
    );
    const groups = new Map();
    const rendered = visible.slice(0, SOURCE_REVIEW_RENDER_LIMIT);
    for (const candidate of rendered) {
      const folder = String(candidate.path ?? "").includes("/")
        ? String(candidate.path).split("/").slice(0, -1).join("/")
        : "root";
      const entries = groups.get(folder) ?? [];
      entries.push(candidate);
      groups.set(folder, entries);
    }
    for (const [folder, entries] of groups) {
      const group = document.createElement("li");
      group.className = "memory-source-candidate-group";
      const groupTitle = document.createElement("strong");
      groupTitle.textContent = `${folder} · ${entries.length}`;
      const nested = document.createElement("ol");
      for (const candidate of entries) {
        nested.append(sourceCandidateItem(candidate, selected, onPreviewDiff, updateSelectedActionState));
      }
      group.append(groupTitle, nested);
      list.append(group);
    }
    if (!visible.length) {
      const item = document.createElement("li");
      item.textContent = candidates.length
        ? "No source candidates match the current filters."
        : "No directly compatible candidate files found in the review sample.";
      list.append(item);
    } else if (visible.length > rendered.length) {
      const item = document.createElement("li");
      item.className = "memory-source-candidate-limit";
      item.textContent = `Showing ${rendered.length} of ${visible.length} matching candidate(s). Narrow the filter to inspect more files; bulk intake still uses all eligible files.`;
      list.append(item);
    }
    count.textContent = `${visible.length}/${candidates.length} candidate(s) visible`;
  };
  categoryFilter.addEventListener("change", renderCandidates);
  statusFilter.addEventListener("change", renderCandidates);
  textFilter.addEventListener("input", renderCandidates);
  renderCandidates();

  const actions = document.createElement("div");
  actions.className = "memory-review-actions";
  const importChangedButton = document.createElement("button");
  importChangedButton.type = "button";
  importChangedButton.textContent = deferredEligibleFiles
    ? `Create Intake Batch (${batchFiles.length}/${eligibleFiles.length})`
    : "Create Intake From New/Changed Files";
  importChangedButton.disabled = batchFiles.length === 0;
  importChangedButton.addEventListener("click", () => onImportFiles(review, batchFiles));
  const importButton = document.createElement("button");
  importSelectedButton = importButton;
  importButton.type = "button";
  importButton.textContent = "Create Intake From Selected Files";
  importButton.disabled = true;
  importButton.addEventListener("click", () => onImportFiles(
    review,
    [...selected].filter((file) => eligibleFiles.some((candidate) => candidate.path === file))
  ));
  updateSelectedActionState();
  actions.append(importChangedButton, importButton);
  card.append(heading, summary, boundary, recommendation, warning, repairGuidance, deltaSummary, approvalPlan, emptyAction, filterBar, list, actions);
  return card;
}

function sourceReviewDeltaSummary({
  newFiles = [],
  changedFiles = [],
  skippedUnchanged = [],
  skippedUnsupported = [],
  blockedFiles = [],
} = {}) {
  const panel = document.createElement("div");
  panel.className = "memory-source-delta-summary";
  const title = document.createElement("strong");
  title.textContent = "Review delta";
  const body = document.createElement("p");
  body.textContent = [
    `${newFiles.length} new`,
    `${changedFiles.length} changed`,
    `${skippedUnchanged.length} unchanged`,
    `${skippedUnsupported.length} excluded`,
    `${blockedFiles.length} blocked`
  ].join(" · ");
  const help = document.createElement("small");
  help.textContent = "Only new and changed compatible files can become governed intake. Unchanged, unsupported, raw, processed, and blocked files stay out of wiki promotion.";
  const sampleList = document.createElement("ol");
  sampleList.className = "memory-source-delta-files";
  for (const [label, files] of [
    ["New", newFiles],
    ["Changed", changedFiles],
    ["Unchanged", skippedUnchanged],
    ["Excluded", skippedUnsupported],
    ["Blocked", blockedFiles],
  ]) {
    const item = document.createElement("li");
    const sample = files.slice(0, 3).map((candidate) => candidate.path).join(", ");
    item.textContent = sample
      ? `${label}: ${sample}${files.length > 3 ? `, +${files.length - 3} more` : ""}`
      : `${label}: none`;
    sampleList.append(item);
  }
  panel.append(title, body, help, sampleList);
  return panel;
}

function isEligibleSourceIntakeCandidate(candidate) {
  return candidate.category === "compatible" && ["new", "changed"].includes(candidate.versionStatus);
}

function sourceCandidateSyncGroup(candidate) {
  if (candidate.versionStatus === "version-manifest-unavailable" || candidate.error || candidate.blocked) {
    return "blocked";
  }
  if (candidate.category !== "compatible") {
    return "excluded";
  }
  if (["new", "changed", "unchanged"].includes(candidate.versionStatus)) {
    return candidate.versionStatus;
  }
  return "excluded";
}

function sourceCandidateStatusText(candidate) {
  const status = sourceCandidateSyncGroup(candidate);
  if (status === "new") return "New";
  if (status === "changed") return `Changed${candidate.sourceVersion ? ` from v${candidate.sourceVersion}` : ""}`;
  if (status === "unchanged") return `Unchanged${candidate.sourceVersion ? ` v${candidate.sourceVersion}` : ""}`;
  if (status === "blocked") return "Blocked";
  if (candidate.category === "processed") return "Processed only";
  if (candidate.category === "raw-audio") return "Raw source";
  return "Excluded";
}

function sourceCandidateReason(candidate, eligible) {
  if (eligible) {
    return candidate.versionStatus === "changed"
      ? "Eligible: this file changed since the last governed intake."
      : "Eligible: this file has not been imported before.";
  }
  if (candidate.versionStatus === "unchanged") {
    return "Skipped: already imported and unchanged.";
  }
  if (candidate.versionStatus === "version-manifest-unavailable" || candidate.error || candidate.blocked) {
    return candidate.error || candidate.reason || "Blocked: repair source/version history before intake.";
  }
  if (candidate.category === "processed" || candidate.category === "raw-audio") {
    return "Kept as source evidence; this is not directly imported as a wiki candidate.";
  }
  return "Excluded from governed wiki intake.";
}

export function optionNode(value, text) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = text;
  return node;
}

function sourceCandidateItem(candidate, selected, onPreviewDiff, onSelectionChange = () => {}) {
  const item = document.createElement("li");
  item.className = "memory-source-candidate";
  item.dataset.syncStatus = sourceCandidateSyncGroup(candidate);
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = candidate.path;
  const eligible = isEligibleSourceIntakeCandidate(candidate);
  input.disabled = !eligible;
  input.checked = selected.has(candidate.path);
  input.addEventListener("change", () => {
    if (!eligible) {
      input.checked = false;
      selected.delete(candidate.path);
      return;
    }
    if (input.checked) selected.add(candidate.path);
    else selected.delete(candidate.path);
    onSelectionChange();
  });
  const text = document.createElement("span");
  text.className = "memory-source-candidate-main";
  const badge = document.createElement("strong");
  badge.className = "memory-source-status-badge";
  badge.dataset.syncStatus = sourceCandidateSyncGroup(candidate);
  badge.textContent = sourceCandidateStatusText(candidate);
  const pathText = document.createElement("span");
  pathText.className = "memory-source-candidate-path";
  pathText.textContent = candidate.path;
  const meta = document.createElement("small");
  meta.textContent = `${candidate.category} · ${formatCount(candidate.bytes)} bytes`;
  const reason = document.createElement("small");
  reason.className = "memory-source-candidate-reason";
  reason.textContent = sourceCandidateReason(candidate, eligible);
  text.append(badge, pathText, meta, reason);
  label.append(input, text);
  item.append(label);
  if (candidate.category === "compatible" && candidate.previousSourceContentHash) {
    const diffButton = document.createElement("button");
    diffButton.type = "button";
    diffButton.textContent = "Diff";
    diffButton.addEventListener("click", () => onPreviewDiff(candidate));
    item.append(diffButton);
  }
  return item;
}

export function sourceDiffCard(result) {
  const card = document.createElement("article");
  card.className = "memory-review-preview";
  const heading = document.createElement("div");
  heading.className = "memory-preview-heading";
  const title = document.createElement("strong");
  title.textContent = `Source diff: ${result.sourceFile || "source file"}`;
  const meta = document.createElement("code");
  meta.textContent = result.status === "unavailable"
    ? result.reason || "diff unavailable"
    : `v${result.latestVersion ?? 0} · ${result.status} · ${String(result.currentHash ?? "").slice(0, 12)}…`;
  heading.append(title, meta);
  const list = document.createElement("ol");
  list.className = "memory-source-diff";
  const changes = Array.isArray(result.changes) ? result.changes : [];
  if (!changes.length) {
    const empty = document.createElement("li");
    empty.textContent = result.status === "unavailable"
      ? result.reason || "No previous governed intake artifact is recorded."
      : "No line-level changes found.";
    list.append(empty);
  }
  for (const change of changes) {
    const item = document.createElement("li");
    item.dataset.type = change.type;
    const marker = document.createElement("strong");
    marker.textContent = change.type === "added" ? "+" : "-";
    const text = document.createElement("span");
    text.textContent = `L${change.line}: ${change.text}`;
    item.append(marker, text);
    list.append(item);
  }
  if (result.truncated) {
    const truncated = document.createElement("p");
    truncated.className = "memory-status";
    truncated.dataset.tone = "warning";
    truncated.textContent = "Diff preview truncated. Use smaller files or inspect the source directly for full context.";
    card.append(heading, list, truncated);
    return card;
  }
  card.append(heading, list);
  return card;
}

export function sourceArtifactPreviewCard(result) {
  const card = document.createElement("article");
  card.className = "memory-review-preview";
  const insights = artifactInsightsFromMarkdown(result.content || result.excerpt || "");
  const heading = document.createElement("div");
  heading.className = "memory-preview-heading";
  const title = document.createElement("strong");
  title.textContent = result.title || "Source intake artifact";
  const path = document.createElement("code");
  path.textContent = result.path || "INTAKE";
  heading.append(title, path);
  const meta = document.createElement("p");
  meta.textContent = [
    insights.sourceType || result.kind || "intake source",
    insights.pageTitle || "",
    insights.pageUrl || "",
    insights.sourceStats || "",
    insights.capturedAt ? `captured ${insights.capturedAt}` : ""
  ].filter(Boolean).join(" · ");
  const boundary = document.createElement("p");
  boundary.className = "memory-status";
  boundary.dataset.tone = "warning";
  boundary.textContent = "This is preserved intake evidence. It can inform a draft, but it is not trusted AI Memory until verification and promotion complete.";
  const content = document.createElement("pre");
  content.textContent = result.content || "No source artifact content returned.";
  card.append(heading, meta, boundary, content);
  if (result.truncated) {
    const truncated = document.createElement("p");
    truncated.className = "memory-status";
    truncated.dataset.tone = "warning";
    truncated.textContent = "Source preview truncated for safety. The full artifact remains in Living Archive intake.";
    card.append(truncated);
  }
  return card;
}

export function wikiPagePreviewCard(result) {
  const card = document.createElement("article");
  card.className = "memory-review-preview";
  const heading = document.createElement("div");
  heading.className = "memory-preview-heading";
  const title = document.createElement("strong");
  title.textContent = result.title || "AI Memory page";
  const path = document.createElement("code");
  path.textContent = result.path || "AI_MEMORY/wiki";
  heading.append(title, path);
  const meta = document.createElement("p");
  meta.textContent = [
    result.modifiedAt ? `modified ${result.modifiedAt}` : "",
    result.bytes ? `${formatCount(result.bytes)} bytes` : ""
  ].filter(Boolean).join(" · ");
  const boundary = document.createElement("p");
  boundary.className = "memory-status";
  boundary.dataset.tone = "success";
  boundary.textContent = "This is trusted AI Memory after governed promotion. Compare it with the source artifact and review history before relying on it for important decisions.";
  const content = document.createElement("pre");
  content.textContent = result.content || "No AI Memory page content returned.";
  card.append(heading, meta, boundary, content);
  if (result.truncated) {
    const truncated = document.createElement("p");
    truncated.className = "memory-status";
    truncated.dataset.tone = "warning";
    truncated.textContent = "Page preview truncated for safety. The full page remains in AI_MEMORY/wiki.";
    card.append(truncated);
  }
  return card;
}
