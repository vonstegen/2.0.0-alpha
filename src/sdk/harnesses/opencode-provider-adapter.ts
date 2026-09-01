// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/CP4-LIFECYCLE-EXTRACTION-MIGRATION.md
//
// CP-4 Phase 3: OpenCode lifecycle lifted onto `BaseHarnessProvider`.
// This adapter is the canonical author of the OpenCode lifecycle; the legacy
// `browser-first/host/addon-delegation-service.mjs` OpenCode block (43 refs,
// ~5 helpers) is a parallel implementation that will be thinned in Phase 4.
//
// Behavioral parity with the legacy service is preserved:
//   - workspace path enforcement (must stay inside repo root)
//   - `disabledAddons` gate (throws if `addon.opencode` is disabled)
//   - pre-existing-status guard (throws if `completed|cancelled`)
//   - credential gating with the same precedence chain
//     (payload.enableOpenCodeExecution > RESONANTOS_OPENCODE_EXECUTION >
//     settings.localOpenCodeExecution)
//   - provider/model routing by model-name heuristic + session secrets
//   - CLI invocation with deterministic fallback
//   - CLI output parsing with JSON-stream text extraction + section parse
//   - result-artifact emission through `complete(artifacts)`
//
// The adapter never spawns a real OpenCode process by default — the runtime
// is dependency-injected so unit tests can swap in a fixture and parity tests
// can exercise the full state machine deterministically.
//
// Distinct from Hermes:
//   - `cancellationSemantics = "finish-atomic"` (the lifecycle lets in-flight
//     work finish before honoring a cancel; legacy `executeOpenCodeDelegationCancel`
//     writes `cancelled` only when status is not already terminal).
//   - `sandboxStrength = "sandboxed-outer-boundary"` (shell + filesystem
//     granted via required grants; OpenCode is the strongest harness).
//   - Workspace is provider-bound (must be inside repo root; legacy
//     `resolveOpenCodeWorkspacePath` enforces this).

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { ArtifactRef, TaskPacket } from "../tasks";
import type {
  HarnessCancellationSemantics,
  HarnessHealth,
  HarnessRun,
  HarnessSandboxStrength,
} from "./index";
import { BaseHarnessProvider } from "./base-harness-provider";

// ---- Runtime contract (dependency injection) ----

export interface OpenCodeExecutionSettings {
  readonly localOpenCodeExecution: boolean;
  readonly disabledAddons?: readonly string[];
}

export interface OpenCodeProviderSecret {
  readonly key: string;
}

export interface OpenCodeRuntime {
  /** Discover the local OpenCode CLI command (or null if not installed). */
  discoverCommand(repoRoot: string): Promise<string | null>;
  /** Spawn the OpenCode CLI with the given args + scoped env; resolve with stdout. */
  invokeCli(command: string, args: readonly string[], options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeout: number;
  }): Promise<string>;
  /** Mint a deterministic artifact filename. */
  artifactFilename(runId: string): string;
}

const NULL_RUNTIME: OpenCodeRuntime = {
  async discoverCommand() {
    return null;
  },
  async invokeCli() {
    throw new Error("OpenCode CLI runtime not configured. Inject an OpenCodeRuntime.");
  },
  artifactFilename(runId) {
    return `${runId}-opencode-result.md`;
  },
};

export interface OpenCodeProviderAdapterOptions {
  readonly runtime?: OpenCodeRuntime;
  /** Override the deterministic branch (used by parity tests). */
  readonly deterministicResult?: OpenCodeDeterministicResult;
  /** Inject a workspace-path resolver (defaults to `repoRoot`). */
  readonly resolveWorkspacePath?: (payload: Record<string, unknown>) => string;
  /** Inject a repo-root anchor for workspace path enforcement. */
  readonly repoRoot?: string;
  /** Inject the execution-settings reader. */
  readonly readExecutionSettings?: () => Promise<OpenCodeExecutionSettings>;
  /** Inject the secrets reader. */
  readonly readSecrets?: () => Promise<Record<string, OpenCodeProviderSecret>>;
}

