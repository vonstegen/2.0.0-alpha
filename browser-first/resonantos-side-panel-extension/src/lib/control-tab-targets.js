export function createControlTabTargets({
  chromeApi,
  clearPageSnapshot = () => undefined,
  getControlledTabId = () => null,
  isReadableBrowserTab = () => false,
  setControlledTabId = () => undefined,
} = {}) {
  if (!chromeApi?.tabs) {
    throw new Error("createControlTabTargets requires chromeApi.tabs.");
  }

  const currentReadableControlTab = async () => {
    const controlledTabId = getControlledTabId();
    if (controlledTabId) {
      const controlled = await chromeApi.tabs.get(controlledTabId).catch(() => null);
      if (isReadableBrowserTab(controlled)) {
        return controlled;
      }
      setControlledTabId(null);
    }

    const currentWindowTabs = await chromeApi.tabs.query({ currentWindow: true }).catch(() => []);
    const activeReadable = currentWindowTabs.find((tab) => tab.active && isReadableBrowserTab(tab));
    if (activeReadable) {
      setControlledTabId(activeReadable.id);
      return activeReadable;
    }

    const readableInWindow = currentWindowTabs.filter(isReadableBrowserTab).at(-1);
    if (readableInWindow) {
      setControlledTabId(readableInWindow.id);
      return readableInWindow;
    }

    const allTabs = await chromeApi.tabs.query({}).catch(() => []);
    const readableTab = allTabs.find((tab) => tab.active && isReadableBrowserTab(tab)) ??
      allTabs.filter(isReadableBrowserTab).at(-1) ??
      null;
    if (readableTab) {
      setControlledTabId(readableTab.id);
    }
    return readableTab;
  };

  const ensureControlTabForUrl = async (url) => {
    const existingTab = await currentReadableControlTab();
    if (existingTab?.id) {
      const updated = await chromeApi.tabs.update(existingTab.id, { url, active: true }).catch(() => null);
      setControlledTabId(existingTab.id);
      clearPageSnapshot();
      return updated ?? { ...existingTab, url };
    }

    const created = await chromeApi.tabs.create({ url, active: true });
    setControlledTabId(created.id);
    clearPageSnapshot();
    return created;
  };

  return {
    currentReadableControlTab,
    ensureControlTabForUrl,
  };
}
