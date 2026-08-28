// Intent citation: docs/architecture/ADR-040-provider-fabric-boundary-external-agent-runtimes.md#7-failure-modes
//
// Public surface for `@resonantos/addon-sdk-testing`. All ten F-mode
// runners, the `runAddOnFailureMode` aggregator, the mock host, and
// the synthetic manifest fixture are exported from this file.

export {
  runAddOnFailureMode,
  mockHost,
  type RunOptions,
  type FailureModeRunner,
  type FailureModeRunResult,
} from "./failure-modes/index.ts";

export type { MockHost } from "./mock-host.ts";

export type { FailureModeReport, FailureModeId, FailureModeExpectedCode, FailureModeAuditEntry } from "./outcome.ts";

export type {
  BridgeDeny,
  BridgeResult,
  ToolCallRequest,
  ModelRequest,
  WorkspaceAccessRequest,
  ArtifactReturnRequest,
  ApproveRequest,
  ApprovalDecision,
  MockHostOptions,
} from "./mock-host.ts";

export { createAuditCapture, type AuditCapture } from "./audit-capture.ts";
export { createRoutingStore, type RoutingDecision, type RoutingStore } from "./routing-store.ts";

export {
  externalAgentRuntimeFixture,
  withGranted,
  withScope,
  withTool,
  declaredToolNames,
  FIXTURE_CALLER_ID,
} from "./manifest-fixtures.ts";

export {
  diffAddOnManifest,
  type AddOnPermissionDelta,
  type AddOnPermissionDeltaEntry,
  type AddOnPermissionDeltaKind,
} from "./permission-diff.ts";

export {
  canTransitionBetweenTiers,
  getTrustTierFromManifest,
  trustNoticeForManifest,
  trustNoticeForTier,
  type TrustTier,
  type TrustTierNotice,
  type TrustTransitionDecision,
} from "./trust-tier.ts";
export {
  buildWorkerKey,
  shouldRebindWorker,
  validateRuntimeIsolationForManifest,
  type IsolationCheckError,
  type IsolationCheckResult,
  type WorkerKey,
} from "./isolation.ts";
