// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/CP4-LIFECYCLE-EXTRACTION-MIGRATION.md
//
// CP-4 Phase 3: OpenClaw lifecycle lifted onto `BaseHarnessProvider`.
// OpenClaw is structurally distinct from Hermes + OpenCode:
//   - `cancellationSemantics = "quarantine"` — a cancelled run is not deleted,
//     it is quarantined for forensic review. The `BaseHarnessProvider` cancel
//     path preserves the artifact + final state; the adapter overrides cancel
//     to record a `quarantinedAt` timestamp instead of `cancelledAt`.
//   - `sandboxStrength = "sandboxed-outer-boundary"` — OpenClaw is a runtime
//     gateway that hosts child agents; the outer boundary is the bridge.
//   - `listChildActors(runId)` returns the gateway itself plus the child
//     actors it enumerates. The legacy stub always returns one gateway + one
//     escalated child; the real adapter returns whatever the runtime reports.
//
// Runtime is dependency-injected (OpenClawRuntime); the default NULL_RUNTIME
// reports zero children + a degraded gateway so the conformance suite stays
// green without a real MCP gateway.

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

export interface OpenClawChildActorSnapshot {
  readonly childId: string;
  readonly kind: "child-agent" | "tool" | "subprocess";
  readonly sandboxed: boolean;
  readonly escalationRequired: boolean;
}

export interface OpenClawRuntime {
  /** Discover the local OpenClaw gateway command (or null if not installed). */
  discoverCommand(profileHome: string | null): Promise<string | null>;
  /** Return the OpenClaw profile home directory (already trust-bounded). */
  resolveProfileHome(profileHome?: string): string;
  /** Look up session-scoped provider secrets. */
  readSecrets(): Promise<Record<string, { readonly key: string }>>;
  /** Read the host-side addon-execution settings file. */
  readExecutionSettings(): Promise<{ readonly openclaw: { readonly localCliExecution: boolean } }>;
  /** Spawn the OpenClaw gateway CLI with the given prompt; resolve with the rendered artifact text. */
  invokeCli(command: string, prompt: string): Promise<string>;
  /** Path under which result artifacts may be written (must be inside workspaceRoot). */
  artifactRoot(workspaceRoot: string): string;
  /** Mint a deterministic artifact filename. */
  artifactFilename(runId: string): string;
  /** Enumerate the child actors currently registered with the gateway. */
  listChildActors(runId: string): Promise<readonly OpenClawChildActorSnapshot[]>;
}

const NULL_RUNTIME: OpenClawRuntime = {
  async discoverCommand() {
    return null;
  },
  resolveProfileHome() {
    return "/dev/null/openclaw-profile-home";
  },
  async readSecrets() {
    return {};
  },
  async readExecutionSettings() {
    return { openclaw: { localCliExecution: false } };
  },
  async invokeCli() {
    throw new Error("OpenClaw gateway runtime not configured. Inject an OpenClawRuntime.");
  },
  artifactRoot() {
    return "/tmp";
  },
  artifactFilename(runId) {
    return `${runId}-openclaw-result.md`;
  },
  async listChildActors() {
    return [];
  },
};

export interface OpenClawProviderAdapterOptions {
  readonly runtime?: OpenClawRuntime;
  /** Override the deterministic branch (used by parity tests). */
  readonly deterministicResult?: OpenClawDeterministicResult;
}

export interface OpenClawDeterministicResult {
  readonly finalSummary: string;
  readonly actionsTaken: readonly string[];
  readonly approvalNeeds: readonly string[];
  readonly residualRisks: readonly string[];
  readonly verification: readonly string[];
}

const DEFAULT_DETERMINISTIC_RESULT: OpenClawDeterministicResult = {
  finalSummary: "OpenClaw delegation is ready for review (deterministic adapter).",
  actionsTaken: [
    "Read the governed OpenClaw MCP task packet.",
    "Checked the runtime-gateway boundary and required artifact contract.",
    "Prepared a reviewable result without runtime spawns, file edits, wallet actions, or trusted memory writes.",
  ],
  approvalNeeds: [
    "Human approval is required before OpenClaw spawns runtime subprocesses, registers external MCP tools, or changes external systems.",
  ],
  residualRisks: [
    "This deterministic adapter proves ResonantOS OpenClaw delegation lifecycle behavior; it does not claim the OpenClaw runtime completed real-world work.",
  ],
  verification: [
    "Task packet was parsed.",
    "Gateway boundary was preserved.",
    "Result artifact was written under BrowserFirst/DelegationArtifacts/openclaw.",
  ],
};