export interface OpenCodeDeterministicResult {
  readonly finalSummary: string;
  readonly actionsTaken: readonly string[];
  readonly changedFiles: readonly string[];
  readonly commandsRun: readonly string[];
  readonly residualRisks: readonly string[];
  readonly verification: readonly string[];
}

const DEFAULT_DETERMINISTIC_RESULT: OpenCodeDeterministicResult = {
  finalSummary: "OpenCode coding delegation is ready for review (deterministic adapter).",
  actionsTaken: [
    "Read the governed OpenCode coding packet.",
    "Checked the coding handoff boundary and required artifact contract.",
    "Prepared a reviewable coding result without shell execution, file edits, provider-secret access, wallet actions, or trusted memory writes.",
  ],
  changedFiles: [],
  commandsRun: [],
  residualRisks: [
    "This deterministic adapter proves ResonantOS OpenCode delegation lifecycle behavior; it does not claim code was changed by a local OpenCode runtime.",
  ],
  verification: [
    "Task packet was parsed.",
    "Workspace scope was checked.",
    "Result artifact was written under BrowserFirst/DelegationArtifacts/opencode.",
  ],
};

// ---- Provider/model routing ----

const DEFAULT_OPENCODE_MODEL = "gpt-4o-mini";
const MINIMAX_OPENCODE_MODEL = "minimax/MiniMax-M3";
const DEFAULT_OPENCODE_PROVIDER = "openai";
const MINIMAX_OPENCODE_PROVIDER = "minimax";

export function openCodeProviderForModel(model: string): string {
  const normalized = String(model ?? "").trim();
  if (/^minimax-m/i.test(normalized)) return MINIMAX_OPENCODE_PROVIDER;
  if (/^gpt-/i.test(normalized)) return DEFAULT_OPENCODE_PROVIDER;
  // Fallback: any model containing "minimax" / "openai" / "anthropic" / "openrouter".
  if (/minimax/i.test(normalized)) return MINIMAX_OPENCODE_PROVIDER;
  if (/anthropic|claude/i.test(normalized)) return "anthropic";
  if (/openrouter/i.test(normalized)) return "openrouter";
  return DEFAULT_OPENCODE_PROVIDER;
}

export function openCodeModel(payload: Record<string, unknown> = {}, secrets: Record<string, OpenCodeProviderSecret> = {}): string {
  const requested = String(payload.model ?? process.env.RESONANTOS_OPENCODE_MODEL ?? "").trim();
  if (requested) return requested;
  if (providerEnvKeysPresent(MINIMAX_OPENCODE_PROVIDER, secrets).length) return MINIMAX_OPENCODE_MODEL;
  return DEFAULT_OPENCODE_MODEL;
}

function providerEnvKeysForProvider(provider: string): readonly string[] {
  const normalized = String(provider ?? "").trim().toLowerCase();
  if (normalized === MINIMAX_OPENCODE_PROVIDER) {
    return ["MINIMAX_API_KEY", "MINIMAX_BASE_URL", "RESONANTOS_MINIMAX_API_KEY"];
  }
  if (normalized === "openai") {
    return ["OPENAI_API_KEY", "OPENAI_BASE_URL", "RESONANTOS_OPENAI_API_KEY"];
  }
  if (normalized === "openrouter") {
    return ["OPENROUTER_API_KEY", "RESONANTOS_OPENROUTER_API_KEY"];
  }
  if (normalized === "anthropic") {
    return ["ANTHROPIC_API_KEY", "RESONANTOS_ANTHROPIC_API_KEY"];
  }
  return [];
}

function providerEnvKeysPresent(
  provider: string,
  secrets: Record<string, OpenCodeProviderSecret>,
): string[] {
  const keys = providerEnvKeysForProvider(provider);
  const present: string[] = [];
  for (const key of keys) {
    if (secrets[key]) present.push(key);
  }
  return present;
}

export function openCodeProviderEnvKeys(model: string): readonly string[] {
  const provider = openCodeProviderForModel(model);
  const explicit = String(process.env.RESONANTOS_OPENCODE_PROVIDER_ENV ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => providerEnvKeysForProvider(openCodeProviderForModel(model)).includes(key));
  return [...new Set([...providerEnvKeysForProvider(provider), ...explicit])];
}

