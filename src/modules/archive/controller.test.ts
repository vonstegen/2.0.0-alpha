import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDefaultState } from "../../core/defaults";
import type {
  ArchiveIngestProbeResult,
  ArchiveSearchSourceHit,
  ArchiveSourceWatchRecord,
  ProviderDiagnosticReport,
} from "../../core/contracts";

const runtimeMocks = vi.hoisted(() => ({
  requestProviderDiagnostics: vi.fn(),
  requestArchiveImportedLibraries: vi.fn(),
  requestArchiveSourceFolderScan: vi.fn(),
  requestArchiveLibraryImport: vi.fn(),
  requestArchiveLibraryPreflight: vi.fn(),
  requestArchiveAiMemoryBuildJobs: vi.fn(),
  requestArchiveIngestProbe: vi.fn(),
  requestArchiveLibraryFolderSelection: vi.fn(),
  requestArchiveLibraryClassificationReview: vi.fn(),
  requestArchiveLibraryReorganisationPlan: vi.fn(),
  requestArchiveQueueImportedLibraryIngest: vi.fn(),
  requestArchiveReviewQueue: vi.fn(),
  requestArchiveReviewArtifacts: vi.fn(),
  requestArchiveBackgroundCycle: vi.fn(),
  requestArchiveLint: vi.fn(),
  requestArchiveSemanticLint: vi.fn(),
  requestArchiveAiMemoryBuildJob: vi.fn(),
}));

vi.mock("../../core/runtime", () => runtimeMocks);

const memoryProviderMock = vi.hoisted(() => ({
  status: vi.fn(),
  search: vi.fn(),
  read: vi.fn(),
  reviewQueue: vi.fn(),
  reviewArtifacts: vi.fn(),
  ingestRequest: vi.fn(),
  processIngestRequest: vi.fn(),
  decideReview: vi.fn(),
  promoteReviewArtifact: vi.fn(),
  maintenanceCycle: vi.fn(),
  lint: vi.fn(),
  semanticLint: vi.fn(),
  backgroundCycle: vi.fn(),
}));

vi.mock("../../core/memory-provider", () => ({
  livingArchiveMemoryProvider: () => memoryProviderMock,
  resolveMemoryProviderBroker: vi.fn(),
}));

const resolveArchiveIngestRouteMock = vi.fn();
const routedProviderLabelMock = vi.fn();
const resolveRoutineRouteMock = vi.fn();
vi.mock("../../core/provider-service", () => ({
  resolveArchiveIngestRoute: (...args: unknown[]) => resolveArchiveIngestRouteMock(...args),
  resolveRoutineRoute: (...args: unknown[]) => resolveRoutineRouteMock(...args),
  routedProviderLabel: (...args: unknown[]) => routedProviderLabelMock(...args),
}));

const applyProviderDiagnosticsMock = vi.fn((state: unknown, _reports: unknown) => state);
const providerCredentialReadyMock = vi.fn().mockReturnValue(true);
vi.mock("../../core/policies", () => ({
  applyProviderDiagnostics: applyProviderDiagnosticsMock,
}));
vi.mock("../../core/provider-credentials", () => ({
  providerCredentialReady: providerCredentialReadyMock,
}));

const errorMessageOf = (_error: unknown, fallback: string) => fallback;

const createRouteMock = (overrides = {}) => ({
  provider: { id: "provider-test", providerType: "openai", label: "Test Provider", credentialStatus: "configured" },
  runtimeNode: { id: "node-test", kind: "cloud", endpoint: "https://api.test.com" },
  model: "gpt-4o",
  decision: {
    authTier: "supported",
    resolutionReason: "viable-route-found",
  },
  ...overrides,
});

describe("loadArchiveImportedLibraries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads imported libraries from runtime and sets them", async () => {
    const libraries = [{ id: "lib-1", name: "Test Lib" }];
    runtimeMocks.requestArchiveImportedLibraries.mockResolvedValue(libraries);
    const setArchiveImportedLibraries = vi.fn();

    const { loadArchiveImportedLibraries } = await import("./controller");
    await loadArchiveImportedLibraries({
      setChatNotice: vi.fn(),
      setArchiveSourceScanBusy: vi.fn(),
      setArchiveImportedLibraries,
      errorMessageOf,
    });

    expect(setArchiveImportedLibraries).toHaveBeenCalledWith(libraries);
  });
});

describe("scanArchiveSourceFolders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scans source folders and sets the result", async () => {
    const result = { filesSeen: 10, newFiles: 3, changedFiles: 1 };
    runtimeMocks.requestArchiveSourceFolderScan.mockResolvedValue(result);
    const setArchiveSourceScanResult = vi.fn();
    const setChatNotice = vi.fn();

    const { scanArchiveSourceFolders } = await import("./controller");
    await scanArchiveSourceFolders({
      rootPath: "/path/to/source",
      setChatNotice,
      setArchiveSourceScanBusy: vi.fn(),
      setArchiveSourceScanResult,
      errorMessageOf,
    });

    expect(setArchiveSourceScanResult).toHaveBeenCalledWith(result);
    expect(setChatNotice).toHaveBeenCalledWith(expect.stringContaining("Scanned 10 source file"));
  });
});

describe("loadArchiveRuntimeStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads runtime status from the memory provider", async () => {
    const status = { status: "ready", version: "1.0" };
    memoryProviderMock.status.mockResolvedValue(status);
    const setArchiveStatus = vi.fn();

    const { loadArchiveRuntimeStatus } = await import("./controller");
    await loadArchiveRuntimeStatus({
      setChatNotice: vi.fn(),
      setArchiveStatusBusy: vi.fn(),
      setArchiveStatus,
      errorMessageOf,
    });

    expect(setArchiveStatus).toHaveBeenCalledWith(status);
  });
});

