// Intent citation: docs/architecture/resonantos-browser-architecture/11-resource-governance.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
//
// CP-6 Strategist UI: read-only resource-governor panel. Pure selectors over
// the SDK ResourceBudget, ResourceReservation, FairShareAccount, and
// ResourceLease shapes. The panel exposes executor / budget / usage / status
// fields read straight from the governor, plus a single mutation channel:
// "Stop" — which composes cancelTask (active run) + revoke (reservation) +
// release (lease) into one deferred path the host module can wire to the
// run-state machine.

import type {
  FairShareAccount,
  ResourceBudget,
  ResourceLease,
  ResourceReservation,
  ResourceUsage,
} from "../../sdk/resources";

export interface ExecutorRow {
  taskId: string;
  principalId: string;
  providerId: string;
  status: "running" | "queued" | "rejected" | "completed" | "failed" | "cancelled";
}

export interface BudgetRow {
  taskId: string;
  estimated: ResourceUsage;
  hardCeiling: ResourceUsage;
  remaining: ResourceUsage;
  exhausted: boolean;
}

export interface UsageRow {
  taskId: string;
  cpuSeconds: number;
  memoryBytes: number;
  gpuSeconds: number;
  diskBytes: number;
  wallClockMs: number;
  tokens: number;
  spendMicroUsd: number;
  requests: number;
}

export interface StatusRow {
  taskId: string;
  decision: "admit" | "queue" | "reject" | "n/a";
  reason?: string;
  at: string;
}

export interface FairShareRow {
  principalId: string;
  allocatedShare: number;
  usedShare: number;
  deficit: number;
  rank: number;
}

export interface LeaseRow {
  leaseId: string;
  resourceKind: ResourceLease["resourceKind"];
  resourceId: string;
  exclusive: boolean;
  expiresAt: string;
  taskId: string | null;
}

export interface ResourceGovernorPanelState {
  executors: ExecutorRow[];
  budgets: BudgetRow[];
  usage: UsageRow[];
  status: StatusRow[];
  fairShares: FairShareRow[];
  leases: LeaseRow[];
}

const ZERO_USAGE: ResourceUsage = Object.freeze({
  cpuSeconds: 0,
  memoryBytes: 0,
  gpuSeconds: 0,
  diskBytes: 0,
  wallClockMs: 0,
  tokens: 0,
  spendMicroUsd: 0,
  requests: 0,
});

function remainingBudget(budget: ResourceBudget, usage: ResourceUsage): ResourceUsage {
  const result: ResourceUsage = {};
  for (const dimension of Object.keys(budget.hardCeiling ?? {}) as Array<keyof ResourceUsage>) {
    const ceiling = budget.hardCeiling?.[dimension] ?? 0;
    const used = usage[dimension] ?? 0;
    const slack = ceiling - used;
    if (slack > 0) (result as Record<string, number>)[dimension as string] = slack;
  }
  return result;
}

/** Project the live governor snapshot into the panel's row shape. */
export function buildResourceGovernorPanel(input: {
  budgets: Array<{ taskId: string; budget: ResourceBudget; usage: ResourceUsage }>;
  reservations: ResourceReservation[];
  fairShares: FairShareAccount[];
  leases: ResourceLease[];
  status: Array<{ taskId: string; decision: StatusRow["decision"]; reason?: string; at: string }>;
  executors: ExecutorRow[];
}): ResourceGovernorPanelState {
  const budgets: BudgetRow[] = input.budgets.map(({ taskId, budget, usage }) => ({
    taskId,
    estimated: { ...ZERO_USAGE, ...(budget.estimated ?? {}) },
    hardCeiling: { ...ZERO_USAGE, ...(budget.hardCeiling ?? {}) },
    remaining: remainingBudget(budget, usage),
    exhausted: Object.entries(budget.hardCeiling ?? {}).some(
      ([dim, ceiling]) => ceiling != null && (usage[dim as keyof ResourceUsage] ?? 0) >= (ceiling as number),
    ),
  }));

  const usage: UsageRow[] = input.budgets.map(({ taskId, usage: u }) => ({
    taskId,
    cpuSeconds: u.cpuSeconds ?? 0,
    memoryBytes: u.memoryBytes ?? 0,
    gpuSeconds: u.gpuSeconds ?? 0,
    diskBytes: u.diskBytes ?? 0,
    wallClockMs: u.wallClockMs ?? 0,
    tokens: u.tokens ?? 0,
    spendMicroUsd: u.spendMicroUsd ?? 0,
    requests: u.requests ?? 0,
  }));

  const status: StatusRow[] = input.status;
  const fairShares: FairShareRow[] = input.fairShares
    .map((account) => ({
      principalId: account.principalId,
      allocatedShare: account.allocatedShare,
      usedShare: account.usedShare,
      deficit: account.allocatedShare - account.usedShare,
      rank: account.allocatedShare <= 0 ? Number.POSITIVE_INFINITY : account.usedShare / account.allocatedShare,
    }))
    .sort((a, b) => a.rank - b.rank);

  const leases: LeaseRow[] = input.leases.map((lease) => ({
    leaseId: lease.leaseId,
    resourceKind: lease.resourceKind,
    resourceId: lease.resourceId,
    exclusive: lease.exclusive,
    expiresAt: lease.expiresAt,
    taskId: (lease as ResourceLease & { taskId?: string | null }).taskId ?? null,
  }));

  return {
    executors: input.executors,
    budgets,
    usage,
    status,
    fairShares,
    leases,
  };
}

export interface StopPlan {
  /** Distinct executor rows the Stop mutation must cancel. */
  cancelTaskIds: string[];
  /** Distinct reservation ids the Stop mutation must revoke. */
  revokeReservationIds: string[];
  /** Distinct lease ids the Stop mutation must release. */
  releaseLeaseIds: string[];
}

/**
 * Compute the deterministic Stop mutation plan. Given the current
 * governance snapshot, return the minimal set of ids the host must hand
 * to `cancelTask` (active runs) + `governor.revoke` (reservations) +
 * `leaseRegistry.release` (active leases).
 */
export function planStopMutation(input: {
  panelState: ResourceGovernorPanelState;
  reservationIdsByTask: Record<string, string[]>;
  leaseIdsByTask: Record<string, string[]>;
}): StopPlan {
  const cancelTaskIds: string[] = [];
  const revokeReservationIds: string[] = [];
  const releaseLeaseIds: string[] = [];
  for (const row of input.panelState.executors) {
    if (row.status !== "running") continue;
    cancelTaskIds.push(row.taskId);
    for (const id of input.reservationIdsByTask[row.taskId] ?? []) revokeReservationIds.push(id);
    for (const id of input.leaseIdsByTask[row.taskId] ?? []) releaseLeaseIds.push(id);
  }
  return {
    cancelTaskIds: [...new Set(cancelTaskIds)],
    revokeReservationIds: [...new Set(revokeReservationIds)],
    releaseLeaseIds: [...new Set(releaseLeaseIds)],
  };
}
