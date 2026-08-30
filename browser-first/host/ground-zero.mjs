// Intent citation: docs/architecture/resonantos-browser-architecture/10-ground-0-recovery.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
// Intent citation: docs/architecture/resonantos-browser-architecture/CONTRACTS.md
//
// CP-8 bridge-side Ground-0 state machine. Plain-JS mirror of
// src/sdk/recovery/index.ts (the bridge is dependency-free of `src/`).
//
// Ground-0 is a Core-controlled system state, not Linux safe mode: entry
// revokes every temporal grant and quarantines optional executable memory;
// exit re-enables in dependency order with fresh grants — never reviving
// pre-recovery authority. `src/modules/recovery` becomes a *consumer* of this
// state machine, not its definition (doc 10).

// GroundZeroState:
//   "normal" | "entering" | "ground-zero" | "re-enabling" | "exited"
// QuarantineKind:
//   "harness" | "extension" | "hook" | "script" | "channel"
//   | "background-job" | "archive-ingest"

// Enter Ground-0: revoke every active temporal grant and quarantine every
// optional executable item. No pre-recovery executable authority survives the
// transition. Pure — returns a new snapshot.
export function enterGroundZero(snapshot, args) {
  if (snapshot.state !== "normal") {
    throw new Error(`cannot enter Ground-0 from state "${snapshot.state}"`);
  }
  const quarantine = snapshot.optionalItems.map((item) => ({
    item: item.id,
    kind: item.kind,
    quarantinedAt: args.at,
  }));
  const transition = {
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

// Exit Ground-0: re-enable items in dependency order, health-checking each.
// Only healthy items resume with a FRESH grant (old grants are never revived);
// unhealthy or omitted items are left disabled with an explicit disposition.
export function reEnableFromGroundZero(snapshot, args) {
  if (snapshot.state !== "ground-zero") {
    throw new Error(`cannot re-enable from state "${snapshot.state}"`);
  }
  const ordered = new Set(args.order);
  const quarantine = snapshot.quarantine.map((record) => {
    if (!ordered.has(record.item)) return record;
    return args.healthCheck(record.item)
      ? { ...record, disposition: "accepted" }
      : { ...record, disposition: "left-disabled" };
  });
  // Fresh grants only for resumed (healthy) items, in dependency order.
  const activeGrantIds = args.order
    .filter((id) => args.healthCheck(id))
    .map((id) => `fresh-grant:${id}`);
  const transition = {
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