describe("queueArchiveSourceForIngest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues a source and refreshes the queue", async () => {
    const queue = [{ id: "req-1" }];
    const artifacts = [{ id: "art-1" }];
    memoryProviderMock.ingestRequest.mockResolvedValue(undefined);
    memoryProviderMock.reviewQueue.mockResolvedValue(queue);
    memoryProviderMock.reviewArtifacts.mockResolvedValue(artifacts);
    const setArchiveQueue = vi.fn();
    const setArchiveReviewArtifacts = vi.fn();
    const setChatNotice = vi.fn();

    const { queueArchiveSourceForIngest } = await import("./controller");
    await queueArchiveSourceForIngest({
      source: { sourceId: "src-1", rawPath: "/path/to/doc", title: "My Doc", sourceType: "pdf", processed: false },
      setChatNotice,
      setArchiveQueueBusy: vi.fn(),
      setArchiveQueue,
      setArchiveReviewArtifacts,
      errorMessageOf,
    });

    expect(memoryProviderMock.ingestRequest).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePath: "/path/to/doc" }),
    );
    expect(setArchiveQueue).toHaveBeenCalledWith(queue);
    expect(setChatNotice).toHaveBeenCalledWith(expect.stringContaining("Queued My Doc"));
  });
});

describe("promoteApprovedArchiveReviewArtifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips when no artifacts are promotable", async () => {
    const setChatNotice = vi.fn();

    const { promoteApprovedArchiveReviewArtifacts } = await import("./controller");
    await promoteApprovedArchiveReviewArtifacts({
      artifacts: [],
      actorId: "strategist.core",
      setChatNotice,
      setArchiveQueueBusy: vi.fn(),
      setArchiveReviewArtifacts: vi.fn(),
      setArchivePromotionResult: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith(
      "No approved, unpromoted archive review artifacts are ready for trusted wiki promotion.",
    );
  });
});

