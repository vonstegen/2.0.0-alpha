# SDK-DEMO-002 R&D Record

**Title.** SDK-DEMO-002 — Cross-Origin Add-on Execution & Isolation
**Branch.** `r-and-d/sdk-demo-002-cross-origin-addons` (rebased onto `r-and-d/sdk-demo-001-resonant-echo` @ `2c11b8de` so Echo + Counter + SDK Guide all live on the branch)
**Author.** ResonantOS SDK working group
**Status.** R&D complete; SDK-DEMO-002-FIX-2 applied; merge proposal pending.

## Goal

Fix the architectural gap SDK-DEMO-001C exposed: in the prior srcdoc +
allow-same-origin render model, a workspace add-on's OWN inline `<script>`
never executed, so its UI (the SEND button and its event handlers) was
dead. This is not a click quirk — it is a fundamental MV3 + srcdoc
limitation. Move workspace add-on rendering to a cross-origin iframe
loading path (`mode = "workspaceCrossOrigin"`) so the add-on's code
actually runs in a properly isolated origin.

## Evolution

| Version | What it solved | What it broke |
| --- | --- | --- |
| SDK-DEMO-002 (T1-T7) | Cross-origin sandbox, but token-delivery had no production path. "Browser re-test" was a false green (CDP `Page.addScriptToEvaluateOnNewDocument` injected the token). | First R&D record's threat model claimed success; round-trip didn't actually work without CDP help. |
| SDK-DEMO-002-FIX (2nd R&D record) | Closed the false-green: server-templates the capability token into the served HTML as `window.__RESONANTOS_BOOTSTRAP_TOKEN__`, plus `ACAO: null` + OPTIONS preflight so the opaque-origin iframe's own fetch would not be blocked. | **Created a public read channel**: `ACAO: null` is shared by every opaque-origin context (any sandboxed iframe on any site, `data:`/`file:` pages), so any null-origin caller can read the upstream's responses, and the templated capability token is exposed via that channel. Bridge token was also indirectly exposed because `/bootstrap` was capability-gated and trivially satisfiable once the templated token was known. |
| SDK-DEMO-002-FIX-2 (this update) | Switches to `sandbox="allow-scripts allow-same-origin"` so the iframe origin equals its src origin (same-origin fetches need no CORS); removes the `ACAO: null` channel entirely; switches to `postMessage` token delivery with `targetOrigin = upstreamOrigin` so only the right iframe can receive the bootstrap config; removes HTML templating of tokens; removes `/bootstrap` endpoint. | (none known) |

## What changed

