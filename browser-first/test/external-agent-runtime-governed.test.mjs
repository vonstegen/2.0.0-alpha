// Intent citation: docs/architecture/ADR-054-principal-delegation-chain-task-scoped-authority.md
//
// Integration test for the CP-2 governed external-agent-runtime dispatch
// path: a GovernedRequest envelope is resolved and validated by the
// bridge before any upstream effect.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dispatchGovernedExternalAgentRuntime } from "../host/external-agent-runtime-dispatcher.mjs";
import { createGovernedAuthority } from "../host/bridge-governed-authority.mjs";
import { startCordisStub } from "./_cordis-stub-loader.mjs";

let stub;
let repoRoot;
const T0 = Date.parse("2026-08-27T06:00:00Z");

function makeManifest(entrypoint) {
  return {
    id: "addon.deepseek-harness",
    name: "DeepSeek Harness",
    version: "0.1.0",
    service: { protocol: "http-json", entrypoint },
    tools: [{ name: "deepseek_harness.status", description: "status" }],
  };
}

before(async () => {
  stub = await startCordisStub();
  repoRoot = mkdtempSync(join(tmpdir(), "governed-dispatch-"));
  const addonsDir = join(repoRoot, "examples", "addons");
  mkdirSync(addonsDir, { recursive: true });
  writeFileSync(
    join(addonsDir, "addon.deepseek-harness.json"),
    JSON.stringify(makeManifest(stub.entrypoint)),
  );
});

after(async () => {
  await stub?.close();
  if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
});

function scope(overrides = {}) {
  return {
    action: "network",
    resourceSelectors: [],
    operations: ["read"],
    taskId: "task-1",
    delegationId: "del-1",
    issuerPrincipalId: "user-1",
    subjectPrincipalId: "harness-1",
    notBefore: "2026-08-27T00:00:00Z",
    expiresAt: "2026-08-27T12:00:00Z",
    revocationBehavior: "cancel",
    ...overrides,
  };
}

function governedRequest(handle, overrides = {}) {
  return {
    taskId: "task-1",
    delegationId: "del-1",
    subjectPrincipalId: "harness-1",
    grantHandle: handle,
    auditCorrelationId: "aud-1",
    payload: {
      addonId: "addon.deepseek-harness",
      tool: "deepseek_harness.status",
      model: "deepseek-chat",
      messages: [{ role: "user", content: "hello" }],
    },
    ...overrides,
  };
}

test("allows a valid governed request and posts to the harness", async () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const s = scope();
  authority.recordDelegation({
    id: s.delegationId,
    taskId: s.taskId,
    parentDelegationId: null,
    issuerPrincipalId: s.issuerPrincipalId,
    subjectPrincipalId: s.subjectPrincipalId,
    requestedCapabilities: [],
    effectiveGrantId: "g-1",
    purpose: "test",
    issuedAt: s.notBefore,
    notBefore: s.notBefore,
    expiresAt: s.expiresAt,
    status: "active",
    auditCorrelationId: "aud-1",
  });
  const handle = authority.mintGrant({ grantId: "g-1", scope: s });
  const result = await dispatchGovernedExternalAgentRuntime({
    request: governedRequest(handle),
    governedAuthority: authority,
    repoRoot,
  });
  assert.equal(result.outcome, "allow");
  assert.ok(result.response?.choices?.[0]?.message?.content, "upstream completion returned");
});

test("denies a forged subject before any upstream call", async () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const handle = authority.mintGrant({ grantId: "g-1", scope: scope() });
  const result = await dispatchGovernedExternalAgentRuntime({
    request: governedRequest(handle, { subjectPrincipalId: "attacker" }),
    governedAuthority: authority,
    repoRoot,
  });
  assert.equal(result.outcome, "deny");
  assert.equal(result.reason, "subject-mismatch");
  assert.equal(result.response, undefined);
});

test("denies an expired grant", async () => {
  const authority = createGovernedAuthority({ now: () => Date.parse("2026-08-27T13:00:00Z") });
  const handle = authority.mintGrant({ grantId: "g-1", scope: scope() });
  const result = await dispatchGovernedExternalAgentRuntime({
    request: governedRequest(handle),
    governedAuthority: authority,
    repoRoot,
  });
  assert.equal(result.reason, "expired");
});

test("denies an unknown grant handle", async () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const result = await dispatchGovernedExternalAgentRuntime({
    request: governedRequest("does-not-exist"),
    governedAuthority: authority,
    repoRoot,
  });
  assert.equal(result.reason, "unknown-handle");
});