describe("executeArchiveIngestProbe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providerCredentialReadyMock.mockReset();
    providerCredentialReadyMock.mockReturnValue(true);
  });

  it("resolves route, probes ingest, and sets the probe result", async () => {
    const state = buildDefaultState([]);
    const reports: ProviderDiagnosticReport[] = [];
    runtimeMocks.requestProviderDiagnostics.mockResolvedValue(reports);
    resolveArchiveIngestRouteMock.mockReturnValue(createRouteMock());
    routedProviderLabelMock.mockReturnValue("Test Provider via Cloud");
    const probeResult = {
      sourceLabel: "Probe source",
      summary: "Probe succeeded",
      checkedAt: new Date().toISOString(),
    } as ArchiveIngestProbeResult;
    runtimeMocks.requestArchiveIngestProbe.mockResolvedValue(probeResult);

    const snapshot = { state, bundled: [], sideloaded: [] };
    const setArchiveProbeResult = vi.fn();

    const { executeArchiveIngestProbe } = await import("./controller");
    await executeArchiveIngestProbe({
      snapshot,
      commitReadyState: vi.fn(),
      setProviderDiagnostics: vi.fn(),
      setChatNotice: vi.fn(),
      setArchiveProbeBusy: vi.fn(),
      setArchiveProbeResult,
      errorMessageOf,
    });

    expect(runtimeMocks.requestArchiveIngestProbe).toHaveBeenCalled();
    expect(setArchiveProbeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        probe: probeResult,
        routeLabel: "Test Provider via Cloud",
        model: "gpt-4o",
      }),
    );
  });

  it("reports failure when no viable route is found", async () => {
    const state = buildDefaultState([]);
    runtimeMocks.requestProviderDiagnostics.mockResolvedValue([]);
    resolveArchiveIngestRouteMock.mockReturnValue(
      createRouteMock({ provider: undefined, runtimeNode: undefined, model: undefined }),
    );

    const snapshot = { state, bundled: [], sideloaded: [] };
    const setChatNotice = vi.fn();

    const { executeArchiveIngestProbe } = await import("./controller");
    await executeArchiveIngestProbe({
      snapshot,
      commitReadyState: vi.fn(),
      setProviderDiagnostics: vi.fn(),
      setChatNotice,
      setArchiveProbeBusy: vi.fn(),
      setArchiveProbeResult: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Archive ingest probe failed.");
  });

  it("reports failure when provider credential is not ready", async () => {
    const state = buildDefaultState([]);
    runtimeMocks.requestProviderDiagnostics.mockResolvedValue([]);
    resolveArchiveIngestRouteMock.mockReturnValue(createRouteMock());
    providerCredentialReadyMock.mockReturnValue(false);

    const snapshot = { state, bundled: [], sideloaded: [] };
    const setChatNotice = vi.fn();

    const { executeArchiveIngestProbe } = await import("./controller");
    await executeArchiveIngestProbe({
      snapshot,
      commitReadyState: vi.fn(),
      setProviderDiagnostics: vi.fn(),
      setChatNotice,
      setArchiveProbeBusy: vi.fn(),
      setArchiveProbeResult: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Archive ingest probe failed.");
  });
});

describe("executeArchiveSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("searches the memory provider and sets the result", async () => {
    const result = { hits: [{ path: "/doc.md", score: 0.95 }], totalHits: 1 };
    memoryProviderMock.search.mockResolvedValue(result);
    const setArchiveSearchResult = vi.fn();

    const { executeArchiveSearch } = await import("./controller");
    await executeArchiveSearch({
      query: "test query",
      setChatNotice: vi.fn(),
      setArchiveSearchBusy: vi.fn(),
      setArchiveSearchResult,
      errorMessageOf,
    });

    expect(memoryProviderMock.search).toHaveBeenCalledWith("test query");
    expect(setArchiveSearchResult).toHaveBeenCalledWith(result);
  });

  it("reports error on search failure", async () => {
    memoryProviderMock.search.mockRejectedValue(new Error("search error"));
    const setChatNotice = vi.fn();

    const { executeArchiveSearch } = await import("./controller");
    await executeArchiveSearch({
      query: "fail",
      setChatNotice,
      setArchiveSearchBusy: vi.fn(),
      setArchiveSearchResult: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Living Archive search failed.");
  });
});

describe("loadArchiveDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads a document from the memory provider", async () => {
    const doc = { path: "/doc.md", content: "# Hello", metadata: {} };
    memoryProviderMock.read.mockResolvedValue(doc);
    const setArchiveDocument = vi.fn();

    const { loadArchiveDocument } = await import("./controller");
    await loadArchiveDocument({
      path: "/doc.md",
      setChatNotice: vi.fn(),
      setArchiveDocumentBusy: vi.fn(),
      setArchiveDocument,
      errorMessageOf,
    });

    expect(memoryProviderMock.read).toHaveBeenCalledWith("/doc.md");
    expect(setArchiveDocument).toHaveBeenCalledWith(doc);
  });

  it("reports error on read failure", async () => {
    memoryProviderMock.read.mockRejectedValue(new Error("read error"));
    const setChatNotice = vi.fn();

    const { loadArchiveDocument } = await import("./controller");
    await loadArchiveDocument({
      path: "/doc.md",
      setChatNotice,
      setArchiveDocumentBusy: vi.fn(),
      setArchiveDocument: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Failed to read archive document.");
  });
});

describe("loadArchiveReviewQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the review queue and artifacts from the memory provider", async () => {
    const queue = [{ id: "req-1", sourcePath: "/doc.md" }];
    const artifacts = [{ id: "art-1", artifactFile: "/art.md" }];
    memoryProviderMock.reviewQueue.mockResolvedValue(queue);
    memoryProviderMock.reviewArtifacts.mockResolvedValue(artifacts);
    const setArchiveQueue = vi.fn();
    const setArchiveReviewArtifacts = vi.fn();

    const { loadArchiveReviewQueue } = await import("./controller");
    await loadArchiveReviewQueue({
      setChatNotice: vi.fn(),
      setArchiveQueueBusy: vi.fn(),
      setArchiveQueue,
      setArchiveReviewArtifacts,
      errorMessageOf,
    });

    expect(memoryProviderMock.reviewQueue).toHaveBeenCalled();
    expect(memoryProviderMock.reviewArtifacts).toHaveBeenCalled();
    expect(setArchiveQueue).toHaveBeenCalledWith(queue);
    expect(setArchiveReviewArtifacts).toHaveBeenCalledWith(artifacts);
  });

  it("reports error when loading review queue fails", async () => {
    memoryProviderMock.reviewQueue.mockRejectedValue(new Error("queue error"));
    const setChatNotice = vi.fn();

    const { loadArchiveReviewQueue } = await import("./controller");
    await loadArchiveReviewQueue({
      setChatNotice,
      setArchiveQueueBusy: vi.fn(),
      setArchiveQueue: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Failed to load archive review queue.");
  });
});

describe("loadArchiveAiMemoryBuildJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads AI memory build jobs from runtime", async () => {
    const jobs = [{ id: "job-1", status: "completed" }];
    runtimeMocks.requestArchiveAiMemoryBuildJobs.mockResolvedValue(jobs);
    const setArchiveAiMemoryBuildJobs = vi.fn();

    const { loadArchiveAiMemoryBuildJobs } = await import("./controller");
    await loadArchiveAiMemoryBuildJobs({
      setChatNotice: vi.fn(),
      setArchiveQueueBusy: vi.fn(),
      setArchiveAiMemoryBuildJobs,
      errorMessageOf,
    });

    expect(runtimeMocks.requestArchiveAiMemoryBuildJobs).toHaveBeenCalled();
    expect(setArchiveAiMemoryBuildJobs).toHaveBeenCalledWith(jobs);
  });

  it("reports error on failure", async () => {
    runtimeMocks.requestArchiveAiMemoryBuildJobs.mockRejectedValue(new Error("build error"));
    const setChatNotice = vi.fn();

    const { loadArchiveAiMemoryBuildJobs } = await import("./controller");
    await loadArchiveAiMemoryBuildJobs({
      setChatNotice,
      setArchiveQueueBusy: vi.fn(),
      setArchiveAiMemoryBuildJobs: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Failed to load AI Memory build jobs.");
  });
});

describe("queueWatchedArchiveSourceForIngest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues a watched source and refreshes the queue", async () => {
    const queue = [{ id: "req-1" }];
    const artifacts = [{ id: "art-1" }];
    memoryProviderMock.ingestRequest.mockResolvedValue(undefined);
    memoryProviderMock.reviewQueue.mockResolvedValue(queue);
    memoryProviderMock.reviewArtifacts.mockResolvedValue(artifacts);
    const setArchiveQueue = vi.fn();
    const setArchiveReviewArtifacts = vi.fn();
    const setChatNotice = vi.fn();
    const source: ArchiveSourceWatchRecord = {
      path: "/watched/file.md",
      absolutePath: "/watched/file.md",
      title: "Watched File",
      sourceType: "markdown",
      status: "new",
      hash: "abc123",
      rootRole: "documents",
      sizeBytes: 1024,
      modifiedAt: "2026-07-20T00:00:00.000Z",
      indexedInDb: false,
    };

    const { queueWatchedArchiveSourceForIngest } = await import("./controller");
    await queueWatchedArchiveSourceForIngest({
      source,
      setChatNotice,
      setArchiveQueueBusy: vi.fn(),
      setArchiveQueue,
      setArchiveReviewArtifacts,
      errorMessageOf,
    });

    expect(memoryProviderMock.ingestRequest).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePath: "/watched/file.md" }),
    );
    expect(setArchiveQueue).toHaveBeenCalledWith(queue);
    expect(setChatNotice).toHaveBeenCalledWith(expect.stringContaining("Queued Watched File"));
  });

  it("reports error on failure", async () => {
    memoryProviderMock.ingestRequest.mockRejectedValue(new Error("queue error"));
    const setChatNotice = vi.fn();

    const { queueWatchedArchiveSourceForIngest } = await import("./controller");
    await queueWatchedArchiveSourceForIngest({
      source: { path: "/f.md", absolutePath: "/f.md", title: "F", sourceType: "markdown", status: "new", hash: "", rootRole: "", sizeBytes: 0, modifiedAt: "2026-07-20T00:00:00.000Z", indexedInDb: false },
      setChatNotice,
      setArchiveQueueBusy: vi.fn(),
      setArchiveQueue: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Failed to queue scanned source for archive review.");
  });
});

