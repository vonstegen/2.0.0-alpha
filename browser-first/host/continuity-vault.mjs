// Intent citation: docs/architecture/resonantos-browser-architecture/09-memory-context-trusted-continuity.md
// Intent citation: docs/architecture/resonantos-browser-architecture/15-identity-continuity-vault.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
//
// CP-7 bridge-side Identity & Continuity Vault. Plain-JS mirror of
// src/sdk/continuity/index.ts (the bridge is dependency-free of `src/`).
//
// The vault is Core-owned (doc 15): it retains durable identity + trusted
// continuity in separate trust domains, and the Continuity Gatekeeper mediates
// every read by the effective-context intersection. The raw store does not
// belong to Augmentor. Secrets/capability tokens are never continuity payloads
// (doc 09) — they stay references or vault state.
//
// Persistence is JSONL under a per-bridge persistence root. Delegation history
// and snapshots survive a bridge restart so a task can be reconstructed
// (provider-switch / restart reconstruction) without replaying credentials.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TRUST_DOMAINS = [
  "user-identity",
  "augmentor-identity",
  "trusted-continuity",
  "augmentor-core-skills",
  "user-defined-skills",
  "delegation-history",
  "recovery-checkpoints",
];

// ---- Continuity Gatekeeper (doc 15 §Continuity gatekeeper) ----
// Mirrors src/sdk/continuity/index.ts `mediateContextRead`.

function intersection(...sets) {
  if (sets.length === 0) return [];
  const [first, ...rest] = sets;
  return first.filter((domain) => rest.every((set) => set.includes(domain)));
}

export function mediateContextRead(facts, policy, opts = {}) {
  const allowed = intersection(
    policy.actorPermissions,
    policy.taskScope,
    policy.userPolicy,
    policy.trustLevel,
  );
  const effectiveContext = [];
  const deniedRefs = [];
  const redactions = [];

  for (const fact of facts) {
    if (fact.domain == null || !allowed.includes(fact.domain)) {
      deniedRefs.push(...(fact.sourceRefs ?? []));
      continue;
    }
    if (opts.secretPattern && opts.secretPattern.test(JSON.stringify(fact.value))) {
      redactions.push(...(fact.sourceRefs ?? []));
      continue;
    }
    effectiveContext.push(fact);
  }
  return { effectiveContext, redactions, deniedRefs };
}

// ---- Continuity snapshot + reconstruction (doc 15 §Ground-0 reload path) ----

export function reconstructLastKnownGood(snapshots, verifyIntegrity) {
  const good = snapshots
    .filter((snapshot) => verifyIntegrity(snapshot.integrityHash))
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  return good[0] ?? null;
}

export function reconstructTask(history, taskId) {
  const entries = history
    .filter((entry) => entry.taskId === taskId)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  if (entries.length === 0) return null;
  const last = entries[0];
  return { taskId, summary: last.summary, lastHarness: last.harnessId };
}

export function reloadGroundZeroKernel(snapshot, skills) {
  if (!snapshot) return null;
  return {
    userIdentity: snapshot.domains["user-identity"],
    augmentorIdentity: snapshot.domains["augmentor-identity"],
    continuityCheckpoint: snapshot.domains["trusted-continuity"],
    coreSkills: skills.filter((skill) => skill.tier === "core"),
  };
}

// ---- Integrity ----

function integrityOf(domains) {
  return createHash("sha256").update(JSON.stringify(domains)).digest("hex");
}

// ---- Persistence helpers ----

function loadJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function appendJsonl(filePath, record) {
  appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

// ---- Vault factory ----

export function createContinuityVault({
  persistenceRoot = null,
  now = () => new Date().toISOString(),
  secretPattern = null,
} = {}) {
  let delegationHistory = [];
  let snapshots = [];

  const delegationPath = persistenceRoot ? join(persistenceRoot, "delegation-history.jsonl") : null;
  const snapshotPath = persistenceRoot ? join(persistenceRoot, "snapshots.jsonl") : null;

  if (persistenceRoot) {
    mkdirSync(persistenceRoot, { recursive: true });
    try {
      delegationHistory = loadJsonl(delegationPath);
    } catch {
      delegationHistory = [];
    }
    try {
      snapshots = loadJsonl(snapshotPath);
    } catch {
      snapshots = [];
    }
  }

  // Record which harness worked which task under whose authority. This is the
  // trusted continuity source `reconstructTask` reads (doc 09: grant/delegation
  // audit summaries, never reusable credentials).
  function recordDelegation({ delegationId, taskId, harnessId, issuerPrincipalId, summary, completedAt }) {
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new Error("recordDelegation: taskId is required");
    }
    if (typeof harnessId !== "string" || harnessId.length === 0) {
      throw new Error("recordDelegation: harnessId is required");
    }
    const entry = {
      delegationId: delegationId ?? null,
      taskId,
      harnessId,
      issuerPrincipalId: issuerPrincipalId ?? null,
      summary: summary ?? "",
      completedAt: completedAt ?? now(),
    };
    delegationHistory.push(entry);
    if (delegationPath) appendJsonl(delegationPath, entry);
    return entry;
  }

  // Take a last-known-good continuity snapshot of the durable domains. The
  // integrity hash is recomputed from the domains on reload, so a tampered
  // snapshot is skipped by `lastKnownGood`.
  function recordSnapshot({ domains }) {
    const snapshot = {
      snapshotId: `snap-${snapshots.length}`,
      takenAt: now(),
      integrityHash: integrityOf(domains ?? {}),
      domains: domains ?? {},
    };
    snapshots.push(snapshot);
    if (snapshotPath) appendJsonl(snapshotPath, snapshot);
    return snapshot;
  }

  // Most recent snapshot whose stored hash matches a recomputation from its
  // domains (self-integrity). A corrupted snapshot is skipped.
  function lastKnownGood() {
    const good = snapshots
      .filter((snapshot) => snapshot.integrityHash === integrityOf(snapshot.domains))
      .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
    return good[0] ?? null;
  }

  // Reconstruct a task from trusted delegation history (restart /
  // provider-switch reconstruction). Never returns credentials.
  function reconstruct(taskId) {
    return reconstructTask(delegationHistory, taskId);
  }

  // Mediate a context read through the gatekeeper (information least privilege).
  function mediate(facts, policy) {
    return mediateContextRead(facts, policy, { secretPattern });
  }

  return {
    recordDelegation,
    recordSnapshot,
    lastKnownGood,
    reconstruct,
    mediate,
    delegationHistory: () => [...delegationHistory],
    snapshots: () => [...snapshots],
  };
}

export { TRUST_DOMAINS };
