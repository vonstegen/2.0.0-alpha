// Intent citation: docs/architecture/ADR-054-principal-delegation-chain-task-scoped-authority.md
// Intent citation: docs/architecture/resonantos-browser-architecture/11-resource-governance.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
//
// CP-6 resource governor contracts. Telemetry alone cannot prevent runaway cost
// or starvation (doc 11): these types + pure predicates give admission, budget
// roll-up, and deterministic exhaustion a shared, testable home. The governor
// consumes the ADR-032 Compute Fabric; it does not duplicate node execution.

// Structured multi-dimensional usage accounting (doc 11 §Governed resources).
export interface ResourceUsage {
  cpuSeconds?: number;
  memoryBytes?: number;
  gpuSeconds?: number;
  diskBytes?: number;
  wallClockMs?: number;
  tokens?: number;
  spendMicroUsd?: number;
  requests?: number;
}

export interface ResourceBudget {
  priority: number;
  deadline: string;
  concurrencyClass: string;
  estimated: ResourceUsage;
  hardCeiling: ResourceUsage;
  requiredNodeRoles: string[];
  networkMode: string;
  workspaceMode: string;
  secretPolicy: string;
  onExhaustion: "stop" | "quarantine" | "return-partial";
}

export interface ResourceReservation {
  reservationId: string;
  taskId: string;
  resourceKind: string;
  amount: number;
  heldByPrincipalId: string;
  expiresAt: string;
}

export interface UsageReport {
  taskId: string;
  delegationId: string;
  harnessId: string;
  providerModel: string;
  estimated: ResourceUsage;
  actual: ResourceUsage;
  attributedPrincipalIds: string[];
}

export type LeaseKind = "workspace" | "browser" | "gpu" | "provider-route" | "external-account";

export interface ResourceLease {
  leaseId: string;
  resourceKind: LeaseKind;
  resourceId: string;
  holderPrincipalId: string;
  exclusive: boolean;
  expiresAt: string;
}

// ---- Governor primitives (doc 11 §Admission and scheduling) ----

export type UsageDimension =
  | "cpuSeconds"
  | "memoryBytes"
  | "gpuSeconds"
  | "diskBytes"
  | "wallClockMs"
  | "tokens"
  | "spendMicroUsd"
  | "requests";

export const USAGE_DIMENSIONS: readonly UsageDimension[] = [
  "cpuSeconds",
  "memoryBytes",
  "gpuSeconds",
  "diskBytes",
  "wallClockMs",
  "tokens",
  "spendMicroUsd",
  "requests",
];

export type GovernorDecision = "admit" | "queue" | "reject";

export interface BudgetRollup {
  parentTaskId: string;
  childTaskId: string;
  rolledUp: ResourceUsage;
  remaining: ResourceUsage;
  exhausted: boolean;
  exceededDimensions: UsageDimension[];
}

function usageValue(usage: ResourceUsage, dimension: UsageDimension): number {
  return usage[dimension] ?? 0;
}

/** Add two usage accounts per-dimension, omitting zero dimensions. */
export function addUsage(a: ResourceUsage, b: ResourceUsage): ResourceUsage {
  const result: ResourceUsage = {};
  for (const dimension of USAGE_DIMENSIONS) {
    const sum = usageValue(a, dimension) + usageValue(b, dimension);
    if (sum > 0) result[dimension] = sum;
  }
  return result;
}

/** Remaining headroom under a budget's hard ceiling (omits exhausted dimensions). */
export function remainingBudget(budget: ResourceBudget, usage: ResourceUsage): ResourceUsage {
  const result: ResourceUsage = {};
  for (const dimension of USAGE_DIMENSIONS) {
    const ceiling = budget.hardCeiling[dimension] ?? 0;
    const remaining = ceiling - usageValue(usage, dimension);
    if (remaining > 0) result[dimension] = remaining;
  }
  return result;
}

/** True when usage meets or exceeds any hard-ceiling dimension. */
export function isBudgetExhausted(budget: ResourceBudget, usage: ResourceUsage): boolean {
  return USAGE_DIMENSIONS.some((dimension) => {
    const ceiling = budget.hardCeiling[dimension];
    return ceiling != null && usageValue(usage, dimension) >= ceiling;
  });
}

// Roll a child's usage into a parent budget (doc 11 §Isolation and accounting).
// The child cannot exceed the parent's remaining capacity: any dimension that
// crosses the parent's hard ceiling is reported as exceeded.
export function rollUpChildUsage(
  parent: ResourceBudget,
  parentUsage: ResourceUsage,
  childUsage: ResourceUsage,
  ids: { parentTaskId: string; childTaskId: string },
): BudgetRollup {
  const rolledUp = addUsage(parentUsage, childUsage);
  const remaining = remainingBudget(parent, rolledUp);
  const exceededDimensions = USAGE_DIMENSIONS.filter((dimension) => {
    const ceiling = parent.hardCeiling[dimension];
    return ceiling != null && usageValue(rolledUp, dimension) > ceiling;
  });
  return {
    parentTaskId: ids.parentTaskId,
    childTaskId: ids.childTaskId,
    rolledUp,
    remaining,
    exhausted: exceededDimensions.length > 0,
    exceededDimensions,
  };
}

