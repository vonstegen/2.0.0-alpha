# ResonantOS Browser Architecture — Canonical Contracts Reference

Consolidated schema and route reference for the target architecture (docs 03–12).
All types are **experimental and versioned** until CP-9 declares a stable SDK;
during CP-1 they live in the `src/sdk/*/` modules named here. This file is the
authoritative sketch the [WORK_BREAKDOWN](WORK_BREAKDOWN.md) slices implement against.

## Identity

```ts
type PrincipalKind =
  | "user" | "core-service" | "orchestrator"
  | "harness" | "child-agent" | "tool" | "connector"
  | "script" | "hook" | "platform-service";

interface Principal {
  id: string;
  kind: PrincipalKind;
  displayName?: string;
}

interface DelegationRecord {
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
}

type DelegationChainRef = { delegationId: string; parent?: DelegationChainRef };
```

## Authority

```ts
interface ScopedCapability {
  action: string;                 // capability id
  resourceSelectors: string[];    // roots, repo, endpoint, provider profile, tab, archive domain
  operations: ("read" | "write" | "execute" | "send" | "sign")[];
  taskId: string;
  delegationId: string;
  issuerPrincipalId: string;
  subjectPrincipalId: string;
  notBefore: string;
  expiresAt: string;
  idleTimeoutMs?: number;
  limits?: { count?: number; costCeiling?: number };
  networkAllowlist?: string[];
  dataClassification?: string;
  approvalCondition?: string;
  revocationBehavior: "cancel" | "finish-atomic" | "quarantine";
}

interface AuthorityGrant {
  grantId: string;                // the host-resolved opaque handle, never a bearer token
  scope: ScopedCapability;
  status: "requested" | "approved" | "active" | "completed" | "expired" | "revoked" | "degraded";
}

type ApprovalDecision = {
  requestId: string;
  decision: "approve" | "deny" | "escalate";
  addedDelta?: ScopedCapability;  // escalation adds only the approved delta
  decidedBy: "user" | "policy";
  decidedAt: string;
};

// Effective authority (doc 08), computed, never stored:
//   manifest ceiling ∩ installation grants ∩ parent effective authority
//   ∩ task-requested scope ∩ user/org policy ∩ temporal validity ∩ resource/approval constraints
```

## Tasks

```ts
interface TaskPacket {
  taskId: string;
  issuerPrincipalId: string;
  executorPrincipalId: string;
  delegationChainRef: DelegationChainRef;
  intent: string;
  successCriteria: string[];
  nonGoals: string[];
  outputContract: unknown;
  contextRefs: ContextEnvelope;         // bounded, never raw credentials/full memory
  requestedCapabilities: ScopedCapability[];
  resourceBudget: ResourceBudget;
  workspaceRoots: string[];
  approvalPolicy: string;
  deadline: string;
  expiresAt: string;
  cancellationChannel: string;
  auditCorrelationId: string;
}

type TaskStatus = "requested" | "approved" | "active" | "completed" | "expired" | "revoked" | "degraded";

interface HarnessResult {
  status: TaskStatus;
  summary: string;
  artifacts: ArtifactRef[];
  evidence: unknown[];                 // untrusted until verified
  actionsTaken: string[];
  verification: unknown;
  residualRisks: string[];
  costUsage: unknown;
  approvalRequests: unknown[];
  childActorAuditRefs: string[];
}

type ArtifactRef = { artifactId: string; root: string; sensitivity: string; provenance: unknown };
```

## Harness provider

```ts
interface HarnessProviderManifest {
  extensionClass: "harness-provider";
  adapterProtocol: string;
  taskContract: unknown;
  eventContract: unknown;
  resultContract: unknown;
  childActorPolicy: unknown;
  contextPolicy: unknown;
  resourceHints: unknown;
  cancellationSemantics: "cancel" | "finish-atomic" | "quarantine";
  sandboxStrength: "host-mediated" | "sandboxed-outer-boundary";
}

interface HarnessProviderAdapter {
  diagnose(): Promise<HarnessHealth>;
  startTask(packet: TaskPacket, grant: GrantHandle): Promise<HarnessRun>;
  getTask(runId: string): Promise<HarnessRunState>;
  events(runId: string, cursor?: string): AsyncIterable<TaskEvent>;
  cancelTask(runId: string, reason: string): Promise<void>;
  collectArtifacts(runId: string): Promise<ArtifactRef[]>;
}
```

## Continuity, resources, recovery

```ts
interface ContextEnvelope {
  facts: unknown[];                    // selected facts with source refs
  provenance: unknown[];
  sensitivity: string;
  freshness: string;
  allowedPurpose: string;
  retentionPolicy: string;
  redactions: unknown[];
}

interface ContinuityGatekeeperDecision {
  effectiveContext: unknown[];         // requested ∩ permissions ∩ scope ∩ policy ∩ trust
  redactions: unknown[];
  deniedRefs: string[];
}

type TrustDomain = "user-identity" | "augmentor-identity" | "trusted-continuity"
  | "augmentor-core-skills" | "user-defined-skills" | "delegation-history" | "recovery-checkpoints";

interface ResourceBudget {
  priority: number;
  deadline: string;
  concurrencyClass: string;
  estimated: unknown;
  hardCeiling: unknown;
  requiredNodeRoles: string[];
  networkMode: string;
  workspaceMode: string;
  secretPolicy: string;
  onExhaustion: "stop" | "quarantine" | "return-partial";
}

type GroundZeroState = "normal" | "entering" | "ground-zero" | "re-enabling" | "exited";
type QuarantineRecord = { item: string; kind: string; quarantinedAt: string; disposition?: "accepted" | "replaced" | "left-disabled" };
```

## Governed request envelope

```ts
type GovernedRequest<T> = {
  taskId: string;
  delegationId: string;
  subjectPrincipalId: string;
  grantHandle: string;                 // opaque; bridge resolves it
  auditCorrelationId: string;
  payload: T;
};
```

The bridge resolves `grantHandle`, validates chain/scope/time/audience, applies
route-specific validation, performs the effect, and emits an audit event.
**Client-supplied identity fields are correlation claims, not authority** (doc 12).

## Extension classes

```ts
type ExtensionClass = "augmentor-extension" | "harness-provider" | "system-addon";
```

Existing manifests without `extensionClass` default to `system-addon` or are mapped
by the CP-0 migration rules (doc 12). `public/addons/hermes.json`, `opencode.json`,
`openclaw.json` currently carry **no** `extensionClass` — CP-5 adds `harness-provider`.

## Versioning rules

- Add fields as optional during migration; validate strict combinations once
  `extensionClass` is present.
- Version task, event, authority, and adapter protocols independently.
- Define capability aliases/deprecations; reject ambiguous broadening.
- No public stable SDK until Hermes, OpenCode, and one structurally different
  provider pass the conformance suite (doc 12).
