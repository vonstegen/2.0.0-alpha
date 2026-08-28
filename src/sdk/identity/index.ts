// Intent citation: docs/architecture/ADR-054-principal-delegation-chain-task-scoped-authority.md
// Intent citation: docs/architecture/resonantos-browser-architecture/15-identity-continuity-vault.md
// Intent citation: docs/architecture/resonantos-browser-architecture/CONTRACTS.md

import type { ScopedCapability } from "../authority";

// ADR-054 §"Principal types" (authoritative). `orchestrator` is the general
// kind; Augmentor is its permanent occupant (ADR-053).
export type PrincipalKind =
  | "user"
  | "core-service"
  | "orchestrator"
  | "harness"
  | "child-agent"
  | "tool"
  | "connector"
  | "script"
  | "hook"
  | "platform-service";

export interface Principal {
  id: string;
  kind: PrincipalKind;
  displayName?: string;
}

export type DelegationStatus =
  | "pending"
  | "active"
  | "revoked"
  | "expired"
  | "completed";

export interface DelegationRecord {
  id: string;
  taskId: string;
  parentDelegationId?: string;
  issuerPrincipalId: string;
  subjectPrincipalId: string;
  requestedCapabilities: ScopedCapability[];
  effectiveGrantId: string;
  purpose: string;
  issuedAt: string;
  notBefore: string;
  expiresAt: string;
  status: DelegationStatus;
  auditCorrelationId: string;
}

export type DelegationChainRef = { delegationId: string; parent?: DelegationChainRef };
