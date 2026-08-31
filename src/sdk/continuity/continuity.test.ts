// Intent citation: docs/architecture/resonantos-browser-architecture/15-identity-continuity-vault.md
import { describe, expect, it } from "vitest";

import type {
  ContextFact,
  ContinuityReadPolicy,
  ContinuitySnapshot,
  DelegationHistoryEntry,
  SkillVersionRef,
} from "./index";
import {
  applyRetentionPolicy,
  deleteFacts,
  exportContinuity,
  mediateContextRead,
  reconstructLastKnownGood,
  reconstructTask,
  reloadGroundZeroKernel,
} from "./index";

const policy: ContinuityReadPolicy = {
  actorPermissions: ["trusted-continuity", "delegation-history"],
  taskScope: ["trusted-continuity"],
  userPolicy: ["trusted-continuity"],
  trustLevel: ["trusted-continuity", "user-identity"],
};

describe("Continuity Gatekeeper", () => {
  it("admits facts in the effective-context intersection and denies the rest", () => {
    const facts: ContextFact[] = [
      { value: { project: "X" }, sourceRefs: ["proj-x"], domain: "trusted-continuity" },
      { value: { prefs: {} }, sourceRefs: ["identity"], domain: "user-identity" },
      { value: { dangling: true }, sourceRefs: ["dangling"] }, // no domain
    ];
    const decision = mediateContextRead(facts, policy);

    expect(decision.effectiveContext.map((f) => f.sourceRefs[0])).toEqual(["proj-x"]);
    expect(decision.deniedRefs.sort()).toEqual(["dangling", "identity"]);
  });

  it("redacts a fact whose value is secret-shaped even when its domain is allowed", () => {
    const facts: ContextFact[] = [
      { value: { apiKey: "SECRET_TOKEN_123" }, sourceRefs: ["cfg"], domain: "trusted-continuity" },
    ];
    const decision = mediateContextRead(facts, policy, { secretPattern: /SECRET_TOKEN/ });

    expect(decision.effectiveContext).toHaveLength(0);
    expect(decision.redactions).toEqual(["cfg"]);
  });
});

describe("continuity reconstruction", () => {
  it("picks the most recent last-known-good snapshot, skipping corrupted ones", () => {
    const snapshots: ContinuitySnapshot[] = [
      { snapshotId: "s1", takenAt: "2026-08-28T10:00:00Z", integrityHash: "bad", domains: {} },
      { snapshotId: "s2", takenAt: "2026-08-28T09:00:00Z", integrityHash: "good", domains: {} },
      { snapshotId: "s3", takenAt: "2026-08-28T11:00:00Z", integrityHash: "good", domains: {} },
    ];
    expect(reconstructLastKnownGood(snapshots, (hash) => hash === "good")?.snapshotId).toBe("s3");
    expect(reconstructLastKnownGood(snapshots, () => false)).toBeNull();
  });

  it("reconstructs a delegated task from delegation history", () => {
    const history: DelegationHistoryEntry[] = [
      { delegationId: "d1", taskId: "t1", harnessId: "hermes", issuerPrincipalId: "u", summary: "summarize", completedAt: "2026-08-28T09:00:00Z" },
      { delegationId: "d2", taskId: "t1", harnessId: "opencode", issuerPrincipalId: "u", summary: "code it", completedAt: "2026-08-28T10:00:00Z" },
    ];
    expect(reconstructTask(history, "t1")).toEqual({ taskId: "t1", summary: "code it", lastHarness: "opencode" });
    expect(reconstructTask(history, "missing")).toBeNull();
  });

  it("reloads the Ground-0 kernel from core skills only", () => {
    const snapshot: ContinuitySnapshot = {
      snapshotId: "s",
      takenAt: "x",
      integrityHash: "h",
      domains: {
        "user-identity": { id: "u" },
        "augmentor-identity": { id: "a" },
        "trusted-continuity": { projects: [] },
      },
    };
    const skills: SkillVersionRef[] = [
      { skillId: "recovery", version: "1.2", tier: "core" },
      { skillId: "research", version: "3.2", tier: "optional" },
    ];
    const kernel = reloadGroundZeroKernel(snapshot, skills);

    expect(kernel?.userIdentity).toEqual({ id: "u" });
    expect(kernel?.coreSkills.map((s) => s.skillId)).toEqual(["recovery"]);
    expect(reloadGroundZeroKernel(null, skills)).toBeNull();
  });
});

describe("continuity portability (export / retention / deletion)", () => {
  it("exports the effective-context intersection and redacts secret-shaped facts", () => {
    const facts: ContextFact[] = [
      { value: { project: "X" }, sourceRefs: ["proj-x"], domain: "trusted-continuity" },
      { value: { apiKey: "SECRET_TOKEN_123" }, sourceRefs: ["cfg"], domain: "trusted-continuity" },
      { value: { prefs: {} }, sourceRefs: ["identity"], domain: "user-identity" },
    ];
    const result = exportContinuity(facts, policy, {
      secretPattern: /SECRET_TOKEN/,
      provenance: ["audit-1"],
    });

    expect(result.envelope.facts.map((f) => f.sourceRefs[0])).toEqual(["proj-x"]);
    expect(result.envelope.redactions).toEqual(["cfg"]);
    expect(result.envelope.provenance).toEqual(["audit-1"]);
    expect(result.exportedRefs).toEqual(["proj-x"]);
    expect(result.deniedRefs.sort()).toEqual(["identity"]);
  });

  it("retention expires facts older than maxAgeMs and retains fresh or untimestamped ones", () => {
    const facts: ContextFact[] = [
      { value: { a: 1 }, sourceRefs: ["fresh"], domain: "trusted-continuity", recordedAt: "2026-08-30T00:00:00Z" },
      { value: { b: 2 }, sourceRefs: ["stale"], domain: "trusted-continuity", recordedAt: "2026-08-01T00:00:00Z" },
      { value: { c: 3 }, sourceRefs: ["no-timestamp"], domain: "trusted-continuity" },
    ];
    const result = applyRetentionPolicy(facts, {
      maxAgeMs: 10 * 24 * 60 * 60 * 1000,
      now: "2026-08-31T00:00:00Z",
    });

    expect(result.retained.map((f) => f.sourceRefs[0]).sort()).toEqual(["fresh", "no-timestamp"]);
    expect(result.expired.map((f) => f.sourceRefs[0])).toEqual(["stale"]);
  });

  it("deletes targeted facts and records an audit entry for audit integrity", () => {
    const facts: ContextFact[] = [
      { value: { a: 1 }, sourceRefs: ["r1"], domain: "trusted-continuity" },
      { value: { b: 2 }, sourceRefs: ["r2", "r3"], domain: "trusted-continuity" },
      { value: { c: 3 }, sourceRefs: ["r4"], domain: "trusted-continuity" },
    ];
    const result = deleteFacts(facts, ["r1", "r3"], {
      reason: "user erasure",
      now: "2026-08-31T00:00:00Z",
    });

    expect(result.remaining.map((f) => f.sourceRefs[0])).toEqual(["r4"]);
    expect(result.audit.deletedRefs.sort()).toEqual(["r1", "r2", "r3"]);
    expect(result.audit.reason).toBe("user erasure");
    expect(result.audit.deletedAt).toBe("2026-08-31T00:00:00Z");
  });
});
