const HARD_BOUNDARY_TEXT = "Wallet, login, payment, credentials, signing, personal autofill, and public-submit stay gated.";

export function permissionLabel(mode) {
  if (mode === "blocked") return "Blocked";
  if (mode === "read-only") return "Read only";
  if (mode === "trusted-for-safe-actions") return "Trusted safe actions";
  if (mode === "unavailable") return "Unavailable";
  return "Ask before action";
}

function cleanSiteKey(siteKey) {
  return String(siteKey || "this site").trim() || "this site";
}

function activeDelegatedConsent(consent) {
  return ["allow-safe", "allow-once"].includes(consent?.mode) ? consent : null;
}

function row(state, text) {
  const labels = {
    allowed: "Allowed",
    blocked: "Blocked",
    "requires-review": "Requires review"
  };
  return {
    state,
    label: labels[state] ?? state,
    text
  };
}

export function describeAugmentorModeStatus({ permissionMode = "ask-before-action", siteKey = "", consent = null } = {}) {
  const normalizedMode = permissionMode || "ask-before-action";
  const site = cleanSiteKey(siteKey);
  const delegatedConsent = normalizedMode === "blocked" ? null : activeDelegatedConsent(consent);
  if (normalizedMode === "blocked") {
    return {
      modeLabel: "Q&A only",
      permissionLabel: permissionLabel(normalizedMode),
      explanation: `Augmentor can answer questions, but browser reads and actions are blocked for ${site}.`,
      breakdown: [
        row("allowed", "Chat answers and planning that do not touch the page."),
        row("requires-review", "Change the site permission before Augmentor can inspect or operate this page."),
        row("blocked", "Page reads, clicks, typing, scrolling, submits, wallet, login, payment, credentials, signing, and public-submit actions.")
      ]
    };
  }
  if (normalizedMode === "read-only") {
    return {
      modeLabel: "Q&A only",
      permissionLabel: permissionLabel(normalizedMode),
      explanation: `Augmentor may read visible page context for ${site}, but it will not click, type, scroll, or submit.`,
      breakdown: [
        row("allowed", "Q&A, summaries, page text, controls, fields, frames, and metadata."),
        row("requires-review", "Change the site permission before any browser action can run."),
        row("blocked", "Clicks, typing, scrolling, submits, wallet, login, payment, credentials, signing, and public-submit actions.")
      ]
    };
  }
  if (delegatedConsent) {
    const taskClass = String(delegatedConsent.taskClass || "task").trim() || "task";
    const once = delegatedConsent.mode === "allow-once";
    return {
      modeLabel: "Fully delegated",
      permissionLabel: permissionLabel(normalizedMode),
      explanation: once
        ? `Augmentor may run safe ${taskClass} actions for ${site} for this execution only.`
        : `Augmentor may run safe ${taskClass} actions for ${site} without per-action approval.`,
      breakdown: [
        row("allowed", `Page reading and safe actions within the approved ${taskClass} task class${once ? " for this execution only" : ""}.`),
        row("requires-review", "Actions outside the approved task class or unclear targets stop for review."),
        row("blocked", HARD_BOUNDARY_TEXT)
      ]
    };
  }
  if (normalizedMode === "trusted-for-safe-actions") {
    return {
      modeLabel: "Fully delegated",
      permissionLabel: permissionLabel(normalizedMode),
      explanation: `Augmentor may run safe browser actions on ${site} without per-action approval.`,
      breakdown: [
        row("allowed", "Page reading, safe clicks, non-sensitive typing, scrolling, and search-like submits."),
        row("requires-review", "Ambiguous, risky, destructive, or externally visible actions stop for human review."),
        row("blocked", HARD_BOUNDARY_TEXT)
      ]
    };
  }
  return {
    modeLabel: "Partial automation",
    permissionLabel: permissionLabel(normalizedMode),
    explanation: `Augmentor can inspect ${site} and propose actions; each browser action needs approval.`,
    breakdown: [
      row("allowed", "Page reading, planning, and approved action-by-action execution."),
      row("requires-review", "Clicks, non-sensitive typing, scrolling, and safe submits require approval before they run."),
      row("blocked", "Wallet, login, payment, credentials, signing, personal autofill, destructive actions, and public-submit remain human-only.")
    ]
  };
}

function compactState(status) {
  if (status.modeLabel === "Fully delegated") return "safe actions allowed";
  if (status.permissionLabel === "Blocked") return "page access blocked";
  if (status.permissionLabel === "Read only") return "read-only page context";
  return "approval required";
}

export function formatModeStatusLine(input = {}) {
  const status = describeAugmentorModeStatus(input);
  return `Mode: ${status.modeLabel} · Permission: ${status.permissionLabel} · ${compactState(status)}`;
}

export function createModeStatusSection({ document, status }) {
  const section = document.createElement("section");
  section.className = "settings-mode-status";
  const heading = document.createElement("strong");
  heading.textContent = `Mode: ${status.modeLabel}`;
  const summary = document.createElement("p");
  summary.textContent = `${status.permissionLabel} · ${status.explanation}`;
  const list = document.createElement("ol");
  list.className = "settings-control-list settings-mode-status-list";
  status.breakdown.forEach((entry) => {
    const item = document.createElement("li");
    item.className = "settings-control-row";
    item.dataset.state = entry.state;
    const copy = document.createElement("span");
    const label = document.createElement("strong");
    label.textContent = entry.label;
    const text = document.createElement("small");
    text.textContent = entry.text;
    copy.append(label, text);
    item.append(copy);
    list.append(item);
  });
  section.append(heading, summary, list);
  return section;
}
