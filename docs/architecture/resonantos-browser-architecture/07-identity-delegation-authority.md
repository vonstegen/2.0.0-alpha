# 07 — Identity, Delegation, and Authority

## Principal chain

Every governed action MUST be attributable through a complete chain:

```text
user principal -> Augmentor principal -> harness principal -> child agent/tool principal
```

Direct user-to-harness execution is allowed, but it produces its own explicit chain rather than pretending Augmentor participated.

## Principal types

- `user`: human authority and approval source;
- `core-service`: policy/recovery service identity;
- `orchestrator`: Augmentor or another selected primary agent;
- `harness`: installed runtime provider;
- `child-agent`, `tool`, `connector`, `script`, `hook`: subordinate actors;
- `platform-service`: effect executor, never the requesting user.

## Delegation record

A delegation is a signed or integrity-protected Core record containing:

```ts
type DelegationRecord = {
  id: string;
  taskId: string;
  parentDelegationId?: string;
  issuerPrincipalId: string;
  subjectPrincipalId: string;
  requestedCapabilities: ScopedCapability[];
  effectiveGrantId: string;
  purpose: string;
  issuedAt: string;
  notBefore: string;
  expiresAt: string;
  status: "pending" | "active" | "revoked" | "expired" | "completed";
  auditCorrelationId: string;
};
```

## Authority rules

- Identity is not authority; a recognized harness still needs an active grant.
- Delegation does not copy credentials. The platform service uses vault-held credentials only after policy approval.
- Every child edge must preserve parent lineage.
- Revoking or expiring a parent invalidates all descendants.
- An approval attaches to an exact request, scope, actor, purpose, and time window.
- Restart/recovery MUST NOT silently reissue expired runtime authority.
- Audit events record both the requester chain and the platform service that performed the effect.

## Escalation

A child that lacks authority emits a structured request with reason, requested delta, risk class, expected duration, and alternatives. Core evaluates policy; Augmentor may explain or recommend; the user or pre-existing policy approves when required. Approval creates a new child grant linked to the original delegation.