export class OpenClawProviderAdapter extends BaseHarnessProvider {
  readonly providerId = "openclaw";
  readonly cancellationSemantics: HarnessCancellationSemantics = "quarantine";
  readonly sandboxStrength: HarnessSandboxStrength = "sandboxed-outer-boundary";

  private readonly runtime: OpenClawRuntime;
  private readonly deterministic: OpenClawDeterministicResult;

  constructor(options: OpenClawProviderAdapterOptions = {}) {
    super();
    this.runtime = options.runtime ?? NULL_RUNTIME;
    this.deterministic = options.deterministicResult ?? DEFAULT_DETERMINISTIC_RESULT;
  }

  // ---- Adapter surface ----

  async diagnose(): Promise<HarnessHealth> {
    const profileHome = this.runtime.resolveProfileHome(undefined);
    const command = await this.runtime.discoverCommand(profileHome).catch(() => null);
    const settings = await this.runtime.readExecutionSettings().catch(() => ({ openclaw: { localCliExecution: false } }));
    const enabled = Boolean(settings.openclaw.localCliExecution);
    return {
      status: command && enabled ? "ok" : "degraded",
      providerId: this.providerId,
      version: "0.1.0",
      message: command && enabled
        ? "runtime-gateway (CLI found + execution enabled)"
        : !command
          ? "runtime-gateway (no local CLI)"
          : "runtime-gateway (execution disabled)",
    };
  }

  /**
   * Structurally distinct from Hermes + OpenCode: children are enumerated
   * through a gateway, and any escalated child is surfaced for human approval.
   * The gateway itself is always returned as the first child.
   */
  override async listChildActors(runId: string): Promise<HarnessChildDescriptor[]> {
    await this.getTask(runId); // existence check
    const runtimeChildren = await this.runtime.listChildActors(runId).catch(() => []);
    return [
      { childId: "openclaw.gateway", kind: "gateway", sandboxed: true, escalationRequired: false },
      ...runtimeChildren.map((child) => ({
        childId: child.childId,
        kind: child.kind === "tool" ? "tool" as const : "child-agent" as const,
        sandboxed: child.sandboxed,
        escalationRequired: child.escalationRequired,
      })),
    ];
  }


  /**
   * Quarantine cancel: a cancelled run is preserved for forensic review.
   * Even for terminal runs (completed/failed) the adapter emits a quarantine
   * progress event so the dashboard surfaces the forensic record distinctly
   * from a clean state.
   */
  override async cancelTask(runId: string, reason: string): Promise<void> {
    const state = await this.getTask(runId);
    if (state.status !== "completed" && state.status !== "failed") {
      await super.cancelTask(runId, reason);
    }
    this.emitProgress(runId, `quarantinedAt=${new Date().toISOString()} reason=${reason}`);
  }

  /**
   * Lifted OpenClaw delegation lifecycle. Mirrors the legacy
   * `executeOpenClawDelegationStart` function. The host service retains route
   * dispatch and packet markdown I/O; this adapter owns the state machine
   * and result emission.
   */
  async startTask(packet: TaskPacket, _grant: string): Promise<HarnessRun> {
    const run = await super.startTask(packet, _grant);

    const payload = (packet.outputContract ?? {}) as Record<string, unknown>;
    const adapter = String(payload.adapter ?? process.env.RESONANTOS_OPENCLAW_ADAPTER ?? "auto")
      .trim()
      .toLowerCase();
    const profileHome = this.runtime.resolveProfileHome(
      typeof payload.profileHome === "string" ? payload.profileHome : undefined,
    );
    const command = adapter === "deterministic" ? null : await this.runtime.discoverCommand(profileHome);

    if (adapter !== "deterministic" && !command) {
      const reason = "OpenClaw gateway unavailable";
      this.fail(run.runId, reason);
      throw new Error(reason);
    }
    if (adapter !== "deterministic") {
      const settings = await this.runtime.readExecutionSettings();
      if (!settings.openclaw.localCliExecution) {
        const reason = "OpenClaw execution requires explicit enablement";
        this.fail(run.runId, reason);
        throw new Error(reason);
      }
    }

    const secrets = await this.runtime.readSecrets();
    this.emitProgress(run.runId, `adapter=${adapter} secrets=${Object.keys(secrets).length}`);

    const prompt = this.buildExecutionPrompt(packet);
    let text: string;
    try {
      text = adapter === "deterministic"
        ? this.deterministic.finalSummary
        : await this.runtime.invokeCli(command!, prompt);
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
      provenance: { provider: "openclaw", adapter },
    };
    this.complete(run.runId, [artifact]);

    return run;
  }

