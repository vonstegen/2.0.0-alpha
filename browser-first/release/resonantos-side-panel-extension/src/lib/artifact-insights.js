// Intent citation: docs/architecture/ADR-027-living-archive-llm-wiki-compliance.md

export function artifactInsightsFromMarkdown(content) {
  const value = String(content ?? "");
  const lineValue = (label) => {
    const match = new RegExp(`^-\\s*${label}:\\s*(.+)$`, "mi").exec(value);
    return match?.[1]?.trim() ?? "";
  };
  const headingValue = (heading, label) => {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`^##\\s+${escapedHeading}\\s*$[\\s\\S]*?^-\\s*${escapedLabel}:\\s*(.+)$`, "mi").exec(value);
    return match?.[1]?.trim() ?? "";
  };
  const isWalletDaoAudit = /^#\s*Wallet \/ DAO Audit\b/im.test(value) || /origin:\s*browser-wallet-dao-audit/i.test(value);
  const isResearchTrail = /^#\s*Research Trail\b/im.test(value) || /browser research trail intake bundle/i.test(value);
  const isPageSummary = /^##\s+AI Summary\b/im.test(value) && /^##\s+Provenance\b/im.test(value);
  const isSelection = /^##\s+Selection\b/im.test(value);
  const isPageCapture = /^##\s+Page Context\b/im.test(value) && /^##\s+Visible Text\b/im.test(value);
  const walletSummary = [
    /Phantom Solana:\s*(.+)$/mi.exec(value)?.[1]?.trim(),
    /Phantom Ethereum:\s*(.+)$/mi.exec(value)?.[1]?.trim()
  ].filter(Boolean).join(" · ");
  const nextHumanAction = /^ {0,5}-\s*next human action:\s*(.+)$/gmi.exec(value)?.[1]?.trim() ?? "";
  const summary = lineValue("summary");
  const phase = lineValue("phase");
  const percentComplete = lineValue("percentComplete");
  const targetSite = lineValue("targetSite");
  const targetReason = lineValue("targetReason");
  const status = lineValue("status");
  const pageTitle = lineValue("pageTitle") || headingValue("Page Context", "title") || headingValue("Provenance", "title");
  const pageUrl = lineValue("pageUrl") || headingValue("Page Context", "url") || headingValue("Provenance", "url") || (/^Captured from:\s*(.+)$/mi.exec(value)?.[1]?.trim() ?? "");
  const linksCaptured = headingValue("Page Context", "links captured");
  const controlsCaptured = headingValue("Page Context", "controls captured");
  const fieldsCaptured = headingValue("Page Context", "fields captured");
  const visibleWords = headingValue("Provenance", "visible words captured");
  const summaryModel = headingValue("Provenance", "model");
  const fallbackSummary = headingValue("Provenance", "fallback summary");
  const pagesCaptured = lineValue("pages captured");
  const tabsSkipped = lineValue("tabs skipped");
  const firstTrailPage = /^##\s+Page\s+1:\s*(.+)$/mi.exec(value)?.[1]?.trim() ?? "";
  const sourceType = isWalletDaoAudit
    ? "Wallet / DAO audit"
    : isResearchTrail
      ? "Browser research trail"
      : isPageSummary
        ? "AI page summary"
        : isSelection
          ? "Selected browser text"
          : isPageCapture
            ? "Browser page capture"
            : "";
  const sourceStats = isResearchTrail
    ? [
      pagesCaptured ? `${pagesCaptured} page(s)` : "",
      tabsSkipped ? `${tabsSkipped} skipped tab(s)` : "",
      firstTrailPage ? `first: ${firstTrailPage}` : ""
    ].filter(Boolean).join(" · ")
    : [
      visibleWords ? `${visibleWords} visible word(s)` : "",
      linksCaptured ? `${linksCaptured} link(s)` : "",
      controlsCaptured ? `${controlsCaptured} control(s)` : "",
      fieldsCaptured ? `${fieldsCaptured} field(s)` : ""
    ].filter(Boolean).join(" · ");
  return {
    capturedAt: lineValue("capturedAt") || lineValue("collectedAt"),
    evidenceType: isWalletDaoAudit ? "Wallet / DAO Audit" : "",
    fallbackSummary,
    nextHumanAction,
    pageTitle,
    pageUrl,
    percentComplete,
    phase,
    sourceStats,
    sourceType,
    summaryModel,
    status,
    summary: summary || (isWalletDaoAudit ? "Read-only wallet/DAO evidence queued for review" : ""),
    targetReason,
    targetSite,
    walletSummary
  };
}
