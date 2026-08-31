// Intent citation: docs/architecture/resonantos-browser-architecture/10-ground-0-recovery.md
// Intent citation: docs/architecture/resonantos-browser-architecture/CONTRACTS.md
//
// CP-8 runtime consumer of the Ground-0 state machine (ground-zero.mjs). This
// is the bridge-side "src/modules/recovery" the SDK names as the consumer: it
// owns the *side effects* the pure machine deliberately leaves out.
//
//   enter  — snapshot the live executable surface + active grants, transition
//            to ground-zero, then actually revoke every active grant (no
//            pre-recovery authority survives) and mark the surface disabled.
//   exit   — health-check each surface item in dependency order, resume the
//            healthy ones with fresh authority, leave the rest disabled.
//
// `enter`/`exit` are idempotent-guarded by the machine: entering from a
// non-normal state and exiting from a non-ground-zero state both throw, so the
// bridge cannot silently double-revoke or half-recover.

import {
  enterGroundZero,
  reEnableFromGroundZero,
  verifyKnownGoodSet,
} from "./ground-zero.mjs";

export function createGroundZeroService({
  governedAuthority,
  surfaceInventory = () => [],
  now = () => Date.now(),
  onSnapshot = null,
  knownGood = null,
  verifyKnownGood = verifyKnownGoodSet,
} = {}) {
  if (!governedAuthority || typeof governedAuthority.revokeAll !== "function") {
    throw new Error("createGroundZeroService requires a governed authority with revokeAll");
  }
  if (typeof governedAuthority.listActiveGrants !== "function") {
    throw new Error("createGroundZeroService requires a governed authority with listActiveGrants");
  }

  let snapshot = {
    state: "normal",
    activeGrantIds: [],
    optionalItems: [],
    quarantine: [],
    audit: [],
  };

  function refreshInventory() {
    return {
      grants: governedAuthority.listActiveGrants(),
      items: surfaceInventory(),
    };
  }

  function enter({ trigger = "manual", at = new Date(now()).toISOString() } = {}) {
    if (snapshot.state !== "normal") {
      throw new Error(`cannot enter Ground-0 from state "${snapshot.state}"`);
    }
    // Doc 10 §Entry: switch to a known-good manifest set. Fail closed if the
    // baseline is missing or tampered — recovery has nothing trustworthy to
    // restore to.
    if (knownGood != null && !verifyKnownGood(knownGood)) {
      throw new Error("known-good manifest set failed integrity check");
    }
    const { grants, items } = refreshInventory();
    // Carry the audit history forward; refresh only the live authority + the
    // optional surface (both may change between recovery cycles).
    const next = enterGroundZero(
      {
        ...snapshot,
        activeGrantIds: grants.map((grant) => grant.grantId),
        optionalItems: items,
      },
      { trigger, at },
    );
    // Side effect: revoke every active grant so the governed dispatch fails
    // closed even if a caller replays a pre-recovery handle.
    governedAuthority.revokeAll(trigger);
    snapshot = next;
    if (onSnapshot) onSnapshot(next);
    return next;
  }

  async function exit({
    order = [],
    healthCheck = async () => true,
    at = new Date(now()).toISOString(),
    resumeItem = null,
  } = {}) {
    if (snapshot.state !== "ground-zero") {
      throw new Error(`cannot exit Ground-0 from state "${snapshot.state}"`);
    }
    // Resolve async health probes first (adapter.diagnose() is async); the
    // pure re-enable machine takes a synchronous predicate.
    const health = new Map();
    for (const item of order) {
      health.set(item, Boolean(await healthCheck(item)));
    }
    const next = reEnableFromGroundZero(snapshot, {
      order,
      healthCheck: (item) => health.get(item) ?? false,
      at,
    });
    // Side effect: resume healthy items with fresh runtime authority; leave the
    // unhealthy ones disabled. `resumeItem` re-establishes an item's authority
    // (the per-task grants are minted fresh at approval, never revived here).
    if (resumeItem) {
      for (const item of order) {
        if (!health.get(item)) continue;
        await resumeItem(item);
      }
    }
    snapshot = next;
    if (onSnapshot) onSnapshot(next);
    return next;
  }

  function getSnapshot() {
    return snapshot;
  }

  function getState() {
    return snapshot.state;
  }

  function isDisabled() {
    return snapshot.state === "ground-zero";
  }

  return { enter, exit, getSnapshot, getState, isDisabled };
}
