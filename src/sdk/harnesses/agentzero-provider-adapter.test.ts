import { describe, expect, it } from "vitest";

import {
  AgentZeroProviderAdapter,
  agentZeroTaskPacketFixture,
  makeFakeAgentZeroRuntime,
} from "./agentzero-provider-adapter";

describe("AgentZeroProviderAdapter parity (CP-4 Phase 3)", () => {
  it("lifts the AgentZero identity + semantics from the reference stub", () => {
    const adapter = new AgentZeroProviderAdapter();
    expect(adapter.providerId).toBe("agentzero");
    expect(adapter.cancellationSemantics).toBe("cancel");
    expect(adapter.sandboxStrength).toBe("sandboxed-outer-boundary");
  });

  it("diagnose returns 'ok' when docker CLI + execution enabled, 'degraded' otherwise", async () => {
    const ok = new AgentZeroProviderAdapter({ runtime: makeFakeAgentZeroRuntime() });
    expect((await ok.diagnose()).status).toBe("ok");

    const noCli = new AgentZeroProviderAdapter({
      runtime: makeFakeAgentZeroRuntime({ async discoverDockerCommand() { return null; } }),
    });
    expect((await noCli.diagnose()).status).toBe("degraded");

    const disabled = new AgentZeroProviderAdapter({
      runtime: makeFakeAgentZeroRuntime({
        async readExecutionSettings() { return { agentzero: { localCliExecution: false } }; },
      }),
    });
    expect((await disabled.diagnose()).status).toBe("degraded");
  });

  it("startTask deterministic branch: completes with one artifact and emits completion event", async () => {
    const adapter = new AgentZeroProviderAdapter({ runtime: makeFakeAgentZeroRuntime() });
    const run = await adapter.startTask(agentZeroTaskPacketFixture(), "grant-test");

    const state = await adapter.getTask(run.runId);
    expect(state.status).toBe("completed");
    const events: unknown[] = [];
    for await (const ev of adapter.events(run.runId)) events.push(ev);
    const completion = events.find((e) => (e as { kind: string }).kind === "completed");
    expect(completion).toBeDefined();

    const artifacts = await adapter.collectArtifacts(run.runId);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.sensitivity).toBe("internal");
  });

  it("startTask rejects when docker CLI is missing", async () => {
    const adapter = new AgentZeroProviderAdapter({
      runtime: makeFakeAgentZeroRuntime({ async discoverDockerCommand() { return null; } }),
    });
    const packet = agentZeroTaskPacketFixture({ outputContract: { adapter: "docker" } });
    await expect(adapter.startTask(packet, "grant-test")).rejects.toThrow(/docker CLI unavailable/i);
  });

  it("startTask rejects when execution is disabled", async () => {
    const adapter = new AgentZeroProviderAdapter({
      runtime: makeFakeAgentZeroRuntime({
        async readExecutionSettings() { return { agentzero: { localCliExecution: false } }; },
      }),
    });
    const packet = agentZeroTaskPacketFixture({ outputContract: { adapter: "docker" } });
    await expect(adapter.startTask(packet, "grant-test")).rejects.toThrow(/execution requires explicit enablement/i);
  });

  it("startTask CLI branch: parses structured output and emits container progress", async () => {
    const adapter = new AgentZeroProviderAdapter({ runtime: makeFakeAgentZeroRuntime() });
    const packet = agentZeroTaskPacketFixture({ outputContract: { adapter: "docker" } });
    const run = await adapter.startTask(packet, "grant-test");
    expect(run.status).toBe("completed");

    const events: { detail?: string; kind: string }[] = [];
    for await (const ev of adapter.events(run.runId)) events.push(ev as { kind: string; detail?: string });
    const progress = events.find((e) => e.kind === "progress");
    expect(progress?.detail).toContain("container=resonantos-agentzero");
    expect(progress?.detail).toContain("secrets=1");
  });

  it("listChildActors returns the single container-agent child (parity with reference shape)", async () => {
    const adapter = new AgentZeroProviderAdapter({ runtime: makeFakeAgentZeroRuntime() });
    const run = await adapter.startTask(agentZeroTaskPacketFixture(), "grant-test");
    const children = await adapter.listChildActors(run.runId);
    expect(children).toHaveLength(1);
    expect(children[0]?.childId).toBe("agentzero.agent");
    expect(children[0]?.kind).toBe("container-agent");
    expect(children[0]?.sandboxed).toBe(true);
  });

  it("parseCliResult extracts Final Summary + section lists from structured output", () => {
    const adapter = new AgentZeroProviderAdapter();
    const text = [
      "## Final Summary",
      "Compiled container registry state.",
      "",
      "## Actions Taken",
      "- Listed containers",
      "- Indexed images",
      "",
      "## Residual Risks",
      "- None.",
      "",
      "## Verification",
      "- Registry returned.",
    ].join("\n");
    const result = adapter.parseCliResult(text);
    expect(result.finalSummary).toBe("Compiled container registry state.");
    expect(result.actionsTaken).toEqual(["Listed containers", "Indexed images"]);
    expect(result.residualRisks).toEqual(["None."]);
  });

  it("deterministicFromPrompt includes the mission intent in the finalSummary", () => {
    const adapter = new AgentZeroProviderAdapter();
    const packet = agentZeroTaskPacketFixture({ intent: "Enumerate docker images." });
    const result = adapter.deterministicFromPrompt(packet);
    expect(result.finalSummary).toContain("Enumerate docker images.");
  });

  it("buildExecutionPrompt refuses tool calls, image pulls, and host mounts", () => {
    const adapter = new AgentZeroProviderAdapter();
    const prompt = adapter.buildExecutionPrompt(agentZeroTaskPacketFixture());
    expect(prompt).toContain("AgentZero operating as a ResonantOS add-on container agent");
    expect(prompt).toContain("Do not mount host paths");
    expect(prompt).toContain("image pulls");
  });
});
