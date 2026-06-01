export function createMemoryHostService(handlers = {}) {
  function required(name) {
    if (typeof handlers[name] !== "function") {
      throw new Error(`Memory host service missing handler: ${name}`);
    }
    return handlers[name];
  }

  return {
    memoryBridgeRoutes: [
      { method: "GET", path: "/memory/status", handler: required("executeMemoryStatus") },
      { method: "GET", path: "/memory/settings", handler: required("executeMemorySettings") },
      {
        method: "POST",
        path: "/memory/settings",
        requiredCapability: "memory-settings-write",
        handler: required("executeMemorySettingsSave"),
      },
      {
        method: "POST",
        path: "/memory/source/browse",
        requiredCapability: "memory-source-browse",
        handler: required("executeMemorySourceBrowse"),
      },
      {
        method: "POST",
        path: "/memory/source/scan",
        requiredCapability: "memory-source-scan",
        handler: required("executeMemorySourceScan"),
      },
      {
        method: "POST",
        path: "/memory/source/action",
        requiredCapability: "memory-source-manage",
        handler: required("executeMemorySourceAction"),
      },
      {
        method: "POST",
        path: "/memory/source/move-preflight",
        requiredCapability: "memory-source-move",
        handler: required("executeMemorySourceMovePreflight"),
      },
      {
        method: "POST",
        path: "/memory/source/move-execute",
        requiredCapability: "memory-source-move",
        handler: required("executeMemorySourceMoveExecute"),
      },
      {
        method: "POST",
        path: "/memory/source/move-rollback",
        requiredCapability: "memory-source-move",
        handler: required("executeMemorySourceMoveRollback"),
      },
      {
        method: "POST",
        path: "/memory/source/review",
        requiredCapability: "memory-source-review",
        handler: required("executeMemorySourceReview"),
      },
      {
        method: "POST",
        path: "/memory/source/intake",
        requiredCapability: "memory-source-intake",
        handler: required("executeMemorySourceIntake"),
      },
      {
        method: "POST",
        path: "/memory/source/file-intake",
        requiredCapability: "memory-source-file-intake",
        handler: required("executeMemorySourceFileIntake"),
      },
      {
        method: "POST",
        path: "/memory/source/sync",
        requiredCapability: "memory-source-file-intake",
        handler: required("executeMemorySourceSync"),
      },
      { method: "POST", path: "/memory/search", handler: required("executeMemorySearch") },
      { method: "GET", path: "/memory/wiki/health", handler: required("executeMemoryWikiHealth") },
      { method: "POST", path: "/memory/wiki/page/read", handler: required("executeMemoryWikiPageRead") },
      {
        method: "POST",
        path: "/memory/wiki/lint",
        requiredCapability: "memory-source-review",
        handler: required("executeMemoryWikiLint"),
      },
      { method: "POST", path: "/memory/source/versions", handler: required("executeMemorySourceVersions") },
      {
        method: "POST",
        path: "/memory/source/versions/repair",
        requiredCapability: "memory-source-manage",
        handler: required("executeMemorySourceVersionsRepair"),
      },
      {
        method: "POST",
        path: "/memory/source/diff",
        requiredCapability: "memory-source-review",
        handler: required("executeMemorySourceDiff"),
      },
      { method: "POST", path: "/archive/intake", handler: required("executeArchiveIntake") },
      { method: "POST", path: "/archive/intake/list", handler: required("executeArchiveIntakeList") },
      { method: "POST", path: "/archive/intake/read", handler: required("executeArchiveIntakeRead") },
      { method: "POST", path: "/archive/review/request", handler: required("executeArchiveReviewRequest") },
      { method: "POST", path: "/archive/review/list", handler: required("executeArchiveReviewList") },
      { method: "POST", path: "/archive/review/transition", handler: required("executeArchiveReviewTransition") },
      { method: "POST", path: "/archive/review/draft", handler: required("executeArchiveReviewDraft") },
      { method: "POST", path: "/archive/review/artifact/read", handler: required("executeArchiveReviewArtifactRead") },
      { method: "POST", path: "/archive/review/artifact/verify", handler: required("executeArchiveReviewArtifactVerify") },
      { method: "POST", path: "/archive/review/verification/read", handler: required("executeArchiveVerificationRead") },
      { method: "POST", path: "/archive/review/artifact/revise", handler: required("executeArchiveReviewArtifactRevise") },
      { method: "POST", path: "/archive/review/artifact/promote", handler: required("executeArchiveReviewArtifactPromote") },
      { method: "POST", path: "/archive/review/promotions/list", handler: required("executeArchivePromotionList") },
      { method: "POST", path: "/archive/review/promotions/restore", handler: required("executeArchivePromotionRestore") },
    ],
  };
}