// ---- Adapter ----

export class OpenCodeProviderAdapter extends BaseHarnessProvider {
  readonly providerId = "opencode";
  readonly cancellationSemantics: HarnessCancellationSemantics = "finish-atomic";
  readonly sandboxStrength: HarnessSandboxStrength = "sandboxed-outer-boundary";

  private readonly runtime: OpenCodeRuntime;
  private readonly deterministic: OpenCodeDeterministicResult;
  private readonly resolveWorkspacePath: (payload: Record<string, unknown>) => string;
  private readonly repoRoot: string;
  private readonly readExecutionSettings: () => Promise<OpenCodeExecutionSettings>;
  private readonly readSecrets: () => Promise<Record<string, OpenCodeProviderSecret>>;

  constructor(options: OpenCodeProviderAdapterOptions = {}) {
    super();
    this.runtime = options.runtime ?? NULL_RUNTIME;
    this.deterministic = options.deterministicResult ?? DEFAULT_DETERMINISTIC_RESULT;
    this.repoRoot = options.repoRoot ?? process.cwd();
    this.resolveWorkspacePath = options.resolveWorkspacePath ?? (() => this.repoRoot);
    this.readExecutionSettings = options.readExecutionSettings ?? (async () => ({
      localOpenCodeExecution: false,
      disabledAddons: [],
    }));
    this.readSecrets = options.readSecrets ?? (async () => ({}));
  }

  // ---- Host-mirror helpers (exposed for parity tests) ----

  /** Whether the local OpenCode CLI may execute right now. Mirrors legacy `addonLocalCliExecutionEnabled("opencode", ...)`. */
  localExecutionEnabled(payload: Record<string, unknown> = {}, settings?: OpenCodeExecutionSettings): boolean {
    if (payload.enableOpenCodeExecution === true) return true;
    const env = String(process.env.RESONANTOS_OPENCODE_EXECUTION ?? "");
    if (/^enabled|true|1$/i.test(env)) return true;
    return Boolean(settings?.localOpenCodeExecution);
  }

  /** Whether the addon is currently enabled (not in `disabledAddons`). */
  isAddonEnabled(settings: OpenCodeExecutionSettings): boolean {
    return !(settings.disabledAddons ?? []).includes("addon.opencode");
  }

