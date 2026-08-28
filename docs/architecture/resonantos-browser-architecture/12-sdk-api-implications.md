# 12 — SDK and API Implications

## Packaging direction

Keep `src/sdk/addons` compatible while adding focused modules rather than one oversized manifest:

```text
src/sdk/
  addons/          existing manifest/lifecycle contracts
  identity/        principals and delegation lineage
  authority/       structured scopes, grants, approvals, tokens
  tasks/           packets, status, events, results, artifacts
  augmentor/       extension contracts
  harnesses/       provider adapter and child namespaces
  resources/       budgets, leases, usage
  continuity/      context envelopes and snapshot metadata
  recovery/        Ground-0 state and transitions
```

## Additive type changes

Introduce, initially as experimental versioned types:

- `Principal`, `PrincipalKind`, `DelegationRecord`, `DelegationChainRef`;
- `ScopedCapability`, `AuthorityGrant`, `AuthorityRequest`, `ApprovalDecision`;
- `TaskPacket`, `TaskStatus`, `TaskEvent`, `HarnessResult`, `ArtifactRef`;
- `AugmentorExtensionManifest` and `HarnessProviderManifest`;
- `HarnessProviderAdapter` and `HarnessChildDescriptor`;
- `ContextEnvelope`, `ContinuitySnapshotRef`;
- `ResourceBudget`, `ResourceReservation`, `UsageReport`, `ResourceLease`;
- `GroundZeroState`, `GroundZeroTransition`, `QuarantineRecord`.

The existing `CapabilityGrant` can remain as a UI/backward-compatible view while Core stores richer grants.

## Manifest evolution

Add a discriminated `extensionClass`: `augmentor-extension | harness-provider | system-addon`. Existing manifests default to `system-addon` or are mapped by reviewed migration rules. Harness manifests add adapter protocol, task/event/result contracts, child-actor policy, context policy, resource hints, cancellation semantics, and sandbox strength.

## Host route envelope

Every privileged request SHOULD carry an authenticated envelope:

```ts
type GovernedRequest<T> = {
  taskId: string;
  delegationId: string;
  subjectPrincipalId: string;
  grantHandle: string;
  auditCorrelationId: string;
  payload: T;
};
```

The bridge resolves the handle, validates chain/scope/time/audience, applies route-specific validation, performs the effect, and emits an audit event. Client-supplied identity fields are correlation claims, not authority.

## Provider adapter sketch

```ts
interface HarnessProviderAdapter {
  diagnose(): Promise<HarnessHealth>;
  startTask(packet: TaskPacket, grant: GrantHandle): Promise<HarnessRun>;
  getTask(runId: string): Promise<HarnessRunState>;
  events(runId: string, cursor?: string): AsyncIterable<TaskEvent>;
  cancelTask(runId: string, reason: string): Promise<void>;
  collectArtifacts(runId: string): Promise<ArtifactRef[]>;
}
```

## Versioning

- Add new fields as optional during migration and validate strict combinations when `extensionClass` is present.
- Version task, event, authority, and adapter protocols independently.
- Define capability aliases/deprecations and reject ambiguous broadening.
- Do not declare a public stable SDK until at least Hermes, OpenCode, and one structurally different provider pass conformance tests.

## Conformance suite

Provide reusable tests for manifest validity, subset inheritance, route enforcement, cancellation, expiration, event durability, artifact-root confinement, memory intake, budget roll-up, provider failure, and Ground-0 quarantine.
