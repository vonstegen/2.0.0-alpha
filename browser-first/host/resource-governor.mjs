// Intent citation: docs/architecture/resonantos-browser-architecture/11-resource-governance.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
//
// CP-6 resource governor mirror. The plan: a process-local mirror of the SDK
// `src/sdk/resources/index.ts` primitives so the bridge (which is dependency-free
// of `src/`) can compose the same admission, roll-up, and exhaustion decisions.
// The bridge never duplicates node execution; the governor consumes the
// ADR-032 compute fabric and only decides whether a run gets in.

const USAGE_DIMENSIONS = Object.freeze([
  "cpuSeconds",
  "memoryBytes",
  "gpuSeconds",
  "diskBytes",
  "wallClockMs",
  "tokens",
  "spendMicroUsd",
  "requests",
]);

const DEFAULT_CONCURRENT_LIMIT = 1;

// A zero-budget fill: admission decisions need a budget to ask "is this
// exhausted?" against. The bridge passes a real ResourceBudget whenever the
// TaskPacket carries one; this is only the zero baseline.
const ZERO_BUDGET = Object.freeze({
  priority: 0,
  deadline: "",
  concurrencyClass: "shared",
  estimated: {},
  hardCeiling: {},
  requiredNodeRoles: [],
  networkMode: "none",
  workspaceMode: "isolated",
  secretPolicy: "none",
  onExhaustion: "stop",
});

function usageValue(usage, dimension) {
  return usage?.[dimension] ?? 0;
}

function addUsage(a = {}, b = {}) {
  const result = {};
  for (const dimension of USAGE_DIMENSIONS) {
    const sum = usageValue(a, dimension) + usageValue(b, dimension);
    if (sum > 0) result[dimension] = sum;
  }
  return result;
}

function remainingBudget(budget, usage) {
  const result = {};
  for (const dimension of USAGE_DIMENSIONS) {
    const ceiling = budget?.hardCeiling?.[dimension] ?? 0;
    const remaining = ceiling - usageValue(usage, dimension);
    if (remaining > 0) result[dimension] = remaining;
  }
  return result;
}

function isBudgetExhausted(budget, usage) {
  return USAGE_DIMENSIONS.some((dimension) => {
    const ceiling = budget?.hardCeiling?.[dimension];
    return ceiling != null && usageValue(usage, dimension) >= ceiling;
  });
}

