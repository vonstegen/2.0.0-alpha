// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
import { describe, expect, it } from "vitest";

import type { TaskPacket } from "../tasks";
import { FakeHarnessProvider } from "./fake-harness-provider";
import {
  HermesProviderAdapter,
  OpenClawProviderAdapter,
  OpenCodeProviderAdapter,
} from "./reference-providers";
import { runHarnessProviderConformance } from "./conformance";

function packet(): TaskPacket {
  return {
    taskId: "task-1",
    issuerPrincipalId: "user-1",
    executorPrincipalId: "hermes-1",
    delegationChainRef: { delegationId: "del-1" },
    intent: "summarize the diff",
    successCriteria: ["summary present"],
    nonGoals: [],
    outputContract: {},
    contextRefs: {
      facts: [],
      provenance: [],
      sensitivity: "low",
      freshness: "2026-08-28T00:00:00Z",
      allowedPurpose: "review",
      retentionPolicy: "session",
      redactions: [],
    },
    requestedCapabilities: [],
    resourceBudget: {
      priority: 1,
      deadline: "2026-08-28T12:00:00Z",
      concurrencyClass: "shared",
      estimated: {},
      hardCeiling: {},
      requiredNodeRoles: [],
      networkMode: "none",
      workspaceMode: "isolated",
      secretPolicy: "none",
      onExhaustion: "stop",
    },
    workspaceRoots: ["/workspace/project-a"],
    approvalPolicy: "human-approval",
    deadline: "2026-08-28T12:00:00Z",
    expiresAt: "2026-08-28T12:00:00Z",
    cancellationChannel: "task-1:cancel",
    auditCorrelationId: "aud-1",
  };
}

const providers = [
  new FakeHarnessProvider(),
  new HermesProviderAdapter(),
  new OpenCodeProviderAdapter(),
  new OpenClawProviderAdapter(),
];

describe("harness provider conformance suite", () => {
  for (const provider of providers) {
    it(`passes all five gate checks for ${provider.providerId}`, async () => {
      const result = await runHarnessProviderConformance(provider, packet());
      expect(result.checks.map((check) => check.name)).toEqual([
        "lifecycle",
        "cancellation",
        "artifact-confinement",
        "event-replay",
        "failure",
      ]);
      expect(result.passed).toBe(true);
      expect(result.checks.every((check) => check.passed)).toBe(true);
    });
  }

  it("gives the three reference providers distinct shapes on the same contract", async () => {
    const hermes = new HermesProviderAdapter();
    const opencode = new OpenCodeProviderAdapter();
    const openclaw = new OpenClawProviderAdapter();

    expect(hermes.cancellationSemantics).toBe("cancel");
    expect(hermes.sandboxStrength).toBe("host-mediated");
    expect(opencode.cancellationSemantics).toBe("finish-atomic");
    expect(opencode.sandboxStrength).toBe("sandboxed-outer-boundary");
    expect(openclaw.cancellationSemantics).toBe("quarantine");
    expect(openclaw.sandboxStrength).toBe("sandboxed-outer-boundary");

    const run = await hermes.startTask(packet(), "grant-1");
    const hermesChildren = await hermes.listChildActors(run.runId);
    expect(hermesChildren.map((child) => child.kind)).toEqual(["agent"]);

    const ocRun = await opencode.startTask(packet(), "grant-1");
    const ocChildren = await opencode.listChildActors(ocRun.runId);
    expect(ocChildren.map((child) => child.kind)).toEqual(["workspace"]);

    const clawRun = await openclaw.startTask(packet(), "grant-1");
    const clawChildren = await openclaw.listChildActors(clawRun.runId);
    expect(clawChildren.map((child) => child.kind)).toEqual(["gateway", "child-agent"]);
    expect(clawChildren.some((child) => child.escalationRequired)).toBe(true);
  });
});
