// Restart-safe persistence for the Augmentor session-summary artifact (#222).
//
// Uses chrome.storage.local so the artifact survives an extension reload; the
// storage is the source of truth, so deletion is honored on restart. The
// artifact is redacted by session-summary-artifact.js before it reaches here.

export const SESSION_SUMMARY_ARTIFACT_KEY = "augmentorSessionSummaryArtifact";

export async function saveSessionSummaryArtifact(chrome, artifact) {
  if (!chrome?.storage?.local?.set) return false;
  await chrome.storage.local.set({ [SESSION_SUMMARY_ARTIFACT_KEY]: artifact });
  return true;
}

export async function loadSessionSummaryArtifact(chrome) {
  if (!chrome?.storage?.local?.get) return null;
  const result = await chrome.storage.local.get(SESSION_SUMMARY_ARTIFACT_KEY);
  const artifact = result?.[SESSION_SUMMARY_ARTIFACT_KEY];
  return artifact && artifact.kind === "session-summary" ? artifact : null;
}

export async function deleteSessionSummaryArtifact(chrome) {
  if (!chrome?.storage?.local?.remove) return false;
  await chrome.storage.local.remove(SESSION_SUMMARY_ARTIFACT_KEY);
  return true;
}
