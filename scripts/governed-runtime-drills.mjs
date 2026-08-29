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

  console.log("Recovery drill — Ground-0 revokes all authority, re-enable mints fresh");
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

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

await main();
