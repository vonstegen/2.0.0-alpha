// Intent citation: docs/architecture/ADR-054-principal-delegation-chain-task-scoped-authority.md
// Intent citation: docs/architecture/resonantos-browser-architecture/08-capability-inheritance-task-scope.md

import type { Capability, CapabilityGrant, CapabilityScope, RevocationBehavior } from "../../core/contracts";

// Open union: known Capability values autocomplete; future/native actions remain
// expressible as strings (doc 08 structured scopes).
export type AuthorityAction = Capability | (string & {});

export type ResourceOperation = "read" | "write" | "execute" | "send" | "sign";

export type RevocationBehaviorKind = "cancel" | "finish-atomic" | "quarantine";

export interface ScopeLimits {
  count?: number;
  costCeiling?: number;
}

export interface ScopedCapability {
  action: AuthorityAction;
  resourceSelectors: string[];
  operations: ResourceOperation[];
  taskId: string;
  delegationId: string;
  issuerPrincipalId: string;
  subjectPrincipalId: string;
  notBefore: string;
  expiresAt: string;
  idleTimeoutMs?: number;
  limits?: ScopeLimits;
  networkAllowlist?: string[];
  dataClassification?: string;
  approvalCondition?: string;
  revocationBehavior: RevocationBehaviorKind;
}

export type GrantStatus =
  | "requested"
  | "approved"
  | "active"
  | "completed"
  | "expired"
  | "revoked"
  | "degraded";

export interface AuthorityGrant {
  grantId: string; // host-resolved opaque handle, never a bearer token
  scope: ScopedCapability;
  status: GrantStatus;
}

export interface AuthorityRequest {
  requestId: string;
  taskId: string;
  subjectPrincipalId: string;
  requested: ScopedCapability[];
  purpose: string;
  riskClass: "low" | "medium" | "high";
  expectedDuration: string;
  alternatives?: string[];
}

export interface ApprovalDecision {
  requestId: string;
  decision: "approve" | "deny" | "escalate";
  addedDelta?: ScopedCapability; // escalation adds only the approved delta
  decidedBy: "user" | "policy";
  decidedAt: string;
}

/** Set-subset over an array of values, preserving order independence. */
function subsetOf<T>(candidate: readonly T[], parent: readonly T[]): boolean {
  return candidate.every((v) => parent.includes(v));
}

/**
 * True when `candidate` cannot widen any dimension of `parent` (doc 08).
 * A child request is a subset only if it matches action, operations,
 * resource selectors, time window, limits, and network allowlist of the parent.
 */
export function isScopeSubset(candidate: ScopedCapability, parent: ScopedCapability): boolean {
  if (candidate.action !== parent.action) return false;
  if (!subsetOf(candidate.operations, parent.operations)) return false;
  if (!subsetOf(candidate.resourceSelectors, parent.resourceSelectors)) return false;
  if (candidate.notBefore < parent.notBefore) return false;
  if (candidate.expiresAt > parent.expiresAt) return false;
  if (candidate.limits?.count !== undefined) {
    if (parent.limits?.count === undefined || candidate.limits.count > parent.limits.count) return false;
  }
  if (candidate.limits?.costCeiling !== undefined) {
    if (
      parent.limits?.costCeiling === undefined ||
      candidate.limits.costCeiling > parent.limits.costCeiling
    ) {
      return false;
    }
  }
  if (parent.networkAllowlist !== undefined) {
    if (candidate.networkAllowlist === undefined) return false;
    if (!subsetOf(candidate.networkAllowlist, parent.networkAllowlist)) return false;
  }
  return true;
}

const REVOCATION_LEGACY: Record<RevocationBehaviorKind, RevocationBehavior> = {
  cancel: "hard-stop",
  "finish-atomic": "degrade",
  quarantine: "hide-surface",
};

/**
 * Compatibility projection from the richer AuthorityGrant to the legacy
 * CapabilityGrant UI view (doc 12). Lossy: structured selectors/limits are not
 * representable in the legacy `scope` field, so it defaults to "shared".
 */
export function toLegacyGrant(grant: AuthorityGrant): CapabilityGrant {
  const active = grant.status === "active" || grant.status === "approved";
  const scope: CapabilityScope = "shared";
  return {
    capability: grant.scope.action as Capability,
    granted: active,
    scope,
    revocationBehavior: REVOCATION_LEGACY[grant.scope.revocationBehavior],
  };
}
