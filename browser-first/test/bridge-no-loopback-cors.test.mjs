// SDK-DEMO-002-FIX-2 defense-in-depth: the bridge must NOT CORS-allowlist
// loopback origins. The add-on iframe lives at
// http://127.0.0.1:<addon-port>/; if a malicious add-on (or any other
// loopback-origin context) tried to fetch from the bridge, the
// bridge must refuse to return Access-Control-Allow-Origin matching
// that loopback origin. Otherwise a sandboxed cross-origin iframe
// (or a separate localhost service) could read bridge responses.
//
// What the bridge DOES allow:
//   - chrome-extension://<extension-id> (the extension itself).
//   - Whatever is in the RESONANTOS_BRIDGE_ALLOWED_ORIGINS env var.
//
// What the bridge MUST NOT do:
//   - Echo the Origin header back as ACAO (without allowlisting it).
//   - Allow loopback origins by default.
//   - Allow the iframe's loopback origin.

import assert from "node:assert/strict";
import test from "node:test";
import { startBridgeServer } from "../host/bridge-server.mjs";

test("FIX-2: bridge does NOT echo Origin header as ACAO for a loopback origin", async () => {
  const port = 0; // OS-assigned
  const server = await startBridgeServer({
    port,
    bridgeToken: "test-bridge-token",
    bridgeCapabilityTokens: { "harness-messaging": "test-harness-token" },
    capabilityBootstrapToken: "test-bootstrap-token",
    extensionOrigin: "chrome-extension://test-extension-id",
    // Default routes. The test only inspects ACAO, not payload.
    routes: [
      {
        method: "POST",
        path: "/api/capability-tokens",
        requiredCapabilityBootstrap: true,
        handler: async () => ({ capabilityTokens: {} })
      },
      {
        method: "GET",
        path: "/addons/status",
        requiredCapabilityBootstrap: true,
        handler: async () => ({ addons: [] })
      }
    ],
    host: "127.0.0.1"
  });
  try {
    const addr = server.address();
    const url = `http://127.0.0.1:${addr.port}/addons/status`;

    // 1. Loopback origin (the add-on iframe's own origin). The bridge
    // must NOT echo this back as ACAO.
    {
      const r = await fetch(url, {
        method: "GET",
        headers: {
          "X-ResonantOS-Bridge-Token": "test-bridge-token",
          "X-ResonantOS-Capability-Bootstrap-Token": "test-bootstrap-token",
          "Origin": "http://127.0.0.1:47321"
        }
      });
      const acao = r.headers.get("access-control-allow-origin");
      assert.notEqual(
        acao,
        "http://127.0.0.1:47321",
        `bridge MUST NOT echo loopback Origin as ACAO; got "${acao}"`
      );
    }

    // 2. Another loopback origin (different port). Same expectation.
    {
      const r = await fetch(url, {
        method: "GET",
        headers: {
          "X-ResonantOS-Bridge-Token": "test-bridge-token",
          "X-ResonantOS-Capability-Bootstrap-Token": "test-bootstrap-token",
          "Origin": "http://127.0.0.1:51234"
        }
      });
      const acao = r.headers.get("access-control-allow-origin");
      assert.notEqual(
        acao,
        "http://127.0.0.1:51234",
        `bridge MUST NOT echo different-loopback Origin as ACAO; got "${acao}"`
      );
    }

    // 3. A null Origin (opaque-origin contexts like sandboxed iframes).
    // The bridge MUST NOT echo "null" back as ACAO.
    {
      const r = await fetch(url, {
        method: "GET",
        headers: {
          "X-ResonantOS-Bridge-Token": "test-bridge-token",
          "X-ResonantOS-Capability-Bootstrap-Token": "test-bootstrap-token",
          "Origin": "null"
        }
      });
      const acao = r.headers.get("access-control-allow-origin");
      assert.notEqual(
        acao,
        "null",
        `bridge MUST NOT echo null Origin as ACAO; got "${acao}"`
      );
    }

    // 4. The legitimate extension origin IS allowlisted (sanity check).
    {
      const r = await fetch(url, {
        method: "GET",
        headers: {
          "X-ResonantOS-Bridge-Token": "test-bridge-token",
          "X-ResonantOS-Capability-Bootstrap-Token": "test-bootstrap-token",
          "Origin": "chrome-extension://test-extension-id"
        }
      });
      const acao = r.headers.get("access-control-allow-origin");
      assert.equal(
        acao,
        "chrome-extension://test-extension-id",
        `bridge SHOULD echo extension origin as ACAO; got "${acao}"`
      );
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("FIX-2: bridge does not allow loopback origin even when RESONANTOS_BRIDGE_ALLOWED_ORIGINS includes a different host", async () => {
  const port = 0;
  const server = await startBridgeServer({
    port,
    bridgeToken: "test-bridge-token",
    bridgeCapabilityTokens: { "harness-messaging": "test-harness-token" },
    capabilityBootstrapToken: "test-bootstrap-token",
    extensionOrigin: "chrome-extension://test-extension-id",
    routes: [
      {
        method: "GET",
        path: "/addons/status",
        requiredCapabilityBootstrap: true,
        handler: async () => ({ addons: [] })
      }
    ],
    host: "127.0.0.1",
    allowedOrigins: ["https://trusted.partner.example.com"]
  });
  try {
    const addr = server.address();
    const url = `http://127.0.0.1:${addr.port}/addons/status`;

    const r = await fetch(url, {
      method: "GET",
      headers: {
        "X-ResonantOS-Bridge-Token": "test-bridge-token",
        "X-ResonantOS-Capability-Bootstrap-Token": "test-bootstrap-token",
        "Origin": "http://127.0.0.1:47321"
      }
    });
    const acao = r.headers.get("access-control-allow-origin");
    assert.notEqual(
      acao,
      "http://127.0.0.1:47321",
      `bridge MUST NOT allow loopback origin even with allowlist; got "${acao}"`
    );
    // And the trusted partner IS allowed.
    const r2 = await fetch(url, {
      method: "GET",
      headers: {
        "X-ResonantOS-Bridge-Token": "test-bridge-token",
        "X-ResonantOS-Capability-Bootstrap-Token": "test-bootstrap-token",
        "Origin": "https://trusted.partner.example.com"
      }
    });
    assert.equal(
      r2.headers.get("access-control-allow-origin"),
      "https://trusted.partner.example.com",
      `bridge SHOULD echo allowlisted origin as ACAO; got "${r2.headers.get("access-control-allow-origin")}"`
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
