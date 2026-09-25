import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 47323;

// Per-add-on bearer token. Phase-3 (P6): the host mints this through
// `harness-registry.setGrants(...)` and delivers it via the bootstrap
// envelope; the operator hands a stable token to the server so the demo can
// be reproduced from a clean checkout. The host-only /admin/* routes accept a
// distinct admin token (operator-pinned, never delivered to the iframe) so the
// bridge can flip the in-memory deny flag without the add-on ever being able
// to do so itself.
const envBearerToken = () =>
  String(process.env.RESONANTOS_SDK_GUIDE_BEARER_TOKEN ?? "").trim();
const argvBearerToken = () => {
  for (const arg of process.argv.slice(2)) {
    const match = /^--sdk-guide-bearer-token=(.+)$/.exec(arg);
    if (match) return match[1];
  }
  return "";
};
const envAdminToken = () =>
  String(process.env.RESONANTOS_SDK_GUIDE_ADMIN_TOKEN ?? "").trim();
const argvAdminToken = () => {
  for (const arg of process.argv.slice(2)) {
    const match = /^--sdk-guide-admin-token=(.+)$/.exec(arg);
    if (match) return match[1];
  }
  return "";
};

// Like Echo and Counter, the sandboxed add-on iframe loads this HTML directly
// from the add-on's own origin (the renderer sets iframe.src =
// service.entrypoint). No CORS header is added anywhere, so cross-origin
// iframes cannot read the response. Boundary = per-origin sandbox + per-add-on
// bearer token + host-only admin token.
const INDEX_HTML_PATH = fileURLToPath(new URL("./index.html", import.meta.url));

// Expected Authorization header value for mutating routes.
const authorizedBearer = (bearerToken) => `Bearer ${bearerToken}`;

const constantTimeEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
};

// The 9 lifecycle steps. Steps 1-6 are public reads (status JSON; no bearer
// required) so the UI can render educational content before the grant lands.
// Step 7 ("ping") is bearer-gated and succeeds on valid bearer + open policy.
// Step 8 ("ping-deny-attempt") is intentionally NOT a separate route — the
// denial proof is *just* step 7 with a wrong bearer (real 401). Step 9
// ("ping-after-revoke") uses the same /api/guide/ping endpoint with the valid
// bearer after the operator has revoked the grant (real 403).
const STEP_INFO = Object.freeze({
  1: { title: "Discovery", path: "/api/guide/step/discovery" },
  2: { title: "Manifest validation", path: "/api/guide/step/manifest" },
  3: { title: "Capability request", path: "/api/guide/step/capability-request" },
  4: { title: "Host consent", path: "/api/guide/step/consent" },
  5: { title: "Grant", path: "/api/guide/step/grant" },
  6: { title: "Sandboxed UI render", path: "/api/guide/step/render" },
  7: { title: "Authorized call", path: "/api/guide/ping" },
  8: { title: "Denied call (wrong bearer)", path: "/api/guide/ping" },
  9: { title: "Revocation (host-revoked 403)", path: "/api/guide/ping" },
});

/**
 * Resonant SDK Guide upstream — operator-started loopback HTTP service.
 *
 * This is the third local-service add-on proving the Phase-3 (P6) lifecycle
 * is generic: same manifest contract, same discovery, same host registry,
 * same /addons/workspace/{grant,revoke,bootstrap,admin-revoke} routes, same
 * bearer + admin channel shape. The "lesson" the guide teaches is the
 * lifecycle itself — every denial the UI shows is a real host-policy
 * response, not a hard-coded result.
 *
 * Routes (all same-origin, no ACAO):
 *   GET    /health                                → { status, addon, hostGranted, bearerConfigured }
 *   GET    /                                      → index.html
 *   GET    /api/guide/step/{1..6}                 → { step, title, body } (public reads)
 *   POST   /api/guide/ping                        → { pong } (requires Bearer; 401 wrong, 403 revoked)
 *   POST   /admin/deny   { granted: bool }        → host-only; requires admin Bearer
 *   GET    /admin/state                           → host-only read; requires admin Bearer
 *
 * Status codes:
 *   200 — operation succeeded
 *   401 — caller presented a missing or wrong bearer (real audience boundary)
 *   403 — host has revoked the grant; caller has a valid bearer but the
 *         network capability was withdrawn by the host (real host-policy
 *         revocation result, symmetric with Echo + Counter)
 *   503 — server was started without --sdk-guide-bearer-token; the mutating
 *         route refuses every call (discovery-step symmetry).
 */