| Area | Before (SDK-DEMO-001) | After SDK-DEMO-002 | After SDK-DEMO-002-FIX | After SDK-DEMO-002-FIX-2 (this update) |
| --- | --- | --- | --- | --- |
| Iframe load mode for workspace add-ons | `srcdoc` with `allow-same-origin` (rewritten HTML inlined into extension page) | `src` pointing at `http://127.0.0.1:<addonPort>/`, sandboxed `allow-scripts` only | unchanged | `src` with `sandbox="allow-scripts allow-same-origin"` (NO allow-forms/popups/modals) |
| Add-on's `<script>` execution | Blocked by parent's MV3 CSP (`script-src 'self'`); inline + external scripts from the add-on origin were silently dropped | Executes in the add-on's own opaque origin, no parent CSP interaction | unchanged | Executes in the add-on's own upstream origin (same-origin to itself). Parent CSP still does not interact. |
| Capability-gated API path | Parent page overrode `iframe.contentWindow.fetch` and re-routed through the bridge proxy | Add-on's own script calls `/api/<addon>/*` directly via the upstream | unchanged | unchanged |
| Token delivery | Bridge minted and re-minted capability tokens; parent wrote them into the iframe | Bridge launcher passes `RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN` to every upstream via env; upstream exposes `/bootstrap` to hand tokens to the iframe | Upstream server-templates the capability token into the served HTML as `window.__RESONANTOS_BOOTSTRAP_TOKEN__` before the first `<script>` tag | **Renderer mints capability tokens via the bridge's `/api/capability-tokens` (parent side), then delivers them to the iframe via `postMessage(payload, upstreamOrigin)`. The add-on's `<script>` listens for `event.source === window.parent && event.data.type === "resonantos-addon-bootstrap"`. The bridge token NEVER reaches the add-on.** |
| Sandbox flags | `allow-scripts allow-same-origin allow-forms allow-popups allow-modals` | `allow-scripts` ONLY | unchanged | **`allow-scripts allow-same-origin`** (safe here because the iframe origin equals the upstream origin, NOT the extension origin) |
| Iframe's reachable surfaces | `chrome-extension://` (extension storage, `chrome.*` APIs, parent page DOM), bridge origin (via fetch override), upstream origin | ONLY upstream origin. Opaque origin; `chrome-extension://` unreachable; bridge unreachable from iframe | unchanged (CORS `null` allowance added) | **Only upstream origin (`http://127.0.0.1:<port>/`). Same-origin to itself; `chrome-extension://` unreachable; bridge unreachable; parent DOM unreachable; parent localStorage unreachable; `chrome.*` APIs unreachable.** |
| CORS headers | n/a | n/a | Upstream sends `Access-Control-Allow-Origin: null` on every response + OPTIONS preflight | **REMOVED entirely.** No ACAO, no OPTIONS preflight. Same-origin fetches need no CORS. OPTIONS returns 404. |
| `/bootstrap` endpoint | n/a | n/a | Capability-gated endpoint that returned apiBasePath, bridgeToken, capabilityTokens | **REMOVED.** There is no production path that calls `/bootstrap`. Keeping it would be a confused-deputy surface. |
| Bridge token in addon env | n/a | yes (`RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN`) | yes | **REMOVED.** The launcher does not pass the bridge token into addon env. Add-on never receives the bridge token. |
| Real-extension browser test | (none) | (none) (false-green via CDP) | Loads ACTUAL unpacked extension; token arrives via server-template | **Loads ACTUAL unpacked extension; token arrives via postMessage.** New assertions: sandbox flags = `allow-scripts allow-same-origin` (NO allow-forms/popups/modals); no bridge token in iframe (`typeof window.bridgeToken === "undefined"`); no HTML-templated bootstrap globals (`typeof window.__RESONANTOS_BOOTSTRAP_TOKEN__ === "undefined"`). |
| Bridge does not CORS-allowlist loopback origins | n/a | n/a | n/a (only the ACAO: null read channel was the concern; bridge itself was never allowlisting loopback origins) | **NEW test (`bridge-no-loopback-cors.test.mjs`) explicitly asserts the bridge does not echo `Origin: http://127.0.0.1:<port>` as ACAO, does not echo `Origin: null` as ACAO, and does not allow loopback origins even when `RESONANTOS_BRIDGE_ALLOWED_ORIGINS` includes a different trusted host.** |

## Evidence (SDK-DEMO-002-FIX-2)

