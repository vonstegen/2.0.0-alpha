// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
//
// CP-5 reference provider shapes. Three structurally distinct adapters share
// the SAME `HarnessProviderAdapter` contract (and therefore the SAME bridge
// governed authority — no vendor-specific authority exception). They differ only
// in the provider-specific bits doc 05 calls out:
//
//   - Hermes:  general delegated agent (host-mediated, cancel).
//   - OpenCode: coding/workspace (sandboxed outer boundary, finish-atomic).
//   - OpenClaw: MCP/runtime-gateway (structurally different: child actors are
//     enumerated through a gateway, sandboxed outer boundary, quarantine).
//
// The real migrations wrap the existing `hermes-runtime.mjs` / `opencode-runtime.mjs`
// / OpenClaw gateway; these adapters encode the *shape* so the shared conformance
// suite can gate them before the real transports are swapped in.

import type {
  HarnessCancellationSemantics,
  HarnessChildDescriptor,
  HarnessHealth,
  HarnessSandboxStrength,
} from "./index";
import { BaseHarnessProvider } from "./base-harness-provider";

export class HermesProviderAdapter extends BaseHarnessProvider {
  readonly providerId = "hermes";
  readonly cancellationSemantics: HarnessCancellationSemantics = "cancel";
  readonly sandboxStrength: HarnessSandboxStrength = "host-mediated";

  async diagnose(): Promise<HarnessHealth> {
    return { status: "ok", providerId: this.providerId, version: "0.1.0", message: "host-mediated agent" };
  }

  async listChildActors(runId: string): Promise<HarnessChildDescriptor[]> {
    await this.getTask(runId); // existence check
    return [
      { childId: "hermes.agent", kind: "agent", sandboxed: false, escalationRequired: false },
    ];
  }
}

export class OpenCodeProviderAdapter extends BaseHarnessProvider {
  readonly providerId = "opencode";
  readonly cancellationSemantics: HarnessCancellationSemantics = "finish-atomic";
  readonly sandboxStrength: HarnessSandboxStrength = "sandboxed-outer-boundary";

  async diagnose(): Promise<HarnessHealth> {
    return { status: "ok", providerId: this.providerId, version: "0.1.0", message: "sandboxed coding workspace" };
  }

  async listChildActors(runId: string): Promise<HarnessChildDescriptor[]> {
    const state = await this.getTask(runId);
    return [
      { childId: `opencode.workspace:${state.taskId}`, kind: "workspace", sandboxed: true, escalationRequired: false },
    ];
  }
}

export class OpenClawProviderAdapter extends BaseHarnessProvider {
  readonly providerId = "openclaw";
  readonly cancellationSemantics: HarnessCancellationSemantics = "quarantine";
  readonly sandboxStrength: HarnessSandboxStrength = "sandboxed-outer-boundary";

  async diagnose(): Promise<HarnessHealth> {
    return { status: "ok", providerId: this.providerId, version: "0.1.0", message: "runtime-gateway" };
  }

  async listChildActors(runId: string): Promise<HarnessChildDescriptor[]> {
    await this.getTask(runId); // existence check
    // Structurally different: children are enumerated through a gateway, and
    // any escalated child is surfaced for human approval.
    return [
      { childId: "openclaw.gateway", kind: "gateway", sandboxed: true, escalationRequired: false },
      { childId: "openclaw.child:0", kind: "child-agent", sandboxed: true, escalationRequired: true },
    ];
  }
}