describe("importArchiveLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("imports a library and sets the result", async () => {
    const result = { libraryName: "Test Lib", filesImported: 10 };
    runtimeMocks.requestArchiveLibraryImport.mockResolvedValue(result);
    const setArchiveLibraryImportResult = vi.fn();

    const { importArchiveLibrary } = await import("./controller");
    await importArchiveLibrary({
      sourcePath: "/path/lib",
      domain: "mixed-library",
      importMode: "copy",
      setChatNotice: vi.fn(),
      setArchiveSourceScanBusy: vi.fn(),
      setArchiveLibraryImportResult,
      errorMessageOf,
    });

    expect(runtimeMocks.requestArchiveLibraryImport).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePath: "/path/lib" }),
    );
    expect(setArchiveLibraryImportResult).toHaveBeenCalledWith(result);
  });

  it("refreshes imported libraries when callback is provided", async () => {
    const result = { libraryName: "Test Lib", filesImported: 5 };
    runtimeMocks.requestArchiveLibraryImport.mockResolvedValue(result);
    const libraries = [{ id: "lib-1", name: "Test Lib" }];
    runtimeMocks.requestArchiveImportedLibraries.mockResolvedValue(libraries);
    const setArchiveImportedLibraries = vi.fn();

    const { importArchiveLibrary } = await import("./controller");
    await importArchiveLibrary({
      sourcePath: "/path/lib",
      domain: "mixed-library",
      importMode: "copy",
      setChatNotice: vi.fn(),
      setArchiveSourceScanBusy: vi.fn(),
      setArchiveLibraryImportResult: vi.fn(),
      setArchiveImportedLibraries,
      errorMessageOf,
    });

    expect(runtimeMocks.requestArchiveImportedLibraries).toHaveBeenCalled();
    expect(setArchiveImportedLibraries).toHaveBeenCalledWith(libraries);
  });

  it("reports error on failure", async () => {
    runtimeMocks.requestArchiveLibraryImport.mockRejectedValue(new Error("import error"));
    const setChatNotice = vi.fn();

    const { importArchiveLibrary } = await import("./controller");
    await importArchiveLibrary({
      sourcePath: "/path/lib",
      domain: "mixed-library",
      importMode: "copy",
      setChatNotice,
      setArchiveSourceScanBusy: vi.fn(),
      setArchiveLibraryImportResult: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Failed to import library into Living Archive.");
  });
});

describe("preflightArchiveLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs a preflight check and sets the result", async () => {
    const result = { supportedFiles: 10, skippedFiles: 2 };
    runtimeMocks.requestArchiveLibraryPreflight.mockResolvedValue(result);
    const setArchiveLibraryPreflightResult = vi.fn();

    const { preflightArchiveLibrary } = await import("./controller");
    await preflightArchiveLibrary({
      sourcePath: "/path/lib",
      setChatNotice: vi.fn(),
      setArchiveSourceScanBusy: vi.fn(),
      setArchiveLibraryPreflightResult,
      errorMessageOf,
    });

    expect(runtimeMocks.requestArchiveLibraryPreflight).toHaveBeenCalledWith("/path/lib");
    expect(setArchiveLibraryPreflightResult).toHaveBeenCalledWith(result);
  });

  it("reports error on failure", async () => {
    runtimeMocks.requestArchiveLibraryPreflight.mockRejectedValue(new Error("preflight error"));
    const setChatNotice = vi.fn();

    const { preflightArchiveLibrary } = await import("./controller");
    await preflightArchiveLibrary({
      sourcePath: "/path/lib",
      setChatNotice,
      setArchiveSourceScanBusy: vi.fn(),
      setArchiveLibraryPreflightResult: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Failed to preflight Living Archive library import.");
  });
});

describe("loadArchiveLibraryClassificationReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the classification review", async () => {
    const review = { entries: [{ path: "/doc.md", classification: "note" }] };
    runtimeMocks.requestArchiveLibraryClassificationReview.mockResolvedValue(review);
    const setArchiveClassificationReview = vi.fn();

    const { loadArchiveLibraryClassificationReview } = await import("./controller");
    await loadArchiveLibraryClassificationReview({
      classificationManifestPath: "/manifest.json",
      setChatNotice: vi.fn(),
      setArchiveSourceScanBusy: vi.fn(),
      setArchiveClassificationReview,
      errorMessageOf,
    });

    expect(runtimeMocks.requestArchiveLibraryClassificationReview).toHaveBeenCalledWith("/manifest.json");
    expect(setArchiveClassificationReview).toHaveBeenCalledWith(review);
  });

  it("reports error on failure", async () => {
    runtimeMocks.requestArchiveLibraryClassificationReview.mockRejectedValue(new Error("review error"));
    const setChatNotice = vi.fn();

    const { loadArchiveLibraryClassificationReview } = await import("./controller");
    await loadArchiveLibraryClassificationReview({
      classificationManifestPath: "/manifest.json",
      setChatNotice,
      setArchiveSourceScanBusy: vi.fn(),
      setArchiveClassificationReview: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Failed to open Living Archive classification review.");
  });
});

describe("generateArchiveLibraryReorganisationPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates a reorganisation plan", async () => {
    const plan = { libraryName: "Test Lib", operations: [] };
    runtimeMocks.requestArchiveLibraryReorganisationPlan.mockResolvedValue(plan);
    const setArchiveReorganisationPlan = vi.fn();

    const { generateArchiveLibraryReorganisationPlan } = await import("./controller");
    await generateArchiveLibraryReorganisationPlan({
      classificationManifestPath: "/manifest.json",
      setChatNotice: vi.fn(),
      setArchiveSourceScanBusy: vi.fn(),
      setArchiveReorganisationPlan,
      errorMessageOf,
    });

    expect(runtimeMocks.requestArchiveLibraryReorganisationPlan).toHaveBeenCalledWith("/manifest.json", "strategist.core");
    expect(setArchiveReorganisationPlan).toHaveBeenCalledWith(plan);
  });

  it("reports error on failure", async () => {
    runtimeMocks.requestArchiveLibraryReorganisationPlan.mockRejectedValue(new Error("plan error"));
    const setChatNotice = vi.fn();

    const { generateArchiveLibraryReorganisationPlan } = await import("./controller");
    await generateArchiveLibraryReorganisationPlan({
      classificationManifestPath: "/manifest.json",
      setChatNotice,
      setArchiveSourceScanBusy: vi.fn(),
      setArchiveReorganisationPlan: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Failed to generate Living Archive reorganisation plan.");
  });
});

