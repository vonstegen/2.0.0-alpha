// Intent citation: docs/architecture/resonantos-browser-architecture/11-resource-governance.md
//
// CP-5 / CP-6 — workspace lease registry (one of the five LeaseKind kinds).
// The public surface is intentionally narrow: `acquire / release / inspect /
// size / clear`. CP-5 introduced it as a workspace-isolated registry; CP-6
// unified the same acquire/release API under `lease-registry.mjs` so all five
// LeaseKinds (workspace / browser / gpu / provider-route / external-account)
// share one conflict resolver. The contract here is unchanged.

import { leaseConflicts, leaseActive } from "./resource-governor.mjs";

/**
 * Build a workspace lease registry. The registry holds `ResourceLease`
 * entries of kind "workspace" plus delegates conflict / expiry checks to
 * the resource-governor primitives so the unified `LeaseRegistry` can
 * reason about workspace leases alongside the other four kinds.
 */
export function createWorkspaceLeaseRegistry({ now = () => Date.now() } = {}) {
  const leases = new Map();
  let seq = 0;

  function acquire({ leaseId, resourceId, holderPrincipalId, exclusive = true, ttlMs = 60_000 }) {
    if (typeof resourceId !== "string" || resourceId.length === 0) {
      throw new Error("workspace-lease: resourceId is required");
    }
    const id = leaseId ?? `ws-lease-${++seq}`;
    const candidate = {
      leaseId: id,
      resourceKind: "workspace",
      resourceId,
      holderPrincipalId: holderPrincipalId ?? "anonymous",
      exclusive,
      expiresAt: new Date(now() + ttlMs).toISOString(),
    };
    // Expired leases are dropped lazily so a re-acquire against a stale
    // lease doesn't behave like a live conflict.
    for (const [otherId, other] of leases) {
      if (leaseActive(other, new Date(now()).toISOString()) && leaseConflicts(candidate, other)) {
        return { ok: false, leaseId: id, conflictingWith: otherId };
      }
    }
    leases.set(id, candidate);
    return { ok: true, leaseId: id, lease: candidate };
  }

  function release(leaseId) {
    return leases.delete(leaseId);
  }

  function inspect(leaseId) {
    const lease = leases.get(leaseId);
    if (!lease) return null;
    return { ...lease };
  }

  function size() {
    let active = 0;
    const at = new Date(now()).toISOString();
    for (const lease of leases.values()) if (leaseActive(lease, at)) active += 1;
    return active;
  }

  function clear() {
    leases.clear();
  }

  function list() {
    return Array.from(leases.values()).map((lease) => ({ ...lease }));
  }

  return { acquire, release, inspect, size, clear, list };
}
