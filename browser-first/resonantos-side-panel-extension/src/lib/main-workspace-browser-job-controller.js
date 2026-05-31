const TERMINAL_STATUSES = new Set(["blocked", "cancelled", "completed", "denied", "failed"]);

export function createMainWorkspaceBrowserJobController({
  addSystemMessage = async () => undefined,
  afterChange = () => undefined,
  now = () => new Date().toISOString(),
  openSidebar = async () => undefined,
  storage,
  storageKeys
} = {}) {
  const browserJobsKey = storageKeys?.browserJobs ?? "augmentorBrowserJobs";
  const activeBrowserJobKey = storageKeys?.activeBrowserJob ?? "augmentorActiveBrowserJob";
  const pendingSidebarPromptKey = storageKeys?.pendingSidebarPrompt ?? "augmentorPendingSidebarPrompt";

  const readJobs = async () => {
    const stored = await storage?.get?.([
      browserJobsKey,
      activeBrowserJobKey
    ]).catch(() => ({}));
    return {
      activeJobId: String(stored?.[activeBrowserJobKey] ?? ""),
      jobs: Array.isArray(stored?.[browserJobsKey]) ? stored[browserJobsKey] : []
    };
  };

  const openMonitor = async () => {
    await storage?.set?.({
      [pendingSidebarPromptKey]: {
        createdAt: now(),
        prompt: "/jobs"
      }
    }).catch(() => undefined);
    await openSidebar();
  };

  const focusJob = async (job) => {
    if (!job?.id) return false;
    await storage?.set?.({
      [activeBrowserJobKey]: job.id,
      [pendingSidebarPromptKey]: {
        createdAt: now(),
        prompt: `/jobs focus ${job.id}`
      }
    }).catch(() => undefined);
    afterChange();
    await openSidebar();
    return true;
  };

  const cancelJob = async (job) => {
    if (!job?.id) return false;
    const { activeJobId, jobs } = await readJobs();
    let changed = false;
    const completedAt = now();
    const nextJobs = jobs.map((candidate) => {
      if (candidate?.id !== job.id || TERMINAL_STATUSES.has(candidate?.status)) return candidate;
      changed = true;
      return {
        ...candidate,
        completedAt,
        pageLock: null,
        status: "cancelled",
        updatedAt: completedAt
      };
    });
    if (!changed) return false;
    await storage?.set?.({
      [activeBrowserJobKey]: activeJobId || job.id,
      [browserJobsKey]: nextJobs
    }).catch(() => undefined);
    await addSystemMessage(`Stopped browser job ${job.id}: ${job.goal || "Untitled browser task"}`);
    afterChange();
    return true;
  };

  return {
    cancelJob,
    focusJob,
    openMonitor,
    readJobs
  };
}