describe("queueImportedLibraryForIngest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues an imported library and refreshes the queue", async () => {
    const result = { libraryName: "Test Lib", queued: 5, skippedUnsupported: 1, skippedExistingQueue: 0 };
    runtimeMocks.requestArchiveQueueImportedLibraryIngest.mockResolvedValue(result);
    const queue = [{ id: "req-1" }];
    const artifacts = [{ id: "art-1" }];
    runtimeMocks.requestArchiveReviewQueue.mockResolvedValue(queue);
    runtimeMocks.requestArchiveReviewArtifacts.mockResolvedValue(artifacts);
    const setArchiveQueue = vi.fn();
    const setArchiveReviewArtifacts = vi.fn();

    const { queueImportedLibraryForIngest } = await import("./controller");
    await queueImportedLibraryForIngest({
      manifestPath: "/manifest.json",
      setChatNotice: vi.fn(),
      setArchiveQueueBusy: vi.fn(),
      setArchiveQueue,
      setArchiveReviewArtifacts,
      errorMessageOf,
    });

    expect(runtimeMocks.requestArchiveQueueImportedLibraryIngest).toHaveBeenCalledWith(
      expect.objectContaining({ manifestPath: "/manifest.json" }),
    );
    expect(runtimeMocks.requestArchiveReviewQueue).toHaveBeenCalled();
    expect(setArchiveQueue).toHaveBeenCalledWith(queue);
  });

  it("reports error on failure", async () => {
    runtimeMocks.requestArchiveQueueImportedLibraryIngest.mockRejectedValue(new Error("queue error"));
    const setChatNotice = vi.fn();

    const { queueImportedLibraryForIngest } = await import("./controller");
    await queueImportedLibraryForIngest({
      manifestPath: "/manifest.json",
      setChatNotice,
      setArchiveQueueBusy: vi.fn(),
      setArchiveQueue: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Failed to queue imported library for AI Memory review.");
  });
});

describe("pickArchiveLibraryFolder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the selected folder path", async () => {
    runtimeMocks.requestArchiveLibraryFolderSelection.mockResolvedValue("/selected/folder");
    const { pickArchiveLibraryFolder } = await import("./controller");
    const result = await pickArchiveLibraryFolder({
      setChatNotice: vi.fn(),
      errorMessageOf,
    });

    expect(runtimeMocks.requestArchiveLibraryFolderSelection).toHaveBeenCalled();
    expect(result).toBe("/selected/folder");
  });

  it("returns null on error", async () => {
    runtimeMocks.requestArchiveLibraryFolderSelection.mockRejectedValue(new Error("picker error"));
    const setChatNotice = vi.fn();

    const { pickArchiveLibraryFolder } = await import("./controller");
    const result = await pickArchiveLibraryFolder({
      setChatNotice,
      errorMessageOf,
    });

    expect(result).toBeNull();
    expect(setChatNotice).toHaveBeenCalledWith("Failed to open folder picker.");
  });
});

describe("decideArchiveReviewArtifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records a review decision and refreshes artifacts", async () => {
    const decisionResult = { status: "approved", artifactFile: "/art.md" };
    memoryProviderMock.decideReview.mockResolvedValue(decisionResult);
    const artifacts = [{ id: "art-1" }];
    memoryProviderMock.reviewArtifacts.mockResolvedValue(artifacts);
    const setArchiveReviewArtifacts = vi.fn();
    const setArchiveReviewDecisionResult = vi.fn();

    const { decideArchiveReviewArtifact } = await import("./controller");
    await decideArchiveReviewArtifact({
      artifactFile: "/art.md",
      action: "approve",
      actorId: "strategist.core",
      setChatNotice: vi.fn(),
      setArchiveQueueBusy: vi.fn(),
      setArchiveReviewArtifacts,
      setArchiveReviewDecisionResult,
      errorMessageOf,
    });

    expect(memoryProviderMock.decideReview).toHaveBeenCalledWith(
      expect.objectContaining({ artifactFile: "/art.md", action: "approve" }),
    );
    expect(setArchiveReviewDecisionResult).toHaveBeenCalledWith(decisionResult);
  });

  it("reports error on failure", async () => {
    memoryProviderMock.decideReview.mockRejectedValue(new Error("decision error"));
    const setChatNotice = vi.fn();

    const { decideArchiveReviewArtifact } = await import("./controller");
    await decideArchiveReviewArtifact({
      artifactFile: "/art.md",
      action: "approve",
      actorId: "strategist.core",
      setChatNotice,
      setArchiveQueueBusy: vi.fn(),
      setArchiveReviewArtifacts: vi.fn(),
      setArchiveReviewDecisionResult: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Failed to record archive review decision.");
  });
});

describe("promoteArchiveReviewArtifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("promotes an artifact and refreshes the list", async () => {
    const promotionResult = { pagesWritten: [{ path: "/wiki/page.md" }], skippedPages: [] };
    memoryProviderMock.promoteReviewArtifact.mockResolvedValue(promotionResult);
    const artifacts = [{ id: "art-1" }];
    memoryProviderMock.reviewArtifacts.mockResolvedValue(artifacts);
    const setArchivePromotionResult = vi.fn();

    const { promoteArchiveReviewArtifact } = await import("./controller");
    await promoteArchiveReviewArtifact({
      artifactFile: "/art.md",
      actorId: "strategist.core",
      setChatNotice: vi.fn(),
      setArchiveQueueBusy: vi.fn(),
      setArchiveReviewArtifacts: vi.fn(),
      setArchivePromotionResult,
      errorMessageOf,
    });

    expect(memoryProviderMock.promoteReviewArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ artifactFile: "/art.md" }),
    );
    expect(setArchivePromotionResult).toHaveBeenCalledWith(promotionResult);
  });

  it("reports error on failure", async () => {
    memoryProviderMock.promoteReviewArtifact.mockRejectedValue(new Error("promotion error"));
    const setChatNotice = vi.fn();

    const { promoteArchiveReviewArtifact } = await import("./controller");
    await promoteArchiveReviewArtifact({
      artifactFile: "/art.md",
      actorId: "strategist.core",
      setChatNotice,
      setArchiveQueueBusy: vi.fn(),
      setArchiveReviewArtifacts: vi.fn(),
      setArchivePromotionResult: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Failed to promote archive review artifact.");
  });
});

