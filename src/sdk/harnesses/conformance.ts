// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
//
// CP-5 shared conformance suite. Runs the CP-4 exit-gate checks against ANY
// harness provider adapter, so every provider shape is gated by the SAME
// lifecycle/cancellation/confinement/replay/failure contract — no
// vendor-specific authority exceptions (doc 12 §Conformance suite).

import type { ArtifactRef, TaskPacket } from "../tasks";
import type { HarnessProviderAdapter } from "./index";

// The driver surface the suite needs beyond the adapter contract. Reference
// providers expose it via `BaseHarnessProvider`; a provider with real async
// execution drives it through its own completion/failure paths.
export interface HarnessRunController {
  recordArtifact(runId: string, artifact: ArtifactRef): void;
  complete(runId: string, artifacts?: ArtifactRef[]): void;
  fail(runId: string, detail: string): void;
  emitProgress(runId: string, detail: string): void;
}

export type HarnessConformanceTarget = HarnessProviderAdapter & HarnessRunController & { providerId: string };

export interface HarnessConformanceCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface HarnessConformanceResult {
  adapterId: string;
  checks: HarnessConformanceCheck[];
  passed: boolean;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

const ESCAPE_ROOT = "/workspace/project-b";

export async function runHarnessProviderConformance(
  adapter: HarnessConformanceTarget,
  packet: TaskPacket,
): Promise<HarnessConformanceResult> {
  const workspaceRoot = packet.workspaceRoots[0] ?? "/tmp";
  const checks: HarnessConformanceCheck[] = [];

  const run = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
    try {
      await fn();
      checks.push({ name, passed: true });
    } catch (error) {
      checks.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };

  await run("lifecycle", async () => {
    const run = await adapter.startTask(packet, "grant-1");
    if (run.status !== "running") throw new Error("startTask did not enter running");
    if ((await adapter.getTask(run.runId)).status !== "running") throw new Error("getTask did not reflect running");
    adapter.complete(run.runId, [
      { artifactId: "a-1", root: `${workspaceRoot}/summary.md`, sensitivity: "low", provenance: {} },
    ]);
    if ((await adapter.getTask(run.runId)).status !== "completed") throw new Error("complete did not complete");
    const artifacts = await adapter.collectArtifacts(run.runId);
    if (artifacts.length !== 1 || artifacts[0].artifactId !== "a-1") throw new Error("collectArtifacts mismatch");
  });

  await run("cancellation", async () => {
    const run = await adapter.startTask(packet, "grant-1");
    await adapter.cancelTask(run.runId, "user abort");
    const state = await adapter.getTask(run.runId);
    if (state.status !== "cancelled") throw new Error("cancelTask did not cancel");
    if (state.detail !== "user abort") throw new Error("cancel reason not recorded");
  });

  await run("artifact-confinement", async () => {
    const run = await adapter.startTask(packet, "grant-1");
    adapter.recordArtifact(run.runId, {
      artifactId: "ok",
      root: `${workspaceRoot}/out.md`,
      sensitivity: "low",
      provenance: {},
    });
    let escaped = false;
    try {
      adapter.recordArtifact(run.runId, {
        artifactId: "escape",
        root: `${ESCAPE_ROOT}/out.md`,
        sensitivity: "low",
        provenance: {},
      });
    } catch {
      escaped = true;
    }
    if (!escaped) throw new Error("artifact escape was not rejected");
    const artifacts = await adapter.collectArtifacts(run.runId);
    if (artifacts.map((a) => a.artifactId).join(",") !== "ok") throw new Error("escaped artifact leaked into collectArtifacts");
  });

  await run("event-replay", async () => {
    const run = await adapter.startTask(packet, "grant-1");
    adapter.emitProgress(run.runId, "step 1");
    adapter.emitProgress(run.runId, "step 2");
    adapter.complete(run.runId);
    const full = await collect(adapter.events(run.runId));
    if (full.map((e) => e.kind).join(",") !== "active,progress,progress,completed") {
      throw new Error(`unexpected event order: ${full.map((e) => e.kind).join(",")}`);
    }
    const tail = await collect(adapter.events(run.runId, "2"));
    if (tail.map((e) => e.kind).join(",") !== "progress,completed") throw new Error("cursor replay failed");
  });

  await run("failure", async () => {
    const run = await adapter.startTask(packet, "grant-1");
    adapter.fail(run.runId, "sandbox escalation required");
    const state = await adapter.getTask(run.runId);
    if (state.status !== "failed") throw new Error("fail did not fail");
    if (state.detail !== "sandbox escalation required") throw new Error("failure detail not recorded");
  });

  return { adapterId: adapter.providerId, checks, passed: checks.every((check) => check.passed) };
}
