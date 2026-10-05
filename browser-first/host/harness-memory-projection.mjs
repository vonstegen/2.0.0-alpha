// Intent citation: docs/architecture/ADR-045-harness-memory-projection.md
//
// Generic Harness Memory Projection (Phase M1) — host-owned session seam.
//
//   MEMORY REQUEST != CAPABILITY GRANT != SESSION PROJECTION
//
// `AddOnMemoryAccessContract.archiveReadMode` describes WHAT KIND of
// authority a manifest declares (none / read-only-context /
// retrieval-with-citations). This module produces the bounded session
// projection: an approved, scoped, 0600 context file the adopted terminal
// (or the harness process) can read.
//
//   1. WHERE             the host-owned staging base + a deterministic
//                        session-bound identity under it; the manifest
//                        cannot supply or widen the staging root.
//   2. WHICH MEMORY      the requested ∩ granted (approved) memory
//                        domains, derived from a host-owned approved-
//                        domain allowlist. No domain the manifest did
//                        not declare is ever included.
//   3. FOR THIS SESSION  sessionId + addonId binding; the projection is
//                        re-issued for every session and is single-use
//                        in spirit (terminated when the session ends).
//
// Hard rules (Phase M1):
//   - Memory is projected as a FILE PATH, never as argv or env content.
//   - The context file is 0600 (0700 staging dir); under a reviewed
//     staging root; session-scoped; cleaned up on terminate/stop.
//   - `archiveReadMode: "none"` -> no file, no projection.
//   - The returned projection object carries ONLY public identifiers
//     (projectionId, sessionId, archiveReadMode, domains, expiresAt,
//     absolute path). It NEVER carries memory content, search API
//     tokens, stored credentials, or arbitrary host state.
//   - For `retrieval-with-citations`, the projection returns a
//     placeholder (`path: null`, `notImplemented: "retrieval-with-citations"`).
//
// Mirrors the resource + skills projection discipline (host-owned
// staging, deterministic opaque identity, fail closed). Reuses the
// canonical memory-domain allowlist (`memoryDomainRoots`) so the
// projection NEVER invents a domain the host did not approve.

import { createHash } from "node:crypto";
import { mkdir, writeFile, chmod, rm as fsRm, rmdir as fsRmdir, stat as fsStatCheck } from "node:fs/promises";
import { realpath as fsRealpath, stat as fsStat } from "node:fs/promises";
import path from "node:path";

import { memoryDomainRoots } from "./memory-schema.mjs";

const TERMINAL_HOST_ADDON_ID = "addon.resonant-terminal-iterm2";
const SESSION_MEMORY_PROJECTION_TTL_MS = 60 * 60 * 1000; // 1h (session-bound)
const MEMORY_DIR_NAME = "memory-context";

// Length-prefixed UTF-8 byte binding — same shape as deriveStagingIdentity
// in harness-skills-projection.mjs so the two projections look and act the
// same way for ops/debugging.
const UINT32_BE_LENGTH_BYTES = 4;

const encodeIdentityField = (value) => {
  const buf = Buffer.from(String(value ?? ""), "utf8");
  const len = Buffer.alloc(UINT32_BE_LENGTH_BYTES);
  len.writeUInt32BE(buf.byteLength, 0);
  return Buffer.concat([len, buf]);
};

const encodeMemoryStagingBinding = (addonId, sessionId) =>
  Buffer.concat([
    encodeIdentityField(addonId),
    encodeIdentityField(sessionId),
  ]);

/**
 * Host-derived deterministic opaque/path-safe staging identity for a memory
 * projection. Mirrors `deriveStagingIdentity` in harness-skills-projection.mjs.
 *
 * @param {string} addonId
 * @param {string} sessionId
 * @returns {string} 32-char hex digest (path-safe)
 */