// Admission decision: reject when budget is exhausted, queue when at the
// concurrency limit, otherwise admit (doc 11 §Admission and scheduling).
export function admissionDecision(input: {
  running: number;
  limit: number;
  budget: ResourceBudget;
  usage: ResourceUsage;
}): GovernorDecision {
  if (isBudgetExhausted(input.budget, input.usage)) return "reject";
  if (input.running >= input.limit) return "queue";
  return "admit";
}

// ---- Leases (doc 11 §Admission and scheduling) ----
// Two leases conflict when they target the same resource within the same kind
// and at least one is exclusive. Shared leases of the same resource coexist.
export function leaseConflicts(a: ResourceLease, b: ResourceLease): boolean {
  if (a.resourceKind !== b.resourceKind) return false;
  if (a.resourceId !== b.resourceId) return false;
  return a.exclusive || b.exclusive;
}

export function leaseActive(lease: ResourceLease, at: string): boolean {
  return Date.parse(lease.expiresAt) > Date.parse(at);
}

// ---- Fair-share scheduling (doc 11 §Admission and scheduling) ----
// Each principal has an allocated share of capacity; `usedShare` is the
// proportion it is currently consuming. A positive deficit is under its share
// (schedule sooner); a negative deficit is over its share (defer).

export interface FairShareAccount {
  principalId: string;
  allocatedShare: number;
  usedShare: number;
}

export function fairShareDeficit(account: FairShareAccount): number {
  return account.allocatedShare - account.usedShare;
}

// Lower rank schedules sooner: the over-use ratio sorts under-share principals
// ahead of over-share ones. A zero allocation ranks last (unbounded).
export function fairShareRank(account: FairShareAccount): number {
  if (account.allocatedShare <= 0) return Number.POSITIVE_INFINITY;
  return account.usedShare / account.allocatedShare;
}

// ---- Governor events (doc 11 §Failure behavior) ----
// Budget exhaustion stops new work and yields a typed event; preemption and
// checkpoint are distinct outcomes the governor emits when supported.

export type GovernorEvent =
  | { kind: "admitted"; taskId: string; at: string }
  | { kind: "queued"; taskId: string; at: string }
  | { kind: "rejected"; taskId: string; at: string; reason: string }
  | { kind: "preempted"; taskId: string; at: string; reason: "priority" | "ground-zero" | "budget" }
  | { kind: "checkpointed"; taskId: string; at: string }
  | { kind: "budget-exhausted"; taskId: string; at: string; dimension: UsageDimension };

export function admissionEvent(
  decision: "admit",
  taskId: string,
  at: string,
  detail?: { reason?: string },
): Extract<GovernorEvent, { kind: "admitted" }>;
export function admissionEvent(
  decision: "queue",
  taskId: string,
  at: string,
  detail?: { reason?: string },
): Extract<GovernorEvent, { kind: "queued" }>;
export function admissionEvent(
  decision: "reject",
  taskId: string,
  at: string,
  detail?: { reason?: string },
): Extract<GovernorEvent, { kind: "rejected" }>;
export function admissionEvent(
  decision: GovernorDecision,
  taskId: string,
  at: string,
  detail: { reason?: string } = {},
): GovernorEvent {
  if (decision === "admit") return { kind: "admitted", taskId, at };
  if (decision === "queue") return { kind: "queued", taskId, at };
  return { kind: "rejected", taskId, at, reason: detail.reason ?? "budget-exhausted" };
}

// ---- Reserved capacity (doc 11 §Admission and scheduling) ----
// The interactive user and Ground-0 retain reserved capacity that optional
// work must not consume. Optional-work headroom is the remaining headroom
// minus the reserved amount; a fully-reserved dimension is omitted.

export type ReservedCapacityKind = "interactive-augmentor" | "ground-zero";

export interface ReservedCapacity {
  kind: ReservedCapacityKind;
  amount: ResourceUsage;
}

export function optionalWorkHeadroom(
  budget: ResourceBudget,
  usage: ResourceUsage,
  reserved: ResourceUsage,
): ResourceUsage {
  const free = remainingBudget(budget, usage);
  const headroom: ResourceUsage = {};
  for (const dimension of USAGE_DIMENSIONS) {
    const slack = (free[dimension] ?? 0) - (reserved[dimension] ?? 0);
    if (slack > 0) headroom[dimension] = slack;
  }
  return headroom;
}
