// Intent citation: docs/architecture/ADR-043-generic-harness-resource-projection.md
//
// Generic Harness Resource Projection (Phase 2B) — host-owned session seam.
//
//   RESOURCE REQUEST != CAPABILITY GRANT != SESSION PROJECTION
//
// The filesystem CapabilityGrant is coarse: it answers WHAT KIND of authority
// (filesystem) but never WHERE, WHICH OPERATIONS, or FOR THIS SESSION. This
// module produces a bounded session projection that answers all three:
//
//   - WHERE            the injected authoritative host project root (only root
//                      a projection can hold; manifest/request/caller cannot
//                      supply or widen it);
//   - WHICH OPERATIONS the requested ∩ granted project/files subset, derived
//                      from the EXISTING filesystem grant (no grant => no
//                      projection; unrequested => not projected; read never
//                      implies write and write never implies read);
//   - FOR THIS SESSION addonId + sessionId + project identity binding.
//
// It reuses the pure request/grant helpers from the canonical SDK layer
// (packages/addon-sdk/src/harness-resources.ts) and the symlink-aware path
// containment primitive (addons/resonant-browser-host/src/lib/path-contains.mjs).
// It never performs resource IO, spawns a process, opens a PTY, resolves a
// credential/provider/model, or exposes an arbitrary path to a manifest.

import { realpath as fsRealpath, stat as fsStat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeHarnessResourceRequest, resolveHarnessResourceGrants, HARNESS_RESOURCE_CAPABILITY } from "../../packages/addon-sdk/src/harness-resources.ts";
import { pathContains } from "../../addons/resonant-browser-host/src/lib/path-contains.mjs";

const PROJECTED_FAMILIES = ["project", "files"];
const FILESYSTEM_CAPABILITY = HARNESS_RESOURCE_CAPABILITY.project;
const ABS_PATH_ILLEGAL = /[\0\n]/;

if (FILESYSTEM_CAPABILITY !== "filesystem" || HARNESS_RESOURCE_CAPABILITY.files !== "filesystem") {
  throw new TypeError("Phase 2B projection expects the project/files backing capability to be filesystem.");
}

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

const operationKey = (family, operation) => `${family}.${operation}`;

/**
 * Validate the authoritative host project identity shape. The root must be an
 * absolute, non-empty path with no NUL/newline (path-confusion guard). Validity
 * of the identity shape is separate from filesystem-backed root containment.
 */
function validProjectIdentity(project) {
  return Boolean(project) && typeof project === "object" &&
    isNonEmptyString(project.id) && isNonEmptyString(project.label) &&
    typeof project.root === "string" && project.root.length > 0 &&
    path.isAbsolute(project.root) && !ABS_PATH_ILLEGAL.test(project.root);
}

/**
 * Pure intersection: requested ∩ granted project/files operation subset. A
 * resource grant may be coarser or finer than the raw filesystem capability; the
 * intersection honors the per-operation `granted` flag from the canonical
 * HarnessResourceGrant view. Operations are granted independently: read never
 * implies write, write never implies read, and an unrequested operation is
 * structurally absent. A read-only grant (files.write not granted) can therefore
 * never yield a write projection, and write requires BOTH request and grant.
 */
export function intersectProjectionOperations(request, resourceGrants) {
  const requests = request?.requests ?? {};
  const operations = [];
  for (const family of PROJECTED_FAMILIES) {
    const requestedOperations = Array.isArray(requests[family]) ? requests[family] : [];
    if (requestedOperations.length === 0) continue;
    for (const grant of resourceGrants ?? []) {
      if (grant?.family === family && grant?.granted === true &&
          requestedOperations.includes(grant.operation)) {
        operations.push({ family, operation: grant.operation });
      }
    }
  }
  return operations;
}

/**
 * Pure derivation: resolves the coarse filesystem grant into per-operation
 * authority via the canonical SDK resolver, then intersects requested ∩
 * granted. Equivalent to `intersectProjectionOperations(request,
 * resolveHarnessResourceGrants(request, grantedCapabilities))`.
 */
export function deriveProjectionOperations(request, grantedCapabilities) {
  return intersectProjectionOperations(request, resolveHarnessResourceGrants(request, grantedCapabilities));
}

/**
 * Filesystem-backed root containment (fail closed). Canonicalizes the
 * authoritative root via realpath, requires an existing directory, and rejects
 * the filesystem root, the home directory, and any ancestor of home (repo
 * convention: a project root must be a strict descendant of home). A nonexistent
 * or uncanonicalizable root fails closed.
 */
const fail = (code, message) => Object.assign(new Error(message), { code });

async function resolveAuthorizedRoot({ root, realpath, statPath, homeDir }) {
  // Nonexistent, uncanonicalizable, or non-directory roots fail closed as
  // invalid-project-root. Only filesystem-backed failures are normalized here;
  // the explicit not-a-directory / not-a-safe-root cases keep their own codes.
  let realRoot;
  try {
    realRoot = await realpath(root);
  } catch (error) {
    throw fail("invalid-project-root", `Project root is not a canonicalizable existing directory: ${error?.code ?? "unresolvable"}.`);
  }
  const details = await statPath(realRoot).catch(() => null);
  if (!details?.isDirectory()) throw fail("project-root-not-directory", "Project root is not a directory.");
  const realHome = await realpath(homeDir).catch(() => homeDir);
  const normalized = path.normalize(realRoot);
  if (normalized === path.parse(normalized).root) throw fail("project-root-filesystem", "Filesystem root is not an allowed project root.");
  if (normalized === realHome) throw fail("project-root-home", "Home directory is not an allowed project root.");
  if (realHome.startsWith(`${normalized}${path.sep}`)) throw fail("project-root-ancestor-of-home", "Ancestors of home are not allowed project roots.");
  return normalized;
}

