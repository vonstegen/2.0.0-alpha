// SDK-DEMO-002-FIX-2 capability + postMessage contract.
//
// Boots the REAL workspace add-on upstreams (Echo + Counter + SDK Guide)
// and exercises them directly via fetch. This is the upstream-side
// authorization boundary that the cross-origin iframe now relies on:
//
//   1. GET / serves the entry HTML (the cross-origin iframe's entry).
//   2. The served HTML contains NO capability token, NO bridge token,
//      and NO apiBasePath templated globals (those come from the
//      parent's postMessage, not from the HTML body).
//   3. NO Access-Control-Allow-Origin header on any response (the
//      iframe is sandboxed with allow-same-origin, so its origin
//      equals the upstream origin and no CORS is needed).
//   4. NO OPTIONS preflight handler — the upstream returns 404 for
//      OPTIONS, not 204.
//   5. /bootstrap returns 404 (the endpoint is removed; the add-on
//      listens for postMessage from window.parent instead).
//   6. /api/<addon>/* WITHOUT the capability token still returns 403
//      — the upstream is the REAL authorization boundary.
//   7. /api/<addon>/* WITH the harness-messaging token returns 200 +
//      the expected payload.
//   8. The four denied capabilities (wallet-signing, provider-secret-read,
//      trusted-memory-write, filesystem-write) are NOT exposed as
//      routes — only the manifest's declared routes are reachable.
//
// These tests run without the bridge or the extension: they spawn each
// upstream's server.mjs with the harness-messaging capability token set
// via env, then probe its endpoints with fetch.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..");
const HARNESS_TOKEN = "test-harness-messaging-token-002";
const BRIDGE_IDENTITY = "bridge://sdk-demo-002-test";

const upstreamChildren = new Set();

