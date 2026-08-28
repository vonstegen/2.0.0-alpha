// Intent citation: docs/architecture/resonantos-browser-architecture/04-augmentor-extension-model.md
// Intent citation: docs/architecture/ADR-054-principal-delegation-chain-task-scoped-authority.md
//
// CP-3 Augmentor UI: approval/escalation + lineage display model. Pure selectors
// over the SDK authority/extension types so the Strategist (Augmentor) workspace
// can render the delegation chain and any pending approval gates without owning
// authority decisions. Authority remains Core's; this module only *projects* a
// view (ADR-053).

import type { DelegationChainRef } from "../../sdk/identity";
import type { AugmentorExtensionInvocation } from "../../sdk/augmentor";

export type AugmentorLineageStepKind = "user" | "orchestrator" | "extension";

export interface AugmentorLineageStep {
  principalId: string;
  label: string;
  kind: AugmentorLineageStepKind;
}

export interface PendingApprovalItem {
  invocationId: string;
  extensionId: string;
  gate: string;
}

// Flatten a DelegationChainRef (leaf -> root) into an ordered list of
// delegation ids from root -> leaf. The root delegation is the user's grant to
// the orchestrator's first subordinate; the leaf is the innermost delegation.
export function flattenDelegationChain(chain: DelegationChainRef): string[] {
  const ids: string[] = [];
  let node: DelegationChainRef | undefined = chain;
  while (node) {
    ids.push(node.delegationId);
    node = node.parent;
  }
  return ids.reverse();
}

// Build the lineage steps for display: the implicit user, the fused Augmentor
// orchestrator, then each delegation in the chain (root -> leaf).
export function buildLineageSteps(
  orchestratorLabel: string,
  chain: DelegationChainRef | null,
  labelFor: (delegationId: string) => string = (id) => id,
): AugmentorLineageStep[] {
  const steps: AugmentorLineageStep[] = [
    { principalId: "user", label: "User", kind: "user" },
    { principalId: "orchestrator", label: orchestratorLabel, kind: "orchestrator" },
  ];
  if (chain) {
    for (const delegationId of flattenDelegationChain(chain)) {
      steps.push({ principalId: delegationId, label: labelFor(delegationId), kind: "extension" });
    }
  }
  return steps;
}

// Extract the invocations currently awaiting a human decision: those planned or
// awaiting-approval, expanded into one item per pending gate.
export function pendingApprovalItems(
  invocations: readonly AugmentorExtensionInvocation[],
): PendingApprovalItem[] {
  return invocations.flatMap((invocation) => {
    if (
      invocation.lifecycle !== "planned" &&
      invocation.lifecycle !== "awaiting-approval" &&
      (invocation.pendingApprovalGates?.length ?? 0) === 0
    ) {
      return [];
    }
    return (invocation.pendingApprovalGates ?? []).map((gate) => ({
      invocationId: invocation.invocationId,
      extensionId: invocation.extensionId,
      gate,
    }));
  });
}

// Escalation transition: promote an invocation to await human approval for a
// specific gate. Pure — returns a new invocation; authority is still Core's.
export function escalateInvocation(
  invocation: AugmentorExtensionInvocation,
  gate: string,
): AugmentorExtensionInvocation {
  const pendingApprovalGates = invocation.pendingApprovalGates.includes(gate)
    ? invocation.pendingApprovalGates
    : [...invocation.pendingApprovalGates, gate];
  return { ...invocation, pendingApprovalGates, lifecycle: "awaiting-approval" };
}
