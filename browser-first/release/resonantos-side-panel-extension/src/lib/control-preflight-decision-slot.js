export function normalizeControlPreflightDecision(decision, { now = () => new Date().toISOString() } = {}) {
  if (!decision) return null;
  return {
    id: decision.id ?? "",
    goal: decision.goal ?? "",
    siteKey: decision.siteKey ?? "unknown-site",
    taskClass: decision.taskClass ?? "general",
    mode: decision.mode ?? "not-required",
    permissionMode: decision.permissionMode ?? "",
    decidedAt: decision.decidedAt ?? now(),
    source: decision.source ?? "control-preflight",
    reason: decision.reason ?? "",
  };
}

export function createControlPreflightDecisionSlot({ now = () => new Date().toISOString() } = {}) {
  let nextDecision = null;
  return {
    consume() {
      const decision = nextDecision;
      nextDecision = null;
      return decision;
    },
    get() {
      return nextDecision;
    },
    set(decision) {
      nextDecision = normalizeControlPreflightDecision(decision, { now });
      return nextDecision;
    },
  };
}
