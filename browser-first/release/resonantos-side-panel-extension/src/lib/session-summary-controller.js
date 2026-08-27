// Session-summary controller for the Augmentor (#222).
//
// Pins the lifecycle trigger to an explicit command (/session) — no background
// monitoring, no always-on personal memory (non-goal). The controller builds a
// reviewable, deletable artifact from the open readable tabs in the current
// window only (Tom's scope suggestion), persists it via chrome.storage.local
// (restart-safe), and restores a short context line on hydrate so a reload
// preserves train-of-thought. Storage failures are surfaced to the user via
// `addMessage` so a quota error during /session is not a silent unhandled
// rejection.

import { buildSessionSummaryArtifact, sessionSummaryRestoreLine } from "./session-summary-artifact.js";
import {
  deleteSessionSummaryArtifact,
  loadSessionSummaryArtifact,
  saveSessionSummaryArtifact
} from "./session-summary-store.js";

export function createSessionSummaryController({ chrome, isReadableBrowserTab, addMessage, setStatus }) {
  // Window scope: only the current window's open tabs are persisted. Tom's
  // review flagged that `chrome.tabs.query({})` captures every open http(s)
  // tab in the browser, so unrelated personal tabs in other windows would
  // have their title/URL persisted merely for being open. Capping at the
  // current window matches the user's mental model of "this session".
  const resolveOpenTabs = async () => {
    const tabs = (await chrome.tabs.query({ currentWindow: true }).catch(() => [])).filter(isReadableBrowserTab);
    return tabs.slice(0, 12).map((tab) => ({ title: tab.title ?? "", url: tab.url ?? "" }));
  };

  // Storage try/catch helper. Wraps save/clear/load so a quota error or
  // unreachable storage surfaces as a user-visible message instead of an
  // unhandled rejection. The controller thread always returns an
  // `{ok, ...}` shape so the caller can test the outcome.
  const safeStorage = async (op, label) => {
    try {
      const result = await op();
      return { ok: true, result };
    } catch (error) {
      const message = String(error?.message ?? error ?? "unknown storage error");
      await addMessage("system", `Session summary ${label} failed: ${message}. The artifact may not survive a reload.`);
      return { ok: false, error };
    }
  };

  const runSessionCommand = async (body = "") => {
    const sub = String(body ?? "").trim().toLowerCase();

    if (sub === "clear" || sub === "delete") {
      const { ok, result } = await safeStorage(() => deleteSessionSummaryArtifact(chrome), "deletion");
      if (!ok) {
        setStatus?.("Session summary deletion failed");
        return { ok: false, deleted: false };
      }
      const removed = result;
      await addMessage("system", removed ? "Session summary deleted. It will not reappear after reload." : "No session summary was stored to delete.");
      setStatus?.(removed ? "Session summary cleared" : "No session summary");
      return { ok: true, deleted: removed };
    }

    // Default (and "summary"): build + persist the artifact now.
    const included = await resolveOpenTabs();
    const artifact = buildSessionSummaryArtifact({ included, skipped: [], summary: "", trigger: "explicit-command" });
    const { ok } = await safeStorage(() => saveSessionSummaryArtifact(chrome, artifact), "save");
    if (!ok) {
      setStatus?.("Session summary save failed");
      return { ok: false, artifact };
    }
    await addMessage("system", `Session summary saved (${artifact.included.length} tab(s)). It is reviewable and survives reload; clear it with /session clear.`);
    setStatus?.("Session summary saved");
    return { ok: true, artifact };
  };

  const restoreSessionContext = async () => {
    const { ok, result } = await safeStorage(() => loadSessionSummaryArtifact(chrome), "load");
    const artifact = ok ? result : null;
    const line = sessionSummaryRestoreLine(artifact);
    if (line) await addMessage("system", line);
    return artifact;
  };

  return { runSessionCommand, restoreSessionContext };
}