export function deriveMemoryStagingIdentity(addonId, sessionId) {
  return createHash("sha256")
    .update(encodeMemoryStagingBinding(addonId, sessionId))
    .digest("hex")
    .slice(0, 32);
}

/** Pure mode derivation (no I/O). Maps the manifest's declared mode to the
 * projection behavior implemented by this module.
 *
 *  - `"none"`                      -> `"none"`     (no file, no projection)
 *  - `"read-only-context"`         -> `"context"`  (0600 file materialized)
 *  - `"retrieval-with-citations"`  -> `"retrieval"`(placeholder; deferred)
 *
 * @param {unknown} memoryAccess
 * @returns {"none" | "context" | "retrieval"}
 */
export function deriveMemoryProjectionMode(memoryAccess) {
  if (!memoryAccess || typeof memoryAccess !== "object") return "none";
  const mode = memoryAccess.archiveReadMode;
  if (mode === "read-only-context") return "context";
  if (mode === "retrieval-with-citations") return "retrieval";
  return "none";
}

/** Default approved domains for read-only-context projections. The host's
 * living-archive schema already defines `memoryDomainRoots`. The
 * projection exposes the read-only context subset: AI-curated wiki +
 * provenance + backups. INTAKE / CONFIG / LOGS / MANIFESTS /
 * HUMAN_KNOWLEDGE / EXTERNAL_KNOWLEDGE are deliberately excluded (raw /
 * private / host-internal / unredacted user-owned material).
 *
 * @returns {readonly string[]}
 */
export function defaultApprovedMemoryDomains() {
  return Object.freeze([
    "AI_MEMORY/wiki",
    "AI_MEMORY/provenance",
    "AI_MEMORY/backups",
  ]);
}

/** Canonicalize an absolute root to a stable comparison form (realpath
 * when possible, else absolute-posix).
 *
 * @param {string} candidate
 * @param {((p: string) => Promise<string>)=} realpath
 * @returns {Promise<string | null>}
 */
async function canonicalRootOf(candidate, realpath) {
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(candidate);
  try {
    const resolved = await (realpath ?? fsRealpath)(absolute);
    return path.normalize(resolved);
  } catch {
    return path.normalize(absolute);
  }
}

/** Validate a domain against the canonical allowlist. A domain is approved
 * only when it appears in `memoryDomainRoots` AND in the supplied allowlist
 * (which is the projection's resolved host-owned allowlist, NOT the raw
 * caller input — the builder resolves the default first).
 *
 * @param {string} domain
 * @param {readonly string[]=} approved   Projection's resolved allowlist
 * @returns {boolean}
 */
function isApprovedDomain(domain, approved) {
  if (typeof domain !== "string" || !domain) return false;
  if (!memoryDomainRoots.includes(domain)) return false;
  if (!approved) return false;
  return approved.includes(domain);
}

/**
 * Build the session-bound, host-owned memory projection. Writes the
 * 0600 context file under `${stagingBase}/${MEMORY_DIR_NAME}/${identity}`,
 * returning a `HarnessMemoryProjection` whose `path` field is the
 * absolute file path. The path is the ONLY field the harness may read
 * (under `ROS_MEMORY_CONTEXT`).
 *
 * @param {object} args
 * @param {string} args.sessionId
 * @param {{ archiveReadMode?: unknown }} [args.memoryAccess]
 *        The harness manifest's memory access contract. When the mode is
 *        `"none"` (or absent), returns a placeholder projection with no file.
 * @param {string} [args.memoryRoot]           The Living Archive root. Required for
 *        `"read-only-context"`; ignored otherwise.
 * @param {readonly string[]} [args.approvedDomains]  Host-owned allowlist; defaults
 *        to `defaultApprovedMemoryDomains()` (read-only-context subset).
 * @param {string} args.stagingBase            Host-owned staging root.
 * @param {() => Date} [args.now]             Wall clock for expiry derivation.
 * @param {((p: string) => Promise<string>)=} [args.realpath]   fs injection for tests
 * @param {((p: string) => Promise<import("node:fs").Stats>)=} [args.statPath]
 * @returns {Promise<{
 *   projection: import("../../src/core/harness-memory-contract.ts").HarnessMemoryProjection | null,
 *   rejection: null | { code: string, reason: string }
 * }>}
 */
