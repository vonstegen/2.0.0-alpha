// Intent citation: docs/architecture/ADR-054-principal-delegation-chain-task-scoped-authority.md
// Intent citation: docs/architecture/resonantos-browser-architecture/08-capability-inheritance-task-scope.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
//
// CP-2 envelope core: opaque grant handles + GovernedRequest<T> validation.
//
// Layering (ADR-054): the Phase 3.5 caller-attributed HMAC token
// (bridge-attributed-token.mjs) is retained as the *internal mint*; this
// module wraps it behind an opaque, high-entropy grant handle that is the
// only thing add-on/browser code ever sees. The handle is resolved in-memory
// by the bridge and is never self-contained: it reveals nothing about the
// grant and cannot be forged from the grant contents.
//
// Client-supplied identity fields in a GovernedRequest (taskId, delegationId,
// subjectPrincipalId) are correlation claims, not authority (doc 12). The
// bridge resolves the handle, walks the full principal chain, and checks every
// claim against the resolved grant before performing the effect.

import { randomBytes } from "node:crypto";

const ACTIVE_STATUSES = new Set(["active", "approved"]);

function subsetOf(candidate, parent) {
  return candidate.every((value) => parent.includes(value));
}

// Mirrors src/sdk/authority/isScopeSubset (CP-1). A child scope may not widen
// any dimension of its parent.
export function isScopeSubset(candidate, parent) {
  if (!candidate || !parent) return false;
  if (candidate.action !== parent.action) return false;
  if (!subsetOf(candidate.operations ?? [], parent.operations ?? [])) return false;
  if (!subsetOf(candidate.resourceSelectors ?? [], parent.resourceSelectors ?? [])) return false;
  if (candidate.notBefore != null && candidate.notBefore < parent.notBefore) return false;
  if (candidate.expiresAt != null && candidate.expiresAt > parent.expiresAt) return false;
  if (candidate.limits?.count != null) {
    if (parent.limits?.count == null || candidate.limits.count > parent.limits.count) return false;
  }
  if (candidate.limits?.costCeiling != null) {
    if (
      parent.limits?.costCeiling == null ||
      candidate.limits.costCeiling > parent.limits.costCeiling
    ) {
      return false;
    }
  }
  if (parent.networkAllowlist != null) {
    if (candidate.networkAllowlist == null) return false;
    if (!subsetOf(candidate.networkAllowlist, parent.networkAllowlist)) return false;
  }
  return true;
}

function isTraversalPath(path) {
  return (
    typeof path !== "string" ||
    path.includes("\0") ||
    path.split(/[\\/]+/).includes("..")
  );
}

function isPathWithin(path, selector) {
  if (path === selector) return true;
  return path.startsWith(`${selector}/`) || path.startsWith(`${selector}\\`);
}

// Every payload path must sit within at least one granted resource selector,
// with no parent-traversal segments. A payload that declares paths against a
// grant with no resource selectors is denied (secure by default).
export function pathsWithinSelectors(paths, selectors) {
  if (paths == null) return true;
  if (!Array.isArray(paths)) return false;
  if (!Array.isArray(selectors) || selectors.length === 0) return false;
  return paths.every((path) => {
    if (isTraversalPath(path)) return false;
    return selectors.some((selector) => isPathWithin(path, selector));
  });
}

