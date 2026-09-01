import { describe, expect, it } from "vitest";

import {
  DeepSeekHarnessProviderAdapter,
  deepSeekTaskPacketFixture,
  makeFakeDeepSeekRuntime,
} from "./deepseek-provider-adapter";

describe("DeepSeekHarnessProviderAdapter parity (CP-4 Phase 3)", () => {
  it("lifts the DeepSeek identity + semantics from the reference stub", () => {
    const adapter = new DeepSeekHarnessProviderAdapter();
    expect(adapter.providerId).toBe("deepseek-harness");
    expect(adapter.cancellationSemantics).toBe("cancel");
    expect(adapter.sandboxStrength).toBe("host-mediated");
  });

  it("diagnose returns 'ok' when the base URL probe succeeds, 'degraded' otherwise", async () => {
    const ok = new DeepSeekHarnessProviderAdapter({ runtime: makeFakeDeepSeekRuntime() });
    const health = await ok.diagnose();
    expect(health.status).toBe("ok");
    expect(health.message).toContain("https://api.deepseek.com/v1");

    const down = new DeepSeekHarnessProviderAdapter({
      runtime: makeFakeDeepSeekRuntime({ async probeBaseUrl() { return null; } }),
    });
    expect((await down.diagnose()).status).toBe("degraded");
  });

  it("startTask deterministic branch: completes with one artifact and emits completion event", async () => {
    const adapter = new DeepSeekHarnessProviderAdapter({ runtime: makeFakeDeepSeekRuntime() });
    const run = await adapter.startTask(deepSeekTaskPacketFixture(), "grant-test");

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

  it("startTask CLI branch rejects when no DeepSeek API key is configured", async () => {
    const adapter = new DeepSeekHarnessProviderAdapter({
      runtime: makeFakeDeepSeekRuntime({ async readSecrets() { return {}; } }),
    });
    const packet = deepSeekTaskPacketFixture({ outputContract: { adapter: "http" } });
    await expect(adapter.startTask(packet, "grant-test")).rejects.toThrow(/credential unavailable/i);
  });

  it("startTask CLI branch: parses structured output and emits model/baseUrl progress", async () => {
    const adapter = new DeepSeekHarnessProviderAdapter({ runtime: makeFakeDeepSeekRuntime() });
    const packet = deepSeekTaskPacketFixture({ outputContract: { adapter: "http" } });
    const run = await adapter.startTask(packet, "grant-test");
    expect(run.status).toBe("completed");

    const events: { detail?: string; kind: string }[] = [];
    for await (const ev of adapter.events(run.runId)) events.push(ev as { kind: string; detail?: string });
    const progress = events.find((e) => e.kind === "progress");
    expect(progress?.detail).toContain("model=deepseek-chat");
    expect(progress?.detail).toContain("baseUrl=https://api.deepseek.com/v1");
  });

  it("listChildActors returns the single cloud-inference child (parity with reference shape)", async () => {
    const adapter = new DeepSeekHarnessProviderAdapter({ runtime: makeFakeDeepSeekRuntime() });
    const run = await adapter.startTask(deepSeekTaskPacketFixture(), "grant-test");
    const children = await adapter.listChildActors(run.runId);
    expect(children).toHaveLength(1);
    expect(children[0]?.childId).toBe("deepseek-harness.inference");
    expect(children[0]?.kind).toBe("cloud-inference");
    expect(children[0]?.sandboxed).toBe(false);
  });

  it("credentialState returns configured=true when DEEPSEEK_API_KEY is present", () => {
    const adapter = new DeepSeekHarnessProviderAdapter();
    const state = adapter.credentialState({}, { DEEPSEEK_API_KEY: { key: "sk-test" } });
    expect(state.provider).toBe("deepseek");
    expect(state.model).toBe("deepseek-chat");
    expect(state.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(state.configured).toBe(true);

    const empty = adapter.credentialState({}, {});
    expect(empty.configured).toBe(false);
  });

  it("credentialBlockedReason explains how to resolve credential missing state", () => {
    const adapter = new DeepSeekHarnessProviderAdapter();
    const reason = adapter.credentialBlockedReason({
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com/v1",
      configured: false,
    });
    expect(reason).toContain("DeepSeek provider credential unavailable");
    expect(reason).toContain("Settings > Providers");
  });

  it("parseCliResult extracts Final Summary + section lists from structured output", () => {
    const adapter = new DeepSeekHarnessProviderAdapter();
    const text = [
      "## Final Summary",
      "Compiled inference results.",
      "",
      "## Actions Taken",
      "- Indexed tokens",
      "- Trimmed context",
      "## Residual Risks",
      "- None.",
      "",
      "## Verification",
      "- Cloud returned.",
    ].join("\n");
    const result = adapter.parseCliResult(text);
    expect(result.finalSummary).toBe("Compiled inference results.");
    expect(result.actionsTaken).toEqual(["Indexed tokens", "Trimmed context"]);
    expect(result.residualRisks).toEqual(["None."]);
  });

  it("deterministicFromPrompt includes the mission intent in the finalSummary", () => {
    const adapter = new DeepSeekHarnessProviderAdapter();
    const packet = deepSeekTaskPacketFixture({ intent: "Summarize the diff." });
    const result = adapter.deterministicFromPrompt(packet);
    expect(result.finalSummary).toContain("Summarize the diff.");
  });

  it("buildExecutionPrompt refuses tool calls and external sends", () => {
    const adapter = new DeepSeekHarnessProviderAdapter();
    const prompt = adapter.buildExecutionPrompt(deepSeekTaskPacketFixture());
    expect(prompt).toContain("DeepSeek operating as a ResonantOS add-on cloud-inference agent");
    expect(prompt).toContain("Do not attempt tool calls");
    expect(prompt).toContain("reviewable artifact");
  });

  it("isCredentialError recognizes 401/403 + api-key style failures", () => {
    const adapter = new DeepSeekHarnessProviderAdapter();
    expect(adapter.isCredentialError("401 Unauthorized")).toBe(true);
    expect(adapter.isCredentialError("API key missing")).toBe(true);
    expect(adapter.isCredentialError("network timeout")).toBe(false);
  });
});