export async function buildHarnessMemoryProjection({
  sessionId,
  memoryAccess,
  memoryRoot,
  approvedDomains,
  stagingBase,
  now = () => new Date(),
  realpath,
  statPath = fsStat,
} = {}) {
  const baseStamp = now();
  const expiresAt = new Date(baseStamp.getTime() + SESSION_MEMORY_PROJECTION_TTL_MS).toISOString();
  const mode = deriveMemoryProjectionMode(memoryAccess);

  const projectionId = deriveMemoryStagingIdentity(TERMINAL_HOST_ADDON_ID, sessionId);

  if (mode === "none") {
    return {
      projection: Object.freeze({
        projectionId,
        sessionId,
        archiveReadMode: "none",
        path: null,
        domains: Object.freeze([]),
        expiresAt: baseStamp.toISOString(),
      }),
      rejection: null,
    };
  }

  if (mode === "retrieval") {
    return {
      projection: Object.freeze({
        projectionId,
        sessionId,
        archiveReadMode: "retrieval-with-citations",
        path: null,
        domains: Object.freeze([]),
        expiresAt: baseStamp.toISOString(),
        notImplemented: "retrieval-with-citations",
      }),
      rejection: null,
    };
  }

  // mode === "context" (read-only-context)
  if (typeof stagingBase !== "string" || !stagingBase) {
    return {
      projection: null,
      rejection: { code: "memory-staging-base-missing", reason: "stagingBase is required for read-only-context memory projections." },
    };
  }
  if (typeof memoryRoot !== "string" || !memoryRoot) {
    return {
      projection: null,
      rejection: { code: "memory-root-missing", reason: "memoryRoot is required for read-only-context memory projections." },
    };
  }
  const memoryRootCanonical = await canonicalRootOf(memoryRoot, realpath);
  if (!memoryRootCanonical) {
    return {
      projection: null,
      rejection: { code: "memory-root-invalid", reason: "memoryRoot is not a valid path." },
    };
  }
  try {
    const s = await statPath(memoryRootCanonical);
    if (!s.isDirectory()) {
      return {
        projection: null,
        rejection: { code: "memory-root-invalid", reason: "memoryRoot is not a directory." },
      };
    }
  } catch {
    return {
      projection: null,
      rejection: { code: "memory-root-invalid", reason: "memoryRoot does not exist or is not accessible." },
    };
  }

  // Host-owned approved-domain intersection:
  //  - If the caller provides an explicit non-empty list, that list is
  //    INTERSECTED with the canonical host-owned default
  //    (defaultApprovedMemoryDomains). Domains outside the host
  //    defaults NEVER enter the projection (caller can't widen).
  //  - If the caller provides an empty/undefined list, the host
  //    default applies wholesale.
  //  - The final result is also filtered against `memoryDomainRoots`
  //    (the living-archive schema's canonical allowlist) so an
  //    attacker-controlled caller value cannot smuggle in a domain
  //    the host never registered.
  const callerList = (approvedDomains && approvedDomains.length > 0)
    ? approvedDomains
    : null;
  const hostDefault = defaultApprovedMemoryDomains();
  const candidateList = callerList
    ? callerList.filter((d) => hostDefault.includes(d))
    : hostDefault;
  const approvedIntersect = candidateList.filter((d) => memoryDomainRoots.includes(d));
  if (approvedIntersect.length === 0) {
    return {
      projection: null,
      rejection: { code: "no-approved-memory-domains", reason: "No approved memory domains remain after host allowlist intersection." },
    };
  }

  const stagingCanonical = await canonicalRootOf(stagingBase, realpath);
  if (!stagingCanonical) {
    return {
      projection: null,
      rejection: { code: "memory-staging-base-invalid", reason: "stagingBase is not a valid path." },
    };
  }
  const stagingDir = path.join(stagingCanonical, MEMORY_DIR_NAME, projectionId);
  const contextFile = path.join(stagingDir, "context.md");

  const body = [
    "# ROS_MEMORY_CONTEXT",
    "",
    `sessionId: ${sessionId}`,
    `projectionId: ${projectionId}`,
    `issuedAt: ${baseStamp.toISOString()}`,
    `expiresAt: ${expiresAt}`,
    `memoryRoot: ${memoryRootCanonical}`,
    `archiveReadMode: read-only-context`,
    "",
    "## Approved Domains",
    "",
    ...approvedIntersect.map((d) => `- ${d}`),
    "",
    "## Notes",
    "",
    "- This file lists the APPROVED memory domains for the session. It",
    "  does NOT inline wiki content. The harness reads the listed",
    "  domains from the Living Archive root directly.",
    "- The path under ROS_MEMORY_CONTEXT is the ONLY host-owned entry",
    "  point. The harness never receives a memory-store endpoint, a",
    "  search API token, or raw memory content on argv.",
    "",
  ].join("\n");

  await mkdir(stagingDir, { recursive: true, mode: 0o700 });
  await writeFile(contextFile, body, { mode: 0o600 });
  await chmod(contextFile, 0o600).catch(() => undefined);
  await chmod(stagingDir, 0o700).catch(() => undefined);

  return {
    projection: Object.freeze({
      projectionId,
      sessionId,
      archiveReadMode: "read-only-context",
      path: contextFile,
      domains: Object.freeze([...approvedIntersect]),
      expiresAt,
    }),
    rejection: null,
  };
}

