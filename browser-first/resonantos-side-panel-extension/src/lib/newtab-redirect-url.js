// Resolves where a new tab should land. Chrome can't point new tabs at an
// arbitrary URL on its own, so the extension overrides the new-tab page with a
// small redirect (see newtab-redirect.html / .js). The destination defaults to
// swisscows and can be overridden per-user via chrome.storage.local, without
// forcing the Augmentor workspace onto every new tab (that is toggle-only now).

export const DEFAULT_NEW_TAB_URL = "https://swisscows.com/en";
export const NEW_TAB_URL_STORAGE_KEY = "augmentorNewTabUrl";

// Only http(s) destinations are honored — this is what gets handed to
// location.replace(), so javascript:/data:/chrome: candidates are rejected.
export function isRedirectableUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function resolveNewTabRedirectUrl(candidate, { defaultUrl = DEFAULT_NEW_TAB_URL } = {}) {
  return typeof candidate === "string" && isRedirectableUrl(candidate) ? candidate : defaultUrl;
}
