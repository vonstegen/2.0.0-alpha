import "./bridge-config.generated.js";
import { createBridgeClient, initCapabilityTokens } from "./lib/bridge-client.js";

const APPROVAL_REQUIRED_ACTIONS = new Set([
  "wallet_connect",
  "wallet_sign",
  "wallet_switch_network",
  "public_submit",
  "sensitive_type",
  "credential_autofill",
]);

const MAIN_WORKSPACE_PATH = "/src/main-workspace.html";
const bridgeRequest = createBridgeClient();

const isMainWorkspaceUrl = (url = "") => {
  try {
    return new URL(url).pathname === MAIN_WORKSPACE_PATH;
  } catch {
    return false;
  }
};

const activeTabForWindow = async (windowId) => {
  const query = windowId === undefined
    ? { active: true, currentWindow: true }
    : { active: true, windowId };
  const [tab] = await chrome.tabs.query(query).catch(() => []);
  return tab ?? null;
};

const setSidePanelEnabledForTab = async (tabId, enabled) => {
  if (typeof chrome.sidePanel?.setOptions !== "function") {
    return;
  }
  if (tabId === undefined) {
    return;
  }
  await chrome.sidePanel.setOptions({ tabId, path: "src/side-panel.html", enabled }).catch(() => undefined);
};

const setSidePanelEnabledForActiveTab = async (windowId, enabled) => {
  const tab = await activeTabForWindow(windowId);
  await setSidePanelEnabledForTab(tab?.id, enabled);
};

const syncSidePanelForTab = async (tab) => {
  if (tab?.id === undefined || typeof tab.url !== "string") {
    return;
  }
  // Intent citation: docs/architecture/ADR-037-browser-first-chromium-resonantos.md
  // Augmentor is the browser-contained ResonantOS side surface. It must stay
  // available on the main workspace and normal webpages; humans hide it by
  // closing the browser side panel and reopen it from the topbar/extension.
  await setSidePanelEnabledForTab(tab.id, true);
};

const syncSidePanelForActiveTab = async (windowId) => {
  await syncSidePanelForTab(await activeTabForWindow(windowId));
};

const openResonantSidePanel = async (windowId, { force = false } = {}) => {
  if (typeof chrome.sidePanel?.open !== "function" || windowId === undefined) {
    return false;
  }
  const tab = await activeTabForWindow(windowId);
  if (tab?.id === undefined) {
    return false;
  }
  await setSidePanelEnabledForTab(tab.id, true);
  await chrome.sidePanel.open({ windowId }).catch(() => undefined);
  return true;
};

const handoffToResonantSidePanel = async ({ senderTab, targetUrl = "" } = {}) => {
  const tab = senderTab?.id === undefined
    ? await activeTabForWindow(senderTab?.windowId)
    : senderTab;
  if (tab?.id === undefined || tab.windowId === undefined) {
    return { ok: false, opened: false, navigated: false, error: "No active tab available for browser-control handoff." };
  }
  // Intent citation: docs/architecture/ADR-037-browser-first-chromium-resonantos.md
  // Browser-control handoff must keep the human on the target webpage while
  // Augmentor moves into the side panel. Enabling/opening the panel before
  // navigation avoids losing the sender page during tab URL changes.
  await setSidePanelEnabledForTab(tab.id, true);
  await chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  if (targetUrl) {
    await chrome.tabs.update(tab.id, { url: targetUrl }).catch(() => undefined);
  }
  return { ok: true, opened: true, navigated: Boolean(targetUrl), tabId: tab.id };
};

// Fetch capability tokens from the bridge on service-worker startup.
// Tokens are NOT stored in the generated config (security boundary); they
// are delivered via the authenticated /api/capability-tokens endpoint.
void initCapabilityTokens();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  void initCapabilityTokens();
});

chrome.runtime.onStartup.addListener(() => {
  void initCapabilityTokens();
});

chrome.action.onClicked.addListener(async (tab) => {
  await openResonantSidePanel(tab.windowId, { force: true });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "open-augmentor-side-panel") {
    return;
  }
  chrome.windows.getCurrent((window) => {
    void openResonantSidePanel(window?.id);
  });
});

chrome.tabs.onActivated?.addListener?.((activeInfo) => {
  void syncSidePanelForActiveTab(activeInfo.windowId);
});

chrome.tabs.onUpdated?.addListener?.((_tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    void syncSidePanelForTab(tab);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    console.warn("[background] rejected message from unknown sender:", sender.id);
    return;
  }

  if (!message || message.channel !== "resonantos.browser_first") {
    return false;
  }

  if (message.type === "active_tab_context") {
    sendResponse({
      ok: true,
      tabId: sender.tab?.id ?? null,
      title: sender.tab?.title ?? "",
      url: sender.tab?.url ?? "",
      receivedAt: new Date().toISOString()
    });
    return true;
  }

  if (message.type === "inline_assistant_request") {
    void bridgeRequest("/augmentor/inline", {
      method: "POST",
      body: message.body ?? {}
    })
      .then((payload) => sendResponse({ ok: true, reply: payload.reply ?? "" }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    return true;
  }

  if (message.type === "open_side_panel") {
    const windowId = sender.tab?.windowId;
    if (windowId !== undefined) {
      void openResonantSidePanel(windowId, { force: Boolean(message.force) }).then((opened) => sendResponse({ ok: true, opened }));
      return true;
    }
    chrome.windows.getCurrent((window) => {
      void openResonantSidePanel(window?.id, { force: Boolean(message.force) }).then((opened) => sendResponse({ ok: true, opened }));
    });
    return true;
  }

  if (message.type === "browser_control_handoff") {
    void handoffToResonantSidePanel({
      senderTab: sender.tab,
      targetUrl: typeof message.targetUrl === "string" ? message.targetUrl : ""
    }).then(sendResponse);
    return true;
  }

  if (message.type === "action_request") {
    const action = String(message.action ?? "");
    const approvalRequired = APPROVAL_REQUIRED_ACTIONS.has(action);
    sendResponse({
      ok: !approvalRequired,
      approvalRequired,
      deniedToAutomation: approvalRequired,
      reason: approvalRequired
        ? "Wallet, credential, public-submit, and sensitive actions require explicit human approval."
        : "Safe browser action can be routed through the governed ResonantOS tool bridge."
    });
    return true;
  }

  sendResponse({ ok: false, error: "Unknown ResonantOS browser-first message." });
  return true;
});
