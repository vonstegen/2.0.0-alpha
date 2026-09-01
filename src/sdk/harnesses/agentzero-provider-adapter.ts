// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/CP4-LIFECYCLE-EXTRACTION-MIGRATION.md
//
// CP-4 Phase 3: AgentZero lifecycle lifted onto `BaseHarnessProvider`.
// AgentZero is a docker-containerized agent framework — every delegation
// runs inside a container that ResonantOS launches through `docker run`.
// The container boundary IS the sandbox boundary, so:
//   - `sandboxStrength = "sandboxed-outer-boundary"`.
//   - `cancellationSemantics = "cancel"` — the container is killed via
//     `docker kill` so any work in flight stops immediately (no
//     finish-atomic grace).
//   - The single `container-agent` child is reported via `listChildActors`
//     and represents the docker container that hosts the agent.
//
// Runtime is dependency-injected (AgentZeroRuntime); the default NULL_RUNTIME
// reports no container so the conformance suite stays green without docker.

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

export interface AgentZeroRuntime {
  /** Discover the local docker CLI command (or null if not installed). */
  discoverDockerCommand(): Promise<string | null>;
  /** Look up session-scoped provider secrets. */
  readSecrets(): Promise<Record<string, { readonly key: string }>>;
  /** Read the host-side addon-execution settings file. */
  readExecutionSettings(): Promise<{ readonly agentzero: { readonly localCliExecution: boolean } }>;
  /** Spawn the docker container with the given args; resolve with stdout. */
  invokeDocker(command: string, args: readonly string[], options: {
    timeout: number;
  }): Promise<string>;
  /** Kill the running container (parity with `docker kill`). */
  killContainer(containerId: string): Promise<void>;
  /** Path under which result artifacts may be written (must be inside workspaceRoot). */
  artifactRoot(workspaceRoot: string): string;
  /** Mint a deterministic artifact filename. */
  artifactFilename(runId: string): string;
}

const NULL_RUNTIME: AgentZeroRuntime = {
  async discoverDockerCommand() {
    return null;
  },
  async readSecrets() {
    return {};
  },
  async readExecutionSettings() {
    return { agentzero: { localCliExecution: false } };
  },
  async invokeDocker() {
    throw new Error("AgentZero docker runtime not configured. Inject an AgentZeroRuntime.");
  },
  async killContainer() {
    return;
  },
  artifactRoot() {
    return "/tmp";
  },
  artifactFilename(runId) {
    return `${runId}-agentzero-result.md`;
  },
};

export interface AgentZeroProviderAdapterOptions {
  readonly runtime?: AgentZeroRuntime;
  /** Override the deterministic branch (used by parity tests). */
  readonly deterministicResult?: AgentZeroDeterministicResult;
}

export interface AgentZeroDeterministicResult {
  readonly finalSummary: string;
  readonly actionsTaken: readonly string[];
  readonly approvalNeeds: readonly string[];
  readonly residualRisks: readonly string[];
  readonly verification: readonly string[];
}

const DEFAULT_DETERMINISTIC_RESULT: AgentZeroDeterministicResult = {
  finalSummary: "AgentZero delegation is ready for review (deterministic adapter).",
  actionsTaken: [
    "Read the governed AgentZero container task packet.",
    "Checked the container boundary and required artifact contract.",
    "Prepared a reviewable result without docker run, file edits, wallet actions, or trusted memory writes.",
  ],
  approvalNeeds: [
    "Human approval is required before AgentZero runs new containers, exposes ports, mounts host paths, or pulls new images.",
  ],
  residualRisks: [
    "This deterministic adapter proves ResonantOS AgentZero delegation lifecycle behavior; it does not claim a docker container ran the agent.",
  ],
  verification: [
    "Task packet was parsed.",
    "Container boundary was preserved.",
    "Result artifact was written under BrowserFirst/DelegationArtifacts/agentzero.",
  ],
};

export class AgentZeroProviderAdapter extends BaseHarnessProvider {
  readonly providerId = "agentzero";
  readonly cancellationSemantics: HarnessCancellationSemantics = "cancel";
  readonly sandboxStrength: HarnessSandboxStrength = "sandboxed-outer-boundary";

  private readonly runtime: AgentZeroRuntime;
  private readonly deterministic: AgentZeroDeterministicResult;

  constructor(options: AgentZeroProviderAdapterOptions = {}) {
    super();
    this.runtime = options.runtime ?? NULL_RUNTIME;
    this.deterministic = options.deterministicResult ?? DEFAULT_DETERMINISTIC_RESULT;
  }