export function createHarnessResourceProjection({
  authorizedProject,
  realpath = fsRealpath,
  statPath = fsStat,
  homeDir = os.homedir(),
  now = () => new Date().toISOString(),
} = {}) {
  if (!validProjectIdentity(authorizedProject)) {
    throw new TypeError("Authoritative host project ({ id, label, root }) is required to project resources.");
  }

  const deniedView = (addonId, sessionId, code) => Object.freeze({
    ok: false,
    code,
    view: Object.freeze({
      addonId: isNonEmptyString(addonId) ? addonId : "",
      sessionId: isNonEmptyString(sessionId) ? sessionId : "",
      projectId: authorizedProject.id,
      projectLabel: authorizedProject.label,
      operations: Object.freeze([]),
      state: "denied",
    }),
  });

  const publicView = (projection) => Object.freeze({
    addonId: projection.addonId,
    sessionId: projection.sessionId,
    projectId: projection.project.id,
    projectLabel: projection.project.label,
    operations: Object.freeze(projection.operations.map((operation) => operationKey(operation.family, operation.operation))),
    state: "projected",
  });

  return {
    /**
     * Issue a bounded session projection. Denies (fail closed) when the request
     * is malformed, the addon/session identity is missing, the filesystem grant
     * is absent/revoked, no project/files operation is both requested and
     * granted, or the authoritative root is not a safe, canonical directory.
     */
    async project({ addonId, sessionId, request, grantedCapabilities = [] } = {}) {
      if (!isNonEmptyString(addonId) || !isNonEmptyString(sessionId)) {
        return deniedView(addonId, sessionId, "invalid-identity");
      }
      const normalized = normalizeHarnessResourceRequest(request);
      if (!normalized.ok) {
        return deniedView(addonId, sessionId, "invalid-request");
      }
      const filesystemGrant = (grantedCapabilities ?? []).find((grant) =>
        grant?.capability === FILESYSTEM_CAPABILITY && grant?.granted === true) ?? null;
      if (!filesystemGrant) {
        return deniedView(addonId, sessionId, "filesystem-not-granted");
      }
      const operations = deriveProjectionOperations(normalized.value, grantedCapabilities);
      if (operations.length === 0) {
        return deniedView(addonId, sessionId, "no-granted-operations");
      }
      let root;
      try {
        root = await resolveAuthorizedRoot({ root: authorizedProject.root, realpath, statPath, homeDir });
      } catch (error) {
        return deniedView(addonId, sessionId, error?.code ?? "invalid-project-root");
      }
      const projection = Object.freeze({
        addonId,
        sessionId,
        project: Object.freeze({ id: authorizedProject.id, label: authorizedProject.label }),
        root,
        cwd: root,
        operations: Object.freeze(operations),
        grant: Object.freeze({ ...filesystemGrant }),
        issuedAt: now(),
      });
      return { ok: true, projection, view: publicView(projection) };
    },

    /**
     * Re-validate an existing projection against CURRENT host state before any
     * consumption. Denies when the add-on, session, or project identity differs,
     * when the authoritative project root changed, or when the filesystem grant
     * has since been revoked. Session A's projection is never reusable as
     * Session B; a project change requires a fresh projection.
     */
    consume(projection, { addonId, sessionId, authorizedProject: currentProject, grantedCapabilities = [] } = {}) {
      if (!projection || typeof projection !== "object") {
        return deniedView(addonId, sessionId, "projection-identity-mismatch");
      }
      if (projection.addonId !== addonId || projection.sessionId !== sessionId ||
          projection.project?.id !== currentProject?.id ||
          path.resolve(projection.root ?? "") !== path.resolve(currentProject?.root ?? "")) {
        return deniedView(addonId, sessionId, "projection-identity-mismatch");
      }
      const currentGrant = (grantedCapabilities ?? []).find((grant) =>
        grant?.capability === FILESYSTEM_CAPABILITY && grant?.granted === true) ?? null;
      if (!currentGrant) {
        return deniedView(addonId, sessionId, "filesystem-not-granted");
      }
      return { ok: true, projection, view: publicView(projection) };
    },

    /** Safe public/audit view: identity, operation names, state. Never a path. */
    publicView,

    /**
     * Host-internal containment of a candidate path within the projected root
     * (read-only realpath/lstat only). Reuses the canonical symlink-aware
     * containment primitive so `..` traversal, absolute reroot, sibling paths,
     * and symlink-out escapes all fail closed. Returns the canonicalized
     * in-root path; never resolves outside the projected root.
     */
    resolveWithinRoot(projection, targetPath) {
      const verdict = pathContains(projection.root, targetPath);
      if (verdict.result !== "pass") {
        const error = new Error("Refused path: resolves outside the projected root.");
        error.code = "EPATH_CONTAINMENT";
        error.containment = verdict.evidence;
        throw error;
      }
      return verdict.evidence.targetReal;
    },
  };
}

export { FILESYSTEM_CAPABILITY, PROJECTED_FAMILIES };
