// Restart-safe session summary artifact for the Augmentor (#222).
//
// A bounded, reviewable, deletable artifact that preserves train-of-thought
// across an extension reload WITHOUT persisting raw page content. The artifact
// stores only tab provenance (title/url), skip reasons, and a redacted summary;
// raw page text, form fields, and controls are never stored. Secrets are
// redacted using the hardened trace redactor (`redactTraceText`) plus a
// supplemental layer so `client_secret=`, bare `token` in JSON, multi-vendor
// provider keys (Stripe, AWS, Google, GitHub, Slack), base58 wallet keys, and
// the `[REDACTED-TOKEN]` hex sentinel all collapse to `[redacted]` before
// persistence. Tab query is scoped to the current window only.
import { redactTraceText } from "./trace-redaction.js";

// Field-bound for per-tab title/url/reason. A page-controlled `document.title`
// can be arbitrarily long, so we cap each piece of provenance at 300 chars
// with an ellipsis to prevent an artifact-bombing tab from filling storage.
const MAX_FIELD_LENGTH = 300;

// Supplemental secret-name pattern that closes the gaps Tom's review flagged.
// The trace redactor's basic alternation (token=/key=/secret=/password=) does
// NOT cover:
//   - JSON-quoted bare names: `{"token":"abc"}` — the `"` between name and `:`
//     defeats the white-space prefix in the trace redactor's ASSIGNMENT_PATTERN.
//   - Compound snake_case names: `client_secret`, `client_id`, `csrf_token`,
//     `jwt_token`, `session_*`, `id_token` — Tom's blocker.
//   - These extras are also covered here even when they appear in URL params,
//     so the same pattern handles both contexts consistently.
const SUPPLEMENTAL_NAME_PATTERN = /\b(?:client[_-]?(?:secret|id|token)|session[_-]?(?:id|token|key)|id[_-]?token|csrf[_-]?token|jwt[_-]?token|token|secret|password|api[_-]?key|access[_-]?token|refresh[_-]?token|key|otp|pin|auth[_-]?code|signature|code|sid|csrf)\s*["']?\s*[=:]\s*[^&\s#'`<>]+/gi;

// Provider key prefixes — Tom listed Stripe `sk_live_`, AWS `AKIA…`, Google
// `AIza…`, GitHub `ghp_…` / `gho_…`, Slack `xox…`. The trace redactor's `sk-`
// rule catches OpenAI-style keys but not these. Length ranges use realistic
// key-length windows so we don't accidentally match arbitrary short tokens.
const PROVIDER_KEY_PREFIX_PATTERN = /\b(?:sk_live_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{25,39}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,})\b/g;

// Length-range base58 wallet-key class. Tom's note: the original `\b(?:48|44)
// [a-z0-9]{86,}` pattern assumed a real-key prefix that actual keys don't
// guarantee. A length-only base58 (\b[a-km-zA-HJ-NP-Z1-9]{40,90}\b) catches any
// plausible wallet key without false-positives on common prose.
const BASE58_HEURISTIC_PATTERN = /\b[A-HJ-NP-Za-hj-np-z1-9]{40,90}\b/g;

// Replace the matched secret with `[redacted]`. For name+separator+value
// assignments (token=abc), the key and separator are kept so the structure
// (URL param, JSON key) is preserved; for prefix-bodied keys (sk_live_…,
// AKIA…) the whole match is replaced since the value IS the match.
const replaceValue = (match) => {
  const sepIndex = Math.max(match.indexOf("="), match.indexOf(":"));
  if (sepIndex === -1) return "[redacted]";
  const prefix = match.slice(0, sepIndex + 1);
  const trailing = match.endsWith("\u0022") || match.endsWith("\u0027") ? match.slice(-1) : "";
  return prefix + "[redacted]" + trailing;
};
const boundField = (value) => {
  const text = String(value ?? "");
  return text.length > MAX_FIELD_LENGTH ? `${text.slice(0, MAX_FIELD_LENGTH)}…` : text;
};

// Redact recognizable secret material from a free-text string before it is
// persisted. Applied to the summary, tab urls, tab titles, and skip reasons.
// Order matters: the `[REDACTED-TOKEN]` sentinel collapse MUST run BEFORE the
// generic `REDACTED` replacement, otherwise the `[` of `[REDACTED-TOKEN]` is
// swallowed by the generic pass and the sentinel leaks as `[[redacted]-TOKEN]`.
export function redactSecrets(text) {
  if (typeof text !== "string") return "";
  let redacted = text;
  for (const pattern of [PROVIDER_KEY_PREFIX_PATTERN, SUPPLEMENTAL_NAME_PATTERN, BASE58_HEURISTIC_PATTERN]) {
    redacted = redacted.replace(pattern, replaceValue);
  }
  return redactTraceText(redacted)
    .replace(/\[REDACTED-TOKEN\]/g, "[redacted]")
    // Sentinel collapse: the trace redactor emits `REDACTED` as a value
    // placeholder. Anchor on the left `\b` (to avoid partial matches like
    // `REDACTED-FOO` in custom scheme names) but allow the right side to
    // abut non-word chars (e.g. `%3D` in percent-encoded URLs, a trailing
    // quote, or end-of-string) so the sentinel is collapsed wherever the
    // trace redactor emitted it.
    .replace(/\bREDACTED(?![A-Za-z0-9])/g, "[redacted]");
}

// Build a reviewable session-summary artifact. `included` and `skipped` carry
// tab provenance only (title/url/reason), with secrets redacted AND
// per-field-bounded before persistence so query-string secrets AND
// page-controlled long titles never reach chrome.storage.local. The summary is
// also redacted and length-bounded. No raw text, fields, or controls are stored.
export function buildSessionSummaryArtifact({
  included = [],
  skipped = [],
  summary = "",
  trigger = "explicit-command",
  generatedAt = new Date().toISOString()
} = {}) {
  const cleanIncluded = (Array.isArray(included) ? included : []).map((tab) => ({
    title: boundField(redactSecrets(String(tab?.title ?? ""))),
    url: boundField(redactSecrets(String(tab?.url ?? "")))
  }));
  const cleanSkipped = (Array.isArray(skipped) ? skipped : []).map((entry) => ({
    title: boundField(redactSecrets(String(entry?.title ?? ""))),
    url: boundField(redactSecrets(String(entry?.url ?? ""))),
    reason: boundField(redactSecrets(String(entry?.reason ?? "")))
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
