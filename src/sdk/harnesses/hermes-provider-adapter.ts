// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/CP4-LIFECYCLE-EXTRACTION-MIGRATION.md
//
// CP-4 Phase 2: Hermes lifecycle lifted onto `BaseHarnessProvider`.
// This adapter is the canonical author of the Hermes lifecycle; the legacy
// `browser-first/host/addon-delegation-service.mjs` Hermes block (72 refs,
// ~10 helpers) is a parallel implementation that will be thinned in Phase 4.
//
// Behavioral parity with the legacy service is preserved:
//   - credential gating (RESONANTOS_HERMES_EXECUTION, settings.localCliExecution,
//     payload.enableHermesExecution) — `localExecutionEnabled`
//   - credential-state probe with blocked-reason messaging — `credentialState`
//     + `credentialBlockedReason`
//   - provider/model resolution — `resolveProvider`, `resolveModel`
//   - CLI invocation with deterministic fallback — `invokeCli`
//   - CLI output parsing with unresolved-tool-call rejection — `parseCliOutput`
//   - result-artifact emission through `complete(artifacts)`
//
// The adapter never spawns a real Hermes process by default — the runtime is
// dependency-injected so unit tests can swap in a fixture and parity tests can
// exercise the full state machine deterministically.

import type { ArtifactRef, TaskPacket } from "../tasks";
import type {
  HarnessCancellationSemantics,
  HarnessChildDescriptor,
  HarnessHealth,
  HarnessRun,
  HarnessSandboxStrength,
} from "./index";
import { BaseHarnessProvider } from "./base-harness-provider";

// ---- Runtime contract (dependency injection) ----

export interface HermesExecutionSettings {
  readonly hermes: { readonly localCliExecution: boolean };
}

export interface HermesProviderSecret {
  readonly key: string;
}

export interface HermesProviderCredentialState {
  readonly provider: string;
  readonly model: string;
  readonly envKeys: readonly string[];
  readonly configuredEnvKeys: readonly string[];
  readonly configured: boolean;
}

export interface HermesRuntime {
  /** Discover the local Hermes CLI command (or null if not installed). */
  discoverCommand(profileHome: string | null): Promise<string | null>;
  /** Return the Hermes profile home directory (already trust-bounded). */
  resolveProfileHome(profileHome?: string): string;
  /** Look up session-scoped provider secrets. */
  readSecrets(): Promise<Record<string, HermesProviderSecret>>;
  /** Read the host-side addon-execution settings file. */
  readExecutionSettings(): Promise<HermesExecutionSettings>;
  /**
   * Spawn the Hermes CLI with the given prompt; resolve with the rendered
   * artifact text. Implementations MUST enforce the same trust boundary the
   * legacy service enforces (trusted PATH only).
   */
  invokeCli(command: string, prompt: string): Promise<string>;
  /** Path under which result artifacts may be written (must be inside workspaceRoot). */
  artifactRoot(workspaceRoot: string): string;
  /** Mint a deterministic artifact filename. */
  artifactFilename(runId: string): string;
}

const DEFAULT_HERMES_PROVIDER = "openai-api";
const DEFAULT_HERMES_MODEL = "gpt-4o-mini";
const DEFAULT_HERMES_MINIMAX_MODEL = "minimax/MiniMax-M3";