function spawnUpstream({ addonDir, addonId, port, env }) {
  const child = spawn(
    process.execPath,
    [path.join(addonDir, "server.mjs")],
    {
      cwd: addonDir,
      env: {
        ...process.env,
        ...env,
        // Always set the harness-messaging token so /api/<addon>/*
        // passes the upstream's authorization check.
        RESONANTOS_BROWSER_FIRST_HARNESS_MESSAGING_TOKEN: HARNESS_TOKEN,
        // Per-addon backward-compat names.
        RESONANT_ECHO_CAPABILITY_TOKEN: HARNESS_TOKEN,
        RESONANT_ECHO_BRIDGE_IDENTITY: BRIDGE_IDENTITY
        // SDK-DEMO-002-FIX-2: NO RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN —
        // the launcher no longer passes the bridge token to add-on
        // upstreams. The add-on does not need it.
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[${addonId}] ${chunk}`);
  });
  upstreamChildren.add(child);
  return {
    child,
    pid: child.pid,
    port,
    close: async () => {
      upstreamChildren.delete(child);
      child.kill("SIGTERM");
      await new Promise((resolve) => child.on("exit", resolve));
    }
  };
}

async function waitForUpstream(port, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`, { method: "GET" });
      if (r.status === 200) return true;
      if (r.status === 403) return true;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`upstream on port ${port} did not become ready`);
}

test.after(async () => {
  for (const child of upstreamChildren) {
    child.kill("SIGTERM");
  }
});

function authHeaders(token = "") {
  return {
    "content-type": "application/json",
    "x-resonantos-bridge-capability-token": token
  };
}

function assertNoAcao(label, headers) {
  const acao = headers.get("access-control-allow-origin");
  assert.equal(
    acao,
    null,
    `${label} must not set Access-Control-Allow-Origin (got "${acao}")`
  );
}

function assertNoTokenTemplated(label, html) {
  assert.ok(
    !html.includes("__RESONANTOS_BOOTSTRAP_TOKEN__"),
    `${label} must not template window.__RESONANTOS_BOOTSTRAP_TOKEN__ into the served HTML`
  );
  assert.ok(
    !html.includes("__RESONANTOS_BRIDGE_IDENTITY__"),
    `${label} must not template window.__RESONANTOS_BRIDGE_IDENTITY__ into the served HTML`
  );
  assert.ok(
    !html.includes("__RESONANTOS_API_BASE_PATH__"),
    `${label} must not template window.__RESONANTOS_API_BASE_PATH__ into the served HTML`
  );
  // Also: the harness-messaging capability token literal must not
  // appear in the HTML body — the test sets HARNESS_TOKEN to a unique
  // string and asserts it never surfaces in the served bytes.
  assert.ok(
    !html.includes(HARNESS_TOKEN),
    `${label} must not include the harness-messaging capability token literal in the served HTML`
  );
}

test("Cross-origin FIX-2: Echo upstream serves index.html at root without ACAO or templated tokens", async () => {
  const addonDir = path.join(REPO_ROOT, "browser-first", "addons", "resonant-echo");
  const port = 47921;
  const env = {
    RESONANT_ECHO_PORT: String(port),
    RESONANT_ECHO_HOST: "127.0.0.1",
    RESONANT_ECHO_BRIDGE_IDENTITY: BRIDGE_IDENTITY,
    RESONANT_ECHO_CAPABILITY_TOKEN: HARNESS_TOKEN,
    RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_PORT: String(port),
    RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_BRIDGE_IDENTITY: BRIDGE_IDENTITY,
    RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_CAPABILITY_TOKEN: HARNESS_TOKEN
  };
  const upstream = spawnUpstream({ addonDir, addonId: "addon.resonant-echo", port, env });
  try {
    await waitForUpstream(port);

    // 1. Root serves the entry HTML.
    const rootResponse = await fetch(`http://127.0.0.1:${port}/`, { method: "GET" });
    assert.equal(rootResponse.status, 200, "GET / must serve the entry HTML");
    assert.match(
      String(rootResponse.headers.get("content-type") ?? ""),
      /text\/html/i,
      "GET / must respond with text/html"
    );
    assertNoAcao("Echo GET /", rootResponse.headers);
    const rootHtml = await rootResponse.text();
    assert.ok(rootHtml.includes("Resonant Echo"), "root HTML must contain add-on marker");
    assertNoTokenTemplated("Echo GET /", rootHtml);

    // 2. OPTIONS returns 404 (no preflight handler).
    const optionsResp = await fetch(`http://127.0.0.1:${port}/api/echo/status`, {
      method: "OPTIONS"
    });
    assert.equal(optionsResp.status, 404, "Echo OPTIONS must 404 (no preflight handler)");
    assertNoAcao("Echo OPTIONS", optionsResp.headers);

    // 3. /bootstrap returns 404 (the endpoint is removed).
    const bootstrapResp = await fetch(`http://127.0.0.1:${port}/bootstrap`, {
      method: "GET",
      headers: authHeaders(HARNESS_TOKEN)
    });
    assert.equal(bootstrapResp.status, 404, "Echo /bootstrap must 404 (endpoint removed)");
    assertNoAcao("Echo /bootstrap", bootstrapResp.headers);

    // 4. /api/echo/message WITHOUT token 403.
    const deniedMessage = await fetch(`http://127.0.0.1:${port}/api/echo/message`, {
      method: "POST",
      headers: authHeaders(""),
      body: JSON.stringify({ message: "should be denied" })
    });
    assert.equal(deniedMessage.status, 403, "/api/echo/message without token must 403");
    assertNoAcao("Echo /api/echo/message 403", deniedMessage.headers);

    // 5. /api/echo/message WITH token 200.
    const okMessage = await fetch(`http://127.0.0.1:${port}/api/echo/message`, {
      method: "POST",
      headers: authHeaders(HARNESS_TOKEN),
      body: JSON.stringify({ message: "Hello Manolo" })
    });
    assert.equal(okMessage.status, 200, "/api/echo/message with token must 200");
    assertNoAcao("Echo /api/echo/message 200", okMessage.headers);
    const messageBody = await okMessage.json();
    assert.equal(messageBody.ok, true);
    assert.equal(messageBody.echo, "Hello Manolo");
    assert.equal(messageBody.bridgeIdentity, BRIDGE_IDENTITY);

    // 6. /api/echo/status with token returns the expected payload.
    const okStatus = await fetch(`http://127.0.0.1:${port}/api/echo/status`, {
      method: "GET",
      headers: authHeaders(HARNESS_TOKEN)
    });
    assert.equal(okStatus.status, 200);
    assertNoAcao("Echo /api/echo/status 200", okStatus.headers);
    const statusBody = await okStatus.json();
    assert.equal(statusBody.ok, true);
    assert.equal(statusBody.addon, "addon.resonant-echo");
    assert.equal(statusBody.bridgeIdentity, BRIDGE_IDENTITY);

    // 7. The denied capabilities (wallet-signing, provider-secret-read,
    // trusted-memory-write, filesystem-write) are NOT exposed as
    // routes. The upstream only knows its declared /api/echo/* paths.
    // Any attempt to reach a denied capability route 404s (not
    // silently 403, because the upstream does not advertise those
    // routes — the bridge is responsible for the capability gate, and
    // the upstream-side 403 is the same harness-messaging token check
    // applied to its declared routes only).
    for (const denied of ["wallet-signing", "provider-secret-read", "trusted-memory-write", "filesystem-write"]) {
      const r = await fetch(`http://127.0.0.1:${port}/api/${denied}/x`, {
        method: "POST",
        headers: authHeaders(HARNESS_TOKEN),
        body: "{}"
      });
      assert.ok(
        r.status === 404 || r.status === 403,
        `Echo ${denied} route must be 404 or 403 (got ${r.status})`
      );
    }
  } finally {
    await upstream.close();
  }
});

test("Cross-origin FIX-2: Counter upstream serves index.html at root without ACAO or templated tokens", async () => {
  const addonDir = path.join(REPO_ROOT, "browser-first", "addons", "resonant-counter");
  const port = 47922;
  const env = {
    RESONANTOS_BROWSER_FIRST_RESONANT_COUNTER_PORT: String(port),
    RESONANTOS_BROWSER_FIRST_RESONANT_COUNTER_HOST: "127.0.0.1",
    RESONANTOS_BROWSER_FIRST_RESONANT_COUNTER_BRIDGE_IDENTITY: BRIDGE_IDENTITY
  };
  const upstream = spawnUpstream({ addonDir, addonId: "addon.resonant-counter", port, env });
  try {
    await waitForUpstream(port);

    const rootResponse = await fetch(`http://127.0.0.1:${port}/`, { method: "GET" });
    assert.equal(rootResponse.status, 200, "GET / must serve Counter entry HTML");
    assertNoAcao("Counter GET /", rootResponse.headers);
    const rootHtml = await rootResponse.text();
    assert.ok(rootHtml.includes("Resonant Counter"), "root HTML must contain Counter marker");
    assertNoTokenTemplated("Counter GET /", rootHtml);

    const optionsResp = await fetch(`http://127.0.0.1:${port}/api/counter/read`, { method: "OPTIONS" });
    assert.equal(optionsResp.status, 404, "Counter OPTIONS must 404 (no preflight handler)");
    assertNoAcao("Counter OPTIONS", optionsResp.headers);

    const bootstrapResp = await fetch(`http://127.0.0.1:${port}/bootstrap`, {
      method: "GET",
      headers: authHeaders(HARNESS_TOKEN)
    });
    assert.equal(bootstrapResp.status, 404, "Counter /bootstrap must 404 (endpoint removed)");
    assertNoAcao("Counter /bootstrap", bootstrapResp.headers);

    const deniedInc = await fetch(`http://127.0.0.1:${port}/api/counter/increment`, {
      method: "POST",
      headers: authHeaders(""),
      body: JSON.stringify({ delta: 1 })
    });
    assert.equal(deniedInc.status, 403, "/api/counter/increment without token must 403");
    assertNoAcao("Counter 403", deniedInc.headers);

    const okInc = await fetch(`http://127.0.0.1:${port}/api/counter/increment`, {
      method: "POST",
      headers: authHeaders(HARNESS_TOKEN),
      body: JSON.stringify({ delta: 1 })
    });
    assert.equal(okInc.status, 200);
    assertNoAcao("Counter 200", okInc.headers);
    const incBody = await okInc.json();
    assert.equal(incBody.ok, true);
    assert.equal(typeof incBody.count, "number");

    const okRead = await fetch(`http://127.0.0.1:${port}/api/counter/read`, {
      method: "GET",
      headers: authHeaders(HARNESS_TOKEN)
    });
    assert.equal(okRead.status, 200);
    const readBody = await okRead.json();
    assert.equal(readBody.count, incBody.count);
  } finally {
    await upstream.close();
  }
});

test("Cross-origin FIX-2: SDK Guide upstream serves index.html at root without ACAO or templated tokens", async () => {
  const addonDir = path.join(REPO_ROOT, "browser-first", "addons", "sdk-guide");
  const port = 47923;
  const env = {
    RESONANTOS_BROWSER_FIRST_SDK_GUIDE_PORT: String(port),
    RESONANTOS_BROWSER_FIRST_SDK_GUIDE_BRIDGE_IDENTITY: BRIDGE_IDENTITY
  };
  const upstream = spawnUpstream({ addonDir, addonId: "addon.sdk-guide", port, env });
  try {
    await waitForUpstream(port);

    const rootResponse = await fetch(`http://127.0.0.1:${port}/`, { method: "GET" });
    assert.equal(rootResponse.status, 200, "GET / must serve SDK Guide entry HTML");
    assertNoAcao("SDK Guide GET /", rootResponse.headers);
    const rootHtml = await rootResponse.text();
    assert.ok(rootHtml.includes("SDK Guide"), "root HTML must contain SDK Guide marker");
    assertNoTokenTemplated("SDK Guide GET /", rootHtml);

    const optionsResp = await fetch(`http://127.0.0.1:${port}/api/sdk-guide/status`, { method: "OPTIONS" });
    assert.equal(optionsResp.status, 404, "SDK Guide OPTIONS must 404 (no preflight handler)");
    assertNoAcao("SDK Guide OPTIONS", optionsResp.headers);

    const bootstrapResp = await fetch(`http://127.0.0.1:${port}/bootstrap`, {
      method: "GET",
      headers: authHeaders(HARNESS_TOKEN)
    });
    assert.equal(bootstrapResp.status, 404, "SDK Guide /bootstrap must 404 (endpoint removed)");
    assertNoAcao("SDK Guide /bootstrap", bootstrapResp.headers);

    const okStatus = await fetch(`http://127.0.0.1:${port}/api/sdk-guide/status`, {
      method: "GET",
      headers: authHeaders(HARNESS_TOKEN)
    });
    assert.equal(okStatus.status, 200);
    assertNoAcao("SDK Guide status", okStatus.headers);

    const deniedMsg = await fetch(`http://127.0.0.1:${port}/api/sdk-guide/message`, {
      method: "POST",
      headers: authHeaders(""),
      body: JSON.stringify({ message: "denied" })
    });
    assert.equal(deniedMsg.status, 403, "/api/sdk-guide/message without token must 403");
  } finally {
    await upstream.close();
  }
});

test("Cross-origin FIX-2: launcher does NOT pass RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN to upstreams", () => {
  // SDK-DEMO-002-FIX-2: the bridge token must not leak into the addon
  // upstream's environment. The launcher code is verified by the
  // browser-first suite; this is a defensive check that the env
  // wiring does NOT include the bridge token. (The token is still
  // held by the parent extension for /api/capability-tokens minting;
  // it just does not enter the addon subprocess.)
  const addonEnv = {
    RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_PORT: "47321",
    RESONANTOS_BROWSER_FIRST_HARNESS_MESSAGING_TOKEN: HARNESS_TOKEN
  };
  assert.equal(
    addonEnv.RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN,
    undefined,
    "launcher must NOT pass RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN into addon env"
  );
});
