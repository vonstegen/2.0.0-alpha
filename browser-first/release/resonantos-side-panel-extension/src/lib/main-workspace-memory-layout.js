import { optionNode } from "./memory-source-renderers.js";
import { memoryMetric } from "./main-workspace-memory-dom.js";

export function createLivingArchiveLayout({
  container,
  documentRef = document,
}) {
  const section = documentRef.createElement("section");
  section.className = "memory-workspace";
  section.setAttribute("aria-label", "Living Archive workspace");

  const header = documentRef.createElement("header");
  header.className = "memory-hero";
  const eyebrow = documentRef.createElement("span");
  eyebrow.className = "module-eyebrow";
  eyebrow.textContent = "Living Archive";
  const title = documentRef.createElement("h1");
  title.textContent = "Your AI memory, organized from your sources.";
  const body = documentRef.createElement("p");
  body.textContent = "Search what Augmentor already knows, add notes or files, and review items before they become AI Memory.";
  header.append(eyebrow, title, body);

  const metrics = documentRef.createElement("div");
  metrics.className = "memory-metrics";
  metrics.append(
    memoryMetric("Memory pages", "…", "organized AI pages"),
    memoryMetric("Saved sources", "…", "notes and files"),
    memoryMetric("To review", "…", "before trusted memory")
  );

  const wikiHealthPanel = documentRef.createElement("section");
  wikiHealthPanel.className = "memory-card memory-wiki-health";
  wikiHealthPanel.textContent = "Loading wiki health…";

  const searchForm = documentRef.createElement("form");
  searchForm.className = "memory-card memory-search";
  const searchLabel = documentRef.createElement("label");
  searchLabel.textContent = "Search memory";
  const searchRow = documentRef.createElement("div");
  searchRow.className = "memory-row";
  const searchInput = documentRef.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search concepts, people, projects, claims…";
  searchInput.minLength = 2;
  const searchButton = documentRef.createElement("button");
  searchButton.type = "submit";
  searchButton.textContent = "Search";
  searchRow.append(searchInput, searchButton);
  const searchStatus = documentRef.createElement("p");
  searchStatus.className = "memory-status";
  const searchResults = documentRef.createElement("div");
  searchResults.className = "memory-results";
  searchForm.append(searchLabel, searchRow, searchStatus, searchResults);

  const intakeForm = documentRef.createElement("form");
  intakeForm.className = "memory-card memory-intake";
  const intakeLabel = documentRef.createElement("label");
  intakeLabel.textContent = "Add note or file";
  const titleInput = documentRef.createElement("input");
  titleInput.type = "text";
  titleInput.placeholder = "Note or file title";
  const contentInput = documentRef.createElement("textarea");
  contentInput.rows = 5;
  contentInput.placeholder = "Paste/write a note, or choose a supported text file. It is saved as intake, not directly promoted into trusted AI Memory.";
  const fileInput = documentRef.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".md,.markdown,.txt,.csv,.json,.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.mp4,text/*,application/json,application/pdf,image/*,audio/*,video/*";
  fileInput.setAttribute("aria-label", "Choose a file for governed intake");
  const intakeButton = documentRef.createElement("button");
  intakeButton.type = "submit";
  intakeButton.textContent = "Save to intake";
  const intakeStatus = documentRef.createElement("p");
  intakeStatus.className = "memory-status";
  intakeForm.append(intakeLabel, titleInput, contentInput, fileInput, intakeButton, intakeStatus);

  const reviewPanel = documentRef.createElement("section");
  reviewPanel.className = "memory-card memory-review-queue";
  const reviewHeader = documentRef.createElement("div");
  reviewHeader.className = "memory-review-top";
  const reviewLabel = documentRef.createElement("label");
  reviewLabel.textContent = "Items to review";
  const refreshReview = documentRef.createElement("button");
  refreshReview.type = "button";
  refreshReview.textContent = "Refresh";
  reviewHeader.append(reviewLabel, refreshReview);
  const reviewStatus = documentRef.createElement("p");
  reviewStatus.className = "memory-status";
  const reviewList = documentRef.createElement("div");
  reviewList.className = "memory-review-list";
  const draftPreview = documentRef.createElement("article");
  draftPreview.className = "memory-review-preview";
  draftPreview.hidden = true;
  reviewPanel.append(reviewHeader, reviewStatus, reviewList, draftPreview);

  const promotionPanel = documentRef.createElement("section");
  promotionPanel.className = "memory-card memory-promotion-history";
  const promotionHeader = documentRef.createElement("div");
  promotionHeader.className = "memory-review-top";
  const promotionLabel = documentRef.createElement("label");
  promotionLabel.textContent = "Memory history";
  const refreshPromotions = documentRef.createElement("button");
  refreshPromotions.type = "button";
  refreshPromotions.textContent = "Refresh";
  promotionHeader.append(promotionLabel, refreshPromotions);
  const promotionStatus = documentRef.createElement("p");
  promotionStatus.className = "memory-status";
  const promotionList = documentRef.createElement("div");
  promotionList.className = "memory-promotion-list";
  const promotionPreview = documentRef.createElement("article");
  promotionPreview.className = "memory-review-preview";
  promotionPreview.hidden = true;
  promotionPanel.append(promotionHeader, promotionStatus, promotionList, promotionPreview);

  const sourcePanel = documentRef.createElement("section");
  sourcePanel.className = "memory-card memory-source-review";
  const sourceHeader = documentRef.createElement("div");
  sourceHeader.className = "memory-review-top";
  const sourceLabel = documentRef.createElement("label");
  sourceLabel.textContent = "Connected sources";
  const sourceHeaderActions = documentRef.createElement("div");
  sourceHeaderActions.className = "memory-review-actions";
  const runSourceSync = documentRef.createElement("button");
  runSourceSync.type = "button";
  runSourceSync.textContent = "Run Sync Now";
  const refreshSources = documentRef.createElement("button");
  refreshSources.type = "button";
  refreshSources.textContent = "Refresh";
  sourceHeaderActions.append(runSourceSync, refreshSources);
  sourceHeader.append(sourceLabel, sourceHeaderActions);
  const sourceFilterBar = documentRef.createElement("div");
  sourceFilterBar.className = "memory-source-filterbar memory-source-list-filterbar";
  const sourceStateFilter = documentRef.createElement("select");
  sourceStateFilter.setAttribute("aria-label", "Filter connected sources by state");
  sourceStateFilter.append(
    optionNode("all", "All sources"),
    optionNode("active", "Active"),
    optionNode("disabled", "Disabled"),
    optionNode("missing", "Missing")
  );
  const sourceTextFilter = documentRef.createElement("input");
  sourceTextFilter.type = "search";
  sourceTextFilter.placeholder = "Filter connected sources";
  sourceTextFilter.setAttribute("aria-label", "Filter connected sources by text");
  const sourceFilterCount = documentRef.createElement("small");
  sourceFilterBar.append(sourceStateFilter, sourceTextFilter, sourceFilterCount);
  const sourceStatus = documentRef.createElement("p");
  sourceStatus.className = "memory-status";
  const sourceSyncHistory = documentRef.createElement("div");
  sourceSyncHistory.className = "memory-source-sync-history-host";
  const sourceRepairHistory = documentRef.createElement("div");
  sourceRepairHistory.className = "memory-source-repair-history-host";
  const sourceMoveHistory = documentRef.createElement("div");
  sourceMoveHistory.className = "memory-source-move-history-host";
  const sourceList = documentRef.createElement("div");
  sourceList.className = "memory-source-list";
  const sourcePreview = documentRef.createElement("div");
  sourcePreview.className = "memory-source-preview";
  sourcePanel.append(sourceHeader, sourceFilterBar, sourceStatus, sourceSyncHistory, sourceRepairHistory, sourceMoveHistory, sourceList, sourcePreview);

  const advancedPanel = documentRef.createElement("details");
  advancedPanel.className = "memory-advanced";
  const advancedSummary = documentRef.createElement("summary");
  advancedSummary.textContent = "Advanced memory tools";
  const advancedBody = documentRef.createElement("div");
  advancedBody.className = "memory-advanced-body";
  advancedBody.append(sourcePanel, promotionPanel, wikiHealthPanel);
  advancedPanel.append(advancedSummary, advancedBody);

  section.append(header, metrics, searchForm, intakeForm, reviewPanel, advancedPanel);
  container.append(section);

  return {
    contentInput,
    draftPreview,
    fileInput,
    intakeButton,
    intakeForm,
    intakeStatus,
    metrics,
    promotionList,
    promotionPreview,
    promotionStatus,
    refreshPromotions,
    refreshReview,
    refreshSources,
    reviewList,
    reviewStatus,
    runSourceSync,
    searchForm,
    searchButton,
    searchInput,
    searchResults,
    searchStatus,
    sourceFilterCount,
    sourceList,
    sourceMoveHistory,
    sourcePreview,
    sourceRepairHistory,
    sourceStateFilter,
    sourceStatus,
    sourceSyncHistory,
    sourceTextFilter,
    titleInput,
    wikiHealthPanel,
  };
}
