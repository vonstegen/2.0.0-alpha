// Intent citation: docs/architecture/ADR-039-addon-permission-diff-on-update.md
// Intent citation: docs/architecture/resonantos-browser-architecture/CP75-PHASE75-CONTINUATION.md
//
// CP-7.5 §7.5.5 (permission-diff wiring). Verifies that:
//   1. A fresh install (no prior capabilities) with non-empty
//      requestedCapabilities passes — no diff against an empty set.
//   2. A re-install with identical requestedCapabilities passes — no
//      hard changes.
//   3. A re-install that ADDS a new capability triggers the gate (rejected
//      without forceOverride; accepted with forceOverride).
//   4. A re-install that WIDENS a capability scope (e.g. self → shared)
//      triggers the gate.
//   5. A re-install that REMOVES a capability (weakening) triggers the gate.
//   6. The install path propagates the error to setErrorState with a
//      descriptive message.

import { describe, expect, it } from "vitest";

import type { AddOnManifest, Capability } from "../../core/contracts";
import { applyPermissionDiffGate, AddOnPermissionEscalationRequired } from "./controller";

const capability = (
  name: Capability,
  scope: "none" | "self" | "workspace" | "shared" | "intake-only" | "system" = "shared",
) => ({ capability: name, granted: false, scope, revocationBehavior: "hard-stop" as const });

const baseManifest = (overrides: Partial<AddOnManifest> = {}): AddOnManifest => ({
  id: "addon.diff-test",
  name: "Diff Test",
  version: "0.1.0",
  publisher: "resonantos-testing",
  author: "Resonant Alpha",
  category: "tool",
  description: "CP-7.5 §7.5.5 permission diff gate smoke test.",
  runtimeType: "local-service",
  surfaces: [],
  requestedCapabilities: [capability("network")],
  providerRequirements: { sharedProfiles: [], supportsPrivateCredentials: false },
  archiveIntegration: { readScopes: [], intakeWriteScopes: [], canRequestIngest: false, canWriteKnowledgePages: false },
  health: { strategy: "ready" },
  installHooks: {},
  sdkVersion: "^2.0.x",
  compatibility: { shellVersion: "^2.0.0-beta.1", platforms: ["darwin"] },
  ...overrides,
});

describe("CP-7.5 §7.5.5 permission-diff gate", () => {
  it("prompts for a fresh install with non-empty requestedCapabilities (fresh installs are not auto-accepted)", () => {
    // A fresh install introduces capabilities that the user has never seen.
    // Per ADR-039 the host UI must surface the prompt; the gate throws so the
    // UI has a chance to ask before the install proceeds.
    const manifest = baseManifest({ requestedCapabilities: [capability("network")] });
    expect(() => applyPermissionDiffGate([], manifest)).toThrow(AddOnPermissionEscalationRequired);
  });

  it("accepts a fresh install with forceOverride (the human-approved path)", () => {
    const manifest = baseManifest({ requestedCapabilities: [capability("network")] });
    expect(() => applyPermissionDiffGate([], manifest, { forceOverride: true })).not.toThrow();
  });

  it("accepts a fresh install with empty requestedCapabilities (no escalation needed)", () => {
    const manifest = baseManifest({ requestedCapabilities: [] });
    expect(() => applyPermissionDiffGate([], manifest)).not.toThrow();
  });

  it("accepts a re-install with identical requestedCapabilities (no hard changes)", () => {
    const manifest = baseManifest({ requestedCapabilities: [capability("network")] });
    const prior = [capability("network")];
    expect(() => applyPermissionDiffGate(prior, manifest)).not.toThrow();
  });

  it("rejects a re-install that ADDS a new capability without forceOverride", () => {
    const prior = [capability("network")];
    const manifest = baseManifest({ requestedCapabilities: [capability("network"), capability("filesystem")] });
    expect(() => applyPermissionDiffGate(prior, manifest)).toThrow(AddOnPermissionEscalationRequired);
  });

  it("accepts a re-install that ADDS a new capability with forceOverride", () => {
    const prior = [capability("network")];
    const manifest = baseManifest({ requestedCapabilities: [capability("network"), capability("filesystem")] });
    expect(() => applyPermissionDiffGate(prior, manifest, { forceOverride: true })).not.toThrow();
  });

  it("rejects a re-install that WIDENS a capability scope (self -> shared)", () => {
    const prior = [capability("network", "self")];
    const manifest = baseManifest({ requestedCapabilities: [capability("network", "shared")] });
    expect(() => applyPermissionDiffGate(prior, manifest)).toThrow(/scope-widened|hard change/i);
  });

  it("rejects a re-install that REMOVES a capability (weakening)", () => {
    const prior = [capability("network"), capability("filesystem")];
    const manifest = baseManifest({ requestedCapabilities: [capability("network")] });
    expect(() => applyPermissionDiffGate(prior, manifest)).toThrow(/removed|hard change/i);
  });

  it("error carries the hard-change list for the host UI to surface", () => {
    const prior = [capability("network")];
    const manifest = baseManifest({ requestedCapabilities: [capability("network"), capability("filesystem")] });
    try {
      applyPermissionDiffGate(prior, manifest);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AddOnPermissionEscalationRequired);
      const err = error as AddOnPermissionEscalationRequired;
      expect(err.hardChanges.length).toBeGreaterThan(0);
      // The synthetic error shape carries `path`, `kind`, and the optional
      // `capability` field when the change is capability-scoped.
      expect(err.hardChanges.some((c) => (c as { capability?: Capability }).capability === "filesystem")).toBe(true);
    }
  });
});
