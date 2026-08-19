// Session-summary controller for the Augmentor (#222).
//
// Pins the lifecycle trigger to an explicit command (/session) — no background
// monitoring, no always-on personal memory (non-goal). The controller builds a
// reviewable, deletable artifact from the open readable tabs, persists it via
// chrome.storage.local (restart-safe), and restores a short context line on
// hydrate so a reload preserves train-of-thought.

import { buildSessionSummaryArtifact, sessionSummaryRestoreLine } from "./session-summary-artifact.js";
import {
  deleteSessionSummaryArtifact,
  loadSessionSummaryArtifact,
  saveSessionSummaryArtifact
} from "./session-summary-store.js";

export function createSessionSummaryController({ chrome, isReadableBrowserTab, addMessage, setStatus }) {
  const resolveOpenTabs = async () => {
    const tabs = (await chrome.tabs.query({}).catch(() => [])).filter(isReadableBrowserTab);
    return tabs.slice(0, 12).map((tab) => ({ title: tab.title ?? "", url: tab.url ?? "" }));
  };

  const runSessionCommand = async (body = "") => {
    const sub = String(body ?? "").trim().toLowerCase();

    if (sub === "clear" || sub === "delete") {
      const removed = await deleteSessionSummaryArtifact(chrome);
      await addMessage("system", removed ? "Session summary deleted. It will not reappear after reload." : "No session summary was stored to delete.");
      setStatus?.(removed ? "Session summary cleared" : "No session summary");
      return { ok: true, deleted: removed };
    }

    // Default (and "summary"): build + persist the artifact now.
    const included = await resolveOpenTabs();
    const artifact = buildSessionSummaryArtifact({ included, skipped: [], summary: "", trigger: "explicit-command" });
    await saveSessionSummaryArtifact(chrome, artifact);
    await addMessage("system", `Session summary saved (${artifact.included.length} tab(s)). It is reviewable and survives reload; clear it with /session clear.`);
    setStatus?.("Session summary saved");
    return { ok: true, artifact };
  };

  const restoreSessionContext = async () => {
    const artifact = await loadSessionSummaryArtifact(chrome);
    const line = sessionSummaryRestoreLine(artifact);
    if (line) await addMessage("system", line);
    return artifact;
  };

  return { runSessionCommand, restoreSessionContext };
}