describe("runArchiveLint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs lint on the memory provider", async () => {
    const result = { findings: [{ severity: "info", message: "ok" }] };
    memoryProviderMock.lint.mockResolvedValue(result);
    const setArchiveLintResult = vi.fn();

    const { runArchiveLint } = await import("./controller");
    await runArchiveLint({
      setChatNotice: vi.fn(),
      setArchiveQueueBusy: vi.fn(),
      setArchiveLintResult,
      errorMessageOf,
    });

    expect(memoryProviderMock.lint).toHaveBeenCalled();
    expect(setArchiveLintResult).toHaveBeenCalledWith(result);
  });

  it("falls back to runtime lint when provider has no lint method", async () => {
    const savedLint = memoryProviderMock.lint;
    delete (memoryProviderMock as Record<string, unknown>).lint;
    try {
      const result = { findings: [{ severity: "warn", message: "warning" }] };
      runtimeMocks.requestArchiveLint.mockResolvedValue(result);
      const setArchiveLintResult = vi.fn();

      const { runArchiveLint } = await import("./controller");
      await runArchiveLint({
        setChatNotice: vi.fn(),
        setArchiveQueueBusy: vi.fn(),
        setArchiveLintResult,
        errorMessageOf,
      });

      expect(runtimeMocks.requestArchiveLint).toHaveBeenCalled();
      expect(setArchiveLintResult).toHaveBeenCalledWith(result);
    } finally {
      memoryProviderMock.lint = savedLint;
    }
  });

  it("reports error on failure", async () => {
    memoryProviderMock.lint.mockRejectedValue(new Error("lint error"));
    const setChatNotice = vi.fn();

    const { runArchiveLint } = await import("./controller");
    await runArchiveLint({
      setChatNotice,
      setArchiveQueueBusy: vi.fn(),
      setArchiveLintResult: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Failed to run Living Archive lint.");
  });
});

describe("processArchiveQueuedRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providerCredentialReadyMock.mockReturnValue(true);
    resolveRoutineRouteMock.mockReturnValue(createRouteMock());
  });

  it("resolves route, processes the ingest request, and refreshes state", async () => {
    const state = buildDefaultState([]);
    const reports: ProviderDiagnosticReport[] = [];
    runtimeMocks.requestProviderDiagnostics.mockResolvedValue(reports);
    resolveArchiveIngestRouteMock.mockReturnValue(createRouteMock());
    const processResult = { status: "completed", pagesWritten: 2 };
    memoryProviderMock.processIngestRequest.mockResolvedValue(processResult);
    memoryProviderMock.reviewQueue.mockResolvedValue([]);
    memoryProviderMock.reviewArtifacts.mockResolvedValue([]);

    const snapshot = { state, bundled: [], sideloaded: [] };
    const setArchiveProcessResult = vi.fn();

    const { processArchiveQueuedRequest } = await import("./controller");
    await processArchiveQueuedRequest({
      snapshot,
      requestFile: "/requests/req-1.json",
      commitReadyState: vi.fn(),
      setProviderDiagnostics: vi.fn(),
      setChatNotice: vi.fn(),
      setArchiveQueueBusy: vi.fn(),
      setArchiveQueue: vi.fn(),
      setArchiveProcessResult,
      setArchiveReviewArtifacts: vi.fn(),
      errorMessageOf,
    });

    expect(runtimeMocks.requestProviderDiagnostics).toHaveBeenCalled();
    expect(resolveArchiveIngestRouteMock).toHaveBeenCalled();
    expect(memoryProviderMock.processIngestRequest).toHaveBeenCalled();
    expect(setArchiveProcessResult).toHaveBeenCalledWith(processResult);
  });

  it("reports failure when no viable route is found", async () => {
    const state = buildDefaultState([]);
    runtimeMocks.requestProviderDiagnostics.mockResolvedValue([]);
    resolveArchiveIngestRouteMock.mockReturnValue(
      createRouteMock({ provider: undefined, runtimeNode: undefined, model: undefined }),
    );
    const setChatNotice = vi.fn();

    const snapshot = { state, bundled: [], sideloaded: [] };

    const { processArchiveQueuedRequest } = await import("./controller");
    await processArchiveQueuedRequest({
      snapshot,
      requestFile: "/requests/req-1.json",
      commitReadyState: vi.fn(),
      setProviderDiagnostics: vi.fn(),
      setChatNotice,
      setArchiveQueueBusy: vi.fn(),
      setArchiveQueue: vi.fn(),
      setArchiveProcessResult: vi.fn(),
      setArchiveReviewArtifacts: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Failed to process archive ingest request.");
  });
});

describe("runArchiveMaintenanceCycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providerCredentialReadyMock.mockReturnValue(true);
    resolveRoutineRouteMock.mockReturnValue(createRouteMock());
  });

  it("runs a maintenance cycle through the memory provider", async () => {
    const state = buildDefaultState([]);
    runtimeMocks.requestProviderDiagnostics.mockResolvedValue([]);
    resolveArchiveIngestRouteMock.mockReturnValue(createRouteMock());
    const maintenanceResult = {
      processed: [{ status: "completed" }],
      promoted: [{ pagesWritten: [{ path: "/wiki/p.md" }] }],
    };
    memoryProviderMock.maintenanceCycle.mockResolvedValue(maintenanceResult);
    memoryProviderMock.reviewQueue.mockResolvedValue([]);
    memoryProviderMock.reviewArtifacts.mockResolvedValue([]);

    const snapshot = { state, bundled: [], sideloaded: [] };
    const setArchiveMaintenanceResult = vi.fn();

    const { runArchiveMaintenanceCycle } = await import("./controller");
    await runArchiveMaintenanceCycle({
      snapshot,
      commitReadyState: vi.fn(),
      setProviderDiagnostics: vi.fn(),
      setChatNotice: vi.fn(),
      setArchiveQueueBusy: vi.fn(),
      setArchiveQueue: vi.fn(),
      setArchiveReviewArtifacts: vi.fn(),
      setArchiveProcessResult: vi.fn(),
      setArchivePromotionResult: vi.fn(),
      setArchiveMaintenanceResult,
      errorMessageOf,
    });

    expect(memoryProviderMock.maintenanceCycle).toHaveBeenCalled();
    expect(setArchiveMaintenanceResult).toHaveBeenCalledWith(maintenanceResult);
  });

  it("throws when memory provider has no maintenanceCycle", async () => {
    const state = buildDefaultState([]);
    memoryProviderMock.maintenanceCycle.mockReturnValue(undefined);
    runtimeMocks.requestProviderDiagnostics.mockResolvedValue([]);

    const snapshot = { state, bundled: [], sideloaded: [] };
    const setChatNotice = vi.fn();

    const { runArchiveMaintenanceCycle } = await import("./controller");
    await runArchiveMaintenanceCycle({
      snapshot,
      commitReadyState: vi.fn(),
      setProviderDiagnostics: vi.fn(),
      setChatNotice,
      setArchiveQueueBusy: vi.fn(),
      setArchiveQueue: vi.fn(),
      setArchiveReviewArtifacts: vi.fn(),
      setArchiveProcessResult: vi.fn(),
      setArchivePromotionResult: vi.fn(),
      setArchiveMaintenanceResult: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Failed to run Living Archive maintenance.");
  });
});