export function createGovernedAuthority({
  now = () => Date.now(),
  auditSink = null,
} = {}) {
  // handle -> granted record. The handle is the only key; it is never stored
  // inside the record and never leaves the bridge process.
  const grants = new Map();
  // delegationId -> DelegationRecord. Source of truth for chain lineage,
  // status, and temporal validity; grants reference it via scope.delegationId.
  const delegations = new Map();

  function emit(kind, fields) {
    if (typeof auditSink !== "function") return;
    auditSink({ kind, timestamp: new Date(now()).toISOString(), ...fields });
  }

  function mintGrant({
    grantId,
    scope,
    status = "active",
    internalToken = null,
  }) {
    if (typeof grantId !== "string" || grantId.length === 0) {
      throw new Error("mintGrant: grantId is required");
    }
    if (!scope || typeof scope !== "object") {
      throw new Error("mintGrant: scope is required");
    }
    if (typeof scope.taskId !== "string" || typeof scope.delegationId !== "string") {
      throw new Error("mintGrant: scope must carry taskId and delegationId");
    }
    const handle = randomBytes(24).toString("base64url");
    grants.set(handle, {
      grantId,
      scope,
      status,
      internalToken, // Phase 3.5 HMAC mint; never exposed, never logged
      mintedAt: now(),
      lastUsedAt: null,
      revokedAt: null,
      revokeReason: null,
    });
    emit("decision", {
      grantId,
      taskId: scope.taskId,
      delegationId: scope.delegationId,
      subjectPrincipalId: scope.subjectPrincipalId,
      action: scope.action,
      status,
    });
    return handle;
  }

  // Register a DelegationRecord (doc 07 / CONTRACTS). Grants are validated
  // against this registry at effect time, so records must be registered
  // before any grant bound to them is minted or exercised.
  function recordDelegation(record) {
    if (!record || typeof record !== "object" || typeof record.id !== "string" || record.id.length === 0) {
      throw new Error("recordDelegation: record.id is required");
    }
    if (typeof record.taskId !== "string") {
      throw new Error("recordDelegation: record.taskId is required");
    }
    delegations.set(record.id, record);
    return record;
  }

  function resolveGrant(handle) {
    return grants.get(handle) ?? null;
  }

  function revokeGrant(handle, reason = "revoked") {
    const grant = grants.get(handle);
    if (!grant) return null;
    grant.status = "revoked";
    grant.revokedAt = now();
    grant.revokeReason = reason;
    emit("cancel", {
      grantId: grant.grantId,
      taskId: grant.scope.taskId,
      delegationId: grant.scope.delegationId,
      reason,
      status: "revoked",
    });
    return grant;
  }

  function revokeTask(taskId, reason = "task-cancelled") {
    const revoked = [];
    for (const [handle, grant] of grants.entries()) {
      if (grant.scope.taskId !== taskId) continue;
      if (grant.status === "revoked" || grant.status === "expired") continue;
      grant.status = "revoked";
      grant.revokedAt = now();
      grant.revokeReason = reason;
      revoked.push(handle);
      emit("cancel", {
        grantId: grant.grantId,
        taskId,
        delegationId: grant.scope.delegationId,
        reason,
        status: "revoked",
      });
    }
    return revoked;
  }

  function revokeDescendants(handle, reason = "parent-revoked") {
    const root = grants.get(handle);
    if (!root) return [];
    const revoked = [];
    if (root.status !== "revoked" && root.status !== "expired") {
      root.status = "revoked";
      root.revokedAt = now();
      root.revokeReason = reason;
      revoked.push(handle);
      emit("cancel", {
        grantId: root.grantId,
        taskId: root.scope.taskId,
        delegationId: root.scope.delegationId,
        reason,
        status: "revoked",
      });
    }
    // BFS over principal lineage: any grant issued by a just-revoked subject
    // principal is a descendant and inherits the revocation.
    const queue = [root.scope.subjectPrincipalId];
    while (queue.length > 0) {
      const issuerId = queue.shift();
      for (const [childHandle, child] of grants.entries()) {
        if (child.status === "revoked" || child.status === "expired") continue;
        if (child.scope.issuerPrincipalId !== issuerId) continue;
        child.status = "revoked";
        child.revokedAt = now();
        child.revokeReason = reason;
        revoked.push(childHandle);
        emit("cancel", {
          grantId: child.grantId,
          taskId: child.scope.taskId,
          delegationId: child.scope.delegationId,
          reason,
          status: "revoked",
        });
        queue.push(child.scope.subjectPrincipalId);
      }
    }
    return revoked;
  }
  // Enumerate active grants for the Ground-0 snapshot (CP-8): the bridge must
  // be able to report the live executable authority before revoking it. The
  // handle is included so callers can reconcile; it is never emitted to audit.
  function listActiveGrants() {
    const active = [];
    for (const [handle, grant] of grants.entries()) {
      if (!ACTIVE_STATUSES.has(grant.status)) continue;
      active.push({
        handle,
        grantId: grant.grantId,
        taskId: grant.scope.taskId,
        delegationId: grant.scope.delegationId,
        subjectPrincipalId: grant.scope.subjectPrincipalId,
      });
    }
    return active;
  }

  // Revoke every active grant (Ground-0 entry). Returns the revoked grant ids
  // for the recovery audit; no pre-recovery executable authority survives.
  function revokeAll(reason = "ground-zero") {
    const revoked = [];
    for (const [handle, grant] of grants.entries()) {
      if (!ACTIVE_STATUSES.has(grant.status)) continue;
      grant.status = "revoked";
      grant.revokedAt = now();
      grant.revokeReason = reason;
      revoked.push(handle);
      emit("cancel", {
        grantId: grant.grantId,
        taskId: grant.scope.taskId,
        delegationId: grant.scope.delegationId,
        reason,
        status: "revoked",
      });
    }
    return revoked;
  }


  // Walk the full principal chain from the grant's delegationId up to the
  // root, verifying every edge is present, active, temporally valid, and
  // lineage-consistent. Returns a denial reason string, or null when valid.
  function validateDelegationChain(grant, t) {
    const scope = grant.scope;
    let delegationId = scope.delegationId;
    const seen = new Set();
    let lastIssuer = null;
    let leafChecked = false;
    while (delegationId != null) {
      if (seen.has(delegationId)) return "chain-cycle";
      seen.add(delegationId);
      const record = delegations.get(delegationId);
      if (!record) return "chain-missing-record";
      if (record.status !== "active") return `chain-status-${record.status}`;
      if (record.notBefore != null && t < Date.parse(record.notBefore)) return "chain-not-yet-valid";
      if (record.expiresAt != null && t > Date.parse(record.expiresAt)) return "chain-expired";
      if (!leafChecked) {
        if (record.subjectPrincipalId !== scope.subjectPrincipalId) return "chain-subject-mismatch";
        if (record.issuerPrincipalId !== scope.issuerPrincipalId) return "chain-issuer-mismatch";
        leafChecked = true;
      }
      if (lastIssuer != null && record.subjectPrincipalId !== lastIssuer) {
        return "chain-lineage-break";
      }
      lastIssuer = record.issuerPrincipalId;
      delegationId = record.parentDelegationId ?? null;
    }
    if (!leafChecked) return "chain-missing-record";
    return null;
  }

  function validateGovernedRequest(request) {
    const {
      taskId = null,
      delegationId = null,
      subjectPrincipalId = null,
      grantHandle = null,
      auditCorrelationId = null,
      payload = null,
    } = request ?? {};

    emit("request", {
      grantId: null, // unresolved yet; the handle is never emitted
      taskId,
      delegationId,
      subjectPrincipalId,
      auditCorrelationId,
      status: "received",
    });

    function deny(grant, reason) {
      emit("denial", {
        grantId: grant?.grantId ?? null,
        taskId,
        delegationId,
        subjectPrincipalId,
        auditCorrelationId,
        reason,
        status: "denied",
      });
      return { ok: false, reason, grant: null, grantId: grant?.grantId ?? null };
    }

    if (typeof grantHandle !== "string" || grantHandle.length === 0) {
      return deny(null, "missing-handle");
    }
    const grant = grants.get(grantHandle);
    if (!grant) return deny(null, "unknown-handle");
    if (!ACTIVE_STATUSES.has(grant.status)) return deny(grant, `status-${grant.status}`);
    const scope = grant.scope;
    const t = now();

    // Approval condition (doc 08): a grant that declares an approval
    // condition must be fully active, not merely approved-and-pending.
    if (scope.approvalCondition != null && grant.status !== "active") {
      return deny(grant, "approval-pending");
    }

    // Temporal validity (scope is bridge-minted, hence trusted).
    if (scope.notBefore != null && t < Date.parse(scope.notBefore)) {
      return deny(grant, "not-yet-valid");
    }
    if (scope.expiresAt != null && t > Date.parse(scope.expiresAt)) {
      return deny(grant, "expired");
    }
    if (
      scope.idleTimeoutMs != null &&
      grant.lastUsedAt != null &&
      t - grant.lastUsedAt > scope.idleTimeoutMs
    ) {
      return deny(grant, "idle-timeout");
    }

    // Correlation claims must match the resolved grant. A mismatch means the
    // client is asserting identity it does not hold (forged identity, sibling
    // grant reuse, or cross-task replay).
    if (scope.taskId !== taskId) return deny(grant, "task-mismatch");
    if (scope.delegationId !== delegationId) return deny(grant, "delegation-mismatch");
    if (scope.subjectPrincipalId !== subjectPrincipalId) return deny(grant, "subject-mismatch");

    // Full principal chain: every delegation edge up to the root must be
    // present, active, temporally valid, and lineage-consistent.
    const chainError = validateDelegationChain(grant, t);
    if (chainError) return deny(grant, chainError);

    // Scope widening + path escape (doc 08): the payload may declare a
    // narrower scope or concrete paths; neither may widen the grant.
    if (payload != null && typeof payload === "object") {
      if (payload.requestedScope != null && !isScopeSubset(payload.requestedScope, scope)) {
        return deny(grant, "scope-widening");
      }
      if (payload.paths != null && !pathsWithinSelectors(payload.paths, scope.resourceSelectors)) {
        return deny(grant, "path-escape");
      }
    }

    grant.lastUsedAt = t;
    emit("effect", {
      grantId: grant.grantId,
      taskId: scope.taskId,
      delegationId: scope.delegationId,
      subjectPrincipalId: scope.subjectPrincipalId,
      action: scope.action,
      auditCorrelationId,
      status: "allowed",
    });
    return { ok: true, reason: null, grant, grantId: grant.grantId };
  }

  return {
    mintGrant,
    recordDelegation,
    resolveGrant,
    revokeGrant,
    revokeTask,
    revokeDescendants,
    revokeAll,
    listActiveGrants,
    validateGovernedRequest,
  };
}
