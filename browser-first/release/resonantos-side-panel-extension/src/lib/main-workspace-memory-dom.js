// Intent citation: docs/architecture/ADR-027-living-archive-llm-wiki-compliance.md

export const formatCount = (value) => Number(value ?? 0).toLocaleString();

export function memoryMetric(label, value, meta = "") {
  const node = document.createElement("div");
  node.className = "memory-metric";
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.textContent = value;
  const metaNode = document.createElement("small");
  metaNode.textContent = meta;
  node.append(labelNode, valueNode, metaNode);
  return node;
}

export function memoryResultCard(match) {
  const card = document.createElement("article");
  card.className = "memory-result";
  const title = document.createElement("strong");
  title.textContent = match.title || "Untitled memory page";
  const path = document.createElement("code");
  path.textContent = match.path || "AI_MEMORY";
  const excerpt = document.createElement("p");
  excerpt.textContent = match.excerpt || "No excerpt returned.";
  card.append(title, path, excerpt);
  return card;
}

export function wikiHealthCard(health, onRefresh, onRunLint) {
  const card = document.createElement("section");
  card.className = "memory-card memory-wiki-health";
  const top = document.createElement("div");
  top.className = "memory-review-top";
  const label = document.createElement("label");
  label.textContent = "Wiki Health";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.textContent = "Refresh";
  refresh.addEventListener("click", onRefresh);
  const lint = document.createElement("button");
  lint.type = "button";
  lint.textContent = "Run Lint";
  lint.addEventListener("click", onRunLint);
  top.append(label, refresh, lint);

  const score = document.createElement("p");
  score.className = "memory-status";
  const issueCount = Array.isArray(health?.issues) ? health.issues.length : 0;
  score.dataset.tone = !health?.exists ? "error" : issueCount ? "warning" : "success";
  score.textContent = health?.exists
    ? `Health ${health.score ?? 0}/100 · ${formatCount(health.pages)} page(s) · ${issueCount} issue(s).`
    : "AI_MEMORY/wiki is missing.";

  const summary = document.createElement("div");
  summary.className = "memory-health-summary";
  summary.append(
    memoryMetric("Index", health?.index?.exists ? "Present" : "Missing", `${formatCount(health?.index?.entries)} linked entries`),
    memoryMetric("Log", health?.log?.exists ? "Present" : "Missing", health?.log?.modifiedAt || "no timestamp"),
    memoryMetric("Broken links", formatCount(health?.brokenLinks?.length), "sampled"),
    memoryMetric("Orphans", formatCount(health?.orphanPages?.length), "sampled")
  );

  const list = document.createElement("ol");
  list.className = "memory-health-issues";
  const issues = Array.isArray(health?.issues) ? health.issues : [];
  if (!issues.length && health?.exists) {
    const item = document.createElement("li");
    item.textContent = "No wiki structure issues found in this scan.";
    list.append(item);
  } else {
    for (const issue of issues.slice(0, 8)) {
      const item = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = issue.type || issue.severity || "issue";
      const body = document.createElement("span");
      body.textContent = issue.message || "Review this wiki health issue.";
      item.append(title, body);
      list.append(item);
    }
  }

  card.append(top, score, summary, list);
  return card;
}

export function setMemoryStatus(node, text, tone = "neutral") {
  node.textContent = text;
  node.dataset.tone = tone;
}

export function reviewMatchesHandoff(request = {}, { initialReviewPath = "", initialArtifactPath = "" } = {}) {
  const reviewPath = String(initialReviewPath ?? "").trim();
  const artifactPath = String(initialArtifactPath ?? "").trim();
  return Boolean(
    (reviewPath && (request.path === reviewPath || request.reviewRequestPath === reviewPath)) ||
    (artifactPath && request.artifactPath === artifactPath)
  );
}

export function promotionMatchesHandoff(entry = {}, { initialReviewPath = "", initialPromotedPage = "" } = {}) {
  const reviewPath = String(initialReviewPath ?? "").trim();
  const promotedPage = String(initialPromotedPage ?? "").trim();
  return Boolean(
    (promotedPage && entry.promotedPage === promotedPage) ||
    (reviewPath && (entry.path === reviewPath || entry.reviewRequestPath === reviewPath))
  );
}
