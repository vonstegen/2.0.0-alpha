import { NEW_TAB_URL_STORAGE_KEY, resolveNewTabRedirectUrl } from "./newtab-redirect-url.js";

// Runs as the new-tab page: read the optional per-user destination, fall back to
// the default, and replace() so this bounce page never enters tab history.
async function redirectNewTab() {
  let candidate;
  try {
    const stored = await chrome.storage?.local?.get?.(NEW_TAB_URL_STORAGE_KEY);
    candidate = stored?.[NEW_TAB_URL_STORAGE_KEY];
  } catch {
    candidate = undefined;
  }
  window.location.replace(resolveNewTabRedirectUrl(candidate));
}

void redirectNewTab();
