// Intent citation: docs/architecture/ADR-054-principal-delegation-chain-task-scoped-authority.md
// Intent citation: docs/architecture/resonantos-browser-architecture/09-memory-context-trusted-continuity.md
// Intent citation: docs/architecture/resonantos-browser-architecture/15-identity-continuity-vault.md
//
// CP-7 trusted continuity. The Identity & Continuity Vault is a Core service
// (doc 15): it retains durable identity + trusted continuity in separate trust
// domains, and the Continuity Gatekeeper mediates every read by the
// effective-context intersection (information least privilege). The raw store
// does not belong to Augmentor; Augmentor uses it, Core owns it.

export interface ContextFact {
  value: unknown;
  sourceRefs: string[];
  /** Trust domain the fact belongs to. Absent → conservatively denied. */
  domain?: TrustDomain;
  /** ISO timestamp the fact was recorded. Absent → retention cannot expire it. */
  recordedAt?: string;
}

export interface ContextEnvelope {
  facts: ContextFact[];
  provenance: string[];
  sensitivity: string;
  freshness: string;
  allowedPurpose: string;
  retentionPolicy: string;
  redactions: string[];
}

export interface ContinuitySnapshotRef {
  snapshotId: string;
  takenAt: string;
  contentType: string;
  integrityHash: string;
}

export type TrustDomain =
  | "user-identity"
  | "augmentor-identity"
  | "trusted-continuity"
  | "augmentor-core-skills"
  | "user-defined-skills"
  | "delegation-history"
  | "recovery-checkpoints";

export interface ContinuityGatekeeperDecision {
  effectiveContext: ContextFact[]; // requested ∩ permissions ∩ scope ∩ policy ∩ trust
  redactions: string[];
  deniedRefs: string[];
}

export interface SkillVersionRef {
  skillId: string;
  version: string;
  tier: "core" | "optional";
}

// ---- Continuity Gatekeeper (doc 15 §Continuity gatekeeper) ----

export interface ContinuityReadPolicy {
  actorPermissions: TrustDomain[]; // domains the actor may read
  taskScope: TrustDomain[];        // domains the task grants
  userPolicy: TrustDomain[];       // domains the user allows for this actor/task
  trustLevel: TrustDomain[];       // domains the actor's trust tier grants
}

function intersection(...sets: TrustDomain[][]): TrustDomain[] {
  if (sets.length === 0) return [];
  const [first, ...rest] = sets;
  return first.filter((domain) => rest.every((set) => set.includes(domain)));
}

// Mediate a context read: the effective context is the intersection of the
// actor's permissions, the task scope, user policy, and trust level. A fact
// outside the intersection (or with no domain label) is denied; a fact whose
// value is secret-shaped is redacted and never reaches the actor.
export function mediateContextRead(
  facts: readonly ContextFact[],
  policy: ContinuityReadPolicy,
  opts: { secretPattern?: RegExp } = {},
): ContinuityGatekeeperDecision {
  const allowed = intersection(
    policy.actorPermissions,
    policy.taskScope,
    policy.userPolicy,
    policy.trustLevel,
  );
  const effectiveContext: ContextFact[] = [];
  const deniedRefs: string[] = [];
  const redactions: string[] = [];

  for (const fact of facts) {
    if (fact.domain == null || !allowed.includes(fact.domain)) {
      deniedRefs.push(...fact.sourceRefs);
      continue;
    }
    if (opts.secretPattern && opts.secretPattern.test(JSON.stringify(fact.value))) {
      redactions.push(...fact.sourceRefs);
      continue;
    }
    effectiveContext.push(fact);
  }
  return { effectiveContext, redactions, deniedRefs };
}

// ---- Continuity snapshot + reconstruction (doc 15 §Ground-0 reload path) ----

export interface ContinuitySnapshot {
  snapshotId: string;
  takenAt: string;
  integrityHash: string;
  domains: Partial<Record<TrustDomain, unknown>>;
}

// Pick the most recent last-known-good snapshot whose integrity verifies.
export function reconstructLastKnownGood(
  snapshots: readonly ContinuitySnapshot[],
  verifyIntegrity: (integrityHash: string) => boolean,
): ContinuitySnapshot | null {
  const good = snapshots
    .filter((snapshot) => verifyIntegrity(snapshot.integrityHash))
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  return good[0] ?? null;
}

export interface DelegationHistoryEntry {
  delegationId: string;
  taskId: string;
  harnessId: string;
  issuerPrincipalId: string;
  summary: string;
  completedAt: string;
}

export interface ReconstructedTask {
  taskId: string;
  summary: string;
  lastHarness: string | null;
}

// Reconstruct what a delegated task was + which harness last worked it, from
// trusted delegation history (provider-switch / restart reconstruction). Never
// returns raw credentials or capability material (doc 09: grants are audit
// summaries, not reusable tokens).
export function reconstructTask(
  history: readonly DelegationHistoryEntry[],
  taskId: string,
): ReconstructedTask | null {
  const entries = history
    .filter((entry) => entry.taskId === taskId)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  if (entries.length === 0) return null;
  const last = entries[0];
  return { taskId, summary: last.summary, lastHarness: last.harnessId };
}

