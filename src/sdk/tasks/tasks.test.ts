// Intent citation: docs/architecture/ADR-054-principal-delegation-chain-task-scoped-authority.md
// Intent citation: docs/architecture/resonantos-browser-architecture/08-capability-inheritance-task-scope.md
import { describe, expect, it } from "vitest";
import type { DelegationChainRef, DelegationRecord } from "../identity";
import type { ScopedCapability } from "../authority";
import type { ContextEnvelope } from "../continuity";
import type { ResourceBudget } from "../resources";
import type { TaskPacket } from "./index";

const capability: ScopedCapability = {
  action: "network",
  resourceSelectors: ["https://api.example.com"],
  operations: ["read"],
  taskId: "task-1",
  delegationId: "del-3",
  issuerPrincipalId: "hermes-1",
  subjectPrincipalId: "tool.git",
  notBefore: "2026-08-27T00:00:00Z",
  expiresAt: "2026-08-27T12:00:00Z",
  revocationBehavior: "cancel",
};

// user → Augmentor (orchestrator) → Hermes (harness) → tool.git, as a linked
// chain of delegation ids (CONTRACTS DelegationChainRef).
const chain: DelegationChainRef = {
  delegationId: "del-3",
  parent: {
    delegationId: "del-2",
    parent: { delegationId: "del-1" },
  },
};

const records: DelegationRecord[] = [
  {
    id: "del-1",
    taskId: "task-1",
    issuerPrincipalId: "user-1",
    subjectPrincipalId: "orchestrator-1",
    requestedCapabilities: [],
    effectiveGrantId: "g-1",
    purpose: "user delegates to Augmentor",
    issuedAt: "2026-08-27T00:00:00Z",
    notBefore: "2026-08-27T00:00:00Z",
    expiresAt: "2026-08-27T12:00:00Z",
    status: "active",
    auditCorrelationId: "aud-1",
  },
  {
    id: "del-2",
    taskId: "task-1",
    parentDelegationId: "del-1",
    issuerPrincipalId: "orchestrator-1",
    subjectPrincipalId: "hermes-1",
    requestedCapabilities: [],
    effectiveGrantId: "g-2",
    purpose: "Augmentor delegates to Hermes",
    issuedAt: "2026-08-27T00:00:00Z",
    notBefore: "2026-08-27T00:00:00Z",
    expiresAt: "2026-08-27T12:00:00Z",
    status: "active",
    auditCorrelationId: "aud-1",
  },
  {
    id: "del-3",
    taskId: "task-1",
    parentDelegationId: "del-2",
    issuerPrincipalId: "hermes-1",
    subjectPrincipalId: "tool.git",
    requestedCapabilities: [capability],
    effectiveGrantId: "g-3",
    purpose: "Hermes delegates to tool.git",
    issuedAt: "2026-08-27T00:00:00Z",
    notBefore: "2026-08-27T00:00:00Z",
    expiresAt: "2026-08-27T12:00:00Z",
    status: "active",
    auditCorrelationId: "aud-1",
  },
];

function packet(): TaskPacket {
  return {
    taskId: "task-1",
    issuerPrincipalId: "user-1",
    executorPrincipalId: "tool.git",
    delegationChainRef: chain,
    intent: "fetch a single resource",
    successCriteria: ["resource returned"],
    nonGoals: [],
    outputContract: {},
    contextRefs: {
      facts: [{ value: "bounded context", sourceRefs: ["mem-1"] }],
      provenance: ["user-1"],
      sensitivity: "internal",
      freshness: "2026-08-27T00:00:00Z",
      allowedPurpose: "task-1",
      retentionPolicy: "task-scoped",
      redactions: [],
    } satisfies ContextEnvelope,
    requestedCapabilities: [capability],
    resourceBudget: {
      priority: 1,
      deadline: "2026-08-27T12:00:00Z",
      concurrencyClass: "serial",
      estimated: { tokens: 1 },
      hardCeiling: { tokens: 10 },
      requiredNodeRoles: [],
      networkMode: "allowlist",
      workspaceMode: "scratch",
      secretPolicy: "deny",
      onExhaustion: "stop",
    } satisfies ResourceBudget,
    workspaceRoots: ["/workspace/project-a"],
    approvalPolicy: "user-approval",
    deadline: "2026-08-27T12:00:00Z",
    expiresAt: "2026-08-27T12:00:00Z",
    cancellationChannel: "task-1-cancel",
    auditCorrelationId: "aud-1",
  };
}

describe("CP-1 chain representation (user → Augmentor → Hermes → tool.git)", () => {
  it("models the full delegation chain", () => {
    const p = packet();
    expect(p.delegationChainRef.delegationId).toBe("del-3");
    expect(p.delegationChainRef.parent?.delegationId).toBe("del-2");
    expect(p.delegationChainRef.parent?.parent?.delegationId).toBe("del-1");
    expect(records.map((r) => r.subjectPrincipalId)).toEqual([
      "orchestrator-1",
      "hermes-1",
      "tool.git",
    ]);
    expect(records[1].parentDelegationId).toBe("del-1");
    expect(records[2].parentDelegationId).toBe("del-2");
  });

  it("survives a JSON round-trip across the bridge boundary", () => {
    const roundTripped = JSON.parse(JSON.stringify(packet())) as TaskPacket;
    expect(roundTripped).toEqual(packet());
    expect(roundTripped.requestedCapabilities[0].operations).toEqual(["read"]);
  });
});
