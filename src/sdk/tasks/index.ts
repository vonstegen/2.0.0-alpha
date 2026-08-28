// Intent citation: docs/architecture/ADR-054-principal-delegation-chain-task-scoped-authority.md
// Intent citation: docs/architecture/resonantos-browser-architecture/08-capability-inheritance-task-scope.md
// Intent citation: docs/architecture/resonantos-browser-architecture/CONTRACTS.md

import type { ScopedCapability } from "../authority";
import type { DelegationChainRef } from "../identity";
import type { ContextEnvelope } from "../continuity";
import type { ResourceBudget } from "../resources";

export type TaskStatus =
  | "requested"
  | "approved"
  | "active"
  | "completed"
  | "expired"
  | "revoked"
  | "degraded";

export interface TaskPacket {
  taskId: string;
  issuerPrincipalId: string;
  executorPrincipalId: string;
  delegationChainRef: DelegationChainRef;
  intent: string;
  successCriteria: string[];
  nonGoals: string[];
  outputContract: unknown;
  contextRefs: ContextEnvelope; // bounded, never raw credentials/full memory
  requestedCapabilities: ScopedCapability[];
  resourceBudget: ResourceBudget;
  workspaceRoots: string[];
  approvalPolicy: string;
  deadline: string;
  expiresAt: string;
  cancellationChannel: string;
  auditCorrelationId: string;
}

export interface ArtifactRef {
  artifactId: string;
  root: string;
  sensitivity: string;
  provenance: unknown;
}

export interface HarnessResult {
  status: TaskStatus;
  summary: string;
  artifacts: ArtifactRef[];
  evidence: unknown[]; // untrusted until verified
  actionsTaken: string[];
  verification: unknown;
  residualRisks: string[];
  costUsage: unknown;
  approvalRequests: unknown[];
  childActorAuditRefs: string[];
}

// Referenced by HarnessProviderAdapter.events() (CONTRACTS) but not field-
// specified there; defined here as the versioned event contract.
export type TaskEventKind =
  | "requested"
  | "approved"
  | "active"
  | "progress"
  | "completed"
  | "expired"
  | "revoked"
  | "degraded";

export interface TaskEvent {
  eventId: string;
  taskId: string;
  at: string;
  kind: TaskEventKind;
  actorPrincipalId: string;
  detail?: string;
}
