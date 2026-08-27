export async function activateBrowserJobPage({
  activeTab = async () => null,
  chromeApi,
  isReadableBrowserTab,
  job,
  setControlledTabId = () => undefined
} = {}) {
  const rawTabId = job?.pageLock?.tabId;
  if (rawTabId === null || rawTabId === undefined || rawTabId === "") {
    return activeTab();
  }
  const tabId = Number(rawTabId);
  if (!Number.isInteger(tabId) || tabId < 0) {
    return activeTab();
  }
  const tab = await chromeApi?.tabs?.get?.(tabId).catch(() => null);
  if (!isReadableBrowserTab?.(tab)) {
    throw new Error(`Browser job ${job?.id ?? "unknown"} target tab is no longer readable.`);
  }
  setControlledTabId(tab.id);
  await chromeApi?.tabs?.update?.(tab.id, { active: true }).catch(() => undefined);
  return tab;
}
