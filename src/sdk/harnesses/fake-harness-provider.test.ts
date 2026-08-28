// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
import { describe, expect, it } from "vitest";

import type { TaskPacket } from "../tasks";
import { FakeHarnessProvider } from "./fake-harness-provider";

function packet(overrides: Partial<TaskPacket> = {}): TaskPacket {
  return {
    taskId: "task-1",
    issuerPrincipalId: "user-1",
    executorPrincipalId: "hermes-1",
    delegationChainRef: { delegationId: "del-1" },
    intent: "summarize the diff",
    successCriteria: ["summary present"],
    nonGoals: [],
    outputContract: {},
    contextRefs: {
      facts: [],
      provenance: [],
      sensitivity: "low",
      freshness: "2026-08-28T00:00:00Z",
      allowedPurpose: "review",
      retentionPolicy: "session",
      redactions: [],
    },
    requestedCapabilities: [],
    resourceBudget: {
      priority: 1,
      deadline: "2026-08-28T12:00:00Z",
      concurrencyClass: "shared",
      estimated: {},
      hardCeiling: {},
      requiredNodeRoles: [],
      networkMode: "none",
      workspaceMode: "isolated",
      secretPolicy: "none",
      onExhaustion: "stop",
    },
    workspaceRoots: ["/workspace/project-a"],
    approvalPolicy: "human-approval",
    deadline: "2026-08-28T12:00:00Z",
    expiresAt: "2026-08-28T12:00:00Z",
    cancellationChannel: "task-1:cancel",
    auditCorrelationId: "aud-1",
    ...overrides,
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe("fake conformance harness provider", () => {
  it("drives the lifecycle queued/running -> completed", async () => {
    const provider = new FakeHarnessProvider();
    const run = await provider.startTask(packet(), "grant-1");

    expect(run.status).toBe("running");
    expect((await provider.getTask(run.runId)).status).toBe("running");

    provider.complete(run.runId, [
      { artifactId: "a-1", root: "/workspace/project-a/summary.md", sensitivity: "low", provenance: {} },
    ]);
    expect((await provider.getTask(run.runId)).status).toBe("completed");
    expect((await provider.collectArtifacts(run.runId)).map((a) => a.artifactId)).toEqual(["a-1"]);
  });

  it("cancels a task and records the revocation event", async () => {
    const provider = new FakeHarnessProvider();
    const run = await provider.startTask(packet(), "grant-1");
    await provider.cancelTask(run.runId, "user abort");

    const state = await provider.getTask(run.runId);
    expect(state.status).toBe("cancelled");
    expect(state.detail).toBe("user abort");

    const events = await collect(provider.events(run.runId));
    expect(events.map((e) => e.kind)).toEqual(["active", "revoked"]);
  });

  it("confines artifacts to the workspace root", async () => {
    const provider = new FakeHarnessProvider();
    const run = await provider.startTask(packet(), "grant-1");

    provider.recordArtifact(run.runId, {
      artifactId: "ok",
      root: "/workspace/project-a/out.md",
      sensitivity: "low",
      provenance: {},
    });
    expect(
      () => provider.recordArtifact(run.runId, {
        artifactId: "escape",
        root: "/workspace/project-b/out.md",
        sensitivity: "low",
        provenance: {},
      }),
    ).toThrow(/escapes workspace root/);

    expect((await provider.collectArtifacts(run.runId)).map((a) => a.artifactId)).toEqual(["ok"]);
  });

  it("replays events in order from a cursor (durable ordering)", async () => {
    const provider = new FakeHarnessProvider();
    const run = await provider.startTask(packet(), "grant-1");
    provider.emitProgress(run.runId, "step 1");
    provider.emitProgress(run.runId, "step 2");
    provider.complete(run.runId);

    const full = await collect(provider.events(run.runId));
    expect(full.map((e) => e.kind)).toEqual(["active", "progress", "progress", "completed"]);

    // Replay from cursor 2 -> only the events at index 2 onward.
    const tail = await collect(provider.events(run.runId, "2"));
    expect(tail.map((e) => e.kind)).toEqual(["progress", "completed"]);
  });

  it("surfaces a failed task with its residual detail", async () => {
    const provider = new FakeHarnessProvider();
    const run = await provider.startTask(packet(), "grant-1");
    provider.fail(run.runId, "sandbox escalation required");

    const state = await provider.getTask(run.runId);
    expect(state.status).toBe("failed");
    expect(state.detail).toBe("sandbox escalation required");

    const events = await collect(provider.events(run.runId));
    expect(events.at(-1)?.kind).toBe("revoked");
  });
});
