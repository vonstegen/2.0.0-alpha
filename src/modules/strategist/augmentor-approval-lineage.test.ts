// Intent citation: docs/architecture/resonantos-browser-architecture/04-augmentor-extension-model.md
import { describe, expect, it } from "vitest";

import type { AugmentorExtensionInvocation } from "../../sdk/augmentor";
import type { DelegationChainRef } from "../../sdk/identity";
import {
  buildLineageSteps,
  escalateInvocation,
  flattenDelegationChain,
  pendingApprovalItems,
} from "./augmentor-approval-lineage";

const chain: DelegationChainRef = {
  delegationId: "tool.git",
  parent: {
    delegationId: "hermes",
    parent: { delegationId: "augmentor" },
  },
};

const invocation = (overrides: Partial<AugmentorExtensionInvocation> = {}): AugmentorExtensionInvocation => ({
  invocationId: "inv-1",
  extensionId: "addon.paperclip:skill",
  kind: "skill",
  taskId: "task-1",
  delegationId: "del-1",
  principalId: "tool.git",
  context: { documentPaths: [] },
  input: {},
  pendingApprovalGates: [],
  lifecycle: "running",
  ...overrides,
});

describe("Augmentor approval/escalation + lineage selectors", () => {
  it("flattens a delegation chain root-first", () => {
    expect(flattenDelegationChain(chain)).toEqual(["augmentor", "hermes", "tool.git"]);
  });

  it("builds lineage steps from the user through the orchestrator to the leaf", () => {
    const steps = buildLineageSteps("Augmentor", chain, (id) => id.toUpperCase());
    expect(steps.map((step) => step.principalId)).toEqual(["user", "orchestrator", "augmentor", "hermes", "tool.git"]);
    expect(steps.map((step) => step.kind)).toEqual(["user", "orchestrator", "extension", "extension", "extension"]);
    expect(steps[1].label).toBe("Augmentor");
    expect(steps[2].label).toBe("AUGMENTOR");
  });

  it("renders the minimal user -> orchestrator lineage when no chain is present", () => {
    const steps = buildLineageSteps("Augmentor", null);
    expect(steps.map((step) => step.kind)).toEqual(["user", "orchestrator"]);
  });

  it("extracts pending approval items for planned/awaiting-approval invocations", () => {
    const pending = [
      invocation({ invocationId: "a", lifecycle: "awaiting-approval", pendingApprovalGates: ["human-approval"] }),
      invocation({ invocationId: "b", lifecycle: "planned", pendingApprovalGates: ["financial"] }),
      invocation({ invocationId: "c", lifecycle: "running", pendingApprovalGates: [] }),
    ];
    expect(pendingApprovalItems(pending)).toEqual([
      { invocationId: "a", extensionId: "addon.paperclip:skill", gate: "human-approval" },
      { invocationId: "b", extensionId: "addon.paperclip:skill", gate: "financial" },
    ]);
  });

  it("escalates an invocation to await approval for a gate", () => {
    const escalated = escalateInvocation(invocation(), "human-approval");
    expect(escalated.lifecycle).toBe("awaiting-approval");
    expect(escalated.pendingApprovalGates).toEqual(["human-approval"]);
    // Original is untouched (pure transition).
    expect(invocation().lifecycle).toBe("running");
  });

  it("does not duplicate an already-pending gate on escalation", () => {
    const escalated = escalateInvocation(
      invocation({ lifecycle: "awaiting-approval", pendingApprovalGates: ["human-approval"] }),
      "human-approval",
    );
    expect(escalated.pendingApprovalGates).toEqual(["human-approval"]);
  });
});
