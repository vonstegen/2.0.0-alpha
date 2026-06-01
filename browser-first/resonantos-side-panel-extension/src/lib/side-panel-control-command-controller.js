const TERMINAL_CONTROL_RUN_STATUSES = new Set(["completed", "blocked", "denied", "cancelled", "failed"]);

export function createSidePanelControlCommandController({
  activeTab = async () => null,
  addMessage = async () => undefined,
  browserJobStore,
  clearControlPreflight = async () => undefined,
  createBrowserJob = async () => null,
  getBrowserJobScheduler = () => null,
  getCurrentControlRun = () => null,
  permissionForUrl = async () => "ask-before-action",
  persistContextDockExpanded = async () => undefined,
  renderControlMonitor = () => undefined,
  renderJobMonitor = () => undefined,
  requestControlPreflight = async () => undefined,
  setActivity = () => undefined,
  setContextDockExpanded = () => undefined,
  setCurrentControlRun = () => undefined,
  setNextControlPreflightDecision = () => undefined,
  setPendingApproval = () => undefined,
  setStatus = () => undefined,
  shouldRequireControlPreflight = () => false,
  siteKeyForUrl = () => "unknown-site",
  taskConsentStore,
  updateBrowserJob = async () => undefined
} = {}) {
  if (!browserJobStore) {
    throw new Error("createSidePanelControlCommandController requires browserJobStore.");
  }
  if (!taskConsentStore) {
    throw new Error("createSidePanelControlCommandController requires taskConsentStore.");
  }

  const pageLockForTab = (tab, reason = "Agent Control run") => ({
    type: "tab",
    tabId: tab?.id ?? null,
    url: tab?.url ?? "",
    siteKey: siteKeyForUrl(tab?.url),
    acquiredAt: new Date().toISOString(),
    reason
  });

  const prepareBrowserJobPageLock = async ({ goal, existingJob = null, status = "running" } = {}) => {
    const tab = await activeTab();
    const pageLock = pageLockForTab(tab, existingJob?.id
      ? `Resumed Agent Control job ${existingJob.id}`
      : `Agent Control goal: ${String(goal ?? "").slice(0, 120)}`);
    let conflict = browserJobStore.conflictingActiveJobForLock(pageLock, {
      excludingJobId: existingJob?.id ?? ""
    });
    const currentControlRun = getCurrentControlRun();
    if (conflict && currentControlRun && conflict.id === currentControlRun.id && TERMINAL_CONTROL_RUN_STATUSES.has(currentControlRun.status)) {
      await updateBrowserJob(conflict.id, {
        status: currentControlRun.status,
        pageLock: null,
        artifacts: currentControlRun.artifacts,
        summary: currentControlRun.summary,
        planner: currentControlRun.planner,
        steps: currentControlRun.steps
      });
      conflict = browserJobStore.conflictingActiveJobForLock(pageLock, {
        excludingJobId: existingJob?.id ?? ""
      });
    }
    if (conflict && status === "queued") {
      return pageLock;
    }
    if (conflict?.status === "approval") {
      if (currentControlRun?.id === conflict.id) {
        setPendingApproval(null);
        setCurrentControlRun({
          ...currentControlRun,
          status: "cancelled",
          completedAt: new Date().toISOString()
        });
        renderControlMonitor();
      }
      await updateBrowserJob(conflict.id, {
        status: "cancelled",
        pageLock: null,
        artifacts: currentControlRun?.id === conflict.id ? currentControlRun.artifacts : conflict.artifacts,
        summary: currentControlRun?.id === conflict.id ? currentControlRun.summary : conflict.summary,
        planner: currentControlRun?.id === conflict.id ? currentControlRun.planner : conflict.planner,
        steps: currentControlRun?.id === conflict.id ? currentControlRun.steps : conflict.steps
      });
      conflict = browserJobStore.conflictingActiveJobForLock(pageLock, {
        excludingJobId: existingJob?.id ?? ""
      });
    }
    if (conflict) {
      throw new Error(`Cannot start Agent Control on ${pageLock.siteKey}: ${conflict.id} is already ${conflict.status} on this browser target. Focus, pause, cancel, or finish that job first.`);
    }
    return pageLock;
  };

  const runControlCommand = async (goal, options = {}) => {
    const tab = await activeTab();
    const mode = tab?.url ? await permissionForUrl(tab.url) : "ask-before-action";
    if (mode === "blocked") {
      await addMessage("system", `Agent Control is blocked on ${siteKeyForUrl(tab?.url)}. Change the current-site permission before asking Augmentor to operate this page.`);
      setStatus("Control blocked");
      return null;
    }
    const existingConsent = await taskConsentStore.consentFor({
      siteKey: siteKeyForUrl(tab?.url),
      goal
    });
    if (options.resumedFromJob) {
      setNextControlPreflightDecision({
        ...(options.resumedFromJob.preflightDecision ?? {}),
        id: options.resumedFromJob.preflightDecision?.id ?? options.resumedFromJob.id,
        goal,
        siteKey: options.resumedFromJob.preflightDecision?.siteKey ?? siteKeyForUrl(tab?.url),
        taskClass: options.resumedFromJob.preflightDecision?.taskClass ?? existingConsent?.taskClass ?? "general",
        mode: "resumed",
        permissionMode: mode,
        source: "browser-job-store",
        reason: `Resumed from browser job ${options.resumedFromJob.id}.`
      });
    }
    if (shouldRequireControlPreflight({
      goal,
      mode,
      existingConsent,
      alreadyApproved: Boolean(options.preflightApproved),
      resumedFromJob: Boolean(options.resumedFromJob)
    })) {
      await requestControlPreflight({
        goal,
        mode,
        siteKey: siteKeyForUrl(tab?.url),
        tab
      });
      return null;
    }
    if (!options.resumedFromJob && existingConsent?.mode === "allow-safe" && !options.preflightApproved) {
      setNextControlPreflightDecision({
        id: existingConsent.id ?? `${existingConsent.siteKey}::${existingConsent.taskClass}`,
        goal,
        siteKey: existingConsent.siteKey,
        taskClass: existingConsent.taskClass,
        mode: "skipped-by-consent",
        permissionMode: mode,
        decidedAt: new Date().toISOString(),
        source: existingConsent.source || "task-consent-store",
        reason: existingConsent.reason || "Stored safe task-class consent allowed preflight skip."
      });
    }
    await clearControlPreflight();
    try {
      const queuedJob = await createBrowserJob({
        existingJob: options.resumedFromJob ?? null,
        goal,
        planner: "observe-act-verify-loop",
        summary: `${options.resumedFromJob?.id ? `Continuation of ${options.resumedFromJob.id}. ` : ""}Queued browser-agent loop. The scheduler observes the page, asks for one safe next action, executes it, then verifies before continuing.`,
        status: "queued"
      });
      setContextDockExpanded(true);
      await persistContextDockExpanded();
      await browserJobStore.setMonitorCollapsed(false);
      await addMessage(
        "system",
        [
          options.resumedFromJob ? "Agent Control job queued for continuation." : "Agent Control job queued.",
          `Job: ${queuedJob.id}`,
          `Goal: ${goal}`,
          "Scheduler: will run when capacity and page-lock rules allow it."
        ].join("\n")
      );
      renderJobMonitor();
      await getBrowserJobScheduler()?.tick?.();
      return queuedJob;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Agent Control could not start.", error);
      await addMessage("system", `Agent Control could not start.\n${message}`);
      setStatus("Control blocked");
      setActivity("failed", "Control could not start", message);
      return null;
    }
  };

  return {
    pageLockForTab,
    prepareBrowserJobPageLock,
    runControlCommand
  };
}
