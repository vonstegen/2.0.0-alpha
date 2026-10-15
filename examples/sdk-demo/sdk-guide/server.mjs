import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 47323;

// Per-add-on bearer token. REF (ADR-055 Resonant Extension Framework;
// SDK-DEMO-003 roadmap phase "P6"): the host mints this through
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

// The 13 lifecycle steps. Steps 1-6 are public reads (status JSON; no bearer
// required) so the UI can render educational content before the grant lands.
// Step 7 ("ping") is bearer-gated and succeeds on valid bearer + open policy.
// Step 8 ("ping-deny-attempt") is intentionally NOT a separate route — the
// denial proof is *just* step 7 with a wrong bearer (real 401). Step 9
// ("ping-after-revoke") uses the same /api/guide/ping endpoint with the valid
// bearer after the operator has revoked the grant (real 403).
// Steps 10-13 teach the current SDK surface by calling the real
// @resonantos/addon-sdk implementation in packages/addon-sdk/src/*.ts:
// runtime-lifecycle projection (10), harness-resource contract (11),
// terminal-host lane via the in-memory driver (12), and the ADR-056 §7
// failure-mode contract (13).
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
  10: { title: "Runtime lifecycle projection", path: "/api/guide/lifecycle" },
  11: { title: "Harness-resource contract", path: "/api/guide/resources" },
  12: { title: "Terminal-host lane (in-memory)", path: "/api/guide/terminal" },
  13: { title: "Failure modes F1–F10 (ADR-056 §7)", path: "/api/guide/failure-modes" },
});

// Steps 10-13 (and the live self-validation attached to step 2) import the
// real SDK sources as TypeScript. Node runs them via type-stripping —
// default-on for Node >= 22.18 (the repo .nvmrc pins 24.21.0); on Node
// 22.6-22.17 start the server with --experimental-strip-types. When the
// runtime cannot strip types the SDK routes answer 501
// sdk-runtime-unavailable with the remediation — mirroring the 503
// bearer-not-configured honesty pattern: the guide never fabricates an SDK
// result. Every module imported here has a strip-safe graph (type-only core
// imports plus explicit-.ts sibling imports; src/core/contracts.ts has no
// imports of its own).
//
// The import specifiers MUST stay string literals: vite/vitest rewrites
// literal dynamic imports (so the round-trip tests exercise the real SDK
// too), while computed specifiers fall through to the native loader and
// would only work with the runtime flag.
const SDK_UNAVAILABLE_MESSAGE =
  "This step calls the real @resonantos/addon-sdk TypeScript sources. " +
  "Restart with Node >= 22.18 (repo .nvmrc pins 24.21.0) or pass " +
  "--experimental-strip-types on Node 22.6-22.17.";

const defaultLoadSdk = async () => {
  const [validation, lifecycle, resources, terminalHost] = await Promise.all([
    import("../../../packages/addon-sdk/src/validation.ts"),
    import("../../../packages/addon-sdk/src/runtime-lifecycle.ts"),
    import("../../../packages/addon-sdk/src/harness-resources.ts"),
    import("../terminal-host/in-memory-host.ts"),
  ]);
  return { validation, lifecycle, resources, terminalHost };
};

const MANIFEST_PATH = fileURLToPath(new URL("./addon.json", import.meta.url));

// ADR-056 §7 failure-mode contract (step 13). The executable harness lives
// in packages/addon-sdk-testing (mockHost + runAddOnFailureMode); its
// TypeScript sources land via PR #440 and are not present in this checkout,
// so this step teaches the contract table — the expected host deny codes —
// rather than running the modes. Copied from the in-tree
// packages/addon-sdk-testing/README.md mapping.
const FAILURE_MODES = Object.freeze([
  { id: "F1", mode: "Credential exfiltration attempt", expected: "credential-in-payload" },
  { id: "F2", mode: "Provider self-selection", expected: "provider-self-selection-rejected" },
  { id: "F3", mode: "Workspace escape", expected: "workspace-escape" },
  { id: "F4", mode: "Capability escalation", expected: "capability-denied" },
  { id: "F5", mode: "Undeclared tool", expected: "unknown-tool" },
  { id: "F6", mode: "Audit bypass", expected: "audit-bypass-attempt" },
  { id: "F7", mode: "Approval skip", expected: "approval-required (or approval-denied if denied)" },
  { id: "F8", mode: "Stale routing decision", expected: "routing-decision-expired" },
  { id: "F9", mode: "Revoked routing decision", expected: "routing-decision-revoked" },
  { id: "F10", mode: "Experimental route (un-declared)", expected: "experimental-route-not-declared" },
]);

