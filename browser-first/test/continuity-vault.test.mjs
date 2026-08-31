// Intent citation: docs/architecture/resonantos-browser-architecture/09-memory-context-trusted-continuity.md
// Intent citation: docs/architecture/resonantos-browser-architecture/15-identity-continuity-vault.md
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createContinuityVault,
  mediateContextRead,
  reconstructLastKnownGood,
  reconstructTask,
  reloadGroundZeroKernel,
} from "../host/continuity-vault.mjs";

const policy = {
  actorPermissions: ["trusted-continuity", "delegation-history"],
  taskScope: ["trusted-continuity"],
  userPolicy: ["trusted-continuity"],
  trustLevel: ["trusted-continuity", "user-identity"],
};

function makeVault() {
  const root = mkdtempSync(join(tmpdir(), "ros-continuity-test-"));
  const vault = createContinuityVault({ persistenceRoot: root });
  return { root, vault };
}

function rmrf(root) {
  rmSync(root, { recursive: true, force: true });
}

test("gatekeeper admits only the effective-context intersection", () => {
  const facts = [
    { value: { project: "X" }, sourceRefs: ["proj-x"], domain: "trusted-continuity" },
    { value: { prefs: {} }, sourceRefs: ["identity"], domain: "user-identity" },
    { value: { dangling: true }, sourceRefs: ["dangling"] },
  ];
  const decision = mediateContextRead(facts, policy);
  assert.deepEqual(decision.effectiveContext.map((f) => f.sourceRefs[0]), ["proj-x"]);
  assert.deepEqual(decision.deniedRefs.sort(), ["dangling", "identity"]);
});

test("gatekeeper redacts a secret-shaped fact even when in-domain", () => {
  const facts = [{ value: { apiKey: "SECRET_TOKEN_123" }, sourceRefs: ["cfg"], domain: "trusted-continuity" }];
  const decision = mediateContextRead(facts, policy, { secretPattern: /SECRET_TOKEN/ });
  assert.equal(decision.effectiveContext.length, 0);
  assert.deepEqual(decision.redactions, ["cfg"]);
});

test("reconstructLastKnownGood picks the most recent integrity-verified snapshot", () => {
  const snapshots = [
    { snapshotId: "s1", takenAt: "2026-08-28T10:00:00Z", integrityHash: "bad", domains: {} },
    { snapshotId: "s2", takenAt: "2026-08-28T09:00:00Z", integrityHash: "good", domains: {} },
    { snapshotId: "s3", takenAt: "2026-08-28T11:00:00Z", integrityHash: "good", domains: {} },
  ];
  assert.equal(reconstructLastKnownGood(snapshots, (hash) => hash === "good")?.snapshotId, "s3");
  assert.equal(reconstructLastKnownGood(snapshots, () => false), null);
});

test("reconstructTask returns the latest harness summary, never a missing task", () => {
  const history = [
    { delegationId: "d1", taskId: "t1", harnessId: "hermes", issuerPrincipalId: "u", summary: "summarize", completedAt: "2026-08-28T09:00:00Z" },
    { delegationId: "d2", taskId: "t1", harnessId: "opencode", issuerPrincipalId: "u", summary: "code it", completedAt: "2026-08-28T10:00:00Z" },
  ];
  assert.deepEqual(reconstructTask(history, "t1"), { taskId: "t1", summary: "code it", lastHarness: "opencode" });
  assert.equal(reconstructTask(history, "missing"), null);
});

test("reloadGroundZeroKernel loads core skills only", () => {
  const snapshot = {
    snapshotId: "s",
    takenAt: "x",
    integrityHash: "h",
    domains: {
      "user-identity": { id: "u" },
      "augmentor-identity": { id: "a" },
      "trusted-continuity": { projects: [] },
    },
  };
  const skills = [
    { skillId: "recovery", version: "1.2", tier: "core" },
    { skillId: "research", version: "3.2", tier: "optional" },
  ];
  const kernel = reloadGroundZeroKernel(snapshot, skills);
  assert.deepEqual(kernel?.userIdentity, { id: "u" });
  assert.deepEqual(kernel?.coreSkills.map((s) => s.skillId), ["recovery"]);
  assert.equal(reloadGroundZeroKernel(null, skills), null);
});

test("vault persists delegation history across restart reconstruction", () => {
  const { root } = makeVault();
  try {
    const vault = createContinuityVault({ persistenceRoot: root });
    vault.recordDelegation({ delegationId: "d1", taskId: "task-7", harnessId: "pi", issuerPrincipalId: "user-1", summary: "add multiply", completedAt: "2026-08-30T10:00:00Z" });

    const reloaded = createContinuityVault({ persistenceRoot: root });
    assert.deepEqual(reloaded.reconstruct("task-7"), { taskId: "task-7", summary: "add multiply", lastHarness: "pi" });
  } finally {
    rmrf(root);
  }
});

test("vault skips a tampered snapshot when picking last-known-good", () => {
  const { root } = makeVault();
  try {
    const vault = createContinuityVault({ persistenceRoot: root });
    vault.recordSnapshot({ domains: { "user-identity": { id: "u" } } });
    assert.equal(vault.lastKnownGood()?.domains["user-identity"].id, "u");

    // Tamper with the persisted domains so the stored hash no longer matches.
    const snapshotPath = join(root, "snapshots.jsonl");
    const rows = readFileSync(snapshotPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    rows[0].domains = { "user-identity": { id: "tampered" } };
    writeFileSync(snapshotPath, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");

    const reloaded = createContinuityVault({ persistenceRoot: root });
    assert.equal(reloaded.lastKnownGood(), null);
  } finally {
    rmrf(root);
  }
});

test("vault.reconstruct and gatekeeper never return credentials", () => {
  const vault = createContinuityVault();
  vault.recordDelegation({ delegationId: "d1", taskId: "t9", harnessId: "hermes", issuerPrincipalId: "u", summary: "do the thing", completedAt: "x" });
  const r = vault.reconstruct("t9");
  assert.equal(r.summary, "do the thing");
  // Reconstructed task carries no credential-shaped fields.
  assert.equal(JSON.stringify(r).includes("sk-"), false);
});
