// Intent citation: docs/architecture/ADR-027-living-archive-llm-wiki-compliance.md

function pipelineStep(label, state, detail = "") {
  const node = document.createElement("li");
  node.className = "memory-pipeline-step";
  node.dataset.state = state;
  const marker = document.createElement("span");
  marker.className = "memory-pipeline-marker";
  marker.setAttribute("aria-hidden", "true");
  const labelNode = document.createElement("strong");
  labelNode.textContent = label;
  const detailNode = document.createElement("small");
  detailNode.textContent = detail;
  node.append(marker, labelNode, detailNode);
  return node;
}

function reviewPipeline(request) {
  const node = document.createElement("ol");
  node.className = "memory-pipeline";
  node.setAttribute("aria-label", "Archive pipeline timeline");
  const reviewStatus = request.status || "pending";
  const verificationStatus = request.draftVerificationStatus || "";
  const promotionStatus = request.promotionStatus || "";
  const rollbackStatus = request.rollbackStatus || "";
  const revisionStatus = request.draftRevisionStatus || "";
  const hasDraft = Boolean(request.draftArtifactPath);

  const reviewState = reviewStatus === "approved"
    ? "complete"
    : reviewStatus === "rejected"
      ? "blocked"
      : reviewStatus === "in-progress"
        ? "active"
        : "waiting";
  const draftState = hasDraft ? "complete" : reviewStatus === "approved" ? "active" : "waiting";
  const verifyState = verificationStatus === "verified"
    ? "complete"
    : verificationStatus === "needs-revision"
      ? "blocked"
      : hasDraft
        ? "active"
        : "waiting";
  const reviseState = revisionStatus === "revised" || request.supersedesDraftPath
    ? "complete"
    : verificationStatus === "needs-revision"
      ? "active"
      : "waiting";
  const promoteState = promotionStatus === "promoted"
    ? "complete"
    : verificationStatus === "verified"
      ? "active"
      : "waiting";
  const restoreState = rollbackStatus === "restored" ? "complete" : request.backupPath ? "available" : "waiting";

  node.append(
    pipelineStep("Intake", request.artifactPath ? "complete" : "blocked", request.artifactPath ? "source captured" : "missing source"),
    pipelineStep("Review", reviewState, reviewStatus),
    pipelineStep("Draft", draftState, hasDraft ? "artifact ready" : "not generated"),
    pipelineStep("Verify", verifyState, verificationStatus || "not run"),
    pipelineStep("Revise", reviseState, revisionStatus || (verificationStatus === "needs-revision" ? "needed" : "optional")),
    pipelineStep("Promote", promoteState, promotionStatus || "blocked until verified"),
    pipelineStep("Restore", restoreState, rollbackStatus || (request.backupPath ? "backup available" : "no backup"))
  );
  return node;
}

export function reviewRequestNextAction(request = {}) {
  if (!request.artifactPath && !request.path) {
    return {
      tone: "error",
      label: "Repair request",
      detail: "This review request is missing source evidence. Do not draft or promote it until the intake artifact is restored."
    };
  }
  if (request.status === "rejected") {
    return {
      tone: "blocked",
      label: "Rejected",
      detail: "No trusted memory write will happen from this artifact unless a new review request is created."
    };
  }
  if (request.promotionStatus === "promoted") {
    return {
      tone: "success",
      label: "Promoted",
      detail: request.backupPath
        ? "This artifact has been promoted into AI Memory. A backup is available if the promotion needs to be restored."
        : "This artifact has been promoted into AI Memory."
    };
  }
  if (request.draftVerificationStatus === "needs-revision") {
    return {
      tone: "warning",
      label: "Revise draft",
      detail: "The verifier found issues. Revise the draft before any promotion can be attempted."
    };
  }
  if (request.draftVerificationStatus === "verified") {
    return {
      tone: "success",
      label: "Ready to promote",
      detail: "The draft is verified. Promotion is the only step that writes into trusted AI Memory."
    };
  }
  if (request.draftArtifactPath) {
    return {
      tone: "active",
      label: "Verify draft",
      detail: "Preview the draft, then run verification. Unverified drafts remain review artifacts only."
    };
  }
  if (request.status === "approved") {
    return {
      tone: "active",
      label: "Generate draft",
      detail: "Create a draft wiki update from this approved intake artifact. This still does not write trusted AI Memory."
    };
  }
  if (request.status === "in-progress") {
    return {
      tone: "active",
      label: "Finish review",
      detail: "Approve only if this source should become a draft candidate; reject it if it should stay as raw intake."
    };
  }
  return {
    tone: "waiting",
    label: "Start review",
    detail: "Inspect the source artifact first. Intake is preserved separately from AI-curated memory."
  };
}

