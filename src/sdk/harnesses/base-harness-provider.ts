// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
//
// CP-4/CP-5 generic harness lifecycle. The start/status/events/cancel/artifact
// machinery is implemented ONCE here; provider-specific adapters supply only
// their shape (`providerId`, `diagnose`, child-actor enumeration, cancellation
// semantics, sandbox strength). This is the "extract generic lifecycle" seam:
// authority never lives here — it is applied uniformly by the bridge's governed
// envelope before any adapter method is reached.

import type { ArtifactRef, TaskEvent, TaskEventKind, TaskPacket } from "../tasks";
import type {
  GrantHandle,
  HarnessCancellationSemantics,
  HarnessChildDescriptor,
  HarnessHealth,
  HarnessProviderAdapter,
  HarnessRun,
  HarnessRunState,
  HarnessSandboxStrength,
} from "./index";

interface RunEntry {
  run: HarnessRunState;
  events: TaskEvent[];
  artifacts: ArtifactRef[];
  workspaceRoot: string;
}

function isPathWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`);
}

export abstract class BaseHarnessProvider implements HarnessProviderAdapter {
  private readonly runs = new Map<string, RunEntry>();
  private seq = 0;

  abstract readonly providerId: string;
  abstract readonly cancellationSemantics: HarnessCancellationSemantics;
  abstract readonly sandboxStrength: HarnessSandboxStrength;

  abstract diagnose(): Promise<HarnessHealth>;

  /** Child actors the provider reports. Default none; providers override. */
  async listChildActors(_runId: string): Promise<HarnessChildDescriptor[]> {
    return [];
  }

  async startTask(packet: TaskPacket, _grant: GrantHandle): Promise<HarnessRun> {
    const runId = `run-${++this.seq}`;
    const workspaceRoot = packet.workspaceRoots[0] ?? "/tmp";
    const run: HarnessRunState = {
      runId,
      providerId: this.providerId,
      taskId: packet.taskId,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    this.runs.set(runId, { run, events: [], artifacts: [], workspaceRoot });
    this.appendEvent(runId, "active", packet.issuerPrincipalId);
    return run;
  }

  async getTask(runId: string): Promise<HarnessRunState> {
    return { ...this.entry(runId).run };
  }

  async *events(runId: string, cursor?: string): AsyncIterable<TaskEvent> {
    const entry = this.entry(runId);
    let index = cursor == null ? 0 : Number(cursor);
    while (index < entry.events.length) {
      yield entry.events[index];
      index += 1;
    }
  }

  async cancelTask(runId: string, reason: string): Promise<void> {
    const entry = this.entry(runId);
    entry.run.status = "cancelled";
    entry.run.detail = reason;
    entry.run.endedAt = new Date().toISOString();
    this.appendEvent(runId, "revoked", "core", reason);
  }

  async collectArtifacts(runId: string): Promise<ArtifactRef[]> {
    return this.entry(runId).artifacts.map((artifact) => ({ ...artifact }));
  }

  // ---- Conformance drivers (not part of the adapter surface) ----

  recordArtifact(runId: string, artifact: ArtifactRef): void {
    const entry = this.entry(runId);
    if (!isPathWithin(artifact.root, entry.workspaceRoot)) {
      throw new Error(`artifact root ${artifact.root} escapes workspace root ${entry.workspaceRoot}`);
    }
    entry.artifacts.push(artifact);
  }

  complete(runId: string, artifacts: ArtifactRef[] = []): void {
    const entry = this.entry(runId);
    entry.run.status = "completed";
    entry.run.endedAt = new Date().toISOString();
    for (const artifact of artifacts) this.recordArtifact(runId, artifact);
    this.appendEvent(runId, "completed", "core");
  }

  fail(runId: string, detail: string): void {
    const entry = this.entry(runId);
    entry.run.status = "failed";
    entry.run.detail = detail;
    entry.run.endedAt = new Date().toISOString();
    this.appendEvent(runId, "revoked", "core", detail);
  }

  emitProgress(runId: string, detail: string): void {
    this.appendEvent(runId, "progress", "core", detail);
  }

  private entry(runId: string): RunEntry {
    const entry = this.runs.get(runId);
    if (!entry) throw new Error(`unknown run ${runId}`);
    return entry;
  }

  private appendEvent(runId: string, kind: TaskEventKind, actorPrincipalId: string, detail?: string): void {
    const entry = this.entry(runId);
    entry.events.push({
      eventId: `${runId}:${entry.events.length}`,
      taskId: entry.run.taskId,
      at: new Date().toISOString(),
      kind,
      actorPrincipalId,
      detail,
    });
    entry.run.lastEventId = String(entry.events.length - 1);
  }
}
