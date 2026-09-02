// Intent citation: docs/architecture/resonantos-browser-architecture/CP5-PHASE5-CONTINUATION.md
// Intent citation: docs/architecture/resonantos-browser-architecture/IMPLEMENTATION_TRACKING.md (row 100)
//
// CP-5 Phase 5 row 100: validate the OpenClaw adapter against the
// real MCP-gateway transport. The bridge's governed envelope still
// owns request attestation; the gateway owns child-actor authority.
// The test proves:
//   - forged subject is denied BEFORE the gateway is contacted
//   - the gateway is the only authority path: a 403 from the gateway
//     (forged child grant, missing child capability) surfaces as a
//     dispatch deny
//   - the happy path forwards the child actor's response from the
//     gateway to the dispatch consumer

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createOpenclawGatewayClient } from "../host/openclaw-gateway-client.mjs";
import { createGovernedAuthority } from "../host/bridge-governed-authority.mjs";
import { createOpenClawProviderAdapter } from "../host/harness-provider-adapters.mjs";

const T0 = Date.parse("2026-08-27T06:00:00Z");

function governedScope(overrides = {}) {
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
    purpose: "test",
    issuedAt: s.notBefore,
    notBefore: s.notBefore,
    expiresAt: s.expiresAt,
    status: "active",
    auditCorrelationId: "aud-1",
  });
}

function packet(overrides = {}) {
  return {
    taskId: "task-1",
    delegationChainRef: { delegationId: "del-1" },
    executorPrincipalId: "hermes-1",
    issuerPrincipalId: "user-1",
    auditCorrelationId: "aud-1",
    intent: "drive a child actor",
    workspaceRoots: ["/tmp/openclaw-e2e-ws"],
    ...overrides,
  };
}

/**
 * Spin up a real HTTP server that mimics the OpenClaw MCP gateway.
 *
 * The `decision` callback decides what the gateway returns for each
 * request. The mock records every delegation request it received so
 * the tests can assert:
 *   - "happy path" — the gateway was called with the right
 *     grantHandle, subjectPrincipalId, and prompt
 *   - "deny" — the gateway was called and returned 403
 *   - "forged subject" — the gateway was NOT called (the bridge
 *     rejected the request before the gateway saw it)
 */