/**
 * Resonant SDK Guide upstream — operator-started loopback HTTP service.
 *
 * This is the third local-service add-on proving the REF (ADR-055; formerly
 * SDK-DEMO-003 phase "P6") lifecycle is generic: same manifest contract,
 * same discovery, same host registry, same
 * /addons/workspace/{grant,revoke,bootstrap,admin-revoke} routes, same
 * bearer + admin channel shape. The "lesson" the guide teaches is the
 * lifecycle itself — every denial the UI shows is a real host-policy
 * response, not a hard-coded result.
 *
 * Routes (all same-origin, no ACAO):
 *   GET    /health                                → { status, addon, hostGranted, bearerConfigured }
 *   GET    /                                      → index.html
 *   GET    /api/guide/step/{1..6}                 → { step, title, body } (public reads;
 *                                                   step 2 attaches a live
 *                                                   validateAddOnManifest result for
 *                                                   this add-on's own addon.json)
 *   POST   /api/guide/ping                        → { pong } (requires Bearer; 401 wrong, 403 revoked)
 *   GET    /api/guide/lifecycle                   → step 10: deriveDesiredRuntimeState +
 *                                                   projectLifecycleSnapshot over this
 *                                                   add-on's live authority projection
 *   GET    /api/guide/resources                   → step 11: normalizeHarnessResourceRequest +
 *                                                   resolveHarnessResourceGrants (fail-closed)
 *   GET    /api/guide/terminal                    → step 12: real in-memory terminal session
 *                                                   (create→attach→run→detach→terminate)
 *   GET    /api/guide/failure-modes               → step 13: ADR-056 §7 F1–F10 contract table
 *   POST   /admin/deny   { granted: bool }        → host-only; requires admin Bearer
 *   GET    /admin/state                           → host-only read; requires admin Bearer
 *
 * Status codes:
 *   200 — operation succeeded
 *   401 — caller presented a missing or wrong bearer (real audience boundary)
 *   403 — host has revoked the grant; caller has a valid bearer but the
 *         network capability was withdrawn by the host (real host-policy
 *         revocation result, symmetric with Echo + Counter)
 *   501 — Node runtime cannot import the SDK TypeScript sources (restart
 *         with type-stripping; see SDK_UNAVAILABLE_MESSAGE)
 *   503 — server was started without --sdk-guide-bearer-token; the mutating
 *         route refuses every call (discovery-step symmetry).
 */
