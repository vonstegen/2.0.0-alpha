// Intent citation: docs/architecture/resonantos-browser-architecture/10-ground-0-recovery.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
//
// Governed-runtime parity + recovery drills. Exercises the bridge governed
// authority and harness adapters directly (no live Cordis/Hermes/OpenCode
// required — the effect transports are stubbed). This is the CI harness that
// closes CP-5 parity and CP-8 recovery drills once the live transports swap in.
//
// Run: node scripts/governed-runtime-drills.mjs

import { createGovernedAuthority } from "../browser-first/host/bridge-governed-authority.mjs";
import { dispatchGovernedAugmentorExtension } from "../browser-first/host/augmentor-extension-dispatcher.mjs";
import {
  createAiderProviderAdapter,
  createAgentZeroProviderAdapter,
  createDeepSeekHarnessProviderAdapter,
  createHermesProviderAdapter,
  createOpenClawProviderAdapter,
  createOpenCodeProviderAdapter,
  createPiProviderAdapter,
} from "../browser-first/host/harness-provider-adapters.mjs";
import { createContinuityVault, mediateContextRead, reconstructTask } from "../browser-first/host/continuity-vault.mjs";
import { driveRecoveryLadder, enterGroundZero, reEnableFromGroundZero } from "../browser-first/host/ground-zero.mjs";
import { createGroundZeroService } from "../browser-first/host/ground-zero-service.mjs";
import { collectRouteEnforcementTelemetry } from "../browser-first/host/route-enforcement-telemetry.mjs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "ros-continuity-"));
}

function rmrf(root) {
  rmSync(root, { recursive: true, force: true });
}

function readJsonl(filePath) {
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function writeJsonl(filePath, records) {
  writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

const T0 = Date.parse("2026-08-27T06:00:00Z");

function scope(overrides = {}) {
  return {
    action: "archive-read",
    resourceSelectors: ["/workspace/project-a"],
    operations: ["read"],
    taskId: "task-1",
    delegationId: "del-1",
    issuerPrincipalId: "user-1",
    subjectPrincipalId: "hermes-1",
    notBefore: "2026-08-27T00:00:00Z",
    expiresAt: "2026-08-27T12:00:00Z",
    revocationBehavior: "cancel",
    ...overrides,
  };
}

function recordLeaf(authority, s) {
  authority.recordDelegation({
    id: s.delegationId,
    taskId: s.taskId,
    parentDelegationId: null,
    issuerPrincipalId: s.issuerPrincipalId,
    subjectPrincipalId: s.subjectPrincipalId,
    requestedCapabilities: [],
    effectiveGrantId: "g-1",
    purpose: "drill",
    issuedAt: s.notBefore,
    notBefore: s.notBefore,
    expiresAt: s.expiresAt,
    status: "active",
    auditCorrelationId: "aud-1",
  });
}

function governedRequest(handle, overrides = {}) {
  return {
    taskId: "task-1",
    delegationId: "del-1",
    subjectPrincipalId: "hermes-1",
    grantHandle: handle,
    auditCorrelationId: "aud-1",
    payload: { extensionId: "addon.skill:skill", kind: "skill", input: {}, requiredCapabilities: ["archive-read"] },
    ...overrides,
  };
}

const packet = (executorPrincipalId) => ({
  taskId: "task-1",
  issuerPrincipalId: "user-1",
  executorPrincipalId,
  delegationChainRef: { delegationId: "del-1" },
  intent: "drill",
  successCriteria: [],
  nonGoals: [],
  outputContract: {},
  contextRefs: { facts: [], provenance: [], sensitivity: "low", freshness: "x", allowedPurpose: "drill", retentionPolicy: "session", redactions: [] },
  requestedCapabilities: [],
  resourceBudget: { priority: 1, deadline: "x", concurrencyClass: "shared", estimated: {}, hardCeiling: {}, requiredNodeRoles: [], networkMode: "none", workspaceMode: "isolated", secretPolicy: "none", onExhaustion: "stop" },
  workspaceRoots: ["/workspace/project-a"],
  approvalPolicy: "human-approval",
  deadline: "x",
  expiresAt: "x",
  cancellationChannel: "x",
  auditCorrelationId: "aud-1",
});

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    fail += 1;
    console.log(`  \u2717 ${name}: ${error.message}`);
  }
}

