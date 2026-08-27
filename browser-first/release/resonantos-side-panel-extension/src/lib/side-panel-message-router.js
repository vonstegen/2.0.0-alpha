const SIDE_PANEL_CHANNEL = "resonantos.browser_first.side_panel";

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function createSidePanelMessageRouter({
  cancelBrowserJob,
  channel = SIDE_PANEL_CHANNEL,
  getActiveBrowserJobId
} = {}) {
  return function routeSidePanelMessage(message, _sender, sendResponse = () => undefined) {
    if (!message || message.channel !== channel) {
      return false;
    }
    if (message.type !== "cancel_control_run") {
      return false;
    }
    const jobId = typeof getActiveBrowserJobId === "function" ? getActiveBrowserJobId() : "";
    Promise.resolve(cancelBrowserJob?.(jobId ?? ""))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: safeErrorMessage(error) }));
    return true;
  };
}