export function createSdkGuideServer({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  bearerToken,
  adminToken,
} = {}) {
  // Host-revocable in-memory flag. Flipped by POST /admin/deny; cleared by
  // the same route with { granted: true }. The bridge calls this when the
  // operator revokes the network capability for addon.sdk-guide.
  let hostGranted = true;

  // Public step body builders. Each function returns the educational payload
  // that the iframe renders in step 1..6. None of them touch the grant
  // surface — they exist only to teach the *shape* of the lifecycle.
  const stepBody = (n) => {
    switch (n) {
      case 1: return {
        lesson: "workspace-addon-discovery scans examples/sdk-demo/*/addon.json, validates each manifest with validateAddOnManifest, and probes service.entrypoint/health for the 'available' UI hint. No code path is hard-coded to addon.resonant-echo or addon.resonant-counter — the renderer is generic.",
      };
      case 2: return {
        lesson: "This manifest was validated by validateAddOnManifest (AddOnSdkManifest schema). The renderer only consumes the projected subset (id, surfaces, requestedCapabilities). The registry sees the full manifest on install.",
      };
      case 3: return {
        lesson: "requestedCapabilities declares 'network' with scope=self, granted=false, revocationBehavior=hard-stop. Grant lives in the host registry (harness-registry); requestedCapabilities is the ask, not the grant.",
      };
      case 4: return {
        lesson: "The host refuses setGrants addons unless consent=true. The consent flag is sent in the request body — the add-on cannot self-grant. Try: POST /addons/workspace/grant without consent:true → permission-denied.",
      };
      case 5: return {
        lesson: "POST /addons/workspace/grant with consent:true and the bridge capability token returned 200. The harness-registry's installation.grantedCapabilities[network].granted flipped to true. The bootstrap envelope now carries the host-minted bearer.",
      };
      case 6: return {
        lesson: "The renderer set iframe.src = service.entrypoint with sandbox=allow-scripts allow-same-origin. CORS is intentionally absent. Cross-origin iframes cannot read this HTML. The bootstrap envelope (postMessage with pinned targetOrigin) is the only way the iframe learns its bearer.",
      };
      default: return { lesson: "(no body for this step)" };
    }
  };

  const sendJson = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const readJsonBody = async (req) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
    catch { return null; }
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        status: "ok",
        addon: "addon.sdk-guide",
        hostGranted,
        bearerConfigured: Boolean(
          process.env.RESONANTOS_SDK_GUIDE_ACTIVE_BEARER ?? bearerToken,
        ),
      });
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await readFile(INDEX_HTML_PATH, "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    // Public read-only steps (1..6). No bearer required — these are pure
    // educational content delivered over the same-origin loopback.
    if (req.method === "GET" && url.pathname.startsWith("/api/guide/step/")) {
      const n = Number(url.pathname.replace("/api/guide/step/", ""));
      if (!Number.isInteger(n) || n < 1 || n > 6 || !STEP_INFO[n]) {
        sendJson(res, 404, { error: "step-not-found" });
        return;
      }
      sendJson(res, 200, { step: n, title: STEP_INFO[n].title, ...stepBody(n) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/admin/state") {
      const presentedAdmin = String(req.headers.authorization ?? "");
      const expectedAdmin = adminToken ? `Bearer ${adminToken}` : "";
      if (!expectedAdmin || !constantTimeEqual(presentedAdmin, expectedAdmin)) {
        sendJson(res, 401, { error: "admin-unauthorized", message: "Admin path requires Authorization: Bearer <sdk-guide-admin-token>." });
        return;
      }
      sendJson(res, 200, {
        hostGranted,
        bearerConfigured: Boolean(process.env.RESONANTOS_SDK_GUIDE_ACTIVE_BEARER ?? bearerToken),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/admin/deny") {
      const presentedAdmin = String(req.headers.authorization ?? "");
      const expectedAdmin = adminToken ? `Bearer ${adminToken}` : "";
      if (!expectedAdmin || !constantTimeEqual(presentedAdmin, expectedAdmin)) {
        sendJson(res, 401, { error: "admin-unauthorized", message: "Admin path requires Authorization: Bearer <sdk-guide-admin-token>." });
        return;
      }
      const body = await readJsonBody(req);
      const nextGranted = body && typeof body.granted === "boolean" ? body.granted : false;
      hostGranted = nextGranted;
      sendJson(res, 200, { hostGranted });
      return;
    }

    // Bearer-gated mutating route. Steps 7/8/9 of the guide all hit this
    // endpoint — the only difference between them is the host policy state
    // and the bearer presented. 401/403 are the *real* outcomes that
    // prove the lifecycle.
    if (req.method === "POST" && url.pathname === "/api/guide/ping") {
      const expected = process.env.RESONANTOS_SDK_GUIDE_ACTIVE_BEARER ?? bearerToken ?? "";
      const presented = String(req.headers.authorization ?? "");
      if (!expected) {
        sendJson(res, 503, {
          error: "sdk-guide-not-configured",
          message: "SDK Guide upstream started without --sdk-guide-bearer-token; no mutating calls are authorized. The lifecycle requires an operator-pinned bearer; that is the discovery-step symmetry with Echo and Counter.",
        });
        return;
      }
      if (!constantTimeEqual(presented, authorizedBearer(expected))) {
        sendJson(res, 401, {
          error: "sdk-guide-unauthorized",
          message: "SDK Guide mutating route requires Authorization: Bearer <sdk-guide-token>. This is a real audience boundary: Echo's bearer cannot drive /api/guide/ping, and the guide's bearer cannot drive /api/echo/message.",
        });
        return;
      }
      if (!hostGranted) {
        sendJson(res, 403, {
          error: "sdk-guide-revoked",
          message: "SDK Guide mutating route is closed by host policy. The network capability for addon.sdk-guide has been revoked. Restore the grant and toggle /admin/deny { granted: true } to re-enable.",
        });
        return;
      }
      sendJson(res, 200, {
        pong: true,
        step: 7,
        echo: "The lifecycle works: discovery, validation, capability request, host consent, grant, render, and an authorized call to /api/guide/ping.",
        hostGranted,
      });
      return;
    }

    sendJson(res, 404, { error: "not-found" });
  });

  const resolvedEnvToken = envBearerToken();
  if (resolvedEnvToken) process.env.RESONANTOS_SDK_GUIDE_ACTIVE_BEARER = resolvedEnvToken;
  const resolvedArgvToken = argvBearerToken();
  if (resolvedArgvToken) process.env.RESONANTOS_SDK_GUIDE_ACTIVE_BEARER = resolvedArgvToken;
  const resolvedAdminToken = adminToken ?? envAdminToken() ?? argvAdminToken();

  return {
    host,
    port,
    getHostGranted: () => hostGranted,
    setHostGranted: (g) => { hostGranted = Boolean(g); },
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const address = server.address();
          const boundPort = address && typeof address === "object" ? address.port : port;
          resolve({ host, port: boundPort });
        });
      }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const port = Number(process.env.RESONANTOS_SDK_GUIDE_PORT ?? DEFAULT_PORT);
  const service = createSdkGuideServer({ port });
  service.start().then(({ host: h, port: p }) => {
    const tokenStatus = process.env.RESONANTOS_SDK_GUIDE_ACTIVE_BEARER ? "configured" : "NOT configured (mutating routes will return 503)";
    console.log(`Resonant SDK Guide listening on http://${h}:${p} (bearer token: ${tokenStatus})`);
  });
}
