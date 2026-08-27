import { walletStateSummary } from "./wallet-state.js";

export const DAO_TARGET_TERMS = /\b(wallet|connect|sign|signature|vote|voting|for|against|abstain|cast|proposal|quorum|delegate|delegation|governance|submit|confirm|execute|queue|timelock|transaction|transfer|treasury|dao|token|stake|unstake|claim|snapshot|tally)\b/i;

export function daoAffordances(snapshot, { controlLimit = 16, fieldLimit = 12 } = {}) {
  const visibleControls = (snapshot?.controls ?? [])
    .filter((control) => DAO_TARGET_TERMS.test([control.text, control.ariaLabel, control.role, control.tagName].filter(Boolean).join(" ")))
    .slice(0, controlLimit);
  const fields = (snapshot?.fields ?? [])
    .filter((field) => DAO_TARGET_TERMS.test([field.label, field.name, field.placeholder, field.kind].filter(Boolean).join(" ")))
    .slice(0, fieldLimit);
  return { fields, visibleControls };
}

export function daoControlLines(visibleControls = []) {
  return visibleControls.length
    ? visibleControls.map((control) => `- ${control.text || control.ariaLabel || control.tagName}${control.ref ? ` · ref ${control.ref}` : ""}`)
    : ["- No wallet/governance-specific controls were visible in the current observation."];
}

export function daoFieldLines(fields = []) {
  return fields.length
    ? fields.map((field) => `- ${field.label || field.name || field.placeholder || field.kind}${field.ref ? ` · ref ${field.ref}` : ""}`)
    : ["- No wallet/governance-specific fields were visible in the current observation."];
}

export function daoRiskChecklistMarkdown(snapshot) {
  const text = String(snapshot?.text ?? "").replace(/\s+/g, " ").trim();
  const checks = [
    ["domain", snapshot?.url ? new URL(snapshot.url).hostname : ""],
    ["proposal", /proposal\s*(?:#|id)?\s*[:#-]?\s*([a-z0-9._-]+)/i.exec(text)?.[0] ?? ""],
    ["quorum", /\bquorum\b[^.]{0,120}/i.exec(text)?.[0] ?? ""],
    ["treasury", /\btreasury\b[^.]{0,120}/i.exec(text)?.[0] ?? ""],
    ["deadline", /\b(deadline|ends?|closes?)\b[^.]{0,120}/i.exec(text)?.[0] ?? ""]
  ];
  return checks.map(([label, value]) => `- ${label}: ${value || "not visible in current capture"}`);
}

export function walletDaoAuditMarkdown({ goal, snapshot, walletState }) {
  const { fields, visibleControls } = daoAffordances(snapshot);
  return [
    `# Wallet / DAO Audit: ${goal || snapshot?.title || "Active page"}`,
    "",
    `- capturedAt: ${new Date().toISOString()}`,
    `- pageTitle: ${snapshot?.title || "Untitled"}`,
    `- pageUrl: ${snapshot?.url || walletState?.tab?.url || "unknown"}`,
    `- walletProbeSource: ${walletState?.source || "unknown"}`,
    `- detectionOnly: ${walletState?.detectionOnly ? "yes" : "unknown"}`,
    "",
    "## Wallet Provider State",
    walletStateSummary(walletState),
    "",
    "## Visible Wallet / Governance Controls",
    ...daoControlLines(visibleControls),
    "",
    "## Relevant Fields",
    ...daoFieldLines(fields),
    "",
    "## DAO Risk Checklist",
    ...daoRiskChecklistMarkdown(snapshot),
    "",
    "## Requested Goal",
    goal || "_No specific goal was provided._",
    "",
    "## Human Boundary",
    "This artifact is read-only evidence. ResonantOS did not request wallet connection, did not ask for a signature, did not expose seed/private keys, did not submit a transaction, and did not click wallet, vote, transfer, or public-submit controls.",
    "",
    "## Review Notes",
    "- Treat this as raw Living Archive intake, not trusted AI Memory.",
    "- Review domain, visible proposal values, governance controls, and wallet state before any human action.",
    "- Any wallet connection, signature, vote, transaction, transfer, or public submission must be completed manually by the human."
  ].join("\n");
}
