// Restart-safe session summary artifact for the Augmentor (#222).
//
// A bounded, reviewable, deletable artifact that preserves train-of-thought
// across an extension reload WITHOUT persisting raw page content. The artifact
// stores only tab provenance (title/url), skip reasons, and a redacted summary;
// raw page text, form fields, and controls are never stored. Secrets are
// redacted using the hardened trace redactor (`redactTraceText`) plus a
// supplemental compound-name layer so `client_secret=`, `client_id=`, and
// other `_`-joined names Tom's review flagged are caught. Percent-encoded
// values, Bearer tokens, JSON-quoted secrets, and a wide range of provider
// keys never reach chrome.storage.local. Tab query is scoped to the current
// window only.

import { redactTraceText } from "./trace-redaction.js";

// Supplemental compound-name patterns that the trace redactor's alternation
// does not yet cover. Matches assignments whose key starts with a known
// compound prefix (client_, session_, id_, csrf_, jwt_) and value runs to
// whitespace, &, #, or `"`/`'` so embedded JSON is also handled.
const COMPOUND_NAME_PATTERN = /\b(?:client[_-]?(?:secret|id|token)|session[_-]?(?:id|token|key)|id[_-]?token|csrf[_-]?token|jwt[_-]?token)\s*["']?\s*[=:]\s*[^&\s#'`<>]+/gi;

// Redact recognizable secret material from a free-text string before it is
// persisted. Applied to the summary, tab urls, tab titles, and skip reasons.
// Replace the value portion of a match (everything after the first `=` or `:`)
// with `[redacted]`, preserving the key, separator, and any trailing quote so
// JSON literals stay balanced.
const replaceValue = (match) => {
  const sepIndex = Math.max(match.indexOf("="), match.indexOf(":"));
  if (sepIndex === -1) return match;
  const prefix = match.slice(0, sepIndex + 1);
  const trailing = match.endsWith('"') || match.endsWith("'") ? match.slice(-1) : "";
  return prefix + "[redacted]" + trailing;
};

// Layer ordering: run the supplemental compound-name layer first so JSON-quoted
// `client_secret` forms (which the trace redactor's alternation misses) are
// caught, then feed the result to `redactTraceText` for the basic patterns
// (token=, key=, secret=, password=, Bearer, sk-..., 32-byte hex, etc.).
export function redactSecrets(text) {
  if (typeof text !== "string") return "";
  return redactTraceText(text.replace(COMPOUND_NAME_PATTERN, replaceValue))
    .replace(/REDACTED/g, "[redacted]")
    .replace(/\[REDACTED-TOKEN\]/g, "[redacted]");
}

// Build a reviewable session-summary artifact. `included` and `skipped` carry
// tab provenance only (title/url/reason), with secrets redacted before
// persistence so query-string secrets never reach chrome.storage.local. The
// summary is also redacted and length-bounded. No raw text, fields, or
// controls are stored.
export function buildSessionSummaryArtifact({
  included = [],
  skipped = [],
  summary = "",
  trigger = "explicit-command",
  generatedAt = new Date().toISOString()
} = {}) {
  const cleanIncluded = (Array.isArray(included) ? included : []).map((tab) => ({
    title: redactSecrets(String(tab?.title ?? "")),
    url: redactSecrets(String(tab?.url ?? ""))
  }));
  const cleanSkipped = (Array.isArray(skipped) ? skipped : []).map((entry) => ({
    title: redactSecrets(String(entry?.title ?? "")),
    url: redactSecrets(String(entry?.url ?? "")),
    reason: redactSecrets(String(entry?.reason ?? ""))
  }));
  return Object.freeze({
    kind: "session-summary",
    trigger,
    generatedAt,
    included: cleanIncluded,
    skipped: cleanSkipped,
    summary: redactSecrets(summary).slice(0, 4000)
  });
}

// A short, reviewable context line restored from a persisted artifact on reload,
// so the user sees prior session context was preserved (and can review/delete it).
// Returns null when there is no valid artifact, so the caller can no-op cleanly.
export function sessionSummaryRestoreLine(artifact) {
  if (!artifact || artifact.kind !== "session-summary") return null;
  const included = Array.isArray(artifact.included) ? artifact.included : [];
  const skipped = Array.isArray(artifact.skipped) ? artifact.skipped : [];
  const when = artifact.generatedAt || "unknown time";
  const skippedNote = skipped.length ? `; ${skipped.length} skipped` : "";
  return `Restored session context from ${when}: ${included.length} tab(s) included${skippedNote}. Review or delete it via /session clear.`;
}