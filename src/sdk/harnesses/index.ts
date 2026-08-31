// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
// Intent citation: docs/architecture/resonantos-browser-architecture/CONTRACTS.md
//
// CP-4 Harness Provider API. A harness provider integrates a complete external
// AI execution environment (Hermes, OpenCode, OpenClaw, …) without ResonantOS
// absorbing its internal architecture (doc 05). The provider is the *seam*: a
// manifest (what the provider is + its policies) and an adapter (the lifecycle
// operations the bridge drives). Every child effect is host-mediated through the
// current identity chain + task grant (doc 05 §Containment rule).

import type { HarnessProviderDefinition } from "../../core/contracts";
import type { ArtifactRef, TaskEvent, TaskPacket } from "../tasks";

// Re-export the manifest-shape types so `src/sdk` surfaces the full provider
// contract from one barrel.
export type {
  HarnessCancellationSemantics,
  HarnessProviderDefinition,
  HarnessSandboxStrength,
} from "../../core/contracts";

export * from "./output-filtering";

// SDK-facing first-class provider declaration: the manifest definition plus
// identity/version and the class discriminant.
export type HarnessProviderManifest = HarnessProviderDefinition & {
  extensionClass: "harness-provider";
  id: string;
  version: string;
};

// Opaque host-resolved grant handle (ADR-054). Never self-contained, never a
// bearer token; the bridge resolves it in memory.
export type GrantHandle = string;

export type HarnessHealthStatus = "ok" | "degraded" | "unavailable";

export interface HarnessHealth {
  status: HarnessHealthStatus;
  providerId: string;
  version?: string;
  latencyMs?: number;
  message?: string;
}

export type HarnessRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export interface HarnessRun {
  runId: string;
  providerId: string;
  taskId: string;
  status: HarnessRunStatus;
}

export interface HarnessRunState extends HarnessRun {
  startedAt?: string;
  endedAt?: string;
  lastEventId?: string;
  detail?: string;
}

// A child actor the harness reports (doc 05 §Containment rule). Its effects are
// constrained by the harness's sandbox or translated into host-mediated calls.
export interface HarnessChildDescriptor {
  childId: string;
  kind: string;
  workspaceRoot?: string;
  sandboxed: boolean;
  escalationRequired: boolean;
}

// The lifecycle surface the bridge drives (CONTRACTS / doc 12 §Provider adapter).
// `events` returns an ordered, durable stream; a provider without durable events
// supplies a polling `getTask` equivalent.
export interface HarnessProviderAdapter {
  diagnose(): Promise<HarnessHealth>;
  startTask(packet: TaskPacket, grant: GrantHandle): Promise<HarnessRun>;
  getTask(runId: string): Promise<HarnessRunState>;
  events(runId: string, cursor?: string): AsyncIterable<TaskEvent>;
  cancelTask(runId: string, reason: string): Promise<void>;
  collectArtifacts(runId: string): Promise<ArtifactRef[]>;
}
