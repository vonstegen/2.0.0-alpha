# ADR-054: Principal/Delegation Chain And Task-Scoped Temporal Authority

## Decision Metadata

- Decision status: Accepted
- Alpha applicability: Deferred
- Superseded by: None
- Owner: Core architecture
- Decision date: 2026-08-27

## Decision

Every governed action is attributable through a complete principal chain:

```text
user principal → Augmentor (orchestrator) principal → harness principal → child agent/tool principal
```

Direct user-to-harness execution is allowed but produces its own explicit chain; it
does not pretend Augmentor participated.

### Principal types

| Kind | Meaning |
| --- | --- |
| `user` | human authority and approval source |
| `core-service` | policy/recovery service identity |
| `orchestrator` | Augmentor (permanent system orchestrator) |
| `harness` | installed runtime provider |
| `child-agent`, `tool`, `connector`, `script`, `hook` | subordinate actors |
| `platform-service` | effect executor, never the requesting user |

### Delegation record

A delegation is an integrity-protected Core record (`DelegationRecord` in
[CONTRACTS.md](resonantos-browser-architecture/CONTRACTS.md)) carrying: id, taskId,
parentDelegationId, issuer and subject principal ids, requested capabilities, the
effective grant id, purpose, issuedAt/notBefore/expiresAt, status, and an audit
correlation id.

### Authority rules

- Identity is not authority: a recognized harness still needs an active grant.
- Delegation does not copy credentials: the platform service uses vault-held credentials only after policy approval.
- Every child edge preserves parent lineage; revoking or expiring a parent invalidates all descendants.
- An approval attaches to an exact request, scope, actor, purpose, and time window.
- Restart/recovery does not silently reissue expired runtime authority.
- Audit events record both the requester chain and the platform service that performed the effect.

### Effective authority

For every action, Core computes:

```text
effective authority =
  manifest ceiling
  ∩ installation grants
  ∩ parent effective authority
  ∩ task-requested scope
  ∩ user/organization policy
  ∩ temporal validity
  ∩ resource and approval constraints
```

A denied or absent term produces no authority; no nested child widens any dimension.

### Scope dimensions

A grant is structured, not a broad string: action/capability; resource selectors;
permitted operations (`read`/`write`/`execute`/`send`/`sign`); task and delegation
ids; issuer and subject principals; time window and idle timeout; use/count/cost
limits; network allowlist and data classification; approval conditions and
revocation behavior.

### Temporal lifecycle

```text
requested → approved → active → completed | expired | revoked | degraded
```

Task completion, cancellation, parent revocation, Ground-0 entry, or expiration
immediately prevents new effects. In-flight platform operations follow the declared
revocation behavior: cancel, finish atomically, or quarantine the result.

### Capability tokens

Bearer tokens, if used, are opaque, short-lived, audience-bound, task-bound,
non-exportable to UI storage, and validated at the route closest to the effect.
Prefer handles resolved by the bridge over self-contained tokens exposed to add-on
code.

### Governed request envelope

Every privileged request carries an authenticated envelope (`GovernedRequest<T>` in
[CONTRACTS.md](resonantos-browser-architecture/CONTRACTS.md)): taskId, delegationId,
subjectPrincipalId, an opaque bridge-resolved grantHandle, auditCorrelationId, and
payload. Client-supplied identity fields are correlation claims, not authority.

## Amends

| Amended | Change |
| --- | --- |
| ADR-038 (Add-on Runtime Identity) | extend the `id@publisher` runtime identity into the full principal/delegation chain |
| ADR-042 (Add-on Trust-Tier Transitions) | trust tier becomes one term of effective authority, not the whole grant |

## Why

The current `CapabilityGrant` is a broad string-scoped grant with no principal
chain, no temporal task binding, and no cascade revocation (doc 12). Multi-harness
execution cannot be safely admitted without structured, task-scoped, temporally
bounded authority. This ADR defines that model before bridge enforcement (CP-2) and
before SDK stabilization (CP-9).

## Rules

- Every governed effect crosses a route that validates the full principal chain, grant handle, scope, time, and audience.
- A child's effective authority can never exceed its parent's or its task's.
- Capability tokens and grant handles never enter browser persistence, artifacts, or logs.
- The existing caller-attributed HMAC token layer (Phase 3.5) is retained as the internal mint behind the grant handle, not replaced.

## Related

- [ADR-053: Browser-First Multi-Harness Architecture And Terminology](ADR-053-browser-first-multi-harness-architecture.md)
- [07 — Identity, delegation, and authority](resonantos-browser-architecture/07-identity-delegation-authority.md)
- [08 — Capability inheritance and task scope](resonantos-browser-architecture/08-capability-inheritance-task-scope.md)
- [Contracts reference](resonantos-browser-architecture/CONTRACTS.md)