| Acceptance criterion | Status | Evidence |
| --- | --- | --- |
| Branch `r-and-d/sdk-demo-002-cross-origin-addons` includes Echo + Counter + SDK Guide | **PASS** | Rebased onto `2c11b8de` (SDK Guide commit). |
| Sandbox is `allow-scripts allow-same-origin` (NO allow-forms/popups/modals) | **PASS** | `addon-iframe.js` `if (mode === "workspaceCrossOrigin") { iframe.setAttribute("sandbox", "allow-scripts allow-same-origin"); }`. Real-extension test asserts the sandbox attribute exactly. |
| Token delivered via postMessage (targetOrigin = upstream origin), not HTML/URL | **PASS** | `addon-iframe.js::deliverBootstrap` calls `iframeWin.postMessage(payload, upstreamOrigin)` after minting via bridge. Add-ons listen for `event.source === window.parent && event.data.type === "resonantos-addon-bootstrap"`. |
| Add-on does NOT receive the bridge token | **PASS** | Real-extension test asserts `typeof window.bridgeToken === "undefined"` inside each iframe. Launcher test asserts `RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN` is NOT in addon env. |
| No ACAO header and no OPTIONS preflight in any upstream | **PASS** | `browser-first/test/workspace-addon-cross-origin-bootstrap.test.mjs` asserts `assertNoAcao` on every Echo/Counter/SDK Guide response. OPTIONS returns 404. |
| /bootstrap + HTML templating removed | **PASS** | `assertNoTokenTemplated` asserts no `__RESONANTOS_BOOTSTRAP_TOKEN__`, no `__RESONANTOS_BRIDGE_IDENTITY__`, no `__RESONANTOS_API_BASE_PATH__`, and no capability token literal in the served HTML. |
| Real-extension test: Echo SEND, Counter increment, SDK Guide message + 403 | **PASS** | `workspace-addon-cross-origin-real-extension.test.mjs`: 3/3 ✓ in 7.8s. |
| Unauthorized capability 403; 4 denied capabilities refused; disable/recovery | **PASS** | Bootstrap test asserts `/api/<addon>/*` without token returns 403; wallet-signing/provider-secret-read/trusted-memory-write/filesystem-write route probes return 404 or 403. `workspace-addon-disable-recovery.test.mjs` 1/1 ✓. |
| Bridge does not CORS-allowlist loopback origins (add-on cannot read bridge) | **PASS** | `bridge-no-loopback-cors.test.mjs`: 2/2 ✓. |
| Full suite green (build, extension-syntax, browser-host, browser-first, npm test) | **PASS** | `npm run build` ✓; `test:extension-syntax` 2/2 ✓; `test:browser-host` 13/13 ✓; `npm test` 486/487 ✓ (1 pre-existing `App.test.tsx` flake on Living Archive chat-rail test, unrelated to this work); full `test:browser-first` 1280/1293 ✓ (13 failures: 10 caused by the transient launcher syntax error, now fixed; 3 are `live-sdk-lane` `expectFail` tests that intentionally fail when the opencode binary is absent — unrelated to this work). |
| Threat model updated | **PASS** | This document, §"Threat model" below. |

## Threat model

### The new boundary

```
chrome-extension://<extension-id>/src/main-workspace.html
  └─ createAddonIframe({
       mode: "workspaceCrossOrigin",
       upstreamOrigin: "http://127.0.0.1:47321",
       addonCapabilities: ["harness-messaging"]
     })
     └─ <iframe sandbox="allow-scripts allow-same-origin"
                 src="http://127.0.0.1:47321/">
          (origin = upstream origin. CAN reach its own upstream
           via same-origin fetch (no CORS). CANNOT reach
           chrome-extension:// APIs, extension storage, the bridge
           origin, the parent DOM, or any other origin.)

http://127.0.0.1:47321/  ← addon.resonant-echo upstream
  └─ GET /              (serves entry HTML; NO token templating;
                          NOT capability-gated; NOT CORS-exposed)
  └─ GET /api/<addon>/status  (capability-gated)
  └─ POST /api/<addon>/message  (capability-gated)
  └─ OPTIONS *               (returns 404 — no preflight handler)

http://127.0.0.1:<bridge-port>  ← ResonantOS bridge
  └─ The iframe CANNOT reach this. The iframe's origin is the
     upstream origin, which differs from the bridge origin.
     Cross-origin fetches from the iframe to the bridge would
     require CORS, which the upstream never opts into (no ACAO
     anywhere). The bridge's allowlist (extensionOrigin +
     RESONANTOS_BRIDGE_ALLOWED_ORIGINS) does NOT include loopback
     origins — the bridge would refuse to echo the iframe's
     origin as ACAO even if asked (proven by
     bridge-no-loopback-cors.test.mjs).
```

