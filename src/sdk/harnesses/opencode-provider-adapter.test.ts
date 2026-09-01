import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  OpenCodeProviderAdapter,
  makeFakeOpenCodeRuntime,
  openCodeTaskPacketFixture,
} from "./opencode-provider-adapter";

const TMP_REPO_ROOT = path.join(os.tmpdir(), "opencode-adapter-test");

describe("OpenCodeProviderAdapter parity (CP-4 Phase 3)", () => {
  it("lifts the OpenCode identity + semantics from the reference stub", () => {
    const adapter = new OpenCodeProviderAdapter({ repoRoot: TMP_REPO_ROOT });
    expect(adapter.providerId).toBe("opencode");
    expect(adapter.cancellationSemantics).toBe("finish-atomic");
    expect(adapter.sandboxStrength).toBe("sandboxed-outer-boundary");
  });

  it("diagnose returns 'ok' when CLI found + addon enabled + execution enabled, 'degraded' otherwise", async () => {
    // CLI found but execution disabled (no payload, no env) → degraded.
    const execDisabled = new OpenCodeProviderAdapter({
      repoRoot: TMP_REPO_ROOT,
      runtime: makeFakeOpenCodeRuntime(),
      readExecutionSettings: async () => ({ localOpenCodeExecution: false, disabledAddons: [] }),
    });
    expect((await execDisabled.diagnose()).status).toBe("degraded");

    // CLI found + execution enabled + addon enabled → ok.
    const ok = new OpenCodeProviderAdapter({
      repoRoot: TMP_REPO_ROOT,
      runtime: makeFakeOpenCodeRuntime(),
      readExecutionSettings: async () => ({ localOpenCodeExecution: true, disabledAddons: [] }),
    });
    expect((await ok.diagnose()).status).toBe("ok");

    // No CLI → degraded.
    const noCli = new OpenCodeProviderAdapter({
      repoRoot: TMP_REPO_ROOT,
      runtime: makeFakeOpenCodeRuntime({ async discoverCommand() { return null; } }),
      readExecutionSettings: async () => ({ localOpenCodeExecution: true, disabledAddons: [] }),
    });
    expect((await noCli.diagnose()).status).toBe("degraded");

    // Addon disabled → degraded.
    const disabled = new OpenCodeProviderAdapter({
      repoRoot: TMP_REPO_ROOT,
      runtime: makeFakeOpenCodeRuntime(),
      readExecutionSettings: async () => ({ localOpenCodeExecution: true, disabledAddons: ["addon.opencode"] }),
    });
    expect((await disabled.diagnose()).status).toBe("degraded");
  });

  it("startTask deterministic branch: completes with one artifact and emits completion event", async () => {
    const adapter = new OpenCodeProviderAdapter({
      repoRoot: TMP_REPO_ROOT,
      runtime: makeFakeOpenCodeRuntime(),
      readExecutionSettings: async () => ({ localOpenCodeExecution: false, disabledAddons: [] }),
    });
    const packet = openCodeTaskPacketFixture({ workspaceRoots: [TMP_REPO_ROOT] });
    const run = await adapter.startTask(packet, "grant-test");

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

  it("startTask rejects when the addon is disabled in My Add-ons", async () => {
    const adapter = new OpenCodeProviderAdapter({
      repoRoot: TMP_REPO_ROOT,
      runtime: makeFakeOpenCodeRuntime(),
      readExecutionSettings: async () => ({ localOpenCodeExecution: false, disabledAddons: ["addon.opencode"] }),
    });
    const packet = openCodeTaskPacketFixture({ workspaceRoots: [TMP_REPO_ROOT] });
    await expect(adapter.startTask(packet, "grant-test")).rejects.toThrow(/switched off in My Add-ons/i);
  });

  it("startTask rejects when the workspace path is outside repo root", async () => {
    const outside = path.join(os.tmpdir(), "outside-repo");
    const adapter = new OpenCodeProviderAdapter({
      repoRoot: TMP_REPO_ROOT,
      runtime: makeFakeOpenCodeRuntime(),
      readExecutionSettings: async () => ({ localOpenCodeExecution: false, disabledAddons: [] }),
      resolveWorkspacePath: () => outside,
    });
    const packet = openCodeTaskPacketFixture({ workspaceRoots: [TMP_REPO_ROOT] });
    await expect(adapter.startTask(packet, "grant-test")).rejects.toThrow(/workspace path must stay inside/i);
  });

  it("startTask rejects when the CLI is missing (parity with legacy 'CLI unavailable' gate)", async () => {
    const adapter = new OpenCodeProviderAdapter({
      repoRoot: TMP_REPO_ROOT,
      runtime: makeFakeOpenCodeRuntime({ async discoverCommand() { return null; } }),
      readExecutionSettings: async () => ({ localOpenCodeExecution: true, disabledAddons: [] }),
      readSecrets: async () => ({ OPENAI_API_KEY: { key: "sk-test" } }),
    });
    const packet = openCodeTaskPacketFixture({
      workspaceRoots: [TMP_REPO_ROOT],
      outputContract: { adapter: "cli" },
    });
    await expect(adapter.startTask(packet, "grant-test")).rejects.toThrow(/CLI unavailable/i);
  });

  it("startTask rejects when no provider credentials are configured (parity with legacy 'credential unavailable' gate)", async () => {
    const adapter = new OpenCodeProviderAdapter({
      repoRoot: TMP_REPO_ROOT,
      runtime: makeFakeOpenCodeRuntime(),
      readExecutionSettings: async () => ({ localOpenCodeExecution: true, disabledAddons: [] }),
      readSecrets: async () => ({}),
    });
    const packet = openCodeTaskPacketFixture({
      workspaceRoots: [TMP_REPO_ROOT],
      outputContract: { adapter: "cli" },
    });
    await expect(adapter.startTask(packet, "grant-test")).rejects.toThrow(/credential unavailable/i);
  });

  it("startTask CLI branch: parses structured output and emits provider/model progress", async () => {
    const adapter = new OpenCodeProviderAdapter({
      repoRoot: TMP_REPO_ROOT,
      runtime: makeFakeOpenCodeRuntime(),
      readExecutionSettings: async () => ({ localOpenCodeExecution: true, disabledAddons: [] }),
      readSecrets: async () => ({ OPENAI_API_KEY: { key: "sk-test" } }),
    });
    const packet = openCodeTaskPacketFixture({
      workspaceRoots: [TMP_REPO_ROOT],
      outputContract: { adapter: "cli" },
    });
    const run = await adapter.startTask(packet, "grant-test");
    expect(run.status).toBe("completed");
    const events: { detail?: string; kind: string }[] = [];
    for await (const ev of adapter.events(run.runId)) events.push(ev as { kind: string; detail?: string });
    const progress = events.find((e) => e.kind === "progress");
    expect(progress?.detail).toContain("provider=openai");
    expect(progress?.detail).toContain("model=gpt-4o-mini");
  });

  it("cancelTask is a no-op for an already-terminal run (parity with legacy finish-atomic gate)", async () => {
    const adapter = new OpenCodeProviderAdapter({
      repoRoot: TMP_REPO_ROOT,
      runtime: makeFakeOpenCodeRuntime(),
      readExecutionSettings: async () => ({ localOpenCodeExecution: false, disabledAddons: [] }),
    });
    const packet = openCodeTaskPacketFixture({ workspaceRoots: [TMP_REPO_ROOT] });
    const run = await adapter.startTask(packet, "grant-test");
    await adapter.cancelTask(run.runId, "human cancelled");

    const state = await adapter.getTask(run.runId);
    // finish-atomic semantics: terminal runs preserve their status.
    expect(state.status).toBe("completed");

    const events: { kind: string }[] = [];
    for await (const ev of adapter.events(run.runId)) events.push(ev as { kind: string });
    expect(events.find((e) => e.kind === "completed")).toBeDefined();
  });

  it("localExecutionEnabled respects payload override > env override > settings (parity with legacy precedence)", () => {
    const adapter = new OpenCodeProviderAdapter({ repoRoot: TMP_REPO_ROOT });
    expect(adapter.localExecutionEnabled({ enableOpenCodeExecution: true }, { localOpenCodeExecution: false })).toBe(true);
    expect(adapter.localExecutionEnabled({}, { localOpenCodeExecution: false })).toBe(false);
    expect(adapter.localExecutionEnabled({}, { localOpenCodeExecution: true })).toBe(true);
  });

  it("credentialState prefers MiniMax session secrets when present (parity with legacy MiniMax routing)", () => {
    const adapter = new OpenCodeProviderAdapter({ repoRoot: TMP_REPO_ROOT });
    const minimaxSecrets = { MINIMAX_API_KEY: { key: "sk-minimax" } };
    const state = adapter.credentialState({}, minimaxSecrets);
    expect(state.provider).toBe("minimax");
    expect(state.model).toBe("minimax/MiniMax-M3");
    expect(state.configured).toBe(true);

    const openaiSecrets = { OPENAI_API_KEY: { key: "sk-openai" } };
    const stateOpenai = adapter.credentialState({}, openaiSecrets);
    expect(stateOpenai.provider).toBe("openai");
    expect(stateOpenai.model).toBe("gpt-4o-mini");
    expect(stateOpenai.configured).toBe(true);
  });

  it("credentialBlockedReason explains how to resolve credential missing state (parity with legacy copy)", () => {
    const adapter = new OpenCodeProviderAdapter({ repoRoot: TMP_REPO_ROOT });
    const reason = adapter.credentialBlockedReason({
      provider: "openai",
      model: "gpt-4o-mini",
      envKeys: ["OPENAI_API_KEY"],
    });
    expect(reason).toContain("OpenCode provider credential unavailable");
    expect(reason).toContain("OPENAI_API_KEY");
  });

  it("buildExecutionPrompt refuses tool calls and external sends (parity with legacy prompt guard)", () => {
    const adapter = new OpenCodeProviderAdapter({ repoRoot: TMP_REPO_ROOT });
    const prompt = adapter.buildExecutionPrompt(openCodeTaskPacketFixture({ workspaceRoots: [TMP_REPO_ROOT] }), TMP_REPO_ROOT);
    expect(prompt).toContain("OpenCode operating as a ResonantOS add-on coding agent");
    expect(prompt).toContain("Do not access provider secrets");
    expect(prompt).toContain("reviewable artifact");
  });

  it("parseCliResult extracts Final Summary, Changed Files, Commands Run from structured CLI output", () => {
    const adapter = new OpenCodeProviderAdapter({ repoRoot: TMP_REPO_ROOT });
    const text = [
      "## Final Summary",
      "Refactored the export pipeline.",
      "",
      "## Changed Files",
      "- src/export.ts",
      "",
      "## Commands Run",
      "- pnpm test",
      "",
      "## Residual Risks",
      "- None.",
      "",
      "## Verification",
      "- Tests pass.",
    ].join("\n");
    const result = adapter.parseCliResult(text, TMP_REPO_ROOT);
    expect(result.adapter).toBe("opencode-cli");
    expect(result.finalSummary).toBe("Refactored the export pipeline.");
    expect(result.changedFiles).toEqual(["src/export.ts"]);
    expect(result.commandsRun).toEqual(["pnpm test"]);
    expect(result.residualRisks).toEqual(["None."]);
    expect(result.verification).toEqual(["Tests pass."]);
    expect(result.workspacePath).toBe(".");
  });

  it("deterministicFromPrompt includes the mission intent in the finalSummary", () => {
    const adapter = new OpenCodeProviderAdapter({ repoRoot: TMP_REPO_ROOT });
    const packet = openCodeTaskPacketFixture({
      intent: "Audit the financial report.",
      workspaceRoots: [TMP_REPO_ROOT],
    });
    const result = adapter.deterministicFromPrompt(packet, TMP_REPO_ROOT);
    expect(result.adapter).toBe("deterministic");
    expect(result.finalSummary).toContain("Audit the financial report.");
    expect(result.workspacePath).toBe(".");
  });

  it("resolveWorkspacePathSafe throws when the resolved path is outside repo root, respects payload override", () => {
    const outside = path.join(os.tmpdir(), "outside-repo");
    const adapter = new OpenCodeProviderAdapter({
      repoRoot: TMP_REPO_ROOT,
      resolveWorkspacePath: (payload) =>
        typeof payload.workspacePath === "string" ? payload.workspacePath : outside,
    });
    expect(() => adapter.resolveWorkspacePathSafe({})).toThrow(/workspace path must stay inside/i);
    expect(adapter.resolveWorkspacePathSafe({ workspacePath: TMP_REPO_ROOT })).toBe(TMP_REPO_ROOT);
  });

  it("isAddonEnabled rejects settings with `addon.opencode` in disabledAddons", () => {
    const adapter = new OpenCodeProviderAdapter({ repoRoot: TMP_REPO_ROOT });
    expect(adapter.isAddonEnabled({ localOpenCodeExecution: true, disabledAddons: [] })).toBe(true);
    expect(adapter.isAddonEnabled({ localOpenCodeExecution: true, disabledAddons: ["addon.opencode"] })).toBe(false);
  });

  it("isCredentialError recognizes 401/403 + api-key style failures (parity with legacy heuristic)", () => {
    const adapter = new OpenCodeProviderAdapter({ repoRoot: TMP_REPO_ROOT });
    expect(adapter.isCredentialError("401 Unauthorized")).toBe(true);
    expect(adapter.isCredentialError("API key missing")).toBe(true);
    expect(adapter.isCredentialError("network timeout")).toBe(false);
  });
});
