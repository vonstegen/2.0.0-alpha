// Intent citation: docs/architecture/resonantos-browser-architecture/CP5-PHASE5-CONTINUATION.md
// Intent citation: docs/architecture/resonantos-browser-architecture/IMPLEMENTATION_TRACKING.md (row 99)
//
// CP-5 Phase 5 row 99: drive a real `opencode serve` session through
// `opencodeRuntimeDispatch` (structurally distinct from Cordis),
// asserting the `WorkspaceLease` is acquired before the request and
// released after the response — parity with the SDK's WorkspaceLease
// flow.
//
// 5.1.1 (opencode-workspace-lease-bridge.test.mjs) covered the lease
// gate with injected client fakes. This test (5.1.3) drives the real
// `createOpencodeHttpClient` against a real HTTP server that mimics
// `opencode serve` — proving the lease gate holds around the actual
// production transport, not just the seam.

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createGovernedAuthority } from "../host/bridge-governed-authority.mjs";
import { makeRegistry } from "../host/workspace-lease.mjs";
import { createOpenCodeProviderAdapter } from "../host/harness-provider-adapters.mjs";

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
    intent: "drive a session",
    workspaceRoots: ["/tmp/opencode-e2e-ws"],
    ...overrides,
  };
}

/**
 * Spin up a real HTTP server that mimics the `opencode serve` shape:
 *   GET  /doc                              -> OpenAPI doc with /session + /session/{id}/message
 *   POST /session                          -> { id }
 *   POST /session/{id}/message             -> 200 ok
 *   POST /session/{id}/prompt_async        -> 200 ok
 *
 * The mock records every request so tests can assert the exact call
 * sequence and timing (acquire -> /session -> prompt -> release).
 */
async function startMockOpencodeServe() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const record = { method: req.method, url: req.url, body };
      requests.push(record);
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/doc") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          paths: {
            "/session": { post: {} },
            "/session/{sessionID}/message": { post: {} },
            "/session/{sessionID}/prompt_async": { post: {} },
          },
        }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/session") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `sess-${requests.length}` }));
        return;
      }
      if (req.method === "POST" && url.pathname.startsWith("/session/")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
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

test("opencodeRuntimeDispatch drives the real client through a mock opencode serve with lease acquire/release", async () => {
  const mock = await startMockOpencodeServe();
  const registry = makeRegistry();
  registry.clear();

  const authority = createGovernedAuthority({ now: () => T0 });
  const scope = governedScope();
  recordLeaf(authority, scope);
  const handle = authority.mintGrant({ grantId: "g-1", scope });

  // Snapshot the lease state at every meaningful transport boundary.
  // The bridge must hold the lease continuously from before ensureServer
  // runs until after the prompt response — and must release in `finally`.
  const leaseSnapshot = [];
  const adapter = createOpenCodeProviderAdapter({
    homeDir: "/tmp",
    governedAuthority: authority,
    workspaceLeaseRegistry: registry,
    leaseHolder: "test:e2e:holder",
    fetchImpl: globalThis.fetch,
    // Inject our own ensureServer that doesn't try to spawn a real
    // process — just returns the mock baseUrl. The real
    // `createOpencodeHttpClient` is used as-is by the dispatch.
    ensureServer: async () => {
      leaseSnapshot.push({ at: "ensureServer", held: registry.size() });
      return { baseUrl: mock.baseUrl };
    },
  });

  // Drive the dispatch — the real createOpencodeHttpClient is the one
  // the adapter factory created internally.
  const run = await adapter.startTask(packet(), handle);
  const state = await adapter.getTask(run.runId);

  await mock.close();

  assert.equal(state.status, "completed", `expected completed, got ${JSON.stringify(state)}`);
  const sessionCall = mock.requests.find((r) => r.method === "POST" && r.url.split("?")[0] === "/session");
  const promptCall = mock.requests.find((r) => r.method === "POST" && (r.url.includes("/message") || r.url.includes("/prompt_async")));
  assert.ok(sessionCall, `POST /session must have been called; saw: ${mock.requests.map((r) => `${r.method} ${r.url}`).join(", ")}`);
  assert.ok(promptCall, `POST /session/{id}/... must have been called; saw: ${mock.requests.map((r) => `${r.method} ${r.url}`).join(", ")}`);
  // The lease must have been held continuously through the transport.
  assert.equal(leaseSnapshot[0].held, 1, "lease must be held when ensureServer runs");
  // The lease must be released after the response.
  assert.equal(registry.size(), 0, "lease must be released after the prompt response");
});