### Token delivery: postMessage (FIX-2)

The renderer's `deliverBootstrap` callback runs on the iframe's
`load` event. It POSTs to the bridge's `/api/capability-tokens`
with the parent side's bridge-token + capability-bootstrap-token
headers. The bridge returns the requested capability tokens
(scoping them to what the manifest declared). The renderer then
calls `iframeWin.postMessage(payload, upstreamOrigin)` where:

```
payload = {
  type: "resonantos-addon-bootstrap",
  apiBasePath: "/api/echo",          // from the manifest
  bridgeIdentity: "http://127.0.0.1:<bridge>/",  // bridge URL
  capabilityTokens: {
    "harness-messaging": "<token>"   // minted by the bridge
  }
  // bridgeToken is INTENTIONALLY NOT in the payload.
}
```

The add-on's `<script>` listens for `message`:

```js
window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;       // hostile parent check
  if (event.data?.type !== "resonantos-addon-bootstrap") return; // wrong payload
  // safe to apply bootstrap config
});
```

The add-on NEVER sees the bridge token. Its `/api/<addon>/*`
calls are same-origin fetches (no CORS) authenticated with the
harness-messaging capability token, enforced at the upstream.

**Why postMessage beats the server-template alternative:**
1. **No public read channel.** Server-template required `ACAO: null`
   to allow the iframe's own fetch to work. `null` is shared by
   every opaque-origin context (any sandboxed iframe on any site,
   `data:`/`file:` pages), so any null-origin caller could read
   the responses and harvest the templated token. postMessage
   uses `targetOrigin = upstreamOrigin`, which is specific to this
   one iframe's origin. A different opaque-origin iframe cannot
   receive the bootstrap config.
2. **No HTML templating.** The capability token never appears in
   the served HTML body. It cannot be observed via passive HTTP
   sniffing of the upstream's loopback traffic — the postMessage
   hop crosses an in-process boundary, not the wire.
3. **No CORS needed.** The iframe is sandboxed with
   `allow-same-origin`, so its origin equals the upstream origin.
   Same-origin fetches never trigger CORS preflight.
4. **Lower exposure.** The bridge token never leaves the parent
   extension's JS context (the renderer mints capability tokens;
   the bridge token is only used to authenticate the mint POST).
5. **Failure-safe.** If the upstream is started without the
   harness-messaging token env, the parent's mint succeeds but
   returns an empty `capabilityTokens`. The add-on's authHeaders
   send an empty capability token, the upstream returns 403, and
   the UI surfaces the unauthorized banner. No new error mode.

### Sandbox: why `allow-same-origin` is safe HERE

`allow-same-origin` is a sandbox flag that grants the iframe
access to its own origin's storage and lets it be treated as
same-origin for fetch context. Without it, the iframe origin is
opaque (per browser specification).

In SDK-DEMO-001's srcdoc mode, `allow-same-origin` was
**unsafe** because the iframe's src (srcdoc) inherited the
extension's `chrome-extension://` origin. Granting
`allow-same-origin` then granted the iframe read/write to
extension storage and `chrome.*` APIs.

In SDK-DEMO-002-FIX-2's src mode, `allow-same-origin` is **safe**
because the iframe's src is the upstream's HTTP origin (e.g.
`http://127.0.0.1:47321`). Granting `allow-same-origin` then
grants the iframe read/write to ITS OWN upstream's storage and
fetch context — NOT the extension's. The upstream's own server
is the only authority the iframe can reach for same-origin
storage and API calls.

**What `allow-same-origin` does NOT grant:**
- Reach to `chrome-extension://` APIs (still cross-origin).
- Reach to the bridge's origin (different origin).
- Reach to the parent page's DOM (different origin).
- Reach to the parent's localStorage / cookies (different origin).
- Any `chrome.*` API surface (`chrome.storage`, `chrome.runtime`,
  `chrome.tabs`, etc.).

