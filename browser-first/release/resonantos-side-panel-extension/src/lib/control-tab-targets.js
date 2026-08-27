import { isReadableSubframeTab, rankedReadableBrowserTabs } from "./readable-tab-ranking.js";

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
        if (!chromeApi.webNavigation?.getAllFrames) {
          return controlled;
        }
        const currentWindowTabs = await chromeApi.tabs.query({ currentWindow: true }).catch(() => []);
        if (!await isReadableSubframeTab(chromeApi, controlled, currentWindowTabs, isReadableBrowserTab)) {
          return controlled;
        }
      }
      setControlledTabId(null);
    }

    const currentWindowTabs = await chromeApi.tabs.query({ currentWindow: true }).catch(() => []);
    const rankedCurrentWindowTabs = await rankedReadableBrowserTabs(chromeApi, currentWindowTabs, isReadableBrowserTab);
    const readableInWindow = rankedCurrentWindowTabs.at(0);
    if (readableInWindow) {
      setControlledTabId(readableInWindow.id);
      return readableInWindow;
    }

    const allTabs = await chromeApi.tabs.query({}).catch(() => []);
    const rankedAllTabs = await rankedReadableBrowserTabs(chromeApi, allTabs, isReadableBrowserTab);
    const readableTab = rankedAllTabs.at(0) ?? null;
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