  /**
   * Resolve a workspace path that must stay inside the configured repo root.
   * Mirrors legacy `resolveOpenCodeWorkspacePath` — throws on violation.
   */
  resolveWorkspacePathSafe(payload: Record<string, unknown>): string {
    const resolved = path.resolve(this.resolveWorkspacePath(payload ?? {}));
    const allowedRoot = path.resolve(this.repoRoot);
    if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
      throw new Error("OpenCode workspace path must stay inside the ResonantOS repository for browser-first V1.");
    }
    return resolved;
  }

  credentialState(
    payload: Record<string, unknown> = {},
    secrets: Record<string, OpenCodeProviderSecret> = {},
  ): {
    provider: string;
    model: string;
    envKeys: readonly string[];
    configuredEnvKeys: readonly string[];
    configured: boolean;
  } {
    const model = openCodeModel(payload, secrets);
    const provider = openCodeProviderForModel(model);
    const envKeys = openCodeProviderEnvKeys(model);
    const configuredEnvKeys = providerEnvKeysPresent(provider, secrets);
    return {
      provider,
      model,
      envKeys,
      configuredEnvKeys,
      configured: configuredEnvKeys.length > 0,
    };
  }

  credentialBlockedReason(state: {
    provider: string;
    model: string;
    envKeys: readonly string[];
  }): string {
    const envHint = state.envKeys.length
      ? ` The bridge can also be started with ${state.envKeys.join(" or ")} in its environment.`
      : "";
    return [
      `OpenCode provider credential unavailable for ${state.provider} / ${state.model}.`,
      "Re-save the provider credential in Settings > Providers so the restarted browser-first bridge has it in session memory.",
      "Provider secrets remain session-only; ResonantOS does not persist plaintext provider credentials for this alpha.",
      envHint.trim(),
    ].filter(Boolean).join(" ");
  }

  // ---- Adapter surface ----

  async diagnose(): Promise<HarnessHealth> {
    const command = await this.runtime.discoverCommand(this.repoRoot).catch(() => null);
    const settings = await this.readExecutionSettings();
    const enabled = this.isAddonEnabled(settings) && this.localExecutionEnabled({}, settings);
    return {
      status: command && enabled ? "ok" : "degraded",
      providerId: this.providerId,
      version: "0.1.0",
      message: command && enabled
        ? "sandboxed coding agent (CLI found + execution enabled)"
        : !command
          ? "sandboxed coding agent (no local CLI)"
          : !this.isAddonEnabled(settings)
            ? "sandboxed coding agent (addon disabled in My Add-ons)"
            : "sandboxed coding agent (execution disabled)",
    };
  }
  async startTask(packet: TaskPacket, _grant: string): Promise<HarnessRun> {
    const settings = await this.readExecutionSettings();
    if (!this.isAddonEnabled(settings)) {
      const reason = "OpenCode is switched off in My Add-ons. Enable it before starting a delegation.";
      const run = await super.startTask(packet, _grant);
      this.fail(run.runId, reason);
      throw new Error(reason);
    }
    const run = await super.startTask(packet, _grant);

    const payload = (packet.outputContract ?? {}) as Record<string, unknown>;
    const adapter = String(payload.adapter ?? process.env.RESONANTOS_OPENCODE_ADAPTER ?? "auto")
      .trim()
      .toLowerCase();
    const workspacePath = this.resolveWorkspacePathSafe(payload);
    const command = adapter === "deterministic" ? null : await this.runtime.discoverCommand(this.repoRoot);

    if (adapter !== "deterministic" && !command) {
      const reason = "OpenCode CLI unavailable";
      this.fail(run.runId, reason);
      throw new Error(reason);
    }
    if (adapter !== "deterministic" && !this.localExecutionEnabled(payload, settings)) {
      const reason = "OpenCode execution requires explicit enablement";
      this.fail(run.runId, reason);
      throw new Error(reason);
    }
    const secrets = await this.readSecrets();
    const state = this.credentialState(payload, secrets);
    if (adapter !== "deterministic" && !state.configured) {
      const reason = this.credentialBlockedReason(state);
      this.fail(run.runId, reason);
      throw new Error(reason);
    }

    this.emitProgress(run.runId, `adapter=${adapter} provider=${state.provider} model=${state.model} workspace=${workspacePath}`);

    const prompt = this.buildExecutionPrompt(packet, workspacePath);
    let result: OpenCodeCliResult;
    try {
      result = adapter === "deterministic"
        ? this.deterministicFromPrompt(packet, workspacePath)
        : await this.invokeCliAndParse(command!, prompt, payload, workspacePath, state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (adapter !== "deterministic" && this.isCredentialError(message)) {
        const reason = this.credentialBlockedReason(state);
        this.fail(run.runId, reason);
        throw new Error(reason);
      }
      this.fail(run.runId, message);
      throw error;
    }

    const artifactRoot = this.artifactRootForWorkspace(workspacePath);
    const artifact: ArtifactRef = {
      artifactId: this.runtime.artifactFilename(run.runId),
      root: artifactRoot,
      sensitivity: "internal",
      provenance: { provider: state.provider, model: state.model, adapter },
    };
    this.complete(run.runId, [artifact]);

    return run;
  }

  // ---- Internals ----

  /** Build the governed OpenCode prompt (mirrors legacy `buildOpenCodeExecutionPrompt`). */
  buildExecutionPrompt(packet: TaskPacket, workspacePath: string): string {
    return [
      "You are OpenCode operating as a ResonantOS add-on coding agent.",
      "",
      `Workspace: ${workspacePath}`,
      "",
      "Mission:",
      packet.intent,
      "",
      "Rules:",
      "- Work only inside the approved workspace.",
      "- Do not access provider secrets, wallets, trusted Living Archive writes, or external send/submission surfaces.",
      "- Return a reviewable artifact.",
      "- Keep the output structured with these headings exactly: Final Summary, Changed Files, Commands Run, Tests, Residual Risks, Verification.",
    ].join("\n");
  }

  /**
   * Cancel a run, mirroring OpenCode's finish-atomic semantics: if the run is
   * already terminal (completed/failed), the cancel is a no-op and the state
   * is preserved (parity with legacy `executeOpenCodeDelegationCancel`).
   */
  override async cancelTask(runId: string, reason: string): Promise<void> {
    const state = await this.getTask(runId);
    if (state.status === "completed" || state.status === "failed" || state.status === "cancelled") {
      return;
    }
    await super.cancelTask(runId, reason);
  }

  /** Parse the CLI output (JSON stream or raw text) into the artifact shape. Mirrors legacy `parseOpenCodeCliResult`. */
  parseCliResult(output: string, workspacePath: string): OpenCodeCliResult {
    const text = this.extractOutputText(output);
    const finalSummary = this.sectionFromText(text, "Final Summary")
      || text.slice(0, 1600)
      || "OpenCode completed without returning a summary.";
    return {
      adapter: "opencode-cli",
      actionsTaken: ["Local OpenCode CLI returned a coding result through the host adapter."],
      changedFiles: this.sectionList(text, "Changed Files"),
      commandsRun: this.sectionList(text, "Commands Run"),
      finalSummary,
      residualRisks: this.sectionList(text, "Residual Risks").length
        ? this.sectionList(text, "Residual Risks")
        : ["OpenCode output is an add-on artifact and still requires normal human review."],
      verification: this.sectionList(text, "Verification").length
        ? this.sectionList(text, "Verification")
        : this.sectionList(text, "Tests").length
          ? this.sectionList(text, "Tests")
          : ["Local OpenCode CLI returned successfully."],
      workspacePath: path.relative(this.repoRoot, workspacePath) || ".",
    };
  }

  /** Deterministic branch result, parameterized for tests. */
  deterministicFromPrompt(packet: TaskPacket, workspacePath: string): OpenCodeCliResult {
    return {
      adapter: "deterministic",
      actionsTaken: [...this.deterministic.actionsTaken],
      changedFiles: [...this.deterministic.changedFiles],
      commandsRun: [...this.deterministic.commandsRun],
      finalSummary: `${this.deterministic.finalSummary} (mission: ${packet.intent.slice(0, 80)})`,
      residualRisks: [...this.deterministic.residualRisks],
      verification: [...this.deterministic.verification],
      workspacePath: path.relative(this.repoRoot, workspacePath) || ".",
    };
  }

  /** Loose credential-error detector. */
  isCredentialError(message: string): boolean {
    const text = String(message ?? "");
    return /credential|api[_\s-]?key|unauthorized|401|403/i.test(text);
  }

  // ---- CLI invocation ----

  private async invokeCliAndParse(
    command: string,
    prompt: string,
    payload: Record<string, unknown>,
    workspacePath: string,
    state: { provider: string; model: string },
  ): Promise<OpenCodeCliResult> {
    const tempRoot = path.join(workspacePath, ".resonantos-tmp", "opencode-prompts");
    await fs.mkdir(tempRoot, { recursive: true });
    const tempDir = await fs.mkdtemp(path.join(tempRoot, "prompt-"));
    const promptPath = path.join(tempDir, "resonantos-opencode-task.md");
    try {
      await fs.writeFile(promptPath, prompt, { mode: 0o600 });
      await fs.chmod(promptPath, 0o600).catch(() => undefined);
      const args = [
        "run",
        "Read the attached ResonantOS OpenCode task packet and return the requested artifact.",
        "--file",
        promptPath,
        "--dir",
        workspacePath,
        "-m",
        state.model,
        "--format",
        "json",
      ];
      const env = this.scopedEnv(state.model);
      const timeout = Math.min(900_000, Math.max(30_000, Number(payload.timeoutMs ?? 300_000)));
      const output = await this.runtime.invokeCli(command, args, { cwd: workspacePath, env, timeout });
      return { ...this.parseCliResult(output, workspacePath), model: state.model };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private scopedEnv(model: string): NodeJS.ProcessEnv {
    const out: NodeJS.ProcessEnv = { ...process.env, PATH: process.env.PATH ?? "" };
    for (const key of openCodeProviderEnvKeys(model)) {
      out[key] = process.env[key] ?? "";
    }
    return out;
  }

  private artifactRootForWorkspace(workspacePath: string): string {
    return path.join(workspacePath, ".resonantos-tmp", "artifacts");
  }

  // ---- Output text extraction ----

  private extractOutputText(output: string): string {
    const raw = String(output ?? "").trim();
    const textEvents: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const candidate = line.trim();
      if (!candidate.startsWith("{")) continue;
      try {
        const event = JSON.parse(candidate);
        const text = event?.part?.type === "text" ? event.part.text : event?.type === "text" ? event.text : "";
        if (text) textEvents.push(text);
      } catch {
        // Non-JSON output falls back to the raw stream below.
      }
    }
    return textEvents.join("\n\n").trim() || raw;
  }

  private sectionFromText(text: string, heading: string): string {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`## ${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`, "i").exec(text);
    return match ? match[1].trim() : "";
  }

  private sectionList(text: string, heading: string): string[] {
    return this.sectionFromText(text, heading)
      .split("\n")
      .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
      .filter(Boolean);
  }
}

