import assert from "node:assert/strict";
import test from "node:test";

import {
  isReadableSubframeTab,
  rankedReadableBrowserTabs,
  readableSubframeUrls
} from "../resonantos-side-panel-extension/src/lib/readable-tab-ranking.js";

const isReadableBrowserTab = (tab) => typeof tab?.url === "string" && /^https?:\/\//i.test(tab.url);

function createChromeApi(framesByTabId = {}) {
  return {
    webNavigation: {
      getAllFrames: async ({ tabId }) => framesByTabId[tabId] ?? [{ frameId: 0, url: `https://tab-${tabId}.test/` }]
    }
  };
}

test("readable tab ranking prefers active main page tabs over readable subframe URLs", async () => {
  const tabs = [
    { id: 1, active: true, url: "https://calendar.example/frame" },
    { id: 2, active: false, url: "https://booking.example/" }
  ];
  const chromeApi = createChromeApi({
    1: [{ frameId: 0, url: "https://calendar.example/frame" }],
    2: [
      { frameId: 0, url: "https://booking.example/" },
      { frameId: 12, url: "https://calendar.example/frame" }
    ]
  });

  const ranked = await rankedReadableBrowserTabs(chromeApi, tabs, isReadableBrowserTab);

  assert.deepEqual(ranked.map((tab) => tab.id), [2, 1]);
});

test("readable tab ranking preserves active preference when tabs are not subframes", async () => {
  const tabs = [
    { id: 1, active: false, url: "https://first.example/" },
    { id: 2, active: true, url: "https://second.example/" }
  ];

  const ranked = await rankedReadableBrowserTabs(createChromeApi(), tabs, isReadableBrowserTab);

  assert.deepEqual(ranked.map((tab) => tab.id), [2, 1]);
});

test("readable subframe detection reports frame URLs from sibling readable tabs", async () => {
  const chromeApi = createChromeApi({
    1: [{ frameId: 0, url: "https://calendar.example/frame" }],
    2: [
      { frameId: 0, url: "https://booking.example/" },
      { frameId: 7, url: "https://calendar.example/frame" }
    ]
  });

  const subframes = await readableSubframeUrls(chromeApi, [{ id: 2, url: "https://booking.example/" }]);
  const isSubframe = await isReadableSubframeTab(
    chromeApi,
    { id: 1, url: "https://calendar.example/frame" },
    [
      { id: 1, url: "https://calendar.example/frame" },
      { id: 2, url: "https://booking.example/" }
    ],
    isReadableBrowserTab
  );

  assert.equal(subframes.has("https://calendar.example/frame"), true);
  assert.equal(isSubframe, true);
});
