// Intent citation: docs/architecture/resonantos-browser-architecture/CP5-PHASE5-CONTINUATION.md
// Intent citation: docs/architecture/resonantos-browser-architecture/IMPLEMENTATION_TRACKING.md (row 99)
//
// CP-5 Phase 5 bridge-side workspace-lease registry. The Phase 5
// continuation prompt requires `opencodeRuntimeDispatch` to acquire a
// `WorkspaceLease` before driving a real `opencode serve` session and
// release it after — parity with the SDK's planned lease flow (Phase 6
// resource governor). The bridge needs the gate today because a
// permissive `opencode serve` would happily write to any path the bridge
// chose to point it at; the lease constrains which paths any one task
// can hold.
//
// Design constraints:
//   - Process-local, in-memory registry: the bridge is single-process
//     and the lease is per-run. Phase 6 replaces this with the SDK
//     `ResourceLease` (cross-process, persistent).
//   - One lease per resourceId at a time. A second acquire while the
//     first is held returns `{ ok: false, reason: "conflict" }`.
//   - Lease auto-expires after `ttlMs` (default 5 minutes) so a crashed
//     holder does not block the workspace forever.
//   - Released leases are removed; expired leases are removed on the
//     next acquire.
//
// Intentionally NOT in scope for Phase 5:
//   - The TS `src/sdk/harnesses/workspace-lease.ts` mirror. The doc
//     names the file, but Phase 5 §"must NOT" forbids touching the SDK
//     adapters in a way that changes conformance. The .ts counterpart
//     lands with Phase 6 (resource governor).
//   - Cross-process leases. Phase 6 only.

import { randomBytes } from "node:crypto";

const DEFAULT_TTL_MS = 5 * 60_000;

function defaultNow() {
  return Date.now();
}

function defaultIdFactory() {
  return randomBytes(12).toString("hex");
}

function makeRegistry({ now = defaultNow, idFactory = defaultIdFactory, defaultTtlMs = DEFAULT_TTL_MS } = {}) {
  /** @type {Map<string, { leaseId: string, resourceId: string, holder: string, expiresAt: number }>} */
  const byResource = new Map();
  /** @type {Map<string, string>} */
  const resourceByLease = new Map();

  function pruneExpired() {
    const current = now();
    for (const [resourceId, entry] of byResource.entries()) {
      if (entry.expiresAt <= current) {
        byResource.delete(resourceId);
        resourceByLease.delete(entry.leaseId);
      }
    }
  }

  function acquire({ resourceId, holder, ttlMs = defaultTtlMs } = {}) {
    if (typeof resourceId !== "string" || !resourceId) {
      return { ok: false, reason: "invalid-resource-id", detail: "acquire requires a non-empty resourceId" };
    }
    if (typeof holder !== "string" || !holder) {
      return { ok: false, reason: "invalid-holder", detail: "acquire requires a non-empty holder" };
    }
    pruneExpired();
    const existing = byResource.get(resourceId);
    if (existing) {
      return {
        ok: false,
        reason: "conflict",
        detail: `workspace lease for ${resourceId} already held by ${existing.holder} until ${new Date(existing.expiresAt).toISOString()}`,
        currentHolder: existing.holder,
        expiresAt: existing.expiresAt,
      };
    }
    const leaseId = idFactory();
    const expiresAt = now() + Math.max(1_000, Number(ttlMs) || defaultTtlMs);
    byResource.set(resourceId, { leaseId, resourceId, holder, expiresAt });
    resourceByLease.set(leaseId, resourceId);
    return { ok: true, leaseId, resourceId, holder, expiresAt };
  }

  function release(leaseId) {
    if (typeof leaseId !== "string" || !leaseId) {
      return { ok: false, reason: "invalid-lease-id", detail: "release requires a non-empty leaseId" };
    }
    const resourceId = resourceByLease.get(leaseId);
    if (!resourceId) {
      return { ok: false, reason: "unknown-lease", detail: `no lease held for id ${leaseId}` };
    }
    byResource.delete(resourceId);
    resourceByLease.delete(leaseId);
    return { ok: true, leaseId, resourceId };
  }

  function inspect(leaseId) {
    if (typeof leaseId !== "string" || !leaseId) return null;
    const resourceId = resourceByLease.get(leaseId);
    if (!resourceId) return null;
    const entry = byResource.get(resourceId);
    if (!entry) return null;
    if (entry.expiresAt <= now()) return null;
    return { leaseId, resourceId, holder: entry.holder, expiresAt: entry.expiresAt };
  }

  function size() {
    pruneExpired();
    return byResource.size;
  }

  function clear() {
    byResource.clear();
    resourceByLease.clear();
  }

  return { acquire, release, inspect, size, clear };
}

// Process-global registry shared by all consumers on the bridge. The
// tests in `workspace-lease-registry.test.mjs` exercise the factory
// directly; the consumers in `harness-provider-adapters.mjs` reach for
// the default registry unless one is injected via options.
const defaultRegistry = makeRegistry();

export { makeRegistry, defaultRegistry, DEFAULT_TTL_MS };
export const __test = Object.freeze({ makeRegistry });
