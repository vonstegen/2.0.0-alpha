// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
//
// CP-4 conformance fake. The minimal provider shape: host-mediated sandbox,
// `cancel` semantics, no child actors. It exists to prove the adapter contract
// is implementable with no vendor-specific assumptions (doc 12 §Conformance
// suite). The generic lifecycle lives in `BaseHarnessProvider`.

import type { HarnessCancellationSemantics, HarnessHealth, HarnessSandboxStrength } from "./index";
import { BaseHarnessProvider } from "./base-harness-provider";

export class FakeHarnessProvider extends BaseHarnessProvider {
  readonly cancellationSemantics: HarnessCancellationSemantics = "cancel";
  readonly sandboxStrength: HarnessSandboxStrength = "host-mediated";

  constructor(readonly providerId = "fake-provider") {
    super();
  }

  async diagnose(): Promise<HarnessHealth> {
    return { status: "ok", providerId: this.providerId, version: "0.1.0" };
  }
}
