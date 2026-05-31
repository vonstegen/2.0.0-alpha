import assert from "node:assert/strict";
import test from "node:test";

import { activateBrowserJobPage } from "../resonantos-side-panel-extension/src/lib/browser-job-activation.js";

test("browser job activation focuses the job locked tab before approval or replay", async () => {
  const updates = [];
  let controlledTabId = null;
  const tab = { id: 42, title: "Review", url: "https://dao.example/review" };

  const result = await activateBrowserJobPage({
    chromeApi: {
      tabs: {
        get: async (tabId) => {
          assert.equal(tabId, 42);
          return tab;
        },
        update: async (tabId, patch) => {
          updates.push([tabId, patch]);
        }
      }
    },
    isReadableBrowserTab: (candidate) => /^https?:/.test(candidate?.url ?? ""),
    job: {
      id: "job-dao",
      pageLock: { tabId: 42, siteKey: "dao.example" }
    },
    setControlledTabId: (tabId) => {
      controlledTabId = tabId;
    }
  });

  assert.equal(result, tab);
  assert.equal(controlledTabId, 42);
  assert.deepEqual(updates, [[42, { active: true }]]);
});

test("browser job activation falls back to the active tab when no tab lock exists", async () => {
  const active = { id: 8, title: "Active", url: "https://example.com" };
  const result = await activateBrowserJobPage({
    activeTab: async () => active,
    chromeApi: {
      tabs: {
        get: async () => {
          throw new Error("should not read a tab without a tab lock");
        }
      }
    },
    isReadableBrowserTab: () => true,
    job: { id: "job-no-tab", pageLock: { siteKey: "example.com", tabId: null } }
  });

  assert.equal(result, active);
});

test("browser job activation blocks approval when the locked tab is no longer readable", async () => {
  await assert.rejects(
    activateBrowserJobPage({
      chromeApi: {
        tabs: {
          get: async () => ({ id: 9, title: "Extensions", url: "chrome://extensions" }),
          update: async () => {
            throw new Error("should not activate unreadable tab");
          }
        }
      },
      isReadableBrowserTab: (candidate) => /^https?:/.test(candidate?.url ?? ""),
      job: {
        id: "job-wallet",
        pageLock: { tabId: 9, siteKey: "extensions" }
      }
    }),
    /target tab is no longer readable/
  );
});