// Ground-0 reload: the minimal Augmentor kernel is built from Core-owned vault
// state and the approved CORE skill tier only — optional skills are quarantined
// (doc 15 §Ground-0 reload path).
export function reloadGroundZeroKernel(
  snapshot: ContinuitySnapshot | null,
  skills: readonly SkillVersionRef[],
): { userIdentity: unknown; augmentorIdentity: unknown; continuityCheckpoint: unknown; coreSkills: SkillVersionRef[] } | null {
  if (!snapshot) return null;
  return {
    userIdentity: snapshot.domains["user-identity"],
    augmentorIdentity: snapshot.domains["augmentor-identity"],
    continuityCheckpoint: snapshot.domains["trusted-continuity"],
    coreSkills: skills.filter((skill) => skill.tier === "core"),
  };
}

// ---- Continuity export / retention / deletion (doc 09 §Portability and deletion) ----

export interface ContinuityExport {
  envelope: ContextEnvelope;
  exportedRefs: string[];
  deniedRefs: string[];
}

// Export continuity into a portable envelope: the effective-context intersection
// (per the gatekeeper) with secret-shaped values redacted. Secrets and capability
// tokens are references or vault state, never continuity payloads (doc 09) — the
// exported envelope carries only non-secret facts, and the redacted refs are
// recorded for audit integrity.
export function exportContinuity(
  facts: readonly ContextFact[],
  policy: ContinuityReadPolicy,
  opts: {
    secretPattern?: RegExp;
    provenance?: string[];
    sensitivity?: string;
    freshness?: string;
    allowedPurpose?: string;
    retentionPolicy?: string;
  } = {},
): ContinuityExport {
  const decision = mediateContextRead(facts, policy, { secretPattern: opts.secretPattern });
  const exportedRefs: string[] = [];
  for (const fact of decision.effectiveContext) exportedRefs.push(...fact.sourceRefs);
  return {
    envelope: {
      facts: decision.effectiveContext,
      provenance: opts.provenance ?? [],
      sensitivity: opts.sensitivity ?? "internal",
      freshness: opts.freshness ?? "fresh",
      allowedPurpose: opts.allowedPurpose ?? "context-exchange",
      retentionPolicy: opts.retentionPolicy ?? "default",
      redactions: decision.redactions,
    },
    exportedRefs,
    deniedRefs: decision.deniedRefs,
  };
}

export interface ContinuityRetentionPolicy {
  /** Drop facts whose recordedAt is older than `now - maxAgeMs`. */
  maxAgeMs: number;
  /** Evaluation point (ISO). Test seam; defaults to the current time. */
  now?: string;
}

export interface RetentionDecision {
  retained: ContextFact[];
  expired: ContextFact[];
}

// Apply a retention window: facts older than maxAgeMs are expired. A fact with no
// (or an unparseable) recordedAt cannot be scheduled for expiry, so it is
// conservatively retained.
export function applyRetentionPolicy(
  facts: readonly ContextFact[],
  policy: ContinuityRetentionPolicy,
): RetentionDecision {
  const nowMs = policy.now == null ? Date.now() : Date.parse(policy.now);
  const cutoff = nowMs - policy.maxAgeMs;
  const retained: ContextFact[] = [];
  const expired: ContextFact[] = [];
  for (const fact of facts) {
    const recordedMs = fact.recordedAt == null ? Number.NaN : Date.parse(fact.recordedAt);
    if (Number.isNaN(recordedMs) || recordedMs >= cutoff) {
      retained.push(fact);
    } else {
      expired.push(fact);
    }
  }
  return { retained, expired };
}

export interface DeletionAuditEntry {
  deletedRefs: string[];
  deletedAt: string;
  reason: string;
}

export interface DeletionDecision {
  remaining: ContextFact[];
  audit: DeletionAuditEntry;
}

// Delete facts by source reference. A fact is removed when any of its sourceRefs
// is targeted; the audit entry records the removed refs so deletion preserves
// audit integrity rather than silently vanishing (doc 09).
export function deleteFacts(
  facts: readonly ContextFact[],
  refs: readonly string[],
  opts: { reason?: string; now?: string } = {},
): DeletionDecision {
  const target = new Set(refs);
  const remaining: ContextFact[] = [];
  const deletedRefs: string[] = [];
  for (const fact of facts) {
    if (fact.sourceRefs.some((ref) => target.has(ref))) {
      deletedRefs.push(...fact.sourceRefs);
    } else {
      remaining.push(fact);
    }
  }
  return {
    remaining,
    audit: {
      deletedRefs,
      deletedAt: opts.now ?? new Date().toISOString(),
      reason: opts.reason ?? "user-requested",
    },
  };
}
