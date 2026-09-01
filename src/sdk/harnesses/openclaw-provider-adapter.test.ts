import { describe, expect, it } from "vitest";

import {
  OpenClawProviderAdapter,
  makeFakeOpenClawRuntime,
  openClawTaskPacketFixture,
  type OpenClawRuntime,
} from "./openclaw-provider-adapter";

describe("OpenClawProviderAdapter parity (CP-4 Phase 3)", () => {
  it("lifts the OpenClaw identity + semantics from the reference stub", () => {
    const adapter = new OpenClawProviderAdapter();
    expect(adapter.providerId).toBe("openclaw");
    expect(adapter.cancellationSemantics).toBe("quarantine");
    expect(adapter.sandboxStrength).toBe("sandboxed-outer-boundary");
  });

  it("diagnose returns 'ok' when CLI + execution enabled, 'degraded' otherwise", async () => {
    const ok = new OpenClawProviderAdapter({ runtime: makeFakeOpenClawRuntime() });
    expect((await ok.diagnose()).status).toBe("ok");

    const noCli = new OpenClawProviderAdapter({
      runtime: makeFakeOpenClawRuntime({ async discoverCommand() { return null; } }),
    });
    expect((await noCli.diagnose()).status).toBe("degraded");

    const disabled = new OpenClawProviderAdapter({
      runtime: makeFakeOpenClawRuntime({
        async readExecutionSettings() { return { openclaw: { localCliExecution: false } }; },
      }),
    });
    expect((await disabled.diagnose()).status).toBe("degraded");
  });

  it("startTask deterministic branch: completes with one artifact and emits completion event", async () => {
    const adapter = new OpenClawProviderAdapter({ runtime: makeFakeOpenClawRuntime() });
    const run = await adapter.startTask(openClawTaskPacketFixture(), "grant-test");

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

  it("startTask rejects when the gateway CLI is missing", async () => {
    const adapter = new OpenClawProviderAdapter({
      runtime: makeFakeOpenClawRuntime({ async discoverCommand() { return null; } }),
    });
    const packet = openClawTaskPacketFixture({ outputContract: { adapter: "cli" } });
    await expect(adapter.startTask(packet, "grant-test")).rejects.toThrow(/gateway unavailable/i);
  });

  it("startTask rejects when execution is disabled", async () => {
    const adapter = new OpenClawProviderAdapter({
      runtime: makeFakeOpenClawRuntime({
        async readExecutionSettings() { return { openclaw: { localCliExecution: false } }; },
      }),
    });
    const packet = openClawTaskPacketFixture({ outputContract: { adapter: "cli" } });
    await expect(adapter.startTask(packet, "grant-test")).rejects.toThrow(/execution requires explicit enablement/i);
  });

  it("startTask CLI branch: parses structured output and emits secrets progress", async () => {
    const adapter = new OpenClawProviderAdapter({ runtime: makeFakeOpenClawRuntime() });
    const packet = openClawTaskPacketFixture({ outputContract: { adapter: "cli" } });
    const run = await adapter.startTask(packet, "grant-test");
    expect(run.status).toBe("completed");

    const events: { detail?: string; kind: string }[] = [];
    for await (const ev of adapter.events(run.runId)) events.push(ev as { kind: string; detail?: string });
    const progress = events.find((e) => e.kind === "progress");
    expect(progress?.detail).toContain("adapter=cli");
    expect(progress?.detail).toContain("secrets=1");
  });

  it("listChildActors returns the gateway + runtime-enumerated children (parity with reference shape)", async () => {
    const adapter = new OpenClawProviderAdapter({ runtime: makeFakeOpenClawRuntime() });
    const run = await adapter.startTask(openClawTaskPacketFixture(), "grant-test");
    const children = await adapter.listChildActors(run.runId);
    expect(children[0]?.childId).toBe("openclaw.gateway");
    expect(children[0]?.kind).toBe("gateway");
    expect(children[1]?.childId).toBe("openclaw.child:0");
    expect(children[1]?.kind).toBe("child-agent");
    expect(children[1]?.escalationRequired).toBe(true);
  });

  it("cancelTask records a quarantinedAt progress event (parity with quarantine semantics)", async () => {
    const adapter = new OpenClawProviderAdapter({ runtime: makeFakeOpenClawRuntime() });
    const packet = openClawTaskPacketFixture({ outputContract: { adapter: "cli" } });
    const run = await adapter.startTask(packet, "grant-test");
    // After deterministic completion, cancel preserves terminal status but
    // records a quarantine progress event for forensic review.
    await adapter.cancelTask(run.runId, "human quarantine");

    const events: { detail?: string; kind: string }[] = [];
    for await (const ev of adapter.events(run.runId)) events.push(ev as { kind: string; detail?: string });
    const quarantine = events.find((e) => e.detail?.startsWith("quarantinedAt="));
    expect(quarantine).toBeDefined();
  });

  it("parseCliResult extracts Final Summary + section lists from structured output", () => {
    const adapter = new OpenClawProviderAdapter();
    const text = [
      "## Final Summary",
      "Compiled MCP registry state.",
      "",
      "## Actions Taken",
      "- Enumerated servers",
      "- Indexed tools",
      "",
      "## Residual Risks",
      "- None.",
      "",
      "## Verification",
      "- Registry returned.",
    ].join("\n");
    const result = adapter.parseCliResult(text);
    expect(result.finalSummary).toBe("Compiled MCP registry state.");
    expect(result.actionsTaken).toEqual(["Enumerated servers", "Indexed tools"]);
    expect(result.residualRisks).toEqual(["None."]);
  });

  it("deterministicFromPrompt includes the mission intent in the finalSummary", () => {
    const adapter = new OpenClawProviderAdapter();
    const packet = openClawTaskPacketFixture({ intent: "Enumerate MCP servers." });
    const result = adapter.deterministicFromPrompt(packet);
    expect(result.finalSummary).toContain("Enumerate MCP servers.");
  });

  it("buildExecutionPrompt refuses tool calls and runtime spawns", () => {
    const adapter = new OpenClawProviderAdapter();
    const prompt = adapter.buildExecutionPrompt(openClawTaskPacketFixture());
    expect(prompt).toContain("OpenClaw operating as a ResonantOS add-on runtime gateway");
    expect(prompt).toContain("Do not attempt live tool calls");
    expect(prompt).toContain("register new MCP servers");
  });
});