async function main() {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = scope();
  recordLeaf(authority, s);
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });

  console.log("Parity — governed authority denies before effect");
  await check("forged subject", () => {
    const r = authority.validateGovernedRequest(governedRequest(handle, { subjectPrincipalId: "attacker" }));
    if (r.ok || r.reason !== "subject-mismatch") throw new Error(`got ${r.reason}`);
  });
  await check("expired grant", () => {
    const past = createGovernedAuthority({ now: () => Date.parse("2026-08-27T13:00:00Z") });
    const s2 = scope();
    recordLeaf(past, s2);
    const h2 = past.mintGrant({ grantId: "g-2", scope: s2 });
    const r = past.validateGovernedRequest(governedRequest(h2));
    if (r.ok || r.reason !== "expired") throw new Error(`got ${r.reason}`);
  });
  await check("sibling reuse (task mismatch)", () => {
    const r = authority.validateGovernedRequest(governedRequest(handle, { taskId: "task-9" }));
    if (r.ok || r.reason !== "task-mismatch") throw new Error(`got ${r.reason}`);
  });
  await check("valid request admitted", () => {
    const r = authority.validateGovernedRequest(governedRequest(handle));
    if (!r.ok) throw new Error(`got ${r.reason}`);
  });

  console.log("Parity — extension dispatch intersects declared capabilities");
  await check("capability-not-granted denied", async () => {
    const r = await dispatchGovernedAugmentorExtension({
      request: governedRequest(handle, { payload: { extensionId: "x", kind: "tool", input: {}, requiredCapabilities: ["network"] } }),
      governedAuthority: authority,
      runEffect: async () => ({ status: "ok" }),
    });
    if (r.outcome !== "deny" || r.reason !== "capability-not-granted") throw new Error(`got ${r.outcome}/${r.reason}`);
  });

  console.log("Parity — seven adapter shapes share one governed authority (no vendor exceptions)");
  const adapters = [
    createHermesProviderAdapter({ governedAuthority: authority }),
    createOpenCodeProviderAdapter({ governedAuthority: authority, ensureServer: async () => ({ baseUrl: "http://stub" }), createClient: () => ({ createSession: async () => ({ id: "s" }), prompt: async () => {} }) }),
    createOpenClawProviderAdapter({ governedAuthority: authority }),
    createAgentZeroProviderAdapter({ governedAuthority: authority }),
    createDeepSeekHarnessProviderAdapter({ governedAuthority: authority }),
    createPiProviderAdapter({ governedAuthority: authority }),
    createAiderProviderAdapter({ governedAuthority: authority }),
  ];
  for (const adapter of adapters) {
    await check(`${adapter.providerId} denies forged subject before effect`, async () => {
      const run = await adapter.startTask(packet("attacker"), handle);
      const state = await adapter.getTask(run.runId);
      if (state.status !== "failed" || !/subject-mismatch/.test(state.detail ?? "")) throw new Error(`got ${state.status}/${state.detail}`);
    });
  }

  console.log("Concurrency — concurrent tasks stay isolated (no workspace/grant leakage)");
  await check("two harnesses run concurrently with independent run ids", async () => {
    const a1 = createHermesProviderAdapter({ governedAuthority: authority, spawnImpl: () => ({ status: 0, stdout: "ok", stderr: "" }) });
    const a2 = createAiderProviderAdapter({ governedAuthority: authority, spawnImpl: () => ({ status: 0, stdout: "ok", stderr: "" }) });
    const [r1, r2] = await Promise.all([
      a1.startTask(packet("hermes-1"), handle),
      a2.startTask(packet("hermes-1"), handle),
    ]);
    if (r1.runId === r2.runId) throw new Error("run ids collided");
    const s1 = await a1.getTask(r1.runId);
    const s2 = await a2.getTask(r2.runId);
    if (s1.status !== "completed" || s2.status !== "completed") throw new Error(`statuses ${s1.status}/${s2.status}`);
  });
  await check("cancelling one run leaves the sibling run untouched", async () => {
    const adapter = createHermesProviderAdapter({ governedAuthority: authority, spawnImpl: () => ({ status: 0, stdout: "ok", stderr: "" }) });
    const r1 = await adapter.startTask(packet("hermes-1"), handle);
    const r2 = await adapter.startTask(packet("hermes-1"), handle);
    await adapter.cancelTask(r1.runId, "drill-cancel");
    const s1 = await adapter.getTask(r1.runId);
    const s2 = await adapter.getTask(r2.runId);
    if (s1.status !== "cancelled") throw new Error(`cancellation not deterministic: ${s1.status}`);
    if (s2.status !== "completed") throw new Error(`sibling run affected: ${s2.status}`);
  });
  console.log("Authority drill — revocation empties grant resolution, fresh grant never revives");
  await check("revoke-on-entry empties grant resolution", () => {
    const g0 = createGovernedAuthority({ now: () => T0 });
    const s3 = scope();
    recordLeaf(g0, s3);
    const h3 = g0.mintGrant({ grantId: "g-3", scope: s3 });
    g0.revokeTask("task-1");
    const r = g0.validateGovernedRequest(governedRequest(h3));
    if (r.ok || r.reason !== "status-revoked") throw new Error(`got ${r.reason}`);
  });
  await check("re-enable issues fresh grants (old handle never revives)", () => {
    const g0 = createGovernedAuthority({ now: () => T0 });
    const s3 = scope();
    recordLeaf(g0, s3);
    const oldHandle = g0.mintGrant({ grantId: "g-3", scope: s3 });
    g0.revokeTask("task-1");
    const freshHandle = g0.mintGrant({ grantId: "g-4", scope: s3 });
    const r = g0.validateGovernedRequest(governedRequest(freshHandle));
    if (!r.ok) throw new Error(`fresh grant rejected: ${r.reason}`);
    const old = g0.validateGovernedRequest(governedRequest(oldHandle));
    if (old.ok || old.reason !== "status-revoked") throw new Error(`old handle revived: ${old.reason}`);
  });

  console.log("Ground-0 recovery drill — state machine revokes all, re-enables in dependency order");
  const g0Snapshot = () => ({
    state: "normal",
    activeGrantIds: ["grant-1", "grant-2"],
    optionalItems: [
      { id: "addon.hermes", kind: "harness" },
      { id: "addon.browser", kind: "extension" },
    ],
    quarantine: [],
    audit: [],
  });
  await check("enterGroundZero revokes every grant and quarantines every optional item", () => {
    const entered = enterGroundZero(g0Snapshot(), { trigger: "drill", at: "t1" });
    if (entered.state !== "ground-zero") throw new Error(`state ${entered.state}`);
    if (entered.activeGrantIds.length !== 0) throw new Error("pre-recovery authority survived entry");
    if (entered.quarantine.length !== 2) throw new Error(`quarantined ${entered.quarantine.length}`);
  });
  await check("reEnableFromGroundZero mints fresh grants, never revives old ids", () => {
    const entered = enterGroundZero(g0Snapshot(), { trigger: "drill", at: "t1" });
    const reenabled = reEnableFromGroundZero(entered, {
      order: ["addon.browser", "addon.hermes"],
      healthCheck: () => true,
      at: "t2",
    });
    if (reenabled.state !== "normal") throw new Error(`state ${reenabled.state}`);
    if (reenabled.activeGrantIds.some((id) => id === "grant-1" || id === "grant-2")) {
      throw new Error("old grant id revived");
    }
    if (!reenabled.activeGrantIds.every((id) => id.startsWith("fresh-grant:"))) {
      throw new Error(`got ${reenabled.activeGrantIds}`);
    }
  });
  await check("unhealthy item is left disabled after re-enable", () => {
    const entered = enterGroundZero(g0Snapshot(), { trigger: "drill", at: "t1" });
    const reenabled = reEnableFromGroundZero(entered, {
      order: ["addon.browser", "addon.hermes"],
      healthCheck: (id) => id !== "addon.hermes",
      at: "t2",
    });
    if (reenabled.activeGrantIds.join(",") !== "fresh-grant:addon.browser") {
      throw new Error(`got ${reenabled.activeGrantIds}`);
    }
    const hermes = reenabled.quarantine.find((q) => q.item === "addon.hermes");
    if (hermes.disposition !== "left-disabled") throw new Error(`hermes disposition ${hermes.disposition}`);
  });
  await check("Ground-0 service revokes every live grant on entry (handle denied)", () => {
    const authority = createGovernedAuthority({ now: () => T0 });
    const s3 = scope();
    recordLeaf(authority, s3);
    const handle = authority.mintGrant({ grantId: "g-live", scope: s3 });
    const service = createGroundZeroService({
      governedAuthority: authority,
      surfaceInventory: () => [{ id: "harness:hermes", kind: "harness" }],
      now: () => T0,
    });
    service.enter({ trigger: "drill" });
    if (!service.isDisabled()) throw new Error("service not disabled after entry");
    if (authority.listActiveGrants().length !== 0) throw new Error("active grants survived entry");
    const r = authority.validateGovernedRequest(governedRequest(handle));
    if (r.ok || r.reason !== "status-revoked") throw new Error(`got ${r.reason}`);
  });
  await check("Ground-0 service blocks a second entry and re-enables on exit", async () => {
    const authority = createGovernedAuthority({ now: () => T0 });
    const service = createGroundZeroService({
      governedAuthority: authority,
      surfaceInventory: () => [{ id: "harness:hermes", kind: "harness" }],
      now: () => T0,
    });
    service.enter({ trigger: "drill" });
    let threw = false;
    try {
      service.enter({ trigger: "drill" });
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("double entry did not throw");
    const exited = await service.exit({
      order: ["harness:hermes"],
      healthCheck: async () => true,
    });
    if (exited.state !== "normal" || service.isDisabled()) throw new Error("exit did not resume");
  });
  await check("Ground-0 state drives the recovery ladder (entry active, exit handoff)", () => {
    const ladder = {
      active: false,
      lastNormalThreadId: "thread-main-desktop",
      checklist: [
        { id: "facts", status: "pending" },
        { id: "report", status: "pending" },
      ],
      changeLog: [],
    };
    const active = driveRecoveryLadder("ground-zero", ladder, "t1");
    if (!active.active || active.checklist[0].status !== "active") throw new Error("ladder not activated on entry");
    const exited = driveRecoveryLadder("normal", active, "t2");
    if (exited.active || exited.checklist.find((s) => s.id === "report").status !== "complete") {
      throw new Error("ladder not handed off on exit");
    }
  });
  await check("route-enforcement telemetry reports governed vs legacy parity", () => {
    const telemetry = collectRouteEnforcementTelemetry([
      { method: "POST", path: "/external-agent-runtime/governed-delegate", enforcement: "governed" },
      { method: "POST", path: "/augmentor/extension/invoke", enforcement: "governed" },
      { method: "POST", path: "/hermes/delegation/start", requiredCapability: "addon-runtime-control" },
      { method: "GET", path: "/addons/status" },
    ]);
    if (telemetry.governed !== 2) throw new Error(`governed ${telemetry.governed}`);
    if (telemetry.legacy !== 1) throw new Error(`legacy ${telemetry.legacy}`);
    if (telemetry.ungated !== 1) throw new Error(`ungated ${telemetry.ungated}`);
    if (telemetry.migrationComplete) throw new Error("migration complete while a legacy route remains");
  });

  console.log("CP-7 continuity — bounded context, restart reconstruction, last-known-good");
  await check("gatekeeper admits only the effective-context intersection", () => {
    const facts = [
      { value: { project: "X" }, sourceRefs: ["proj-x"], domain: "trusted-continuity" },
      { value: { prefs: {} }, sourceRefs: ["identity"], domain: "user-identity" },
      { value: { dangling: true }, sourceRefs: ["dangling"] },
    ];
    const policy = {
      actorPermissions: ["trusted-continuity", "delegation-history"],
      taskScope: ["trusted-continuity"],
      userPolicy: ["trusted-continuity"],
      trustLevel: ["trusted-continuity", "user-identity"],
    };
    const decision = mediateContextRead(facts, policy);
    if (decision.effectiveContext.map((f) => f.sourceRefs[0]).join(",") !== "proj-x") {
      throw new Error(`effective context ${decision.effectiveContext.map((f) => f.sourceRefs[0])}`);
    }
    if (decision.deniedRefs.sort().join(",") !== "dangling,identity") throw new Error(`denied ${decision.deniedRefs}`);
  });
  await check("gatekeeper redacts secret-shaped facts even in-domain", () => {
    const facts = [{ value: { apiKey: "SECRET_TOKEN_123" }, sourceRefs: ["cfg"], domain: "trusted-continuity" }];
    const policy = {
      actorPermissions: ["trusted-continuity"],
      taskScope: ["trusted-continuity"],
      userPolicy: ["trusted-continuity"],
      trustLevel: ["trusted-continuity"],
    };
    const decision = mediateContextRead(facts, policy, { secretPattern: /SECRET_TOKEN/ });
    if (decision.effectiveContext.length !== 0) throw new Error("secret-shaped fact leaked");
    if (decision.redactions.join(",") !== "cfg") throw new Error(`redactions ${decision.redactions}`);
  });
  await check("reconstructs a delegated task from history (provider switch)", () => {
    const history = [
      { delegationId: "d1", taskId: "t1", harnessId: "hermes", issuerPrincipalId: "u", summary: "summarize", completedAt: "2026-08-28T09:00:00Z" },
      { delegationId: "d2", taskId: "t1", harnessId: "opencode", issuerPrincipalId: "u", summary: "code it", completedAt: "2026-08-28T10:00:00Z" },
    ];
    const r = reconstructTask(history, "t1");
    if (!r || r.lastHarness !== "opencode" || r.summary !== "code it") throw new Error(`got ${JSON.stringify(r)}`);
    if (reconstructTask(history, "missing") !== null) throw new Error("reconstructed a missing task");
  });
  await check("vault persists delegation history across restart reconstruction", async () => {
    const root = await makeTempDir();
    try {
      const vault = createContinuityVault({ persistenceRoot: root });
      vault.recordDelegation({ delegationId: "d1", taskId: "task-7", harnessId: "pi", issuerPrincipalId: "user-1", summary: "add multiply", completedAt: "2026-08-30T10:00:00Z" });
      const reloaded = createContinuityVault({ persistenceRoot: root });
      const r = reloaded.reconstruct("task-7");
      if (!r || r.lastHarness !== "pi" || r.summary !== "add multiply") throw new Error(`restart reconstruction failed: ${JSON.stringify(r)}`);
    } finally {
      await rmrf(root);
    }
  });
  await check("vault skips a tampered snapshot when picking last-known-good", async () => {
    const root = await makeTempDir();
    try {
      const vault = createContinuityVault({ persistenceRoot: root });
      vault.recordSnapshot({ domains: { "user-identity": { id: "u" } } });
      // Tamper with the persisted snapshot domains so its stored hash no longer
      // matches a recomputation — reload must skip it.
      const snapshots = await readJsonl(join(root, "snapshots.jsonl"));
      snapshots[0].domains = { "user-identity": { id: "tampered" } };
      await writeJsonl(join(root, "snapshots.jsonl"), snapshots);
      const reloaded = createContinuityVault({ persistenceRoot: root });
      if (reloaded.lastKnownGood() !== null) throw new Error("tampered snapshot accepted as last-known-good");
    } finally {
      await rmrf(root);
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

await main();