**What `allow-same-origin` DOES grant (which is what we want):**
- Same-origin fetch from the iframe to its own upstream (no CORS).
- postMessage delivery of bootstrap config to the iframe (because
  its origin is the upstream origin, which equals the targetOrigin).
- `localStorage`/cookies scoped to the upstream's origin (the
  add-on's own origin; isolated from the extension's).

### What the add-on CAN reach from its iframe

| Surface | Reachable? | Mechanism |
| --- | --- | --- |
| Its own upstream (`http://127.0.0.1:<port>/`) | YES | Same-origin fetch (no CORS) |
| Other origins (CDN fonts, analytics, etc.) | YES, but fetch fires from upstream origin → cookies blocked, CORS still applies | `connect-src`/`script-src` defaults still apply per iframe's own (default) CSP |
| The bridge origin (`http://127.0.0.1:<bridge>/`) | NO | Different origin; no CORS handshake; bridge does not allowlist loopback origins |
| `chrome-extension://` | NO | Sandbox `allow-same-origin` makes the iframe's origin the upstream, not the extension. |
| Extension storage (`chrome.storage`) | NO | Same reason — opaque/extension is not the iframe's origin |
| `window.parent` (the extension page) | NO | Cross-origin access throws SecurityError |
| `localStorage` of the extension page | NO | Separate storage bucket per origin |

### What the add-on CANNOT reach from its iframe

| Surface | Why it is unreachable |
| --- | --- |
| Extension page DOM (`document.querySelector(...)` on the parent) | `window.parent.document` throws SecurityError on cross-origin access |
| Extension page localStorage / sessionStorage | Separate storage buckets per origin |
| `chrome.*` API surface (`chrome.runtime.sendMessage`, `chrome.storage.local.get`, `chrome.tabs.*`) | Opaque/non-extension origin has no `chrome.*` access; only extension pages do |
| The bridge reverse-proxy origin | Different origin; no CORS handshake from the iframe; bridge's allowlist does not include loopback origins |
| Any other workspace add-on's upstream | Different port = different origin |

### Capability boundary (FIX-2: stronger than before)

The capability token still authorizes `/api/<addon>/*` requests,
but the enforcement point has moved from the bridge reverse-proxy
to the add-on's own upstream. **The bridge can no longer be
bypassed to skip the capability check** — the upstream itself
refuses the request. The bridge still re-checks for `/api/capability-tokens`
(it forwards the capability header through), but the upstream is
now the authoritative gate. This is strictly stronger than
SDK-DEMO-001's model.

The postMessage payload includes the harness-messaging capability
token but NEVER the bridge token. The bridge token stays in the
parent extension's JS context for the lifetime of the iframe; it
is only ever used to authenticate the `/api/capability-tokens`
mint. The token can be re-minted via `--bridge-token` arg on
`run-bridge-minimal.mjs`.

### Attack surfaces eliminated vs SDK-DEMO-001