export function createSdkGuideServer({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  bearerToken,
  adminToken,
  loadSdk = defaultLoadSdk,
} = {}) {
  // Host-revocable in-memory flag. Flipped by POST /admin/deny; cleared by
  // the same route with { granted: true }. The bridge calls this when the
  // operator revokes the network capability for addon.sdk-guide.
  let hostGranted = true;

  // Lifecycle-projection state for step 10. `generation` increments on every
  // host-policy transition (deny/restore), mirroring the CP-BR4 reconciler's
  // generation semantics; timestamps are opaque strings to the resolver.
  const startedAt = new Date().toISOString();
  let lifecycleGeneration = 0;
  let lastTransitionAt = null;

  // Lazily imported SDK modules (TypeScript via type-stripping). Cached for
  // the life of the server; resolves to null when the runtime cannot strip
  // types so the SDK routes can answer 501 instead of crashing.
  let sdkPromise = null;
  const sdk = () => {
    sdkPromise ??= loadSdk().catch(() => null);
    return sdkPromise;
  };

  const bearerIsConfigured = () =>
    Boolean(process.env.RESONANTOS_SDK_GUIDE_ACTIVE_BEARER ?? bearerToken);

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

  // Admin token resolution: explicit parameter first, then env, then argv.
  // The /admin/* handlers compare against this resolved value — an
  // operator-started server (direct-run, no parameters) must still honor
  // --sdk-guide-admin-token / RESONANTOS_SDK_GUIDE_ADMIN_TOKEN. The env
  // helper returns "" (not undefined) when unset, so the final fallback
  // must be || — a ?? chain would short-circuit on the empty string and
  // never reach argv.
  const resolvedAdminToken = (adminToken ?? envAdminToken()) || argvAdminToken();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        status: "ok",
        addon: "addon.sdk-guide",
        hostGranted,
        bearerConfigured: bearerIsConfigured(),
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
    // educational content delivered over the same-origin loopback. Step 2
    // additionally runs the REAL validator against this add-on's own
    // addon.json whenever the runtime can import the SDK; otherwise it says
    // so explicitly rather than implying a validation that never ran.
    if (req.method === "GET" && url.pathname.startsWith("/api/guide/step/")) {
      const n = Number(url.pathname.replace("/api/guide/step/", ""));
      if (!Number.isInteger(n) || n < 1 || n > 6 || !STEP_INFO[n]) {
        sendJson(res, 404, { error: "step-not-found" });
        return;
      }
      const body = { step: n, title: STEP_INFO[n].title, ...stepBody(n) };
      if (n === 2) {
        const sdkModules = await sdk();
        if (sdkModules) {
          const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
          const result = sdkModules.validation.validateAddOnManifest(manifest, { source: "sideload" });
          body.validation = {
            live: true,
            valid: result.valid,
            issues: result.issues,
          };
        } else {
          body.validation = { live: false, reason: SDK_UNAVAILABLE_MESSAGE };
        }
      }
      sendJson(res, 200, body);
      return;
    }

    // Step 10 — runtime lifecycle projection (CP-BR3/CP-BR4 contract). The
    // authority projection is built from THIS add-on's live state: the
    // operator-pinned bearer stands in for the host registry grant, and the
    // hostGranted flag (flipped by /admin/deny in step 9) maps to the
    // revocation policy. After step 9 revokes, this flips from
    // running/starting to stopped/addon-revoked — the projection is real.
    if (req.method === "GET" && url.pathname === "/api/guide/lifecycle") {
      const sdkModules = await sdk();
      if (!sdkModules) {
        sendJson(res, 501, { error: "sdk-runtime-unavailable", message: SDK_UNAVAILABLE_MESSAGE });
        return;
      }
      const grantedCapabilities = bearerIsConfigured() ? ["network"] : [];
      const authority = {
        installed: true,
        enabled: true,
        grantedCapabilities: new Set(grantedCapabilities),
        requiredCapabilities: new Set(["network"]),
        compatible: true,
        reviewedFactoryAvailable: true,
        revocation: hostGranted ? "none" : "hard-stop",
      };
      const decision = sdkModules.lifecycle.deriveDesiredRuntimeState({
        addonId: "addon.sdk-guide",
        runtimeType: "local-service",
        classification: "tool",
        authority,
      });
      const snapshot = sdkModules.lifecycle.projectLifecycleSnapshot(decision, {
        runtimeId: "sdk-guide-loopback",
        generation: lifecycleGeneration,
        activeSessionCount: hostGranted ? 1 : 0,
        startedAt,
        ...(lastTransitionAt ? { lastTransitionAt } : {}),
      });
      sendJson(res, 200, {
        step: 10,
        title: STEP_INFO[10].title,
        lesson: "RESOURCE REQUEST != CAPABILITY GRANT != SESSION PROJECTION. deriveDesiredRuntimeState is a pure, fail-closed resolver over the host's authority projection — it never touches the manifest entrypoint, a process, or a socket. Revoke the grant in step 9 and re-run: the same input shape now resolves stopped/addon-revoked and the snapshot status flips to failed.",
        authority: { ...authority, grantedCapabilities, requiredCapabilities: ["network"] },
        decision,
        snapshot,
        vocabulary: {
          statuses: sdkModules.lifecycle.ADDON_RUNTIME_LIFECYCLE_STATUSES,
          publicFailureCodes: sdkModules.lifecycle.ADDON_RUNTIME_PUBLIC_FAILURE_CODES,
        },
      });
      return;
    }

    // Step 11 — harness-resource contract (ADR-042 Phase 2A). Normalizes a
    // representative harnessResources block with the real normalizer, then
    // resolves it against THIS add-on's actual grants. The guide only holds
    // `network`, so every family fails closed: files/project back onto
    // `filesystem`, memory onto `archive-read`, and skills/tools have no
    // backing capability at all (null — authority flows through the
    // manifest's own skill/tool requiredCapabilities in Phase 2B+).
    if (req.method === "GET" && url.pathname === "/api/guide/resources") {
      const sdkModules = await sdk();
      if (!sdkModules) {
        sendJson(res, 501, { error: "sdk-runtime-unavailable", message: SDK_UNAVAILABLE_MESSAGE });
        return;
      }
      const demoRequest = {
        requests: { files: ["read"], memory: ["search", "read"], skills: ["list"] },
      };
      const normalized = sdkModules.resources.normalizeHarnessResourceRequest(demoRequest);
      const capabilityGrants = bearerIsConfigured()
        ? [{ capability: "network", granted: true, scope: "self", revocationBehavior: "hard-stop" }]
        : [];
      const resolvedGrants = normalized.ok
        ? sdkModules.resources.resolveHarnessResourceGrants(normalized.value, capabilityGrants)
        : [];
      sendJson(res, 200, {
        step: 11,
        title: STEP_INFO[11].title,
        lesson: "A resource request is a manifest declaration of possible consumption — never authority. The normalizer rejects credentials, paths, commands and provider/model fields outright, and the grant resolver fails closed unless the backing capability is already granted. This add-on holds only `network`, so every family below resolves granted:false. That is the contract working, not an error.",
        demoRequest,
        normalized,
        backingCapability: sdkModules.resources.HARNESS_RESOURCE_CAPABILITY,
        grantsConsulted: capabilityGrants,
        resolvedGrants,
      });
      return;
    }

    // Step 12 — terminal-host lane (ADR-040). Runs a REAL session through
    // the in-memory driver (the same driver RESONANT_TERMINAL_DRIVER selects
    // by default; iterm2 and ghostty are the host-backed alternatives), then
    // proves the state machine rejects an illegal transition.
    if (req.method === "GET" && url.pathname === "/api/guide/terminal") {
      const sdkModules = await sdk();
      if (!sdkModules) {
        sendJson(res, 501, { error: "sdk-runtime-unavailable", message: SDK_UNAVAILABLE_MESSAGE });
        return;
      }
      const terminalHost = sdkModules.terminalHost.createInMemoryTerminalHost();
      const telemetry = [];
      terminalHost.onTelemetry((event) => telemetry.push(event));
      const session = terminalHost.createSession({
        id: "sdk-guide-demo-session",
        entryMode: "create",
        provenanceFidelity: sdkModules.terminalHost.deriveProvenanceFidelity({
          harnessCooperative: false,
          feedbackChannel: terminalHost.adapter.feedbackChannel,
        }),
      });
      const trail = [session.state];
      terminalHost.attach(session.id); trail.push("attached");
      terminalHost.run(session.id); trail.push("running");
      terminalHost.detach(session.id, "sdk-guide-demo-complete"); trail.push("detached");
      let invalidTransitionRejected = null;
      try {
        // detached -> running is not in TERMINAL_SESSION_TRANSITIONS.
        terminalHost.run(session.id);
      } catch (error) {
        invalidTransitionRejected = String(error?.message ?? error);
      }
      terminalHost.terminate(session.id); trail.push("terminated");
      sendJson(res, 200, {
        step: 12,
        title: STEP_INFO[12].title,
        lesson: "The terminal lane runs the same host-mediated model as this loopback service: a closed session state machine (created/adopted → attached → running → detached|terminated), an adapter contract with declared supportedOperations, and telemetry as the provenance channel. The transition below really executed against the in-memory driver; the illegal detached→running transition was really rejected. RESONANT_TERMINAL_DRIVER=in-memory|iterm2|ghostty selects the backing driver.",
        adapter: terminalHost.adapter,
        transitions: sdkModules.terminalHost.TERMINAL_SESSION_TRANSITIONS,
        sessionTrail: trail,
        session: terminalHost.get(session.id),
        telemetry,
        invalidTransitionRejected,
        drivers: { env: "RESONANT_TERMINAL_DRIVER", options: ["in-memory", "iterm2", "ghostty"], demonstrated: "in-memory" },
      });
      return;
    }

    // Step 13 — ADR-056 §7 failure-mode contract. Educational table only:
    // the executable harness (packages/addon-sdk-testing mockHost +
    // runAddOnFailureMode) lands via PR #440 and is not in this checkout.
    if (req.method === "GET" && url.pathname === "/api/guide/failure-modes") {
      sendJson(res, 200, {
        step: 13,
        title: STEP_INFO[13].title,
        lesson: "ADR-056 §7 lists ten failure modes every external agent runtime integration must be hardened against; each maps to one expected host deny code. The executable form — mockHost(...), runAddOnFailureMode(modeId, manifest) and a vitest suite asserting every Expected clause — lives in packages/addon-sdk-testing. Its TypeScript sources land via PR #440 and are absent from this checkout (only README/package.json/test stubs are present), so this step teaches the contract table rather than running the modes. Steps 7-9 above are the same idea proven live: wrong audience → 401, revoked policy → 403.",
        adr: "ADR-056 §7",
        harnessPackage: "packages/addon-sdk-testing",
        harnessPresentInCheckout: false,
        failureModes: FAILURE_MODES,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/admin/state") {
      const presentedAdmin = String(req.headers.authorization ?? "");
      const expectedAdmin = resolvedAdminToken ? `Bearer ${resolvedAdminToken}` : "";
      if (!expectedAdmin || !constantTimeEqual(presentedAdmin, expectedAdmin)) {
        sendJson(res, 401, { error: "admin-unauthorized", message: "Admin path requires Authorization: Bearer <sdk-guide-admin-token>." });
        return;
      }
      sendJson(res, 200, {
        hostGranted,
        bearerConfigured: bearerIsConfigured(),
        lifecycleGeneration,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/admin/deny") {
      const presentedAdmin = String(req.headers.authorization ?? "");
      const expectedAdmin = resolvedAdminToken ? `Bearer ${resolvedAdminToken}` : "";
      if (!expectedAdmin || !constantTimeEqual(presentedAdmin, expectedAdmin)) {
        sendJson(res, 401, { error: "admin-unauthorized", message: "Admin path requires Authorization: Bearer <sdk-guide-admin-token>." });
        return;
      }
      const body = await readJsonBody(req);
      const nextGranted = body && typeof body.granted === "boolean" ? body.granted : false;
      if (nextGranted !== hostGranted) {
        hostGranted = nextGranted;
        lifecycleGeneration += 1;
        lastTransitionAt = new Date().toISOString();
      }
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
  return {
    host,
    port,
    sdkAvailable: () => sdk().then((modules) => Boolean(modules)),
    getHostGranted: () => hostGranted,
    setHostGranted: (g) => {
      const next = Boolean(g);
      if (next !== hostGranted) {
        hostGranted = next;
        lifecycleGeneration += 1;
        lastTransitionAt = new Date().toISOString();
      }
    },
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
  service.start().then(async ({ host: h, port: p }) => {
    const tokenStatus = process.env.RESONANTOS_SDK_GUIDE_ACTIVE_BEARER ? "configured" : "NOT configured (mutating routes will return 503)";
    console.log(`Resonant SDK Guide listening on http://${h}:${p} (bearer token: ${tokenStatus})`);
    if (!(await service.sdkAvailable())) {
      console.log(`SDK steps 10-13 unavailable: ${SDK_UNAVAILABLE_MESSAGE}`);
    }
  });
}