  // ---- Internals ----

  /** Build the governed OpenClaw prompt. */
  buildExecutionPrompt(packet: TaskPacket): string {
    return [
      "You are OpenClaw operating as a ResonantOS add-on runtime gateway.",
      "You are running in reviewable-artifact mode. No live MCP tool calls are available.",
      "",
      "Mission:",
      packet.intent,
      "",
      "Rules:",
      "- Return a reviewable artifact only.",
      "- Do not attempt live tool calls, function calls, XML tool tags, shell commands, file writes, or external runtime spawns.",
      "- Do not register new MCP servers, change MCP permissions, send messages, schedule events, post publicly, submit forms, operate wallets, expose secrets, or write trusted memory.",
      "- If the mission asks you to call MCP tools, describe the requested action and mark it as requiring approval instead of attempting it.",
      "- Keep the output concise and structured with these headings exactly: Final Summary, Actions Taken, Approval Needs, Residual Risks, Verification.",
    ].join("\n");
  }

  /** Parse CLI output into the artifact shape. */
  parseCliResult(text: string): OpenClawDeterministicResult {
    return {
      finalSummary: this.sectionFromText(text, "Final Summary") || text.slice(0, 1600) || "OpenClaw completed without returning a summary.",
      actionsTaken: this.sectionList(text, "Actions Taken").length
        ? this.sectionList(text, "Actions Taken")
        : ["OpenClaw returned a result through the gateway adapter."],
      approvalNeeds: this.sectionList(text, "Approval Needs").length
        ? this.sectionList(text, "Approval Needs")
        : ["Human approval is required before any external MCP tool call or runtime spawn."],
      residualRisks: this.sectionList(text, "Residual Risks").length
        ? this.sectionList(text, "Residual Risks")
        : ["OpenClaw output is an add-on artifact and still requires normal human review."],
      verification: this.sectionList(text, "Verification").length
        ? this.sectionList(text, "Verification")
        : ["OpenClaw gateway returned successfully."],
    };
  }

  /** Deterministic branch result, parameterized for tests. */
  deterministicFromPrompt(packet: TaskPacket): OpenClawDeterministicResult {
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
export function openClawTaskPacketFixture(overrides: Partial<TaskPacket> = {}): TaskPacket {
  const base: TaskPacket = {
    taskId: "task-openclaw-1",
    issuerPrincipalId: "augmentor:test",
    executorPrincipalId: "openclaw.gateway",
    delegationChainRef: { delegationId: "delegation-openclaw-1" },
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
    workspaceRoots: ["/tmp/openclaw-workspace"],
    approvalPolicy: "human-review-required",
    deadline: new Date(Date.now() + 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    cancellationChannel: "test-channel",
    auditCorrelationId: "audit-openclaw-1",
  };
  return { ...base, ...overrides };
}

/** Helper exposed for parity tests: an in-memory fake `OpenClawRuntime`. */
export function makeFakeOpenClawRuntime(overrides: Partial<OpenClawRuntime> = {}): OpenClawRuntime {
  const base: OpenClawRuntime = {
    async discoverCommand() {
      return "/usr/local/bin/openclaw";
    },
    resolveProfileHome() {
      return "/tmp/openclaw-workspace/profile-home";
    },
    async readSecrets() {
      return { OPENAI_API_KEY: { key: "sk-test" } };
    },
    async readExecutionSettings() {
      return { openclaw: { localCliExecution: true } };
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
        "- Human approval required before any external MCP tool call.",
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
      return `${runId}-openclaw-result.md`;
    },
    async listChildActors() {
      return [
        { childId: "openclaw.child:0", kind: "child-agent", sandboxed: true, escalationRequired: true },
      ];
    },
    ...overrides,
  };
  return base;
}