describe("runArchiveSemanticLint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providerCredentialReadyMock.mockReturnValue(true);
    resolveRoutineRouteMock.mockReturnValue(createRouteMock());
  });

  it("runs semantic lint through the memory provider", async () => {
    const state = buildDefaultState([]);
    runtimeMocks.requestProviderDiagnostics.mockResolvedValue([]);
    resolveArchiveIngestRouteMock.mockReturnValue(createRouteMock());
    const result = { findings: [{ message: "inconsistency" }], candidatesReviewed: 5 };
    memoryProviderMock.semanticLint.mockResolvedValue(result);
    const setArchiveSemanticLintResult = vi.fn();

    const snapshot = { state, bundled: [], sideloaded: [] };

    const { runArchiveSemanticLint } = await import("./controller");
    await runArchiveSemanticLint({
      snapshot,
      commitReadyState: vi.fn(),
      setProviderDiagnostics: vi.fn(),
      setChatNotice: vi.fn(),
      setArchiveQueueBusy: vi.fn(),
      setArchiveSemanticLintResult,
      errorMessageOf,
    });

    expect(memoryProviderMock.semanticLint).toHaveBeenCalled();
    expect(setArchiveSemanticLintResult).toHaveBeenCalledWith(result);
  });

  it("falls back to runtime semantic lint when provider has no method", async () => {
    const saved = memoryProviderMock.semanticLint;
    delete (memoryProviderMock as Record<string, unknown>).semanticLint;
    try {
      const state = buildDefaultState([]);
      runtimeMocks.requestProviderDiagnostics.mockResolvedValue([]);
      resolveArchiveIngestRouteMock.mockReturnValue(createRouteMock());
      const result = { findings: [{ message: "ok" }], candidatesReviewed: 0 };
      runtimeMocks.requestArchiveSemanticLint.mockResolvedValue(result);
      const setArchiveSemanticLintResult = vi.fn();

      const snapshot = { state, bundled: [], sideloaded: [] };

      const { runArchiveSemanticLint } = await import("./controller");
      await runArchiveSemanticLint({
        snapshot,
        commitReadyState: vi.fn(),
        setProviderDiagnostics: vi.fn(),
        setChatNotice: vi.fn(),
        setArchiveQueueBusy: vi.fn(),
        setArchiveSemanticLintResult,
        errorMessageOf,
      });

      expect(runtimeMocks.requestArchiveSemanticLint).toHaveBeenCalled();
      expect(setArchiveSemanticLintResult).toHaveBeenCalledWith(result);
    } finally {
      memoryProviderMock.semanticLint = saved;
    }
  });

  it("reports error on failure", async () => {
    const state = buildDefaultState([]);
    runtimeMocks.requestProviderDiagnostics.mockResolvedValue([]);
    resolveArchiveIngestRouteMock.mockReturnValue(createRouteMock());
    memoryProviderMock.semanticLint.mockRejectedValue(new Error("lint error"));
    const setChatNotice = vi.fn();

    const snapshot = { state, bundled: [], sideloaded: [] };

    const { runArchiveSemanticLint } = await import("./controller");
    await runArchiveSemanticLint({
      snapshot,
      commitReadyState: vi.fn(),
      setProviderDiagnostics: vi.fn(),
      setChatNotice,
      setArchiveQueueBusy: vi.fn(),
      setArchiveSemanticLintResult: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Failed to run Living Archive semantic lint.");
  });
});

describe("runArchiveAiMemoryBuildJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providerCredentialReadyMock.mockReturnValue(true);
    resolveRoutineRouteMock.mockReturnValue(createRouteMock());
  });

  it("runs an AI memory build job", async () => {
    const state = buildDefaultState([]);
    runtimeMocks.requestProviderDiagnostics.mockResolvedValue([]);
    resolveArchiveIngestRouteMock.mockReturnValue(createRouteMock());
    const buildResult = {
      status: "completed",
      recordsSeen: 10,
      queuedThisRun: 3,
      processedThisRun: 3,
      promotedThisRun: 1,
      queueRemaining: 0,
      maintenance: { processed: [{ status: "completed" }], promoted: [{ pagesWritten: [] }] },
    };
    runtimeMocks.requestArchiveAiMemoryBuildJob.mockResolvedValue(buildResult);
    runtimeMocks.requestArchiveReviewQueue.mockResolvedValue([]);
    runtimeMocks.requestArchiveReviewArtifacts.mockResolvedValue([]);
    runtimeMocks.requestArchiveAiMemoryBuildJobs.mockResolvedValue([]);

    const snapshot = { state, bundled: [], sideloaded: [] };
    const setArchiveAiMemoryBuildResult = vi.fn();

    const { runArchiveAiMemoryBuildJob } = await import("./controller");
    await runArchiveAiMemoryBuildJob({
      snapshot,
      manifestPath: "/manifest.json",
      commitReadyState: vi.fn(),
      setProviderDiagnostics: vi.fn(),
      setChatNotice: vi.fn(),
      setArchiveQueueBusy: vi.fn(),
      setArchiveQueue: vi.fn(),
      setArchiveReviewArtifacts: vi.fn(),
      setArchiveProcessResult: vi.fn(),
      setArchivePromotionResult: vi.fn(),
      setArchiveMaintenanceResult: vi.fn(),
      setArchiveAiMemoryBuildResult,
      setArchiveAiMemoryBuildJobs: vi.fn(),
      errorMessageOf,
    });

    expect(runtimeMocks.requestArchiveAiMemoryBuildJob).toHaveBeenCalled();
    expect(setArchiveAiMemoryBuildResult).toHaveBeenCalledWith(buildResult);
  });

  it("reports error on failure", async () => {
    const state = buildDefaultState([]);
    runtimeMocks.requestProviderDiagnostics.mockResolvedValue([]);
    resolveArchiveIngestRouteMock.mockReturnValue(createRouteMock());
    runtimeMocks.requestArchiveAiMemoryBuildJob.mockRejectedValue(new Error("build error"));
    const setChatNotice = vi.fn();

    const snapshot = { state, bundled: [], sideloaded: [] };

    const { runArchiveAiMemoryBuildJob } = await import("./controller");
    await runArchiveAiMemoryBuildJob({
      snapshot,
      manifestPath: "/manifest.json",
      commitReadyState: vi.fn(),
      setProviderDiagnostics: vi.fn(),
      setChatNotice,
      setArchiveQueueBusy: vi.fn(),
      setArchiveQueue: vi.fn(),
      setArchiveReviewArtifacts: vi.fn(),
      setArchiveProcessResult: vi.fn(),
      setArchivePromotionResult: vi.fn(),
      setArchiveMaintenanceResult: vi.fn(),
      setArchiveAiMemoryBuildResult: vi.fn(),
      setArchiveAiMemoryBuildJobs: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Failed to run the AI Memory build job.");
  });
});