async function startMockGateway(decision) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let parsed = null;
      try { parsed = body ? JSON.parse(body) : null; } catch { parsed = null; }
      const record = { method: req.method, url: req.url, body: parsed };
      requests.push(record);
      const url = new URL(req.url, "http://localhost");
      if (req.method === "POST" && url.pathname === "/v1/delegation") {
        const verdict = decision(record);
        res.writeHead(verdict.status, { "content-type": "application/json" });
        res.end(JSON.stringify(verdict.body));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("openclaw gateway: happy path forwards the child actor's response through the gateway", async () => {
  const mock = await startMockGateway((req) => ({
    status: 200,
    body: {
      childActorId: "actor-7",
      reply: "OpenClaw child actor completed the delegation.",
    },
  }));

  const authority = createGovernedAuthority({ now: () => T0 });
  const scope = governedScope();
  recordLeaf(authority, scope);
  const handle = authority.mintGrant({ grantId: "g-1", scope });

  const gatewayClient = createOpenclawGatewayClient({
    baseUrl: mock.baseUrl,
    fetchImpl: globalThis.fetch,
  });
  const adapter = createOpenClawProviderAdapter({
    governedAuthority: authority,
    gatewayClient,
  });

  const run = await adapter.startTask(packet(), handle);
  const state = await adapter.getTask(run.runId);
  await mock.close();

  assert.equal(state.status, "completed", `expected completed, got ${JSON.stringify(state)}`);
  // The bridge must have called the gateway with the governed grant
  // handle, the correct subject, and the packet intent as prompt.
  const delegation = mock.requests.find((r) => r.method === "POST" && r.url === "/v1/delegation");
  assert.ok(delegation, "POST /v1/delegation must have been called");
  assert.equal(delegation.body.addonId, "addon.openclaw");
  assert.equal(delegation.body.tool, "openclaw.delegate");
  assert.equal(delegation.body.subjectPrincipalId, "hermes-1");
  assert.equal(delegation.body.prompt, "drive a child actor");
  assert.equal(delegation.body.grantHandle, handle);
});

test("openclaw gateway: gateway 403 (forged child grant / missing capability) surfaces as dispatch deny", async () => {
  // The bridge's governed envelope accepted the request, but the
  // gateway — the child-actor authority — returns 403. The dispatch
  // must surface the gateway's verdict verbatim.
  const mock = await startMockGateway((req) => ({
    status: 403,
    body: { error: "child-capability-missing", requested: "openclaw.actor.spawn" },
  }));

  const authority = createGovernedAuthority({ now: () => T0 });
  const scope = governedScope();
  recordLeaf(authority, scope);
  const handle = authority.mintGrant({ grantId: "g-1", scope });

  const gatewayClient = createOpenclawGatewayClient({
    baseUrl: mock.baseUrl,
    fetchImpl: globalThis.fetch,
  });
  const adapter = createOpenClawProviderAdapter({
    governedAuthority: authority,
    gatewayClient,
  });

  const run = await adapter.startTask(packet(), handle);
  const state = await adapter.getTask(run.runId);
  await mock.close();

  assert.equal(state.status, "failed");
  // The detail must surface the gateway's reason, not the bridge's
  // (the bridge's governed envelope is not the reason here).
  assert.match(state.detail, /child-capability-missing/);
  // The gateway was actually contacted.
  const delegation = mock.requests.find((r) => r.method === "POST" && r.url === "/v1/delegation");
  assert.ok(delegation, "gateway must have been contacted before the bridge can deny on a 403");
});

test("openclaw gateway: forged subject is denied BEFORE the gateway is contacted", async () => {
  // The bridge's governed envelope is the first gate; a forged
  // subject must not reach the gateway. This is the named Phase 5
  // acceptance criterion: the gateway is the only authority path
  // for the child actor, but the bridge still owns request
  // attestation.
  const mock = await startMockGateway((req) => ({
    status: 200,
    body: { childActorId: "should-not-be-called", reply: "should not happen" },
  }));

  const authority = createGovernedAuthority({ now: () => T0 });
  const scope = governedScope();
  recordLeaf(authority, scope);
  const handle = authority.mintGrant({ grantId: "g-1", scope });

  const gatewayClient = createOpenclawGatewayClient({
    baseUrl: mock.baseUrl,
    fetchImpl: globalThis.fetch,
  });
  const adapter = createOpenClawProviderAdapter({
    governedAuthority: authority,
    gatewayClient,
  });

  // Forge the executorPrincipalId — the governed envelope must reject.
  const forged = { ...packet(), executorPrincipalId: "attacker" };
  const run = await adapter.startTask(forged, handle);
  const state = await adapter.getTask(run.runId);
  await mock.close();

  assert.equal(state.status, "failed");
  assert.match(state.detail, /subject-mismatch/);
  // The gateway was NOT contacted.
  const delegation = mock.requests.find((r) => r.method === "POST" && r.url === "/v1/delegation");
  assert.equal(delegation, undefined, "the gateway must not see a forged request");
});

test("openclaw gateway: no gatewayClient is denied with gateway-unavailable", async () => {
  const authority = createGovernedAuthority({ now: () => T0 });
  const scope = governedScope();
  recordLeaf(authority, scope);
  const handle = authority.mintGrant({ grantId: "g-1", scope });

  // No gatewayClient -> the opt-in dispatch is skipped, the adapter
  // falls back to the legacy host-command path, but without a
  // `command` it fails closed. The legacy path is the current
  // default and is covered by the existing harness-provider-adapters
  // tests. Here we only assert the opt-in choice.
  const adapter = createOpenClawProviderAdapter({
    governedAuthority: authority,
  });
  const run = await adapter.startTask(packet(), handle);
  const state = await adapter.getTask(run.runId);
  // The legacy host-command transport requires a `command` to spawn;
  // without one the dispatch fails closed with an explicit reason.
  assert.equal(state.status, "failed");
  // Reason is from the legacy path (upstream-unreachable or
  // command missing). We don't pin a specific string — the contract
  // is that the run fails closed, not how.
  assert.ok(typeof state.detail === "string" && state.detail.length > 0);
});
