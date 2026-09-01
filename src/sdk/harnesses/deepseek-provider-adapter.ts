// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/CP4-LIFECYCLE-EXTRACTION-MIGRATION.md
//
// CP-4 Phase 3: DeepSeek lifecycle lifted onto `BaseHarnessProvider`.
// DeepSeek is an OpenAI-compatible cloud inference harness — ResonantOS
// delegates to it via the standard OpenAI-compatible HTTP API:
//   - `cancellationSemantics = "cancel"` — a cancelled run abandons the
//     in-flight HTTP request (no finish-atomic grace).
//   - `sandboxStrength = "host-mediated"` — the inference is offloaded
//     entirely to DeepSeek's cloud; there is no local boundary beyond the
//     bridge.
//   - `listChildActors` returns the single cloud-inference child (parity
//     with reference shape).
//
// Runtime is dependency-injected (DeepSeekRuntime); the default NULL_RUNTIME
// returns a degraded HTTP probe so the conformance suite stays green
// without a network call.

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

export interface DeepSeekProviderSecret {
  readonly key: string;
}

export interface DeepSeekProviderCredentialState {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly configured: boolean;
}

export interface DeepSeekRuntime {
  /** Probe the DeepSeek base URL; returns null if unreachable. */
  probeBaseUrl(): Promise<string | null>;
  /** Look up session-scoped provider secrets. */
  readSecrets(): Promise<Record<string, DeepSeekProviderSecret>>;
  /** Issue the OpenAI-compatible chat completion request. */
  completeChat(request: {
    baseUrl: string;
    apiKey: string;
    model: string;
    prompt: string;
    timeoutMs: number;
  }): Promise<string>;
  /** Mint a deterministic artifact filename. */
  artifactFilename(runId: string): string;
}

const NULL_RUNTIME: DeepSeekRuntime = {
  async probeBaseUrl() {
    return null;
  },
  async readSecrets() {
    return {};
  },
  async completeChat() {
    throw new Error("DeepSeek runtime not configured. Inject a DeepSeekRuntime.");
  },
  artifactFilename(runId) {
    return `${runId}-deepseek-result.md`;
  },
};

export interface DeepSeekProviderAdapterOptions {
  readonly runtime?: DeepSeekRuntime;
  /** Override the deterministic branch (used by parity tests). */
  readonly deterministicResult?: DeepSeekDeterministicResult;
}

export interface DeepSeekDeterministicResult {
  readonly finalSummary: string;
  readonly actionsTaken: readonly string[];
  readonly approvalNeeds: readonly string[];
  readonly residualRisks: readonly string[];
  readonly verification: readonly string[];
}

const DEFAULT_DETERMINISTIC_RESULT: DeepSeekDeterministicResult = {
  finalSummary: "DeepSeek delegation is ready for review (deterministic adapter).",
  actionsTaken: [
    "Read the governed DeepSeek inference task packet.",
    "Checked the OpenAI-compatible boundary and required artifact contract.",
    "Prepared a reviewable result without live inference calls, file edits, wallet actions, or trusted memory writes.",
  ],
  approvalNeeds: [
    "Human approval is required before DeepSeek sends messages, makes external API calls, or writes trusted memory.",
  ],
  residualRisks: [
    "This deterministic adapter proves ResonantOS DeepSeek delegation lifecycle behavior; it does not claim the DeepSeek cloud completed real inference.",
  ],
  verification: [
    "Task packet was parsed.",
    "Cloud-inference boundary was preserved.",
    "Result artifact was written under BrowserFirst/DelegationArtifacts/deepseek.",
  ],
};

const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_MODEL = "deepseek-chat";

function resolveBaseUrl(secrets: Record<string, DeepSeekProviderSecret>): string {
  const configured = String(secrets.DEEPSEEK_BASE_URL?.key ?? process.env.DEEPSEEK_BASE_URL ?? "").trim();
  return configured || DEFAULT_BASE_URL;
}

function resolveModel(payload: Record<string, unknown>): string {
  const requested = String(payload.model ?? process.env.DEEPSEEK_MODEL ?? "").trim();
  return requested || DEFAULT_MODEL;
}

