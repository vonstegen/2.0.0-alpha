// Redaction pass for durable Agent Control trace artifacts (reports and
// delegation packets). The in-memory run keeps full fidelity for resume and
// UX; only exported artifacts pass through this scrubber so secrets echoed in
// goals, URLs, notes, or errors never reach the archive.

const SECRET_URL_PARAM_NAMES =
  "(?:token|key|secret|password|passwd|pwd|pin|otp|auth[_-]?code|access[_-]?token|refresh[_-]?token|api[_-]?key|session|sid|signature|csrf|jwt|code)";
const URL_PARAM_PATTERN = new RegExp(`([?&])(${SECRET_URL_PARAM_NAMES})(=)([^&#\\s]*)`, "gi");
// Percent-encoded URLs nested inside another URL's query value keep their
// separators as %3F / %26 / %3D; the plain pattern above never sees them, so a
// redirect like ?next=https%3A%2F%2Fb.com%2F%3Ftoken%3Dabc would leak.
const ENCODED_URL_PARAM_PATTERN = new RegExp(
  `(%3F|%26)(${SECRET_URL_PARAM_NAMES})(%3D)((?:(?!%26|%23)[^&#\\s])*)`,
  "gi"
);
const SECRET_ASSIGNMENT_NAMES =
  "(?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|otp|pin|auth[_-]?code|signature|jwt|session|sid|csrf|key|code)";
// The value match runs through to whitespace, &, or # so values containing
// commas or semicolons (password=abc,defsecret) are redacted in full.
const ASSIGNMENT_PATTERN = new RegExp(`\\b(${SECRET_ASSIGNMENT_NAMES})(\\s*[=:]\\s*)[^\\s&#]+`, "gi");
// "Authorization: Bearer <token>" / "Token: Bearer <x>" — the credential is
// the word after Bearer, so redact the whole scheme+token span. This must run
// before ASSIGNMENT_PATTERN, which would otherwise consume only the literal
// word "Bearer" as the value and leave the token itself in the artifact.
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/=]+/g;
const HEX_TOKEN_PATTERN = /\b[0-9a-fA-F]{32,}\b/g;

export function redactTraceText(value) {
  if (typeof value !== "string") return "";
  return String(value)
    .replace(URL_PARAM_PATTERN, (match, separator, name, eq) => `${separator}${name}${eq}REDACTED`)
    .replace(ENCODED_URL_PARAM_PATTERN, (match, separator, name, eq) => `${separator}${name}${eq}REDACTED`)
    .replace(BEARER_PATTERN, "REDACTED")
    .replace(ASSIGNMENT_PATTERN, (match, name, separator) => `${name}${separator}REDACTED`)
    .replace(HEX_TOKEN_PATTERN, "[REDACTED-TOKEN]");
}