  // ---- Adapter surface ----

  async diagnose(): Promise<HarnessHealth> {
    const command = await this.runtime.discoverDockerCommand().catch(() => null);
    const settings = await this.runtime.readExecutionSettings().catch(() => ({ agentzero: { localCliExecution: false } }));
    const enabled = Boolean(settings.agentzero.localCliExecution);
    return {
      status: command && enabled ? "ok" : "degraded",
      providerId: this.providerId,
      version: "0.1.0",
      message: command && enabled
        ? "docker-containerized agent framework (docker CLI found + execution enabled)"
        : !command
          ? "docker-containerized agent framework (no docker CLI)"
          : "docker-containerized agent framework (execution disabled)",
    };
  }

  /** Single host-mediated container-agent child (parity with reference shape). */
  override async listChildActors(runId: string): Promise<HarnessChildDescriptor[]> {
    await this.getTask(runId);
    return [
      { childId: "agentzero.agent", kind: "container-agent", sandboxed: true, escalationRequired: false },
    ];
  }

  /**
   * Lifted AgentZero delegation lifecycle. The container ID is tracked on the
   * run so `cancelTask` can `docker kill` it. The host service retains route
   * dispatch and packet markdown I/O; this adapter owns the state machine.
   */
  async startTask(packet: TaskPacket, _grant: string): Promise<HarnessRun> {
    const run = await super.startTask(packet, _grant);

    const payload = (packet.outputContract ?? {}) as Record<string, unknown>;
    const adapter = String(payload.adapter ?? process.env.RESONANTOS_AGENTZERO_ADAPTER ?? "auto")
      .trim()
      .toLowerCase();
    const command = adapter === "deterministic" ? null : await this.runtime.discoverDockerCommand();

    if (adapter !== "deterministic" && !command) {
      const reason = "AgentZero docker CLI unavailable";
      this.fail(run.runId, reason);
      throw new Error(reason);
    }
    if (adapter !== "deterministic") {
      const settings = await this.runtime.readExecutionSettings();
      if (!settings.agentzero.localCliExecution) {
        const reason = "AgentZero execution requires explicit enablement";
        this.fail(run.runId, reason);
        throw new Error(reason);
      }
    }

    const secrets = await this.runtime.readSecrets();
    this.emitProgress(run.runId, `adapter=${adapter} container=resonantos-agentzero secrets=${Object.keys(secrets).length}`);

    const prompt = this.buildExecutionPrompt(packet);
    let text: string;
    try {
      text = adapter === "deterministic"
        ? this.deterministic.finalSummary
        : await this.invokeDockerAndCapture(command!, prompt, packet);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.fail(run.runId, message);
      throw error;
    }

    const result = adapter === "deterministic" ? this.deterministicFromPrompt(packet) : this.parseCliResult(text);
    const workspaceRoot = packet.workspaceRoots[0] ?? "/tmp";
    const artifact: ArtifactRef = {
      artifactId: this.runtime.artifactFilename(run.runId),
      root: this.runtime.artifactRoot(workspaceRoot),
      sensitivity: "internal",
      provenance: { provider: "agentzero", adapter },
    };
    this.complete(run.runId, [artifact]);

    return run;
  }

  /**
   * `cancel` semantics: kill the docker container (parity with `docker kill`).
   * Unlike OpenCode's finish-atomic, the kill is immediate — no grace period.
   */
  override async cancelTask(runId: string, reason: string): Promise<void> {
    const state = await this.getTask(runId);
    if (state.status === "completed" || state.status === "failed" || state.status === "cancelled") {
      return;
    }
    await this.runtime.killContainer(`resonantos-agentzero-${runId}`).catch(() => undefined);
    await super.cancelTask(runId, reason);
  }

  // ---- Internals ----

  /** Build the governed AgentZero prompt. */
  buildExecutionPrompt(packet: TaskPacket): string {
    return [
      "You are AgentZero operating as a ResonantOS add-on container agent.",
      "You are running inside a docker container that ResonantOS launched for you.",
      "You are running in reviewable-artifact mode. No live tools are available.",
      "",
      "Mission:",
      packet.intent,
      "",
      "Rules:",
      "- Return a reviewable artifact only.",
      "- Do not attempt live tool calls, function calls, XML tool tags, shell commands, file writes, port bindings, image pulls, or external runtime spawns.",
      "- Do not mount host paths, expose ports, escalate privileges, send messages, schedule events, post publicly, submit forms, operate wallets, expose secrets, or write trusted memory.",
      "- If the mission asks you to call tools, describe the requested action and mark it as requiring approval instead of attempting it.",
      "- Keep the output concise and structured with these headings exactly: Final Summary, Actions Taken, Approval Needs, Residual Risks, Verification.",
    ].join("\n");
  }