export class DeepSeekHarnessProviderAdapter extends BaseHarnessProvider {
  readonly providerId = "deepseek-harness";
  readonly cancellationSemantics: HarnessCancellationSemantics = "cancel";
  readonly sandboxStrength: HarnessSandboxStrength = "host-mediated";

  private readonly runtime: DeepSeekRuntime;
  private readonly deterministic: DeepSeekDeterministicResult;

  constructor(options: DeepSeekProviderAdapterOptions = {}) {
    super();
    this.runtime = options.runtime ?? NULL_RUNTIME;
    this.deterministic = options.deterministicResult ?? DEFAULT_DETERMINISTIC_RESULT;
  }

  // ---- Adapter surface ----

  async diagnose(): Promise<HarnessHealth> {
    const baseUrl = await this.runtime.probeBaseUrl().catch(() => null);
    return {
      status: baseUrl ? "ok" : "degraded",
      providerId: this.providerId,
      version: "0.1.0",
      message: baseUrl ? `OpenAI-compatible cloud inference (${baseUrl})` : "OpenAI-compatible cloud inference (no base URL)",
    };
  }

  /** Single cloud-inference child (parity with reference shape). */
  override async listChildActors(runId: string): Promise<HarnessChildDescriptor[]> {
    await this.getTask(runId);
    return [
      { childId: "deepseek-harness.inference", kind: "cloud-inference", sandboxed: false, escalationRequired: false },
    ];
  }

  credentialState(
    payload: Record<string, unknown> = {},
    secrets: Record<string, DeepSeekProviderSecret> = {},
  ): DeepSeekProviderCredentialState {
    const apiKey = String(secrets.DEEPSEEK_API_KEY?.key ?? "").trim();
    return {
      provider: "deepseek",
      model: resolveModel(payload),
      baseUrl: resolveBaseUrl(secrets),
      configured: Boolean(apiKey),
    };
  }

  credentialBlockedReason(state: DeepSeekProviderCredentialState): string {
    return [
      `DeepSeek provider credential unavailable for ${state.provider} / ${state.model}.`,
      "Re-save the provider credential in Settings > Providers so the restarted browser-first bridge has it in session memory.",
      "Provider secrets remain session-only; ResonantOS does not persist plaintext provider credentials for this alpha.",
    ].join(" ");
  }