/** Remove the host-owned memory-context tree for a session. Best-effort:
 * missing files are not an error. Strict containment: only the exact
 * owned staging tree for this projection/session is removed.
 *
 * @param {object} args
 * @param {string} args.stagingBase
 * @param {string} args.sessionId
 * @param {string} [args.projectionId]  Optional pre-known identity; falls back
 *        to `deriveMemoryStagingIdentity(TERMINAL_HOST_ADDON_ID, sessionId)`.
 * @param {(p: string, opts: { recursive?: boolean, force?: boolean }) => Promise<void>} [args.rm]
 *        fs injection for tests
 * @returns {Promise<{ removed: boolean, path: string }>}
 */
export async function cleanupHarnessMemoryProjection({
  stagingBase,
  sessionId,
  projectionId,
  rm = fsRm,
  rmdir = fsRmdir,
  stat = fsStatCheck,
} = {}) {
  if (typeof stagingBase !== "string" || !stagingBase || typeof sessionId !== "string" || !sessionId) {
    return { removed: false, path: "" };
  }
  const identity = projectionId ?? deriveMemoryStagingIdentity(TERMINAL_HOST_ADDON_ID, sessionId);
  const base = stagingBase.replace(/\/$/, "");
  const dir = path.join(base, MEMORY_DIR_NAME, identity);
  // Best-effort: if the dir is missing, return removed:false without
  // touching the filesystem. `rm({ force: true })` would otherwise report
  // success on a missing path, masking cleanup truth.
  try {
    await stat(dir);
  } catch {
    return { removed: false, path: dir };
  }
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    return { removed: false, path: dir };
  }
  // Best-effort: also remove the now-empty parent `memory-context/` dir.
  // If the parent contains anything else (a sibling session's projection),
  // rmdir will fail (ENOTEMPTY) and we leave it alone.
  const parent = path.join(base, MEMORY_DIR_NAME);
  try {
    await rmdir(parent);
  } catch {
    /* non-empty or non-existent — leave it */
  }
  return { removed: true, path: dir };
}

export { MEMORY_DIR_NAME };