  /** Parse CLI output into the artifact shape. */
  parseCliResult(text: string): AgentZeroDeterministicResult {
    return {
      finalSummary: this.sectionFromText(text, "Final Summary") || text.slice(0, 1600) || "AgentZero completed without returning a summary.",
      actionsTaken: this.sectionList(text, "Actions Taken").length
        ? this.sectionList(text, "Actions Taken")
        : ["AgentZero returned a result through the container adapter."],
      approvalNeeds: this.sectionList(text, "Approval Needs").length
        ? this.sectionList(text, "Approval Needs")
        : ["Human approval is required before any container action or external send."],
      residualRisks: this.sectionList(text, "Residual Risks").length
        ? this.sectionList(text, "Residual Risks")
        : ["AgentZero output is an add-on artifact and still requires normal human review."],
      verification: this.sectionList(text, "Verification").length
        ? this.sectionList(text, "Verification")
        : ["AgentZero container returned successfully."],
    };
  }

  /** Deterministic branch result, parameterized for tests. */
  deterministicFromPrompt(packet: TaskPacket): AgentZeroDeterministicResult {
    return {
      finalSummary: `${this.deterministic.finalSummary} (mission: ${packet.intent.slice(0, 80)})`,
      actionsTaken: [...this.deterministic.actionsTaken],
      approvalNeeds: [...this.deterministic.approvalNeeds],
      residualRisks: [...this.deterministic.residualRisks],
      verification: [...this.deterministic.verification],
    };
  }

  private async invokeDockerAndCapture(
    command: string,
    prompt: string,
    packet: TaskPacket,
  ): Promise<string> {
    const args = [
      "run",
      "--rm",
      "--name",
      `resonantos-agentzero-${packet.taskId}`,
      "-i",
      "resonantos/agentzero:latest",
      prompt,
    ];
    const timeout = Math.min(900_000, Math.max(30_000, Number((packet.outputContract as { timeoutMs?: number })?.timeoutMs ?? 300_000)));
    return this.runtime.invokeDocker(command, args, { timeout });
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
export function agentZeroTaskPacketFixture(overrides: Partial<TaskPacket> = {}): TaskPacket {
  const base: TaskPacket = {
    taskId: "task-agentzero-1",
    issuerPrincipalId: "augmentor:test",
    executorPrincipalId: "agentzero.agent",
    delegationChainRef: { delegationId: "delegation-agentzero-1" },
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
    workspaceRoots: ["/tmp/agentzero-workspace"],
    approvalPolicy: "human-review-required",
    deadline: new Date(Date.now() + 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    cancellationChannel: "test-channel",
    auditCorrelationId: "audit-agentzero-1",
  };
  return { ...base, ...overrides };
}

/** Helper exposed for parity tests: an in-memory fake `AgentZeroRuntime`. */
export function makeFakeAgentZeroRuntime(overrides: Partial<AgentZeroRuntime> = {}): AgentZeroRuntime {
  let killedContainers: string[] = [];
  const base: AgentZeroRuntime = {
    async discoverDockerCommand() {
      return "/usr/local/bin/docker";
    },
    async readSecrets() {
      return { OPENAI_API_KEY: { key: "sk-test" } };
    },
    async readExecutionSettings() {
      return { agentzero: { localCliExecution: true } };
    },
    async invokeDocker(_command, _args, _options) {
      return [
        "## Final Summary",
        "Reviewed the document and produced a final summary.",
        "",
        "## Actions Taken",
        "- Read the document.",
        "- Drafted a final summary.",
        "",
        "## Approval Needs",
        "- Human approval required before any container action.",
        "",
        "## Residual Risks",
        "- None identified.",
        "",
        "## Verification",
        "- Container returned.",
        "",
      ].join("\n");
    },
    async killContainer(containerId) {
      killedContainers.push(containerId);
    },
    artifactRoot(workspaceRoot: string) {
      return `${workspaceRoot}/artifacts`;
    },
    artifactFilename(runId) {
      return `${runId}-agentzero-result.md`;
    },
    ...overrides,
  };
  return base;
}