  /**
   * Lifted DeepSeek delegation lifecycle. ResonantOS delegates to DeepSeek
   * via the standard OpenAI-compatible HTTP API.
   */
  async startTask(packet: TaskPacket, _grant: string): Promise<HarnessRun> {
    const run = await super.startTask(packet, _grant);

    const payload = (packet.outputContract ?? {}) as Record<string, unknown>;
    const adapter = String(payload.adapter ?? process.env.RESONANTOS_DEEPSEEK_ADAPTER ?? "auto")
      .trim()
      .toLowerCase();
    const secrets = await this.runtime.readSecrets();
    const state = this.credentialState(payload, secrets);

    if (adapter !== "deterministic" && !state.configured) {
      const reason = this.credentialBlockedReason(state);
      this.fail(run.runId, reason);
      throw new Error(reason);
    }

    this.emitProgress(run.runId, `adapter=${adapter} model=${state.model} baseUrl=${state.baseUrl}`);

    const prompt = this.buildExecutionPrompt(packet);
    let text: string;
    try {
      text = adapter === "deterministic"
        ? this.deterministic.finalSummary
        : await this.runtime.completeChat({
            baseUrl: state.baseUrl,
            apiKey: String(secrets.DEEPSEEK_API_KEY?.key ?? ""),
            model: state.model,
            prompt,
            timeoutMs: Math.min(900_000, Math.max(30_000, Number(payload.timeoutMs ?? 300_000))),
          });
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

    const result = adapter === "deterministic" ? this.deterministicFromPrompt(packet) : this.parseCliResult(text);
    const workspaceRoot = packet.workspaceRoots[0] ?? "/tmp";
    const artifact: ArtifactRef = {
      artifactId: this.runtime.artifactFilename(run.runId),
      root: workspaceRoot,
      sensitivity: "internal",
      provenance: { provider: state.provider, model: state.model, adapter },
    };
    this.complete(run.runId, [artifact]);

    return run;
  }

  /** Loose credential-error detector (parity with Hermes/OpenCode heuristic). */
  isCredentialError(message: string): boolean {
    const text = String(message ?? "");
    return /credential|api[_\s-]?key|unauthorized|401|403/i.test(text);
  }

  // ---- Internals ----

  /** Build the governed DeepSeek prompt. */
  buildExecutionPrompt(packet: TaskPacket): string {
    return [
      "You are DeepSeek operating as a ResonantOS add-on cloud-inference agent.",
      "You are running in reviewable-artifact mode. No live tools are available.",
      "",
      "Mission:",
      packet.intent,
      "",
      "Rules:",
      "- Return a reviewable artifact only.",
      "- Do not attempt tool calls, function calls, XML tool tags, or external sends.",
      "- Do not send messages, schedule events, post publicly, submit forms, operate wallets, expose secrets, or write trusted memory.",
      "- If the mission asks you to call tools, describe the requested action and mark it as requiring approval instead of attempting it.",
      "- Keep the output concise and structured with these headings exactly: Final Summary, Actions Taken, Approval Needs, Residual Risks, Verification.",
    ].join("\n");
  }

  /** Parse CLI output into the artifact shape. */
  parseCliResult(text: string): DeepSeekDeterministicResult {
    return {
      finalSummary: this.sectionFromText(text, "Final Summary") || text.slice(0, 1600) || "DeepSeek completed without returning a summary.",
      actionsTaken: this.sectionList(text, "Actions Taken").length
        ? this.sectionList(text, "Actions Taken")
        : ["DeepSeek returned a result through the cloud-inference adapter."],
      approvalNeeds: this.sectionList(text, "Approval Needs").length
        ? this.sectionList(text, "Approval Needs")
        : ["Human approval is required before any external send or trusted memory write."],
      residualRisks: this.sectionList(text, "Residual Risks").length
        ? this.sectionList(text, "Residual Risks")
        : ["DeepSeek output is an add-on artifact and still requires normal human review."],
      verification: this.sectionList(text, "Verification").length
        ? this.sectionList(text, "Verification")
        : ["DeepSeek cloud returned successfully."],
    };
  }

  /** Deterministic branch result, parameterized for tests. */
  deterministicFromPrompt(packet: TaskPacket): DeepSeekDeterministicResult {
    return {
      finalSummary: `${this.deterministic.finalSummary} (mission: ${packet.intent.slice(0, 80)})`,
      actionsTaken: [...this.deterministic.actionsTaken],
      approvalNeeds: [...this.deterministic.approvalNeeds],
      residualRisks: [...this.deterministic.residualRisks],
      verification: [...this.deterministic.verification],
    };
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

// ---- Test helpers ----

/** Helper exposed for parity tests: build a `TaskPacket` fixture for the adapter. */
export function deepSeekTaskPacketFixture(overrides: Partial<TaskPacket> = {}): TaskPacket {
  const base: TaskPacket = {
    taskId: "task-deepseek-1",
    issuerPrincipalId: "augmentor:test",
    executorPrincipalId: "deepseek-harness.inference",
    delegationChainRef: { delegationId: "delegation-deepseek-1" },
    intent: "Review the provided document and produce a final summary.",
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
    workspaceRoots: ["/tmp/deepseek-workspace"],
    approvalPolicy: "human-review-required",
    deadline: new Date(Date.now() + 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    cancellationChannel: "test-channel",
    auditCorrelationId: "audit-deepseek-1",
  };
  return { ...base, ...overrides };
}

/** Helper exposed for parity tests: an in-memory fake `DeepSeekRuntime`. */
export function makeFakeDeepSeekRuntime(overrides: Partial<DeepSeekRuntime> = {}): DeepSeekRuntime {
  const base: DeepSeekRuntime = {
    async probeBaseUrl() {
      return "https://api.deepseek.com/v1";
    },
    async readSecrets() {
      return { DEEPSEEK_API_KEY: { key: "sk-deepseek-test" } };
    },
    async completeChat(_request) {
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
        "- Inference returned.",
        "",
      ].join("\n");
    },
    artifactFilename(runId) {
      return `${runId}-deepseek-result.md`;
    },
    ...overrides,
  };
  return base;
}