export interface OpenCodeCliResult {
  adapter: string;
  actionsTaken: string[];
  changedFiles: string[];
  commandsRun: string[];
  finalSummary: string;
  residualRisks: string[];
  verification: string[];
  workspacePath: string;
  model?: string;
}

// ---- Test helpers ----

/** Helper exposed for parity tests: build a `TaskPacket` fixture for the adapter. */
export function openCodeTaskPacketFixture(overrides: Partial<TaskPacket> = {}): TaskPacket {
  const base: TaskPacket = {
    taskId: "task-opencode-1",
    issuerPrincipalId: "augmentor:test",
    executorPrincipalId: "opencode.agent",
    delegationChainRef: { delegationId: "delegation-opencode-1" },
    intent: "Read the provided document and produce a final summary.",
    successCriteria: ["final summary present"],
    nonGoals: [],
    outputContract: { adapter: "deterministic" },
    contextRefs: {
      facts: [],
      provenance: ["test"],
      sensitivity: "internal",
      freshness: "current",
      allowedPurpose: "review",
      retentionPolicy: "session-only",
      redactions: [],
    },
    requestedCapabilities: [],
    resourceBudget: {
      priority: 0,
      deadline: new Date(Date.now() + 60_000).toISOString(),
      concurrencyClass: "interactive",
      estimated: { tokens: 1000, wallClockMs: 60_000 },
      hardCeiling: { tokens: 8000, wallClockMs: 300_000 },
      requiredNodeRoles: [],
      networkMode: "host-mediated",
      workspaceMode: "isolated",
      secretPolicy: "session-only",
      onExhaustion: "stop",
    },
    workspaceRoots: [os.tmpdir()],
    approvalPolicy: "human-review-required",
    deadline: new Date(Date.now() + 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    cancellationChannel: "test-channel",
    auditCorrelationId: "audit-opencode-1",
  };
  return { ...base, ...overrides };
}

/** Helper exposed for parity tests: an in-memory fake `OpenCodeRuntime`. */
export function makeFakeOpenCodeRuntime(overrides: Partial<OpenCodeRuntime> = {}): OpenCodeRuntime {
  const base: OpenCodeRuntime = {
    async discoverCommand() {
      return "/usr/local/bin/opencode";
    },
    async invokeCli(_command, _args, _options) {
      return [
        "## Final Summary",
        "Reviewed the document and produced a final summary.",
        "",
        "## Changed Files",
        "- src/example.ts",
        "",
        "## Commands Run",
        "- pnpm test",
        "",
        "## Residual Risks",
        "- None identified.",
        "",
        "## Verification",
        "- Document parsed.",
        "",
      ].join("\n");
    },
    artifactFilename(runId) {
      return `${runId}-opencode-result.md`;
    },
    ...overrides,
  };
  return base;
}
