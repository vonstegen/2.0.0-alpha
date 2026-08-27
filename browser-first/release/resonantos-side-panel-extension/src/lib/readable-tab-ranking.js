export async function rankedReadableBrowserTabs(chromeApi, tabs = [], isReadableBrowserTab = () => false) {
  const readableTabs = tabs.filter(isReadableBrowserTab);
  if (readableTabs.length <= 1 || !chromeApi?.webNavigation?.getAllFrames) {
    return readableTabs;
  }

  const subframeUrls = await readableSubframeUrls(chromeApi, readableTabs);

  return [...readableTabs].sort((left, right) => {
    const leftLooksLikeSubframe = subframeUrls.has(left.url);
    const rightLooksLikeSubframe = subframeUrls.has(right.url);
    if (leftLooksLikeSubframe !== rightLooksLikeSubframe) return leftLooksLikeSubframe ? 1 : -1;
    if (Boolean(left.active) !== Boolean(right.active)) return left.active ? -1 : 1;
    return 0;
  });
}

export async function readableSubframeUrls(chromeApi, readableTabs = []) {
  const subframeUrls = new Set();
  if (!chromeApi?.webNavigation?.getAllFrames) return subframeUrls;
  for (const tab of readableTabs) {
    const frames = await chromeApi.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => []);
    for (const frame of Array.isArray(frames) ? frames : []) {
      if (frame?.frameId !== 0 && frame?.url) subframeUrls.add(frame.url);
    }
  }
  return subframeUrls;
}

export async function isReadableSubframeTab(chromeApi, tab, tabs = [], isReadableBrowserTab = () => false) {
  if (!tab || !isReadableBrowserTab(tab)) return false;
  const readableTabs = tabs.filter((candidate) => candidate?.id !== tab.id && isReadableBrowserTab(candidate));
  if (!readableTabs.length) return false;
  const subframeUrls = await readableSubframeUrls(chromeApi, readableTabs);
  return subframeUrls.has(tab.url);
}
