// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
import { describe, expect, it } from "vitest";

import type { TaskPacket } from "../tasks";
import { FakeHarnessProvider } from "./fake-harness-provider";
import {
  AgentZeroProviderAdapter,
  AiderProviderAdapter,
  DeepSeekHarnessProviderAdapter,
  HermesProviderAdapter,
  OpenClawProviderAdapter,
  OpenCodeProviderAdapter,
  PiProviderAdapter,
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
  new AgentZeroProviderAdapter(),
  new DeepSeekHarnessProviderAdapter(),
  new PiProviderAdapter(),
  new AiderProviderAdapter(),
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

  it("gives the seven reference providers distinct shapes on the same contract", async () => {
    const hermes = new HermesProviderAdapter();
    const opencode = new OpenCodeProviderAdapter();
    const openclaw = new OpenClawProviderAdapter();
    const agentzero = new AgentZeroProviderAdapter();
    const deepseek = new DeepSeekHarnessProviderAdapter();
    const pi = new PiProviderAdapter();
    const aider = new AiderProviderAdapter();

    expect(hermes.cancellationSemantics).toBe("cancel");
    expect(hermes.sandboxStrength).toBe("host-mediated");
    expect(opencode.cancellationSemantics).toBe("finish-atomic");
    expect(opencode.sandboxStrength).toBe("sandboxed-outer-boundary");
    expect(openclaw.cancellationSemantics).toBe("quarantine");
    expect(openclaw.sandboxStrength).toBe("sandboxed-outer-boundary");
    expect(agentzero.cancellationSemantics).toBe("cancel");
    expect(agentzero.sandboxStrength).toBe("sandboxed-outer-boundary");
    expect(deepseek.cancellationSemantics).toBe("cancel");
    expect(deepseek.sandboxStrength).toBe("host-mediated");
    expect(pi.cancellationSemantics).toBe("cancel");
    expect(pi.sandboxStrength).toBe("host-mediated");
    expect(aider.cancellationSemantics).toBe("finish-atomic");
    expect(aider.sandboxStrength).toBe("host-mediated");

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

    const azRun = await agentzero.startTask(packet(), "grant-1");
    const azChildren = await agentzero.listChildActors(azRun.runId);
    expect(azChildren.map((child) => child.kind)).toEqual(["container-agent"]);

    const dsRun = await deepseek.startTask(packet(), "grant-1");
    const dsChildren = await deepseek.listChildActors(dsRun.runId);
    expect(dsChildren.map((child) => child.kind)).toEqual(["cloud-inference"]);

    const piRun = await pi.startTask(packet(), "grant-1");
    const piChildren = await pi.listChildActors(piRun.runId);
    expect(piChildren.map((child) => child.kind)).toEqual(["terminal-agent"]);

    const aiderRun = await aider.startTask(packet(), "grant-1");
    const aiderChildren = await aider.listChildActors(aiderRun.runId);
    expect(aiderChildren.map((child) => child.kind)).toEqual(["pair-programmer"]);
  });
});
