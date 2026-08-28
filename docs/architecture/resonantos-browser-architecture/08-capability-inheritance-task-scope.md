# 08 — Capability Inheritance and Task-Scoped Authority

## Effective authority

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

A denied or absent term produces no authority. No nested child can widen any dimension.

## Scope dimensions

A grant SHOULD be structured rather than expressed only as a broad string:

- action/capability;
- resource selectors (roots, repository, endpoint, provider profile, browser tab, archive domain);
- permitted operations (read/write/execute/send/sign);
- task and delegation IDs;
- issuer and subject principals;
- time window and idle timeout;
- use/count/cost limits;
- network allowlist and data classification;
- approval conditions and revocation behavior.

## Temporal lifecycle

`requested → approved → active → completed | expired | revoked | degraded`

Task completion, cancellation, parent revocation, Ground-0 entry, or expiration MUST immediately prevent new effects. In-flight platform operations must follow declared revocation behavior: cancel, finish atomically, or quarantine the result.

## Capability tokens

If bearer tokens are used internally, they MUST be opaque, short-lived, audience-bound, task-bound, non-exportable to UI storage, and validated at the route closest to the effect. Prefer handles resolved by the bridge over self-contained tokens exposed to add-on code.

## Example

If Hermes has workspace read/write and shell permission for `/projects/A` until 14:00, its Git child asks for repository write, and the task allows only `/projects/A/src`, then the Git tool receives write authority only for `/projects/A/src` until 14:00. A request for network, another repository, or later execution must escalate.

## Required tests

- child subset succeeds;
- child superset is denied;
- sibling grants do not leak;
- expiration and parent cancellation cascade;
- route rejects mismatched task, audience, root, or principal;
- escalation adds only the approved delta;
- audit reconstructs the full chain.