export function reviewRequestCard(request, onTransition, onDraft, onPreviewDraft, onPreviewSource, onPreviewPage, { focused = false } = {}) {
  const card = document.createElement("article");
  card.className = "memory-review-request";
  card.dataset.reviewPath = request.path || "";
  card.dataset.artifactPath = request.artifactPath || "";
  if (focused) card.dataset.focused = "true";
  const heading = document.createElement("div");
  heading.className = "memory-review-heading";
  const title = document.createElement("strong");
  title.textContent = request.title || "Untitled review request";
  const status = document.createElement("span");
  status.textContent = request.status || "pending";
  heading.append(title, status);
  const artifact = document.createElement("code");
  artifact.textContent = request.artifactPath || request.path || "REVIEW/requests";
  const draft = document.createElement("code");
  draft.className = "memory-review-draft";
  draft.textContent = request.draftArtifactPath ? `draft: ${request.draftArtifactPath}` : "draft: not generated";
  const reason = document.createElement("p");
  reason.textContent = request.reason || "No review reason recorded.";
  const pipeline = reviewPipeline(request);
  const next = reviewRequestNextAction(request);
  const nextAction = document.createElement("p");
  nextAction.className = "memory-review-next";
  nextAction.dataset.tone = next.tone;
  const nextLabel = document.createElement("strong");
  nextLabel.textContent = `Next: ${next.label}`;
  const nextDetail = document.createElement("span");
  nextDetail.textContent = next.detail;
  nextAction.append(nextLabel, nextDetail);
  const actions = document.createElement("div");
  actions.className = "memory-review-actions";
  const makeAction = (label, nextStatus) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.reviewStatus = nextStatus;
    button.disabled = request.status === nextStatus;
    button.addEventListener("click", () => onTransition(request, nextStatus));
    return button;
  };
  actions.append(
    makeAction("Start", "in-progress"),
    makeAction("Approve", "approved"),
    makeAction("Reject", "rejected")
  );
  const sourceButton = document.createElement("button");
  sourceButton.type = "button";
  sourceButton.textContent = "Inspect Source";
  sourceButton.disabled = !request.artifactPath;
  sourceButton.addEventListener("click", () => onPreviewSource(request));
  actions.append(sourceButton);
  const draftButton = document.createElement("button");
  draftButton.type = "button";
  draftButton.textContent = request.draftArtifactPath ? "Drafted" : "Draft";
  draftButton.disabled = request.status !== "approved" || Boolean(request.draftArtifactPath);
  draftButton.addEventListener("click", () => onDraft(request));
  actions.append(draftButton);
  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview";
  previewButton.disabled = !request.draftArtifactPath;
  previewButton.addEventListener("click", () => onPreviewDraft(request));
  actions.append(previewButton);
  const pageButton = document.createElement("button");
  pageButton.type = "button";
  pageButton.textContent = "Preview Page";
  pageButton.disabled = request.promotionStatus !== "promoted" || !request.promotedPage;
  pageButton.addEventListener("click", () => onPreviewPage(request));
  actions.append(pageButton);
  card.append(heading, artifact, draft, reason, pipeline, nextAction, actions);
  return card;
}

export function promotionCard(entry, onRestore, onPreviewPage, { focused = false } = {}) {
  const card = document.createElement("article");
  card.className = "memory-promotion-card";
  card.dataset.promotedPage = entry.promotedPage || "";
  card.dataset.reviewPath = entry.path || "";
  if (focused) card.dataset.focused = "true";
  const heading = document.createElement("div");
  heading.className = "memory-promotion-heading";
  const title = document.createElement("strong");
  title.textContent = entry.title || "Promoted wiki update";
  const status = document.createElement("span");
  status.textContent = entry.status || "promoted";
  heading.append(title, status);
  const page = document.createElement("code");
  page.textContent = entry.promotedPage || "AI_MEMORY/wiki";
  const meta = document.createElement("p");
  meta.textContent = entry.promotedAt
    ? `Promoted ${entry.promotedAt}`
    : "Promotion time not recorded.";
  card.append(heading, page, meta);
  if (entry.backupPath) {
    const backup = document.createElement("code");
    backup.textContent = `backup: ${entry.backupPath}`;
    card.append(backup);
  }
  if (entry.rollbackStatus === "restored") {
    const restored = document.createElement("p");
    restored.textContent = entry.restoredAt
      ? `Restored from backup ${entry.restoredAt}.`
      : "Restored from backup.";
    card.append(restored);
  }
  const actions = document.createElement("div");
  actions.className = "memory-review-actions";
  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview Page";
  previewButton.disabled = !entry.promotedPage;
  previewButton.addEventListener("click", () => onPreviewPage(entry));
  const restoreButton = document.createElement("button");
  restoreButton.type = "button";
  restoreButton.textContent = entry.rollbackStatus === "restored" ? "Restored" : "Restore Backup";
  restoreButton.disabled = !entry.backupPath || entry.rollbackStatus === "restored";
  restoreButton.addEventListener("click", () => onRestore(entry));
  actions.append(previewButton, restoreButton);
  card.append(actions);
  return card;
}
