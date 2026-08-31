// Intent citation: docs/architecture/resonantos-browser-architecture/10-ground-0-recovery.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
// Intent citation: docs/architecture/resonantos-browser-architecture/CONTRACTS.md
//
// CP-8 Ground-0 state machine (Core-owned, doc 10). Ground-0 is a Core-controlled
// system state, not Linux safe mode: entry revokes every temporal grant and
// quarantines optional executable memory; exit re-enables in dependency order
// with fresh grants — never reviving pre-recovery authority. `src/modules/recovery`
// becomes a *consumer* of this state machine, not its definition.

// Matches CONTRACTS.md §Continuity, resources, recovery.
export type GroundZeroState = "normal" | "entering" | "ground-zero" | "re-enabling" | "exited";

export type QuarantineKind =
  | "harness"
  | "extension"
  | "hook"
  | "script"
  | "channel"
  | "background-job"
  | "archive-ingest";

export interface QuarantineRecord {
  item: string;
  kind: QuarantineKind;
  quarantinedAt: string;
  disposition?: "accepted" | "replaced" | "left-disabled";
}

export interface GroundZeroTransition {
  transitionId: string;
  at: string;
  from: GroundZeroState;
  to: GroundZeroState;
  trigger: string;
  effects: string[];
}

export interface GroundZeroSnapshot {
  state: GroundZeroState;
  activeGrantIds: string[];
  optionalItems: Array<{ id: string; kind: QuarantineKind }>;
  quarantine: QuarantineRecord[];
  audit: GroundZeroTransition[];
}

// Enter Ground-0: revoke every active temporal grant and quarantine every
// optional executable item. No pre-recovery executable authority survives the
// transition. Pure — returns a new snapshot.
export function enterGroundZero(
  snapshot: GroundZeroSnapshot,
  args: { trigger: string; at: string },
): GroundZeroSnapshot {
  if (snapshot.state !== "normal") {
    throw new Error(`cannot enter Ground-0 from state "${snapshot.state}"`);
  }
  const quarantine: QuarantineRecord[] = snapshot.optionalItems.map((item) => ({
    item: item.id,
    kind: item.kind,
    quarantinedAt: args.at,
  }));
  const transition: GroundZeroTransition = {
    transitionId: `normal->ground-zero@${args.at}`,
    at: args.at,
    from: "normal",
    to: "ground-zero",
    trigger: args.trigger,
    effects: [
      `revoked ${snapshot.activeGrantIds.length} active grants`,
      `quarantined ${quarantine.length} optional items`,
    ],
  };
  return {
    state: "ground-zero",
    activeGrantIds: [],
    optionalItems: [],
    quarantine,
    audit: [...snapshot.audit, transition],
  };
}

// Exit Ground-0: re-enable items in dependency order, health-checking each. Only
// healthy items resume with a FRESH grant (old grants are never revived);
// unhealthy or omitted items are left disabled with an explicit disposition.
export function reEnableFromGroundZero(
  snapshot: GroundZeroSnapshot,
  args: { order: string[]; healthCheck: (id: string) => boolean; at: string },
): GroundZeroSnapshot {
  if (snapshot.state !== "ground-zero") {
    throw new Error(`cannot re-enable from state "${snapshot.state}"`);
  }
  const ordered = new Set(args.order);
  const quarantine: QuarantineRecord[] = snapshot.quarantine.map((record) => {
    if (!ordered.has(record.item)) return record;
    return args.healthCheck(record.item)
      ? { ...record, disposition: "accepted" as const }
      : { ...record, disposition: "left-disabled" as const };
  });
  // Fresh grants only for resumed (healthy) items, in dependency order.
  const activeGrantIds = args.order
    .filter((id) => args.healthCheck(id))
    .map((id) => `fresh-grant:${id}`);
  const transition: GroundZeroTransition = {
    transitionId: `ground-zero->normal@${args.at}`,
    at: args.at,
    from: "ground-zero",
    to: "normal",
    trigger: "re-enable",
    effects: [`re-enabled ${activeGrantIds.length} items with fresh grants`],
  };
  return {
    state: "normal",
    activeGrantIds,
    optionalItems: [],
    quarantine,
    audit: [...snapshot.audit, transition],
  };
}

// ---- Known-good manifest/config set (doc 10 §Entry, §Recovery sequence) ----
// The frozen Core-owned baseline Ground-0 restores to. It is integrity-checked
// before reload: a tampered set must fail closed, never silently reload.

export interface KnownGoodSet {
  version: string;
  frozenAt: string;
  manifestIds: string[];
  configDigest: string;
}

// Canonical serialization for the digest. Key order and manifest-id ordering
// are fixed so the same logical set always hashes identically.
export function serializeKnownGoodSet(set: Pick<KnownGoodSet, "version" | "manifestIds">): string {
  return JSON.stringify({ version: set.version, manifestIds: [...set.manifestIds].sort() });
}

// Verify a known-good set against a caller-supplied digest function (kept
// injectable so the SDK stays free of `node:crypto`).
export function verifyKnownGoodSet(
  set: KnownGoodSet,
  computeDigest: (serialized: string) => string,
): boolean {
  return computeDigest(serializeKnownGoodSet(set)) === set.configDigest;
}

// ---- Engineer recovery ladder (ADR-010) beneath Ground-0 (ADR-053 amendment) ----
// The recovery ladder runs only while in Ground-0. Ground-0 drives it: entry
// activates the ladder and resets it to phase 1; exit deactivates it and marks
// the report complete (handoff back to the Strategist). `lastNormalThreadId` is
// preserved — the caller captures it before entry.

export type RecoveryChecklistStatus = "pending" | "active" | "complete";

export interface RecoveryLadderState {
  active: boolean;
  lastNormalThreadId: string;
  checklist: Array<{ id: string; status: RecoveryChecklistStatus }>;
  changeLog: string[];
}

export function driveRecoveryLadder(
  state: GroundZeroState,
  ladder: RecoveryLadderState,
  at: string,
): RecoveryLadderState {
  const active = state === "ground-zero";
  if (active === ladder.active) return ladder;
  if (active) {
    return {
      ...ladder,
      active,
      changeLog: [...ladder.changeLog, `${at}: Entered Ground-0 — recovery ladder active.`],
      checklist: ladder.checklist.map((step, index) => ({
        ...step,
        status: index === 0 ? ("active" as const) : ("pending" as const),
      })),
    };
  }
  return {
    ...ladder,
    active,
    changeLog: [...ladder.changeLog, `${at}: Exited Ground-0 — control returned to the Strategist.`],
    checklist: ladder.checklist.map((step) => ({
      ...step,
      status: step.id === "report" ? ("complete" as const) : ("pending" as const),
    })),
  };
}