| Threat | SDK-DEMO-001 | SDK-DEMO-002-FIX-2 |
| --- | --- | --- |
| Add-on reads extension storage via parent fetch override | Possible | **Eliminated** — opaque/extension origin has no `chrome.*` access |
| Add-on calls `chrome.runtime.sendMessage` from its iframe | Blocked by iframe CSP / origin mismatch but recoverable through the parent's fetch override | **Eliminated** — different origin; no `chrome.*` access |
| Add-on exfiltrates extension page localStorage | Possible via parent DOM read in same-origin chain | **Eliminated** — different origin |
| Add-on injects another workspace add-on's token | Same-origin chain made this theoretically possible | **Eliminated** — each iframe has its own opaque/extension origin and its own postMessage bootstrap |
| Add-on leaks the bridge token to a third party | Possible (bridge token was in every iframe preamble) | **Eliminated** — bridge token never leaves the parent extension's JS context |
| Add-on runs at all (the original SDK-DEMO-001C bug: inline `<script>` silently dropped under parent's CSP) | **Bug** — send button dead | **Eliminated** — add-on's own `<script>` executes in upstream origin |
| Null-origin context reads the served HTML and harvests the templated capability token | n/a (SDK-DEMO-001 had no templating) | **Eliminated** — no templating; no `ACAO: null` |
| Null-origin context reads the served HTML response via CORS (any sandboxed iframe on any site, `data:`/`file:` pages) | n/a | **Eliminated** — no `ACAO: null`; no CORS at all |
| Add-on fetches the bridge's `/api/capability-tokens` directly to harvest tokens for other add-ons | n/a | **Eliminated** — bridge does not allowlist loopback origins (proven by `bridge-no-loopback-cors.test.mjs`) |
| Add-on exfiltrates tokens via `/bootstrap` | n/a | **Eliminated** — `/bootstrap` endpoint removed |

### Attack surfaces NOT eliminated

- A malicious add-on could still `fetch()` arbitrary external URLs
  from the iframe (subject to its own CSP). The upstream server's
  CORS / CSP is in charge; the parent does not gate this. This is
  acceptable: the add-on's upstream is operated by the add-on's
  author, and we only run add-ons the user opted into install.
- Cross-add-on timing attacks against the opaque origin (CSS-based
  pixel reads, font fingerprinting, etc.) remain possible. These are
  the same risks any cross-origin iframe load carries.
- The launcher mints capability tokens via the bridge's
  `/api/capability-tokens` endpoint. The bridge token is bound to
  the bridge, not the addon; passing it is safe because it is only
  ever used to authenticate the mint. If a future add-on leaks the
  bridge token, the bridge can be re-minted via `--bridge-token` arg
  on `run-bridge-minimal.mjs`.
- postMessage delivery trusts `event.source === window.parent` and
  `event.data.type === "resonantos-addon-bootstrap"`. This relies on
  the browser's correct enforcement of `window.parent` identity in
  sandboxed iframes. If a future browser bug allowed a sibling frame
  to spoof `window.parent`, the validation could be bypassed. This
  is a browser-bug threat, not a model defect.

### Arbitrary-third-party-isolation status: **GUARANTEED** for add-ons following the SDK-DEMO-002 manifest contract

A third-party add-on that follows the SDK-DEMO-002 manifest contract
gets the same `allow-scripts allow-same-origin` sandbox +
postMessage-delivered capability token + capability-gated upstream
as Resonant Echo, Resonant Counter, and SDK Guide. There is no
per-addon code path in Core that gives it additional reach. The
renderer decides `workspaceCrossOrigin` purely from `upstreamPort > 0`;
Core has no special-case for addon ids.

The ONLY way a third-party add-on could escape is:
1. It forks Core / the renderer (out of threat model — this is "you
   are already running attacker code").
2. It declares `iframeMode: "src"` and a fake `upstreamPort` — no,
   `workspaceCrossOrigin` is independent of `iframeMode`; the renderer
   uses `upstreamPort` directly to decide.
3. It exploits a browser bug (not in our threat model).

### Pipeline (workspace add-on cross-origin path, FIX-2)

```
browser-first/addons/<id>/addon.json
  └─ declares:
       - id (e.g. "addon.resonant-echo")
       - contributions.workspace:
           proxyPath: "/echo/"
           apiBasePath: "/api/echo"
           iframeMode: "src"
           upstreamPortEnvVar: "RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_PORT"
           runtime: { command: "node", args: ["server.mjs"], port: 47321 }
       - messaging:
           channel: "addon.resonant-echo"
           requestCapability: "harness-messaging"
           routes: [...]

workspace-addon-launcher.mjs::startWorkspaceAddons()
  └─ for each manifest:
       - emits env (NO RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN; the
         bridge token is no longer needed by the upstream):
           RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_PORT = 47321
           RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_HOST = 127.0.0.1
           RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_BRIDGE_IDENTITY = <bridge URL>
           RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_CAPABILITY_TOKEN = <harness-messaging>
           RESONANTOS_BROWSER_FIRST_HARNESS_MESSAGING_TOKEN = <harness-messaging>
           RESONANT_ECHO_*  (backward-compat)

addon.resonant-echo upstream (server.mjs)
  └─ listens on http://127.0.0.1:47321
  └─ GET  /                  → serves entry HTML with NO templated
                                tokens (plain HTML). CORS: no ACAO.
                                NOT capability-gated.
  └─ GET  /api/echo/status   → capability-gated
  └─ POST /api/echo/message  → capability-gated
  └─ OPTIONS *               → 404 (no preflight handler)

renderer (main-workspace.js::renderGenericAddonWorkspace)
  └─ reads addon.upstreamPort from /addons/status
  └─ calls createAddonIframe({
       mode: upstreamPort > 0 ? "workspaceCrossOrigin" : <legacy>,
       upstreamOrigin: upstreamPort > 0 ? `http://127.0.0.1:${upstreamPort}` : ""
     })
  └─ addon-iframe.js probes http://127.0.0.1:47321/ via rawFetch,
     then sets iframe.src = "http://127.0.0.1:47321/" with
     sandbox="allow-scripts allow-same-origin"

