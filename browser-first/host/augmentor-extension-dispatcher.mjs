// Intent citation: docs/architecture/resonantos-browser-architecture/04-augmentor-extension-model.md
// Intent citation: docs/architecture/ADR-054-principal-delegation-chain-task-scoped-authority.md
//
// CP-3 governed extension dispatch. An Augmentor extension runs *inside*
// Augmentor's loop (doc 04) as a host-mediated tool call — unlike a harness
// provider (CP-4) it brings no own runtime. This module is the bridge-side
// effect boundary for that invocation:
//
//   1. Validate the GovernedRequest envelope through `createGovernedAuthority`
//      (task/principal/chain/audience/time/scope). Client identity fields are
//      correlation claims, not authority (ADR-054).
//   2. Compute the *effective* capability set as the intersection of the
//      grant's scope and the extension's declared `requiredCapabilities`
//      (doc 08). A declared capability outside the grant is denied — the
//      extension's declaration is a request, never a grant (ADR-053).
//   3. Run the host-mediated effect with only the effective capabilities and
//      return a typed result.
//
// `runEffect` is injected by the launcher (the host-mediated tool executor).
// Until the launcher supplies it, callers fail closed rather than fabricate an
// effect.

/**
 * Dispatch a governed Augmentor extension invocation.
 *
 * @param {object} args
 * @param {object} args.request GovernedRequest whose payload is
 *   `{ extensionId, kind, input, requiredCapabilities?, pendingApprovalGates? }`.
 * @param {object} args.governedAuthority a `createGovernedAuthority()` instance.
 * @param {Function} args.runEffect async `(invocation) => result`, the
 *   host-mediated tool executor.
 * @returns {Promise<object>} `{ outcome: "allow", result, effectiveCapabilities }`
 *   or `{ outcome: "deny", reason, detail }`.
 */
export async function dispatchGovernedAugmentorExtension({
  request,
  governedAuthority,
  runEffect,
}) {
  const decision = governedAuthority.validateGovernedRequest(request);
  if (!decision.ok) {
    return {
      outcome: "deny",
      reason: decision.reason,
      detail: `governed extension request rejected: ${decision.reason}`,
    };
  }

  const { extensionId, kind, input, requiredCapabilities = [], pendingApprovalGates = [] } =
    request.payload ?? {};

  // The grant covers a single action; the extension's declared capabilities are
  // intersected against it (doc 08). Anything outside the grant is denied — Core
  // independently authorizes every effect.
  const granted = new Set([decision.grant.scope.action]);
  const effectiveCapabilities = requiredCapabilities.filter((capability) => granted.has(capability));
  const missing = requiredCapabilities.filter((capability) => !granted.has(capability));
  if (missing.length > 0) {
    return {
      outcome: "deny",
      reason: "capability-not-granted",
      detail: `extension ${extensionId} requires ungranted capabilities: ${missing.join(", ")}`,
    };
  }

  if (typeof runEffect !== "function") {
    return {
      outcome: "deny",
      reason: "effect-unavailable",
      detail: "the host-mediated extension executor is not configured on this bridge",
    };
  }

  const result = await runEffect({
    invocationId: request.auditCorrelationId ?? `inv-${request.taskId}`,
    extensionId,
    kind,
    taskId: request.taskId,
    delegationId: request.delegationId,
    principalId: request.subjectPrincipalId,
    input,
    pendingApprovalGates,
    effectiveCapabilities,
  });

  return { outcome: "allow", result, effectiveCapabilities };
}
