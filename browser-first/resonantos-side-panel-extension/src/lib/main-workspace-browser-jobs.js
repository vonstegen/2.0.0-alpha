import {
  browserJobSchedulerState,
  normalizeBrowserJob
} from "./browser-job-store.js";
import { controlRunProgressSummary } from "./monitor-renderers.js";

const ACTIVE_STATUSES = new Set(["queued", "running", "approval", "paused"]);

export function mainBrowserJobSnapshot({ activeJobId = "", jobs = [], maxConcurrent = 2 } = {}) {
  const normalizedJobs = Array.isArray(jobs)
    ? jobs.map((job) => normalizeBrowserJob(job)).filter((job) => job.id)
    : [];
  const activeJobs = normalizedJobs.filter((job) => ACTIVE_STATUSES.has(job.status));
  const approvalJobs = activeJobs.filter((job) => job.status === "approval" && job.pendingApproval);
  const activeFocusedJob = normalizedJobs.find((job) => job.id === activeJobId && ACTIVE_STATUSES.has(job.status));
  const focusedJob = activeFocusedJob ?? approvalJobs[0] ?? activeJobs[0] ?? normalizedJobs[0] ?? null;
  const scheduler = browserJobSchedulerState(normalizedJobs, { maxConcurrent });
  const blocked = activeJobs.filter((job) => ["approval", "paused"].includes(job.status)).length +
    scheduler.lockBlockedQueued.length +
    scheduler.capacityBlockedQueued.length;
  return {
    activeCount: activeJobs.length,
    approvalJobs,
    blocked,
    focusedJob,
    jobs: normalizedJobs,
    scheduler
  };
}

function statusLabel(job) {
  if (!job) return "No browser jobs";
  if (job.status === "approval") return "Needs approval";
  if (job.status === "running") return "Running";
  if (job.status === "queued") return "Queued";
  if (job.status === "paused") return "Paused";
  if (job.status === "blocked") return "Blocked";
  if (job.status === "failed") return "Failed";
  if (job.status === "cancelled") return "Stopped";
  if (job.status === "completed") return "Completed";
  return String(job.status || "Unknown");
}

function jobTarget(job) {
  return [
    job?.pageLock?.siteKey,
    job?.pageLock?.tabId !== null && job?.pageLock?.tabId !== undefined ? `tab ${job.pageLock.tabId}` : ""
  ].filter(Boolean).join(" · ");
}

function jobRecoveryEvidence(job) {
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const step = [...steps].reverse()
    .find((candidate) => candidate?.details?.verificationRetry || candidate?.details?.actionRetry);
  const details = step?.details ?? {};
  return [
    details.verificationRetry ? `rechecked: ${details.verificationRetry}` : "",
    details.actionRetry ? `retried: ${details.actionRetry}` : ""
  ].filter(Boolean).join(" · ");
}

function approvalActionLabel(job) {
  const approval = job?.pendingApproval;
  const step = approval?.step ?? {};
  return String(step.label ?? step.text ?? step.url ?? step.query ?? step.type ?? "pending action").slice(0, 120);
}

function approvalTargetLabel(job) {
  return [
    job?.pageLock?.siteKey,
    job?.pageLock?.tabId !== null && job?.pageLock?.tabId !== undefined ? `tab ${job.pageLock.tabId}` : "",
    job?.pendingApproval?.history?.at?.(-1)?.observation?.title
  ].filter(Boolean).join(" · ");
}

function createButton(documentRef, label, title, handler, { primary = false } = {}) {
  const button = documentRef.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;
  if (primary) button.dataset.primary = "true";
  button.addEventListener("click", handler);
  return button;
}

