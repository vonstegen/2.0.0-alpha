// Restart-safe session summary artifact for the Augmentor (#222).
//
// A bounded, reviewable, deletable artifact that preserves train-of-thought
// across an extension reload WITHOUT persisting raw page content. The artifact
// stores only tab provenance (title/url), skip reasons, and a redacted summary;
// raw page text, form fields, and controls are never stored. Secrets (provider
// keys, bearer tokens, api_key/token/secret/password assignments, wallet
// private keys) are redacted from the summary AND from tab urls, titles, and
// skip reasons before anything is persisted, so query-string secrets never
// land in chrome.storage.local.

const SECRET_PATTERNS = [
  /sk-[a-z0-9_-]{16,}/gi,            // provider/api keys (OpenAI-style)
  /\bbearer\s+[a-z0-9._-]+/gi,       // bearer tokens
  /\bapi[_-]?key\s*[:=]\s*[^&\s]+/gi,     // api_key= / apiKey: (stops at &)
  /\btoken\s*[:=]\s*[^&\s]+/gi,          // token= (stops at &)
  /\bsecret\s*[:=]\s*[^&\s]+/gi,         // secret= (stops at &)
  /\bpassword\s*[:=]\s*[^&\s]+/gi,       // password= (stops at &)
  /\b0x[a-f0-9]{64}\b/gi,            // 32-byte wallet private keys
  /\b(?:48|44)[a-z0-9]{86,}/gi       // ed25519 secret keys (base58, 88 chars)
];
// Redact recognizable secret material from a free-text string before it is
// persisted. Applied to the summary, tab urls, tab titles, and skip reasons.
export function redactSecrets(text) {
  let out = String(text ?? "");
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
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