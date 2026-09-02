// Intent citation: docs/architecture/resonantos-browser-architecture/CP75-PHASE75-CONTINUATION.md
// Intent citation: docs/architecture/resonantos-browser-architecture/TOM-FEEDBACK-CROSS-REFERENCE.md
//
// CP-7.5 §7.5.3 (Runtime Block Validation). Verifies that:
//   1. A manifest with agents[].trustTier === "core" is rejected (the
//      compile-time Exclude<TrustTier, "core"> guard does not protect
//      JSON-loaded manifests; this is the runtime equivalent).
//   2. A manifest with delegation.requiresHumanApprovalBeforeExecution
//      === false is rejected (the §7.5.3 community-ready trust gate).
//   3. A manifest with a valid agents[] + delegation pair passes.
//   4. A manifest with no agents or delegation blocks passes (both optional).
//   5. Bundled manifest shape: hermes.json has agents[] (trustTier=addon)
//      + delegation (requiresHumanApprovalBeforeExecution=true) and validates.

import { describe, expect, it } from "vitest";

import { validateAddOnManifest } from "./validation.ts";

const baseManifest = (overrides: Record<string, unknown> = {}) => ({
  id: "addon.runtime-blocks-test",
  name: "Runtime Blocks Test",
  version: "0.1.0",
  publisher: "resonantos-testing",
  author: "Resonant Alpha",
  category: "tool",
  description: "CP-7.5 §7.5.3 runtime block validation smoke test.",
  runtimeType: "local-service",
  surfaces: [{ id: "main", label: "Main", description: "Main surface.", type: "page" }],
  requestedCapabilities: [
    { capability: "network", granted: false, scope: "shared", revocationBehavior: "hard-stop" },
  ],
  providerRequirements: {
    sharedProfiles: [],
    supportsPrivateCredentials: false,
  },
  archiveIntegration: {
    readScopes: [],
    intakeWriteScopes: [],
    canRequestIngest: false,
    canWriteKnowledgePages: false,
  },
  health: { strategy: "ready" },
  installHooks: {},
  sdkVersion: "^2.0.x",
  compatibility: { shellVersion: "2.0.0-beta.1", platforms: ["darwin"] },
  ...overrides,
});

const validAgents = [
  { id: "agent.example", displayName: "Example Agent", trustTier: "addon", workspaceBehavior: "delegated" },
];

const validDelegation = {
  acceptsTasks: true,
  taskTypes: ["routine-work"],
  artifactReturnTypes: ["summary"],
  defaultTargetRuntime: "local-service",
  requiresHumanApprovalBeforeExecution: true,
};

describe("CP-7.5 §7.5.3 runtime block validation", () => {
  it("accepts a manifest with no agents or delegation blocks", () => {
    const result = validateAddOnManifest(baseManifest());
    const runtimeIssues = result.issues.filter((i) =>
      i.code.startsWith("runtime-") && i.code !== "runtime-delegation-flag-missing",
    );
    expect(runtimeIssues).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it("accepts a valid agents[] + delegation pair", () => {
    const result = validateAddOnManifest(baseManifest({
      agents: validAgents,
      delegation: validDelegation,
    }));
    const runtimeIssues = result.issues.filter((i) => i.code.startsWith("runtime-"));
    expect(runtimeIssues).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it("rejects a manifest whose agents[].trustTier is 'core' (the §7.5.3 trust-tier exclusion)", () => {
    const result = validateAddOnManifest(baseManifest({
      agents: [{ ...validAgents[0], trustTier: "core" }],
    }));
    expect(result.valid).toBe(false);
    const coreIssue = result.issues.find(
      (i) => i.code === "runtime-agent-trust-tier-core",
    );
    expect(coreIssue).toBeDefined();
    expect(coreIssue?.path).toBe("agents[0].trustTier");
    expect(coreIssue?.message).toContain("core");
  });

  it("rejects a manifest whose agents[].trustTier is unknown (not addon/external/core)", () => {
    const result = validateAddOnManifest(baseManifest({
      agents: [{ ...validAgents[0], trustTier: "rogue-tier" }],
    }));
    expect(result.valid).toBe(false);
    const issue = result.issues.find(
      (i) => i.code === "runtime-agent-trust-tier-unknown",
    );
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("rogue-tier");
  });

  it("rejects a manifest whose agents[] is not an array", () => {
    const result = validateAddOnManifest(baseManifest({ agents: "not-an-array" }));
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.code === "runtime-agents-array");
    expect(issue).toBeDefined();
  });

  it("rejects a manifest whose delegation.requiresHumanApprovalBeforeExecution is false (the §7.5.3 community-ready gate)", () => {
    const result = validateAddOnManifest(baseManifest({
      delegation: { ...validDelegation, requiresHumanApprovalBeforeExecution: false },
    }));
    expect(result.valid).toBe(false);
    const issue = result.issues.find(
      (i) => i.code === "runtime-delegation-flag-bypassed",
    );
    expect(issue).toBeDefined();
    expect(issue?.path).toBe("delegation.requiresHumanApprovalBeforeExecution");
  });

  it("rejects a manifest whose delegation is not an object", () => {
    const result = validateAddOnManifest(baseManifest({ delegation: "not-an-object" }));
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.code === "runtime-delegation-shape");
    expect(issue).toBeDefined();
  });

  it("accepts the bundled hermes.json shape (verified catalog entry)", () => {
    // Regression: the bundled hermes.json declares an addon-tier agent and
    // a delegation block with requiresHumanApprovalBeforeExecution=true. Both
    // must pass the §7.5.3 gate.
    const hermes = baseManifest({
      id: "addon.hermes",
      name: "Hermes",
      agents: [
        { id: "hermes.agent", displayName: "Hermes", trustTier: "addon", workspaceBehavior: "delegated" },
      ],
      delegation: {
        acceptsTasks: true,
        taskTypes: ["communication", "routine-work", "research"],
        artifactReturnTypes: ["summary", "markdown", "log", "citation-bundle", "verification-report"],
        defaultTargetRuntime: "addon-agent",
        requiresHumanApprovalBeforeExecution: true,
        notes: ["Hermes must request approval before public, external, or identity-sensitive sends."],
      },
    });
    const result = validateAddOnManifest(hermes);
    const runtimeIssues = result.issues.filter((i) => i.code.startsWith("runtime-"));
    expect(runtimeIssues).toHaveLength(0);
    expect(result.valid).toBe(true);
  });
});
