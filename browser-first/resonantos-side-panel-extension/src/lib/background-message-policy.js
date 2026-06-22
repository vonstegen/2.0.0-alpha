const INLINE_ACTIONS = new Set(["custom", "summarize", "summary", "explain", "translate", "rewrite"]);
const TOKEN_PATTERN = /\b(?:sk-[a-z0-9_-]{12,}|ghp_[a-z0-9_]{12,}|xox[baprs]-[a-z0-9-]{12,}|bearer\s+[a-z0-9._-]{12,}|api[_-]?key\s*[:=]\s*['"]?[^'"\s]+|token\s*[:=]\s*['"]?[^'"\s]+|password\s*[:=]\s*['"]?[^'"\s]+)\b/gi;

function safeText(value, max = 1000) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(TOKEN_PATTERN, "[redacted]")
    .replace(/\s{3,}/g, "  ")
    .trim()
    .slice(0, max);
}

function safeUrl(value) {
  const text = safeText(value, 900);
  if (!text) return "";
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.href.slice(0, 900) : "";
  } catch {
    return "";
  }
}

export function sanitizeInlineAssistantBody(body) {
  const source = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const action = safeText(source.action, 40).toLowerCase();
  return {
    action: INLINE_ACTIONS.has(action) ? action : "summarize",
    prompt: safeText(source.prompt, 1200),
    selection: safeText(source.selection, 8000),
    pageContext: safeText(source.pageContext, 5000),
  };
}

export function sanitizeResonantContextSnapshot(snapshot, { tabId = null, title = "", url = "" } = {}) {
  const source = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : {};
  const sourceUrl = safeUrl(source.url) || safeUrl(url);
  const sections = Array.isArray(source.sections)
    ? source.sections.slice(0, 8).map((section) => ({
      label: safeText(section?.label, 80),
      text: safeText(section?.text ?? section?.summary, 700),
    })).filter((section) => section.label || section.text)
    : [];
  return {
    tabId,
    title: safeText(source.title || title, 160),
    url: sourceUrl,
    text: safeText(source.text ?? source.visibleText ?? source.summary, 7000),
    sections,
    receivedAt: new Date().toISOString(),
  };
}
