import { describe, expect, it } from "vitest";
import {
  HermesProviderAdapter,
  hermesTaskPacketFixture,
  makeFakeHermesRuntime,
  type HermesRuntime,
} from "./hermes-provider-adapter";

describe("HermesProviderAdapter parity (CP-4 Phase 2)", () => {
  it("lifts the Hermes identity + semantics from the reference stub", () => {
    const adapter = new HermesProviderAdapter();
    expect(adapter.providerId).toBe("hermes");
    expect(adapter.cancellationSemantics).toBe("cancel");
    expect(adapter.sandboxStrength).toBe("host-mediated");
  });

  it("diagnose returns 'ok' when the runtime reports a CLI, 'degraded' otherwise", async () => {
    const withCli = new HermesProviderAdapter({ runtime: makeFakeHermesRuntime() });
    expect((await withCli.diagnose()).status).toBe("ok");

    const withoutCli = new HermesProviderAdapter({
      runtime: makeFakeHermesRuntime({ async discoverCommand() { return null; } }),
    });
    expect((await withoutCli.diagnose()).status).toBe("degraded");
  });

  it("startTask deterministic branch: completes with one artifact and emits completion event", async () => {
    const adapter = new HermesProviderAdapter({ runtime: makeFakeHermesRuntime() });
    const run = await adapter.startTask(hermesTaskPacketFixture(), "grant-test");

    const state = await adapter.getTask(run.runId);
    expect(state.status).toBe("completed");
    const events: unknown[] = [];
    for await (const ev of adapter.events(run.runId)) events.push(ev);
    const completion = events.find((e) => (e as { kind: string }).kind === "completed");
    expect(completion).toBeDefined();

    const artifacts = await adapter.collectArtifacts(run.runId);
    expect(artifacts[0]?.root).toBe("/tmp/hermes-workspace/artifacts");
    expect(artifacts[0]?.sensitivity).toBe("internal");
  });

  it("startTask deterministic branch: result finalSummary echoes the mission intent", async () => {
    const adapter = new HermesProviderAdapter({ runtime: makeFakeHermesRuntime() });
    const packet = hermesTaskPacketFixture({
      intent: "Audit the financial report for residual risk.",
    });
    const run = await adapter.startTask(packet, "grant-test");
    expect(run.status).toBe("completed");

    const events: { detail?: string; kind: string }[] = [];
    for await (const ev of adapter.events(run.runId)) events.push(ev as { detail?: string; kind: string });
    const progress = events.find((e) => e.kind === "progress");
    expect(progress?.detail).toContain("adapter=deterministic");
  });

  it("startTask rejects when execution is disabled (parity with legacy 'enableHermesExecution' gate)", async () => {
    const adapter = new HermesProviderAdapter({
      runtime: makeFakeHermesRuntime({
        async readExecutionSettings() {
          return { hermes: { localCliExecution: false } };
        },
      }),
    });
    const packet = hermesTaskPacketFixture({
      outputContract: { adapter: "auto" }, // not deterministic
    });
    await expect(adapter.startTask(packet, "grant-test")).rejects.toThrow(/explicit enablement/);
    const runs = (adapter as unknown as { runs: Map<string, unknown> }).runs;
    expect(runs.size).toBe(1);
  });

  it("startTask rejects when the CLI is missing (parity with legacy 'CLI unavailable' gate)", async () => {
    const adapter = new HermesProviderAdapter({
      runtime: makeFakeHermesRuntime({
        async discoverCommand() { return null; },
      }),
    });
    const packet = hermesTaskPacketFixture({ outputContract: { adapter: "auto" } });
    await expect(adapter.startTask(packet, "grant-test")).rejects.toThrow(/Hermes CLI unavailable/);
  });

  it("startTask rejects when no provider credentials are configured (parity with legacy 'credential unavailable' gate)", async () => {
    const adapter = new HermesProviderAdapter({
      runtime: makeFakeHermesRuntime({
        async readSecrets() { return {}; },
      }),
    });
    const packet = hermesTaskPacketFixture({ outputContract: { adapter: "auto" } });
    await expect(adapter.startTask(packet, "grant-test")).rejects.toThrow(/credential unavailable/);
  });

  it("startTask rejects CLI output containing unresolved <tool_call> markup (parity with legacy parse guard)", async () => {
    const adapter = new HermesProviderAdapter({
      runtime: makeFakeHermesRuntime({
        async invokeCli() {
          return "<tool_call>leaked</tool_call>";
        },
      }),
    });
    const packet = hermesTaskPacketFixture({ outputContract: { adapter: "auto" } });
    await expect(adapter.startTask(packet, "grant-test")).rejects.toThrow(/unresolved provider tool-call/);
  });

  it("startTask maps credential errors during CLI invocation to a blocked state (parity with legacy recovery path)", async () => {
    const adapter = new HermesProviderAdapter({
      runtime: makeFakeHermesRuntime({
        async invokeCli() {
          throw new Error("401 unauthorized: invalid api key");
        },
      }),
    });
    const packet = hermesTaskPacketFixture({ outputContract: { adapter: "auto" } });
    await expect(adapter.startTask(packet, "grant-test")).rejects.toThrow(/credential unavailable/);
  });

  it("startTask CLI branch: parses structured output into the artifact shape", async () => {
    const adapter = new HermesProviderAdapter({
      runtime: makeFakeHermesRuntime({
        async invokeCli() {
          return [
            "## Final Summary",
            "Reviewed and approved.",
            "",
            "## Actions Taken",
            "- Read the document.",
            "",
            "## Approval Needs",
            "- None.",
            "",
            "## Residual Risks",
            "- Minimal.",
            "",
            "## Verification",
            "- Parsed.",
            "",
          ].join("\n");
        },
      }),
    });
    const packet = hermesTaskPacketFixture({ outputContract: { adapter: "auto" } });
    const run = await adapter.startTask(packet, "grant-test");
    expect(run.status).toBe("completed");
    const state = await adapter.getTask(run.runId);
    expect(state.status).toBe("completed");
  });

  it("startTask CLI branch: emits a progress event carrying provider/model before completion", async () => {
    let seenProvider: string | undefined;
    const adapter = new HermesProviderAdapter({
      runtime: makeFakeHermesRuntime({
        async invokeCli(_cmd, _prompt) {
          return [
            "## Final Summary",
            "OK.",
            "## Actions Taken",
            "- did work",
            "## Approval Needs",
            "- none",
            "## Residual Risks",
            "- none",
            "## Verification",
            "- parsed",
          ].join("\n");
        },
      }),
    });
    const packet = hermesTaskPacketFixture({ outputContract: { adapter: "auto" } });
    const run = await adapter.startTask(packet, "grant-test");
    const events: { detail?: string; kind: string }[] = [];
    for await (const ev of adapter.events(run.runId)) events.push(ev as { detail?: string; kind: string });
    const progress = events.find((e) => e.kind === "progress");
    expect(progress?.detail).toMatch(/provider=openai-api model=gpt-4o-mini/);
    seenProvider = progress?.detail;
    expect(seenProvider).toBeDefined();
  });

  it("cancelTask transitions the run to 'cancelled' and emits a revoked event (parity with legacy cancel)", async () => {
    const adapter = new HermesProviderAdapter({ runtime: makeFakeHermesRuntime() });
    const run = await adapter.startTask(hermesTaskPacketFixture(), "grant-test");
    await adapter.cancelTask(run.runId, "user requested");
    const state = await adapter.getTask(run.runId);
    expect(state.status).toBe("cancelled");
    expect(state.detail).toBe("user requested");

    const events: { kind: string; detail?: string }[] = [];
    for await (const ev of adapter.events(run.runId)) events.push(ev as { kind: string; detail?: string });
    const revoked = events.find((e) => e.kind === "revoked");
    expect(revoked?.detail).toBe("user requested");
  });

  it("listChildActors returns the single host-mediated agent actor (parity with reference shape)", async () => {
    const adapter = new HermesProviderAdapter({ runtime: makeFakeHermesRuntime() });
    const run = await adapter.startTask(hermesTaskPacketFixture(), "grant-test");
    const children = await adapter.listChildActors(run.runId);
    expect(children).toEqual([
      { childId: "hermes.agent", kind: "agent", sandboxed: false, escalationRequired: false },
    ]);
  });

  it("localExecutionEnabled respects payload override > env override > settings (parity with legacy precedence)", () => {
    const adapter = new HermesProviderAdapter({ runtime: makeFakeHermesRuntime() });
    const previousEnv = process.env.RESONANTOS_HERMES_EXECUTION;
    try {
      delete process.env.RESONANTOS_HERMES_EXECUTION;
      expect(adapter.localExecutionEnabled({}, { hermes: { localCliExecution: true } })).toBe(true);
      expect(adapter.localExecutionEnabled({}, { hermes: { localCliExecution: false } })).toBe(false);
      expect(adapter.localExecutionEnabled({ enableHermesExecution: true }, { hermes: { localCliExecution: false } })).toBe(true);
      process.env.RESONANTOS_HERMES_EXECUTION = "enabled";
      expect(adapter.localExecutionEnabled({}, { hermes: { localCliExecution: false } })).toBe(true);
    } finally {
      if (previousEnv === undefined) delete process.env.RESONANTOS_HERMES_EXECUTION;
      else process.env.RESONANTOS_HERMES_EXECUTION = previousEnv;
    }
  });

  it("credentialState prefers session secrets when present (parity with legacy MiniMax routing)", () => {
    const adapter = new HermesProviderAdapter({ runtime: makeFakeHermesRuntime() });
    const withMinimax = adapter.credentialState({}, { MINIMAX_API_KEY: { key: "sk-m" } });
    expect(withMinimax.provider).toBe("minimax");
    expect(withMinimax.model).toBe(DEFAULT_HERMES_MINIMAX_MODEL_FOR_TEST);
    expect(withMinimax.configured).toBe(true);
    const withOpenAi = adapter.credentialState({}, { OPENAI_API_KEY: { key: "sk-o" } });
    expect(withOpenAi.provider).toBe("openai-api");
  });

  it("credentialBlockedReason explains how to resolve credential missing state (parity with legacy copy)", () => {
    const adapter = new HermesProviderAdapter({ runtime: makeFakeHermesRuntime() });
    const message = adapter.credentialBlockedReason(adapter.credentialState({}, {}));
    expect(message).toContain("Hermes provider credential unavailable");
    expect(message).toContain("Re-save the provider credential in Settings > Providers");
  });

  it("buildExecutionPrompt refuses tool calls and external sends (parity with legacy prompt guard)", () => {
    const adapter = new HermesProviderAdapter({ runtime: makeFakeHermesRuntime() });
    const prompt = adapter.buildExecutionPrompt(hermesTaskPacketFixture());
    expect(prompt).toContain("Do not attempt tool calls");
    expect(prompt).toContain("Do not send messages, schedule events, post publicly");
    expect(prompt).toContain("Final Summary, Actions Taken, Approval Needs, Residual Risks, Verification");
  });
});

const DEFAULT_HERMES_MINIMAX_MODEL_FOR_TEST = "minimax/MiniMax-M3";