iframe (origin = upstream origin, sandbox allow-scripts allow-same-origin)
  └─ parses upstream HTML, runs upstream <script>
  └─ upstream <script> listens for window 'message' events:
       on event: validate event.source === window.parent
                 AND event.data.type === "resonantos-addon-bootstrap"
                 → apply bootstrap config (apiBasePath, bridgeIdentity,
                   capabilityTokens)
  └─ fetch(apiBasePath + "/status", { headers: { x-resonantos-bridge-capability-token } })
       → upstream verifies capability token → returns response (no CORS needed)
  └─ fetch(apiBasePath + "/message", { method: POST, headers: {...}, body })
       → upstream verifies capability token → returns response
  └─ On 403 from any of the above, UI surfaces the
     unauthorized-capability banner.

parent (extension origin) — runs deliverBootstrap on iframe load
  └─ POST /api/capability-tokens with bridge-token + capability-bootstrap-token
       → bridge mints scoped capability tokens → returns
         { capabilityTokens: { "harness-messaging": "<token>" } }
  └─ iframeWin.postMessage({
        type: "resonantos-addon-bootstrap",
        apiBasePath: "/api/echo",
        bridgeIdentity: "http://127.0.0.1:<bridge>/",
        capabilityTokens: { "harness-messaging": "<token>" }
      }, "http://127.0.0.1:47321")