export function renderMainBrowserJobStatus({
  activeJobId = "",
  container,
  jobs = [],
  maxConcurrent = 2,
  onCancelFocused,
  onFocusJob,
  onOpenMonitor
} = {}) {
  if (!container) return mainBrowserJobSnapshot({ activeJobId, jobs, maxConcurrent });
  const snapshot = mainBrowserJobSnapshot({ activeJobId, jobs, maxConcurrent });
  const documentRef = container.ownerDocument;
  const { activeCount, approvalJobs, blocked, focusedJob, scheduler } = snapshot;
  container.replaceChildren();
  container.hidden = activeCount === 0 && !focusedJob;
  if (container.hidden) return snapshot;

  container.dataset.status = focusedJob?.status ?? "idle";
  const copy = documentRef.createElement("div");
  copy.className = "main-browser-jobs-copy";
  const eyebrow = documentRef.createElement("small");
  eyebrow.textContent = "Agent Control";
  const title = documentRef.createElement("strong");
  title.textContent = focusedJob ? `${statusLabel(focusedJob)} · ${focusedJob.goal}` : "No active browser work";
  const meta = documentRef.createElement("span");
  meta.textContent = [
    `${activeCount} active`,
    `${scheduler.runnableQueued.length} runnable`,
    `${scheduler.lockBlockedQueued.length} locked`,
    `${scheduler.capacityBlockedQueued.length} waiting`,
    blocked ? `${blocked} needs attention` : "",
    focusedJob ? jobTarget(focusedJob) : ""
  ].filter(Boolean).join(" · ");
  copy.append(eyebrow, title, meta);

  if (focusedJob?.steps?.length) {
    const progress = documentRef.createElement("span");
    progress.className = "main-browser-jobs-progress";
    progress.textContent = controlRunProgressSummary(focusedJob);
    copy.append(progress);
  }
  const recoveryEvidence = jobRecoveryEvidence(focusedJob);
  if (recoveryEvidence) {
    const recovery = documentRef.createElement("span");
    recovery.className = "main-browser-jobs-recovery";
    recovery.textContent = `Recovery: ${recoveryEvidence}`;
    copy.append(recovery);
  }
  if (approvalJobs.length) {
    const approvalQueue = documentRef.createElement("div");
    approvalQueue.className = "main-browser-jobs-approvals";
    const approvalLabel = documentRef.createElement("small");
    approvalLabel.textContent = `${approvalJobs.length} approval ${approvalJobs.length === 1 ? "card" : "cards"}`;
    approvalQueue.append(approvalLabel);
    approvalJobs.slice(0, 3).forEach((job) => {
      const card = documentRef.createElement("article");
      card.className = "main-browser-jobs-approval-card";
      card.dataset.active = job.id === activeJobId ? "true" : "false";
      const details = documentRef.createElement("div");
      const title = documentRef.createElement("strong");
      title.textContent = `${job.goal}: ${approvalActionLabel(job)}`;
      const reason = documentRef.createElement("span");
      reason.textContent = job.pendingApproval?.reason ?? "This browser action requires human approval.";
      const target = documentRef.createElement("small");
      target.textContent = approvalTargetLabel(job) || "Review in Browser Jobs before approval.";
      details.append(title, reason, target);
      const review = createButton(
        documentRef,
        job.id === activeJobId ? "Open review" : "Focus review",
        `Review approval for ${job.goal}`,
        () => (job.id === activeJobId ? onOpenMonitor?.() : onFocusJob?.(job)),
        { primary: job.id !== activeJobId }
      );
      card.append(details, review);
      approvalQueue.append(card);
    });
    if (approvalJobs.length > 3) {
      const more = documentRef.createElement("small");
      more.textContent = `${approvalJobs.length - 3} more approval jobs in Browser Jobs.`;
      approvalQueue.append(more);
    }
    copy.append(approvalQueue);
  }

  const actions = documentRef.createElement("div");
  actions.className = "main-browser-jobs-actions";
  if (focusedJob && typeof onFocusJob === "function") {
    actions.append(createButton(documentRef, "Focus", `Focus ${focusedJob.goal}`, () => onFocusJob(focusedJob)));
  }
  if (typeof onOpenMonitor === "function") {
    actions.append(createButton(documentRef, "Open monitor", "Open the full Browser Jobs monitor in the Augmentor side panel", onOpenMonitor, { primary: true }));
  }
  if (focusedJob && !["completed", "cancelled", "failed", "blocked", "denied"].includes(focusedJob.status) && typeof onCancelFocused === "function") {
    actions.append(createButton(documentRef, "Stop", `Stop ${focusedJob.goal}`, () => onCancelFocused(focusedJob)));
  }

  container.append(copy, actions);
  return snapshot;
}
