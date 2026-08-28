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