function rollUpChildUsage(parent, parentUsage, childUsage, ids) {
  const rolledUp = addUsage(parentUsage, childUsage);
  const remaining = remainingBudget(parent, rolledUp);
  const exceededDimensions = USAGE_DIMENSIONS.filter((dimension) => {
    const ceiling = parent?.hardCeiling?.[dimension];
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

function admissionDecision(input) {
  if (isBudgetExhausted(input.budget, input.usage)) return "reject";
  if (input.running >= input.limit) return "queue";
  return "admit";
}

function admissionEvent(decision, taskId, at, detail = {}) {
  if (decision === "admit") return { kind: "admitted", taskId, at };
  if (decision === "queue") return { kind: "queued", taskId, at };
  return {
    kind: "rejected",
    taskId,
    at,
    reason: detail.reason ?? "budget-exhausted",
  };
}

function leaseConflicts(a, b) {
  if (a.resourceKind !== b.resourceKind) return false;
  if (a.resourceId !== b.resourceId) return false;
  return a.exclusive || b.exclusive;
}

function leaseActive(lease, at) {
  return Date.parse(lease.expiresAt) > Date.parse(at);
}

function fairShareDeficit(account) {
  return account.allocatedShare - account.usedShare;
}

function fairShareRank(account) {
  if (account.allocatedShare <= 0) return Number.POSITIVE_INFINITY;
  return account.usedShare / account.allocatedShare;
}

function optionalWorkHeadroom(budget, usage, reserved) {
  const free = remainingBudget(budget, usage);
  const headroom = {};
  for (const dimension of USAGE_DIMENSIONS) {
    const slack = (free[dimension] ?? 0) - (reserved?.[dimension] ?? 0);
    if (slack > 0) headroom[dimension] = slack;
  }
  return headroom;
}

/**
 * Build a resource governor wired to the bridge's audit sink. The governor
 * is the single point of admission for `startTask` and the roll-up target
 * for every completed harness run.
 *
 * `governedAuthority` is the CP-2 envelope object. It is currently unused —
 * the bridge audit sink already pairs GovernorEvents with the existing
 * decision/denial rows — but it carries the optional seam for future
 * authority-aware admission that lives inside CP-2.
 */
export function makeResourceGovernor({
  governedAuthority = null,
  auditSink = null,
  now = () => Date.now(),
} = {}) {
  if (governedAuthority != null && typeof governedAuthority !== "object") {
    throw new Error("makeResourceGovernor: governedAuthority must be an object or null");
  }

  // taskId -> per-task governor bookkeeping. The harness adapter owns the
  // runId; the governor keys on taskId so child turn usage rolls up into the
  // parent task budget.
  const tasks = new Map();
  // leaseId -> ResourceLease (uniform across the 5 LeaseKinds).
  const leases = new Map();
  // principalId -> FairShareAccount.
  const fairShares = new Map();

  function emit(event) {
    if (typeof auditSink === "function") {
      auditSink({ kind: event.kind, ...event });
    }
  }

  function getOrInitTask(taskId, defaults = {}) {
    let entry = tasks.get(taskId);
    if (!entry) {
      entry = {
        taskId,
        principalId: defaults.principalId ?? null,
        budget: defaults.budget ?? null,
        usage: {},
        concurrentLimit: defaults.concurrentLimit ?? DEFAULT_CONCURRENT_LIMIT,
        running: 0,
      };
      tasks.set(taskId, entry);
    }
    if (defaults.budget) entry.budget = defaults.budget;
    if (defaults.concurrentLimit != null) entry.concurrentLimit = defaults.concurrentLimit;
    return entry;
  }

  function ensureFairShare(principalId, allocatedShare = 1) {
    let account = fairShares.get(principalId);
    if (!account) {
      account = { principalId, allocatedShare, usedShare: 0 };
      fairShares.set(principalId, account);
    }
    return account;
  }

  function runningForPrincipal(principalId, currentTaskId) {
    let count = 0;
    for (const entry of tasks.values()) {
      if (entry.taskId === currentTaskId) continue;
      if (principalId && entry.principalId !== principalId) continue;
      count += entry.running;
    }
    return count;
  }

  /**
   * Decide whether `taskId` may start against the requested budget. The
   * decision is deterministic and emits a `GovernorEvent` so the bridge
   * audit ledger pairs it with the existing decision/denial rows.
   */
  function admit({ taskId, principalId, budget = null, concurrentLimit = null }) {
    const entry = getOrInitTask(taskId, { principalId, budget, concurrentLimit });
    if (budget) entry.budget = budget;
    if (concurrentLimit != null) entry.concurrentLimit = concurrentLimit;
    const running = runningForPrincipal(principalId, taskId) + entry.running;
    const limit = entry.concurrentLimit;
    const decision = admissionDecision({
      running,
      limit,
      budget: entry.budget ?? ZERO_BUDGET,
      usage: entry.usage,
    });
    const at = new Date(now()).toISOString();
    const event = admissionEvent(decision, taskId, at, {
      reason: decision === "reject" ? "budget-exhausted" : undefined,
    });
    emit(event);
    if (decision === "admit") {
      entry.running += 1;
      if (principalId) {
        const fs = ensureFairShare(principalId);
        fs.usedShare += 1;
      }
    }
    return { decision: event.kind, event, running, limit, task: inspectTask(taskId) };
  }

  /**
   * Cancel an admitted run. Drops the per-principal running count and
   * releases every active lease held by the task.
   */
  function revoke(taskId, reason = "task-cancelled") {
    const entry = tasks.get(taskId);
    if (!entry) return { released: [] };
    entry.running = Math.max(0, entry.running - 1);
    if (entry.principalId) {
      const fs = fairShares.get(entry.principalId);
      if (fs && fs.usedShare > 0) fs.usedShare -= 1;
    }
    const released = [];
    for (const lease of listLeases({ taskId })) {
      leases.delete(lease.leaseId);
      released.push(lease.leaseId);
    }
    const evictionReason = reason === "ground-zero" ? "ground-zero" : "priority";
    emit({
      kind: "preempted",
      taskId,
      at: new Date(now()).toISOString(),
      reason: evictionReason,
    });
    return { released };
  }

  /**
   * Record a child's actual usage against its parent's budget. Called at
   * the end of every harness run (mirror of `rollUpChildUsage`). Emits a
   * `budget-exhausted` event when the parent crosses a hard ceiling.
   */
  function rollUp({ parentTaskId, childTaskId, childUsage }) {
    const parent = tasks.get(parentTaskId);
    if (!parent || !parent.budget) return null;
    const rollup = rollUpChildUsage(parent.budget, parent.usage, childUsage, {
      parentTaskId,
      childTaskId,
    });
    parent.usage = rollup.rolledUp;
    parent.running = Math.max(0, parent.running - 1);
    if (rollup.exhausted) {
      const dimension = rollup.exceededDimensions[0];
      emit({
        kind: "budget-exhausted",
        taskId: parentTaskId,
        at: new Date(now()).toISOString(),
        dimension,
      });
    }
    return rollup;
  }

  function childUsed({ parentTaskId, childTaskId, usage }) {
    return rollUp({ parentTaskId, childTaskId, childUsage: usage });
  }

  function acquireLease(lease) {
    for (const held of leases.values()) {
      if (leaseConflicts(lease, held)) {
        return { ok: false, leaseId: lease.leaseId, conflictingWith: held.leaseId };
      }
    }
    leases.set(lease.leaseId, { ...lease });
    if (lease.taskId) {
      const entry = getOrInitTask(lease.taskId);
      if (!Array.isArray(entry.leases)) entry.leases = [];
      entry.leases.push({ ...lease });
    }
    return { ok: true, leaseId: lease.leaseId };
  }

  function releaseLease(leaseId) {
    const lease = leases.get(leaseId);
    if (!lease) return false;
    leases.delete(leaseId);
    for (const entry of tasks.values()) {
      if (Array.isArray(entry.leases)) {
        entry.leases = entry.leases.filter((l) => l.leaseId !== leaseId);
      }
    }
    return true;
  }

  function listLeases(filter = {}) {
    const result = [];
    for (const lease of leases.values()) {
      if (filter.kind && lease.resourceKind !== filter.kind) continue;
      if (filter.taskId && lease.taskId !== filter.taskId) continue;
      result.push({ ...lease });
    }
    return result;
  }

  function inspectTask(taskId) {
    const entry = tasks.get(taskId);
    if (!entry) return null;
    return {
      taskId: entry.taskId,
      principalId: entry.principalId,
      budget: entry.budget,
      usage: entry.usage,
      remaining: entry.budget ? remainingBudget(entry.budget, entry.usage) : {},
      running: entry.running,
      concurrentLimit: entry.concurrentLimit,
      exhausted: entry.budget ? isBudgetExhausted(entry.budget, entry.usage) : false,
      leases: Array.isArray(entry.leases) ? entry.leases.map((l) => l.leaseId) : [],
    };
  }

  function snapshotFairShares() {
    return Array.from(fairShares.values()).map((account) => ({
      ...account,
      deficit: fairShareDeficit(account),
      rank: fairShareRank(account),
    }));
  }

  return {
    admit,
    revoke,
    childUsed,
    rollUp,
    acquireLease,
    releaseLease,
    listLeases,
    inspectTask,
    snapshotFairShares,
  };
}

export {
  USAGE_DIMENSIONS,
  addUsage,
  remainingBudget,
  isBudgetExhausted,
  rollUpChildUsage,
  admissionDecision,
  admissionEvent,
  leaseConflicts,
  leaseActive,
  fairShareDeficit,
  fairShareRank,
  optionalWorkHeadroom,
  ZERO_BUDGET,
  DEFAULT_CONCURRENT_LIMIT,
};