describe("runArchiveBackgroundCycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providerCredentialReadyMock.mockReturnValue(true);
    resolveRoutineRouteMock.mockReturnValue(createRouteMock());
  });

  it("runs a background cycle through the memory provider", async () => {
    const state = buildDefaultState([]);
    runtimeMocks.requestProviderDiagnostics.mockResolvedValue([]);
    resolveArchiveIngestRouteMock.mockReturnValue(createRouteMock());
    const bgResult = {
      scan: { newFiles: 2, changedFiles: 1, filesSeen: 10 },
      queuedRequestFiles: ["/req-1.json"],
      maintenance: { processed: [{ status: "completed" }], promoted: [{ pagesWritten: [] }] },
    };
    memoryProviderMock.backgroundCycle.mockResolvedValue(bgResult);
    memoryProviderMock.reviewQueue.mockResolvedValue([]);
    memoryProviderMock.reviewArtifacts.mockResolvedValue([]);

    const snapshot = { state, bundled: [], sideloaded: [] };

    const { runArchiveBackgroundCycle } = await import("./controller");
    await runArchiveBackgroundCycle({
      snapshot,
      commitReadyState: vi.fn(),
      setProviderDiagnostics: vi.fn(),
      setChatNotice: vi.fn(),
      setArchiveQueueBusy: vi.fn(),
      setArchiveQueue: vi.fn(),
      setArchiveReviewArtifacts: vi.fn(),
      setArchiveProcessResult: vi.fn(),
      setArchivePromotionResult: vi.fn(),
      setArchiveMaintenanceResult: vi.fn(),
      errorMessageOf,
    });

    expect(memoryProviderMock.backgroundCycle).toHaveBeenCalled();
  });

  it("falls back to runtime background cycle when provider has no method", async () => {
    const saved = memoryProviderMock.backgroundCycle;
    delete (memoryProviderMock as Record<string, unknown>).backgroundCycle;
    try {
      const state = buildDefaultState([]);
      runtimeMocks.requestProviderDiagnostics.mockResolvedValue([]);
      resolveArchiveIngestRouteMock.mockReturnValue(createRouteMock());
      const bgResult = {
        scan: { newFiles: 1, changedFiles: 0, filesSeen: 5 },
        queuedRequestFiles: [],
        maintenance: { processed: [], promoted: [] },
      };
      runtimeMocks.requestArchiveBackgroundCycle.mockResolvedValue(bgResult);
      memoryProviderMock.reviewQueue.mockResolvedValue([]);
      memoryProviderMock.reviewArtifacts.mockResolvedValue([]);

      const snapshot = { state, bundled: [], sideloaded: [] };

      const { runArchiveBackgroundCycle } = await import("./controller");
      await runArchiveBackgroundCycle({
        snapshot,
        commitReadyState: vi.fn(),
        setProviderDiagnostics: vi.fn(),
        setChatNotice: vi.fn(),
        setArchiveQueueBusy: vi.fn(),
        setArchiveQueue: vi.fn(),
        setArchiveReviewArtifacts: vi.fn(),
        setArchiveProcessResult: vi.fn(),
        setArchivePromotionResult: vi.fn(),
        setArchiveMaintenanceResult: vi.fn(),
        errorMessageOf,
      });

      expect(runtimeMocks.requestArchiveBackgroundCycle).toHaveBeenCalled();
    } finally {
      memoryProviderMock.backgroundCycle = saved;
    }
  });

  it("reports error on failure", async () => {
    const state = buildDefaultState([]);
    runtimeMocks.requestProviderDiagnostics.mockResolvedValue([]);
    resolveArchiveIngestRouteMock.mockReturnValue(createRouteMock());
    memoryProviderMock.backgroundCycle.mockRejectedValue(new Error("bg error"));
    const setChatNotice = vi.fn();

    const snapshot = { state, bundled: [], sideloaded: [] };

    const { runArchiveBackgroundCycle } = await import("./controller");
    await runArchiveBackgroundCycle({
      snapshot,
      commitReadyState: vi.fn(),
      setProviderDiagnostics: vi.fn(),
      setChatNotice,
      setArchiveQueueBusy: vi.fn(),
      setArchiveQueue: vi.fn(),
      setArchiveReviewArtifacts: vi.fn(),
      setArchiveProcessResult: vi.fn(),
      setArchivePromotionResult: vi.fn(),
      setArchiveMaintenanceResult: vi.fn(),
      errorMessageOf,
    });

    expect(setChatNotice).toHaveBeenCalledWith("Failed to run Living Archive background cycle.");
  });
});