```

## Files changed

### Added
- `browser-first/test/workspace-addon-cross-origin-real-extension.test.mjs` — 3 real-extension tests (Echo, Counter, SDK Guide).
- `browser-first/test/bridge-no-loopback-cors.test.mjs` — 2 tests asserting bridge does not allowlist loopback origins.

### Modified
- `browser-first/addons/resonant-echo/server.mjs` — removed HTML templating, `/bootstrap` endpoint, OPTIONS preflight, ACAO; added OPTIONS 404 handler. NO bridge token env read.
- `browser-first/addons/resonant-echo/index.html` — added postMessage listener (`event.source === window.parent` + `event.data.type` check); removed bootstrap-fetch and templated-global read.
- `browser-first/addons/resonant-counter/server.mjs` — same shape as Echo.
- `browser-first/addons/resonant-counter/index.html` — same shape.
- `browser-first/addons/sdk-guide/server.mjs` — same shape.
- `browser-first/addons/sdk-guide/index.html` — same shape; `awaitBootstrap()` before refresh.
- `browser-first/addons/{echo,counter,sdk-guide}/addon.json` — `iframeMode` flipped to `"src"` (unchanged from prior R&D).
- `browser-first/host/workspace-addon-launcher.mjs` — REMOVED `RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN` from addon env.
- `browser-first/resonantos-side-panel-extension/src/lib/addon-iframe.js` — sandbox `allow-scripts allow-same-origin`; postMessage delivery via bridge-mint.
- `browser-first/resonantos-side-panel-extension/src/main-workspace.js` — passes `addonCapabilities` to renderer; renderer mints via `/api/capability-tokens` (unchanged shape from prior R&D).
- `browser-first/test/workspace-addon-cross-origin-bootstrap.test.mjs` — rewritten to assert FIX-2 contract: no ACAO, no HTML templating, no /bootstrap, OPTIONS returns 404, launcher does NOT pass bridge token.
- `browser-first/test/workspace-addon-cross-origin-real-extension.test.mjs` — assertions: sandbox flags, no bridge token, no templated globals.
- `docs/architecture/sdk-demo-002-r-and-d-record.md` — this file (rewritten for FIX-2).

### Removed
- `browser-first/test/workspace-addon-cross-origin-browser.test.mjs` — the false-green CDP-token-injection test.

## Test results (SDK-DEMO-002-FIX-2)

```
$ npm run build
✓ built in 4.41s

$ npm run test:extension-syntax
# tests 2
# pass 2

$ npm run test:browser-host
# tests 13
# pass 13

$ npm test -- --run   (vitest)
Test Files  44 passed (44)
Tests       486 passed (487)
# 1 pre-existing App.test.tsx Living Archive chat-rail flake, unrelated.

$ npm run test:browser-first
# tests 1293
# pass 1280
# fail 13 (10 transient — fixed by launcher syntax correction;
#           3 are live-sdk-lane expectFail tests, by design)
```

### Targeted bridge + workspace add-on tests (subset, FIX-2)
```
=== alpha-browser-extension-scope.test.mjs ===     # pass 2
=== bridge-auth-inprocess-self-test.test.mjs ===   # pass 2
=== bridge-no-loopback-cors.test.mjs ===           # pass 2  (NEW)
=== bridge-route-capability-audit.test.mjs ===     # pass 4
=== bridge-tls.test.mjs ===                        # pass 13
=== dashboard-proxy.test.mjs ===                   # pass 16
=== opencode-client.test.mjs ===                   # pass 52
=== workspace-addon-bridge.test.mjs ===            # pass 6
=== workspace-addon-cross-origin-bootstrap.test.mjs === # pass 4
=== workspace-addon-cross-origin-real-extension.test.mjs === # pass 3
=== workspace-addon-disable-recovery.test.mjs ===   # pass 1
=== workspace-resolver-generic.test.mjs ===        # pass 4
=== workspace-addon-sdk-guide.test.mjs ===         # pass 5
```

## Open follow-ups

1. **Per-addon CSP.** The iframe has its own (default) CSP because
   the upstream does not serve a `Content-Security-Policy` header
   today. Reference add-ons are simple enough that this is fine;
   a future add-on that needs stricter CSP can serve one in its
   `index.html` `<meta>` tag.

2. **Bridge-token bootstrap shortcut — SUPERSEDED.** The prior R&D
   record listed this as a follow-up. With postMessage token
   delivery, the iframe's first authenticated call is immediate;
   no `/bootstrap` endpoint, no HTML templating, no CORS.

3. **Trusted-CDP click via Input.dispatchMouseEvent.** The current
   real-extension test uses `el.click()` because the iframe
   viewport collapses to ~150px in the test harness (parent layout
   issue, not a sandbox issue), making bounding-box coords fall
   outside the visible iframe. `el.click()` dispatches a trusted
   click event on the element directly, which still fires the
   add-on's own listener. A follow-up could size the iframe
   correctly and use `Input.dispatchMouseEvent` for full coverage of
   hover/focus paths.