function providerEnvKeysForProvider(provider: string): readonly string[] {
  const normalized = String(provider ?? "").trim().toLowerCase();
  if (normalized === "minimax") {
    return ["MINIMAX_API_KEY", "MINIMAX_BASE_URL", "RESONANTOS_MINIMAX_API_KEY"];
  }
  if (normalized === "openai" || normalized === "openai-api") {
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
  secrets: Record<string, HermesProviderSecret>,
): string[] {
  const keys = providerEnvKeysForProvider(provider);
  const present: string[] = [];
  for (const key of keys) {
    if (secrets[key]) present.push(key);
  }
  return present;
}

// A no-op runtime: every discovery returns null (no CLI), secrets empty,
// settings disabled. Conformance tests use this default and pass because they
// exercise the lifecycle shape, not live I/O.
const NULL_RUNTIME: HermesRuntime = {
  async discoverCommand() {
    return null;
  },
  resolveProfileHome() {
    return "/dev/null/profile-home";
  },
  async readSecrets() {
    return {};
  },
  async readExecutionSettings() {
    return { hermes: { localCliExecution: false } };
  },
  async invokeCli() {
    throw new Error("Hermes CLI runtime not configured. Inject a HermesRuntime.");
  },
  artifactRoot() {
    return "/tmp";
  },
  artifactFilename(runId) {
    return `${runId}-hermes-result.md`;
  },
};

export interface HermesProviderAdapterOptions {
  readonly runtime?: HermesRuntime;
  /** Override the deterministic branch (used by parity tests). */
  readonly deterministicResult?: HermesDeterministicResult;
}

export interface HermesDeterministicResult {
  readonly finalSummary: string;
  readonly actionsTaken: readonly string[];
  readonly approvalNeeds: readonly string[];
  readonly residualRisks: readonly string[];
  readonly verification: readonly string[];
}

const DEFAULT_DETERMINISTIC_RESULT: HermesDeterministicResult = {
  finalSummary: "Hermes delegation is ready for review (deterministic adapter).",
  actionsTaken: [
    "Read the governed Hermes delegation packet.",
    "Checked the task boundary and artifact return contract.",
    "Reviewed the attached bounded context packet.",
    "Prepared a reviewable result without external sends or trusted memory writes.",
  ],
  approvalNeeds: [
    "Human approval is required before Hermes sends messages, schedules events, posts publicly, or changes external systems.",
  ],
  residualRisks: [
    "This deterministic adapter proves ResonantOS delegation lifecycle behavior; it does not claim the local Hermes model completed real-world research.",
  ],
  verification: [
    "Task packet was parsed.",
    "Safety boundary was preserved.",
    "Result artifact was written under BrowserFirst/DelegationArtifacts/hermes.",
  ],
};

export class HermesProviderAdapter extends BaseHarnessProvider {
  readonly providerId = "hermes";
  readonly cancellationSemantics: HarnessCancellationSemantics = "cancel";
  readonly sandboxStrength: HarnessSandboxStrength = "host-mediated";

  private readonly runtime: HermesRuntime;
  private readonly deterministic: HermesDeterministicResult;

  constructor(options: HermesProviderAdapterOptions = {}) {
    super();
    this.runtime = options.runtime ?? NULL_RUNTIME;
    this.deterministic = options.deterministicResult ?? DEFAULT_DETERMINISTIC_RESULT;
  }

  // ---- Host-mirror helpers (exposed for parity tests; not part of the adapter contract) ----

  /**
   * Whether the local Hermes CLI may execute right now, considering the
   * explicit payload override, the env override, and the persisted settings
   * file. Mirrors the legacy `addonLocalCliExecutionEnabled("hermes", ...)`.
   */
  localExecutionEnabled(payload: Record<string, unknown> = {}, settings?: HermesExecutionSettings): boolean {
    if (payload.enableHermesExecution === true) return true;
    const env = String(process.env.RESONANTOS_HERMES_EXECUTION ?? "");
    if (/^enabled|true|1$/i.test(env)) return true;
    return Boolean(settings?.hermes?.localCliExecution);
  }

  resolveProvider(payload: Record<string, unknown> = {}, secrets: Record<string, HermesProviderSecret> = {}): string {
    const requested = String(
      payload.provider ?? process.env.RESONANTOS_HERMES_PROVIDER ?? process.env.HERMES_INFERENCE_PROVIDER ?? "",
    ).trim();
    if (requested) return requested;
    if (providerEnvKeysPresent("minimax", secrets).length) return "minimax";
    if (providerEnvKeysPresent("openai-api", secrets).length) return DEFAULT_HERMES_PROVIDER;
    if (providerEnvKeysPresent("openrouter", secrets).length) return "openrouter";
    if (providerEnvKeysPresent("anthropic", secrets).length) return "anthropic";
    return DEFAULT_HERMES_PROVIDER;
  }

  resolveModel(
    payload: Record<string, unknown> = {},
    provider: string = DEFAULT_HERMES_PROVIDER,
  ): string {
    const requested = String(
      payload.model ?? process.env.RESONANTOS_HERMES_MODEL ?? process.env.HERMES_INFERENCE_MODEL ?? "",
    ).trim();
    const normalizedProvider = String(provider ?? "").trim().toLowerCase();
    const model = requested || (
      normalizedProvider === "minimax"
        ? DEFAULT_HERMES_MINIMAX_MODEL
        : normalizedProvider === "openrouter"
          ? "openai/gpt-4o-mini"
          : DEFAULT_HERMES_MODEL
    );
    if ((normalizedProvider === "openai" || normalizedProvider === "openai-api") && model.startsWith("openai/")) {
      return model.slice("openai/".length);
    }
    return model;
  }

  credentialState(
    payload: Record<string, unknown> = {},
    secrets: Record<string, HermesProviderSecret> = {},
  ): HermesProviderCredentialState {
    const provider = this.resolveProvider(payload, secrets);
    const model = this.resolveModel(payload, provider);
    const envKeys = providerEnvKeysForProvider(provider);
    const configuredEnvKeys = providerEnvKeysPresent(provider, secrets);
    return {
      provider,
      model,
      envKeys,
      configuredEnvKeys,
      configured: configuredEnvKeys.length > 0,
    };
  }

  credentialBlockedReason(state: HermesProviderCredentialState): string {
    const envHint = state.envKeys.length
      ? ` The bridge can also be started with ${state.envKeys.join(" or ")} in its environment.`
      : "";
    return [
      `Hermes provider credential unavailable for ${state.provider} / ${state.model}.`,
      "Re-save the provider credential in Settings > Providers so the restarted browser-first bridge has it in session memory.",
      "Provider secrets remain session-only; ResonantOS does not persist plaintext provider credentials for this alpha.",
      envHint.trim(),
    ].filter(Boolean).join(" ");
  }

  // ---- Adapter surface ----

  async diagnose(): Promise<HarnessHealth> {
    const profileHome = this.runtime.resolveProfileHome(undefined);
    const command = await this.runtime.discoverCommand(profileHome).catch(() => null);
    return {
      status: command ? "ok" : "degraded",
      providerId: this.providerId,
      version: "0.1.0",
      message: command ? "host-mediated agent (CLI found)" : "host-mediated agent (no local CLI)",
    };
  }

  async listChildActors(runId: string): Promise<HarnessChildDescriptor[]> {
    await this.getTask(runId); // existence check
    return [
      { childId: "hermes.agent", kind: "agent", sandboxed: false, escalationRequired: false },
    ];
  }

  /**
   * Lifted Hermes delegation lifecycle. Mirrors the legacy
   * `executeHermesDelegationStart` function. The host service retains route
   * dispatch; this adapter owns the state machine and result emission.
   *
   * The adapter does not write markdown packets — that is host-side glue. It
   * emits events through `BaseHarnessProvider` and finalizes via `complete` /
   * `fail`.
   */
  async startTask(packet: TaskPacket, _grant: string): Promise<HarnessRun> {
    const run = await super.startTask(packet, _grant);

    const payload = (packet.outputContract ?? {}) as Record<string, unknown>;
    const settings = await this.runtime.readExecutionSettings();
    const secrets = await this.runtime.readSecrets();
    const adapter = String(payload.adapter ?? process.env.RESONANTOS_HERMES_ADAPTER ?? "auto")
      .trim()
      .toLowerCase();
    const profileHome = this.runtime.resolveProfileHome(
      typeof payload.profileHome === "string" ? payload.profileHome : undefined,
    );
    const command = adapter === "deterministic" ? null : await this.runtime.discoverCommand(profileHome);

    if (adapter !== "deterministic" && !this.localExecutionEnabled(payload, settings)) {
      const reason = "Hermes execution requires explicit enablement";
      this.fail(run.runId, reason);
      throw new Error(reason);
    }
    if (adapter !== "deterministic" && !command) {
      const reason = "Hermes CLI unavailable";
      this.fail(run.runId, reason);
      throw new Error(reason);
    }
    const credential = this.credentialState(payload, secrets);
    if (adapter !== "deterministic" && !credential.configured) {
      const reason = this.credentialBlockedReason(credential);
      this.fail(run.runId, reason);
      throw new Error(reason);
    }

    this.emitProgress(run.runId, `adapter=${adapter} provider=${credential.provider} model=${credential.model}`);

    const prompt = this.buildExecutionPrompt(packet);
    let text: string;
    try {
      text = adapter === "deterministic"
        ? this.deterministic.finalSummary
        : await this.runtime.invokeCli(command!, prompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (adapter !== "deterministic" && this.isCredentialError(message)) {
        const reason = this.credentialBlockedReason(credential);
        this.fail(run.runId, reason);
        throw new Error(reason);
      }
      this.fail(run.runId, message);
      throw error;
    }

    const result = adapter === "deterministic" ? this.deterministicFromPrompt(packet) : this.parseCliOutput(text);
    const workspaceRoot = packet.workspaceRoots[0] ?? "/tmp";
    const artifact: ArtifactRef = {
      artifactId: this.runtime.artifactFilename(run.runId),
      root: this.runtime.artifactRoot(workspaceRoot),
      sensitivity: "internal",
      provenance: { provider: credential.provider, model: credential.model, adapter },
    };
    this.complete(run.runId, [artifact]);

    return run;
  }

  // ---- Internals ----

  /** Build the governed Hermes prompt (mirrors legacy `buildHermesExecutionPrompt`). */
  buildExecutionPrompt(packet: TaskPacket): string {
    const intent = packet.intent;
    const ctx = packet.contextRefs;
    const ctxText = ctx && (ctx as unknown as { facts?: unknown }).facts
      ? JSON.stringify((ctx as unknown as { facts: unknown }).facts)
      : "";
    return [
      "You are Hermes operating as a ResonantOS add-on agent.",
      "You are running in reviewable-artifact mode. No interactive tools are available.",
      "",
      "Mission:",
      intent,
      "",
      ctxText ? "Context packet:" : "",
      ctxText,
      "",
      "Rules:",
      "- Return a reviewable artifact only.",
      "- Do not attempt tool calls, function calls, XML tool tags, shell commands, file writes, or local runtime actions.",
      "- Do not include unresolved provider/tool markers such as <tool_call>, tool_call, function_call, or provider control tokens.",
      "- If the mission asks you to create, run, inspect, browse, or execute something, describe the requested action and mark it as requiring approval or unavailable instead of attempting it.",
      "- Do not send messages, schedule events, post publicly, submit forms, operate wallets, expose secrets, or write trusted memory.",
      "- If external action is needed, list it under Approval Needs instead of performing it.",
      "- Keep the output concise and structured with these headings exactly: Final Summary, Actions Taken, Approval Needs, Residual Risks, Verification.",
    ].filter(Boolean).join("\n");
  }

  /** Parse the CLI output into the artifact shape. Mirrors legacy `parseHermesCliResult`. */
  parseCliOutput(text: string): HermesDeterministicResult {
    if (/<\s*tool_call\b|tool_call|function_call/i.test(text)) {
      throw new Error("Hermes returned unresolved provider tool-call markup instead of a reviewable artifact.");
    }
    return {
      finalSummary: this.sectionFromText(text, "Final Summary") || text.slice(0, 1600) || "Hermes completed without returning a summary.",
      actionsTaken: this.sectionListFromText(text, "Actions Taken").length
        ? this.sectionListFromText(text, "Actions Taken")
        : ["Hermes returned a result through the local CLI adapter."],
      approvalNeeds: this.sectionListFromText(text, "Approval Needs").length
        ? this.sectionListFromText(text, "Approval Needs")
        : ["Human approval is required before any external send, submission, wallet action, or trusted memory write."],
      residualRisks: this.sectionListFromText(text, "Residual Risks").length
        ? this.sectionListFromText(text, "Residual Risks")
        : ["Hermes output was accepted as an add-on artifact and still requires normal human review."],
      verification: this.sectionListFromText(text, "Verification").length
        ? this.sectionListFromText(text, "Verification")
        : ["Local Hermes CLI returned successfully."],
    };
  }

  /** Deterministic branch result, parameterized for tests. */
  deterministicFromPrompt(packet: TaskPacket): HermesDeterministicResult {
    return {
      finalSummary: `${this.deterministic.finalSummary} (mission: ${packet.intent.slice(0, 80)})`,
      actionsTaken: [...this.deterministic.actionsTaken],
      approvalNeeds: [...this.deterministic.approvalNeeds],
      residualRisks: [...this.deterministic.residualRisks],
      verification: [...this.deterministic.verification],
    };
  }

  /** Loose credential-error detector (mirrors legacy `isHermesProviderCredentialError`). */
  isCredentialError(message: string): boolean {
    const text = String(message ?? "");
    return /credential|api[_\s-]?key|unauthorized|401|403/i.test(text);
  }

  private sectionFromText(text: string, heading: string): string {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`## ${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`, "i").exec(text);
    return match ? match[1].trim() : "";
  }

  private sectionListFromText(text: string, heading: string): string[] {
    return this.sectionFromText(text, heading)
      .split("\n")
      .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
      .filter(Boolean);
  }
}

/** Helper exposed for parity tests: build a `TaskPacket` fixture for the adapter. */
export function hermesTaskPacketFixture(overrides: Partial<TaskPacket> = {}): TaskPacket {
  const base: TaskPacket = {
    taskId: "task-hermes-1",
    issuerPrincipalId: "augmentor:test",
    executorPrincipalId: "hermes.agent",
    delegationChainRef: { delegationId: "delegation-1" },
    intent: "Review the provided document and produce a final summary.",
    successCriteria: ["final summary present", "approval needs listed"],
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
    workspaceRoots: ["/tmp/hermes-workspace"],
    approvalPolicy: "human-review-required",
    deadline: new Date(Date.now() + 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    cancellationChannel: "test-channel",
    auditCorrelationId: "audit-1",
  };
  return { ...base, ...overrides };
}

/** Helper exposed for parity tests: an in-memory fake `HermesRuntime`. */
export function makeFakeHermesRuntime(overrides: Partial<HermesRuntime> = {}): HermesRuntime {
  const base: HermesRuntime = {
    async discoverCommand() {
      return "/usr/local/bin/hermes";
    },
    resolveProfileHome() {
      return "/tmp/hermes-workspace/profile-home";
    },
    async readSecrets() {
      return { OPENAI_API_KEY: { key: "sk-test" } };
    },
    async readExecutionSettings() {
      return { hermes: { localCliExecution: true } };
    },
    async invokeCli(_command, _prompt) {
      return [
        "## Final Summary",
        "Reviewed the document and produced a final summary.",
        "",
        "## Actions Taken",
        "- Read the document.",
        "- Drafted a final summary.",
        "",
        "## Approval Needs",
        "- Human approval required before any external send.",
        "",
        "## Residual Risks",
        "- None identified.",
        "",
        "## Verification",
        "- Document parsed.",
        "",
      ].join("\n");
    },
    artifactRoot(workspaceRoot: string) {
      return `${workspaceRoot}/artifacts`;
    },
    artifactFilename(runId) {
      return `${runId}-hermes-result.md`;
    },
    ...overrides,
  };
  return base;
}
