// Intent citation: docs/architecture/resonantos-browser-architecture/11-resource-governance.md
//
// CP-6 unified LeaseRegistry. CP-5 introduced a workspace-scoped lease
// registry (`workspace-lease.mjs`, acquire/release/inspect/size/clear).
// CP-6 unifies the same acquire/release contract across the five
// LeaseKinds so all five resources (workspace / browser / gpu /
// provider-route / external-account) share one conflict resolver and the
// same owner-side inspection API.
//
// The unified registry is the lease surface that the bridge registers
// against the governor; per-kind hand-rolled registries remain available
// for callers that need a single-kind view.

import { leaseConflicts, leaseActive } from "./resource-governor.mjs";

const LEASE_KINDS = Object.freeze([
  "workspace",
  "browser",
  "gpu",
  "provider-route",
  "external-account",
]);

const DEFAULTS = Object.freeze({
  workspace: { ttlMs: 60_000, exclusive: true },
  browser: { ttlMs: 30_000, exclusive: true },
  gpu: { ttlMs: 120_000, exclusive: true },
  "provider-route": { ttlMs: 30_000, exclusive: false },
  "external-account": { ttlMs: 300_000, exclusive: true },
});

function validateLeaseShape(lease) {
  if (!lease || typeof lease !== "object") {
    throw new Error("lease-registry: lease must be an object");
  }
  if (!LEASE_KINDS.includes(lease.resourceKind)) {
    throw new Error(`lease-registry: invalid resourceKind ${lease.resourceKind}`);
  }
  if (typeof lease.resourceId !== "string" || lease.resourceId.length === 0) {
    throw new Error("lease-registry: resourceId is required");
  }
  if (typeof lease.expiresAt !== "string") {
    throw new Error("lease-registry: expiresAt is required");
  }
}

/**
 * Build the unified lease registry. The same `acquire` API serves every
 * LeaseKind; per-kind defaults (ttlMs, exclusive) keep caller shape small.
 *
 * `now` lets tests pin time. `workspaceLeaseRegistry` is the optional
 * pre-existing CP-5 registry that the unified registry must compose with —
 * passing it forwards every workspace acquire/release into the legacy
 * surface so the existing 12 workspace-lease tests stay green.
 */
export function makeLeaseRegistry({
  now = () => Date.now(),
  workspaceLeaseRegistry = null,
} = {}) {
  const leases = new Map();
  let seq = 0;

  function acquire(input) {
    if (!input || typeof input !== "object") {
      throw new Error("lease-registry: acquire requires { resourceKind, resourceId, ... }");
    }
    const { resourceKind, resourceId, holderPrincipalId, exclusive, ttlMs, leaseId, taskId } = input;
    if (!LEASE_KINDS.includes(resourceKind)) {
      throw new Error(`lease-registry: invalid resourceKind ${resourceKind}`);
    }
    const defaults = DEFAULTS[resourceKind] ?? { ttlMs: 60_000, exclusive: true };
    const id = leaseId ?? `${resourceKind}-${++seq}`;
    const candidate = {
      leaseId: id,
      resourceKind,
      resourceId,
      holderPrincipalId: holderPrincipalId ?? "anonymous",
      exclusive: exclusive ?? defaults.exclusive,
      expiresAt: new Date(now() + (ttlMs ?? defaults.ttlMs)).toISOString(),
      taskId: taskId ?? null,
    };
    validateLeaseShape(candidate);
    const at = new Date(now()).toISOString();
    for (const [otherId, other] of leases) {
      if (leaseActive(other, at) && leaseConflicts(candidate, other)) {
        return { ok: false, leaseId: id, conflictingWith: otherId };
      }
    }
    leases.set(id, candidate);
    if (resourceKind === "workspace" && workspaceLeaseRegistry) {
      // Forward into the CP-5 workspace surface so observers using the
      // legacy `inspect / size` views stay consistent.
      workspaceLeaseRegistry.acquire({
        leaseId: id,
        resourceId: candidate.resourceId,
        holderPrincipalId: candidate.holderPrincipalId,
        exclusive: candidate.exclusive,
        ttlMs: ttlMs ?? defaults.ttlMs,
      });
    }
    return { ok: true, leaseId: id, lease: { ...candidate } };
  }

  function release(leaseId) {
    const lease = leases.get(leaseId);
    if (!lease) return false;
    leases.delete(leaseId);
    if (lease.resourceKind === "workspace" && workspaceLeaseRegistry) {
      workspaceLeaseRegistry.release(leaseId);
    }
    return true;
  }

  function inspect(leaseId) {
    const lease = leases.get(leaseId);
    if (!lease) return null;
    return { ...lease };
  }

  function size(filter = {}) {
    let count = 0;
    const at = new Date(now()).toISOString();
    for (const lease of leases.values()) {
      if (filter.kind && lease.resourceKind !== filter.kind) continue;
      if (!leaseActive(lease, at)) continue;
      count += 1;
    }
    return count;
  }

  function clear() {
    leases.clear();
  }

  function list(filter = {}) {
    const out = [];
    for (const lease of leases.values()) {
      if (filter.kind && lease.resourceKind !== filter.kind) continue;
      out.push({ ...lease });
    }
    return out;
  }

  /**
   * Prove the unified registry can wrap the legacy workspace lease
   * surface; the same acquire call routes to `workspaceLeaseRegistry`
   * (CP-5 contract) AND lands in `leases` (CP-6 unified view).
   */
  function wrapWorkspaceLease(workspaceLease) {
    return {
      acquire: (input) => acquire({ ...input, resourceKind: "workspace" }),
      release: (leaseId) => {
        if (!leases.delete(leaseId)) return false;
        return workspaceLease.release(leaseId);
      },
      inspect: (leaseId) => inspect(leaseId) ?? workspaceLease.inspect(leaseId),
      size: () => size({ kind: "workspace" }),
      clear: () => {
        for (const lease of list({ kind: "workspace" })) leases.delete(lease.leaseId);
        return workspaceLease.clear();
      },
      list: () => list({ kind: "workspace" }),
    };
  }

  return {
    acquire,
    release,
    inspect,
    size,
    clear,
    list,
    wrapWorkspaceLease,
    kinds: LEASE_KINDS,
  };
}

export { LEASE_KINDS };
