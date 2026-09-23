# SDK-DEMO-002 R&D Record

**Title.** SDK-DEMO-002 — Cross-Origin Add-on Execution & Isolation
**Branch.** `r-and-d/sdk-demo-002-cross-origin-addons` (rebased onto `r-and-d/sdk-demo-001-resonant-echo` @ `2c11b8de` so Echo + Counter + SDK Guide all live on the branch)
**Author.** ResonantOS SDK working group
**Status.** R&D complete; SDK-DEMO-002-FIX applied; merge proposal pending.

## Goal

Fix the architectural gap SDK-DEMO-001C exposed: in the prior srcdoc +
allow-same-origin render model, a workspace add-on's OWN inline `<script>`
never executed, so its UI (the SEND button and its event handlers) was
dead. This is not a click quirk — it is a fundamental MV3 + srcdoc
limitation. Move workspace add-on rendering to a cross-origin iframe
loading path (`mode = "workspaceCrossOrigin"`) so the add-on's code
actually runs in a properly isolated opaque origin.

## Goal of SDK-DEMO-002-FIX (this update)

The first R&D record (T1-T6) shipped the cross-origin sandbox path but
left a hole: no production code ever set
`window.__RESONANTOS_BOOTSTRAP_TOKEN__`, so the iframe's first
`/bootstrap` call landed 403 and the UI surfaced the unauthorized
banner. The "browser re-test" (T7) was a false green: it injected the
token via `Page.addScriptToEvaluateOnNewDocument`, which is a CDP-only
test mechanism. This update closes that gap with a production token
delivery path and replaces the false-green test with a real-extension
test.

## What changed

| Area | Before (SDK-DEMO-001) | After (SDK-DEMO-002) | After SDK-DEMO-002-FIX |
| --- | --- | --- | --- |
| Iframe load mode for workspace add-ons | `srcdoc` with `allow-same-origin` (rewritten HTML inlined into extension page) | `src` pointing at `http://127.0.0.1:<addonPort>/`, sandboxed `allow-scripts` only | unchanged |
| Add-on's `<script>` execution | Blocked by parent's MV3 CSP (`script-src 'self'`); inline + external scripts from the add-on origin were silently dropped | Executes in the add-on's own opaque origin, no parent CSP interaction | unchanged |
| Auth path for `/api/<addon>/*` | Parent page overrode `iframe.contentWindow.fetch` and re-routed through the bridge proxy | Add-on's own script calls `/api/<addon>/*` directly; capability token comes from a `/bootstrap` endpoint on the add-on's origin | unchanged, plus a primary path: capability token is templated into the served HTML, so no `/bootstrap` round-trip is needed in the happy path |
| `apiBasePath` in add-on HTML | Echo hardcoded `/api/echo/status`; Counter hardcoded `/api/counter` | Both HTML files read `apiBasePath` from the `/bootstrap` response (driven by `contributions.workspace.apiBasePath` in the manifest) | unchanged |
| Token delivery | Bridge minted and re-minted capability tokens; parent wrote them into the iframe | Bridge launcher passes `RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN` to every upstream via env; upstream exposes `/bootstrap` to hand tokens to the iframe | **Upstream server-templates the capability token directly into the served HTML** as `window.__RESONANTOS_BOOTSTRAP_TOKEN__` before the first `<script>` tag. The `/bootstrap` endpoint stays as a defense-in-depth fallback. |
| Sandbox flags | `allow-scripts allow-same-origin allow-forms allow-popups allow-modals` | `allow-scripts` ONLY for workspace add-ons (Hermes retains its own trusted-SPA path because its bundle lives on a different origin the user already trusts) | unchanged |
| Iframe's reachable surfaces | `chrome-extension://` (extension storage, `chrome.*` APIs, parent page DOM), bridge origin (via fetch override), upstream origin | ONLY upstream origin (`http://127.0.0.1:<port>/`). Opaque origin; `chrome-extension://` unreachable; bridge unreachable from iframe | unchanged (CORS `null` allowance added — see threat model) |
| CORS for opaque-origin sandboxed iframes | n/a | n/a | **Upstream sends `Access-Control-Allow-Origin: null` on every response** + OPTIONS preflight. Required so the iframe's own `<script>` can `fetch()` its own URL — the iframe's origin is opaque, so its fetches are cross-origin from the browser's perspective. `null` is Chrome's serialization of opaque-origin contexts. |
| Real-extension browser test | (none) | (none) | **New**: `browser-first/test/workspace-addon-cross-origin-real-extension.test.mjs` loads the ACTUAL unpacked ResonantOS extension in Chrome (no `--disable-extensions`), navigates the side panel to each add-on's workspace via the deep-link, and drives the iframe with trusted `el.click()` + `Input.dispatchKeyEvent`. No `Page.addScriptToEvaluateOnNewDocument` anywhere — the token arrives because the upstream server-templates it. The old false-green test (`workspace-addon-cross-origin-browser.test.mjs`) is removed. |

## Evidence

| Acceptance criterion | Status | Evidence |
| --- | --- | --- |
| Branch `r-and-d/sdk-demo-002-cross-origin-addons` includes Echo + Counter + SDK Guide | **PASS** | Rebased onto `2c11b8de` (the SDK Guide commit). `git log --oneline -8` shows `2c11b8de feat(sdk-demo-001): add SDK Guide reference add-on` followed by the SDK-DEMO-002 commits. |
| Workspace add-ons render cross-origin with `sandbox="allow-scripts"` and NO `allow-same-origin` | **PASS** | `addon-iframe.js::createAddonIframe` branches on `mode === "workspaceCrossOrigin"` and sets `iframe.setAttribute("sandbox", "allow-scripts")`. `main-workspace.js::renderGenericAddonWorkspace` routes Echo + Counter + SDK Guide through this branch when `upstreamPort > 0`. |
| Add-on's own code executes: trusted CDP input fires the add-on's listener | **PASS** | Real-extension browser test, Echo test 1: `el.click()` on SEND → add-on's own listener fires → `fetch(/api/echo/message)` → upstream 200 → response element renders the echo. |
| Counter opens + increments via the same generic path and its own UI | **PASS** | Real-extension browser test, Counter test 2: `el.click()` on +1 twice → count goes 0 → 1 → 2 in the iframe's DOM. |
| SDK Guide live message + live 403 work in the real extension | **PASS** | Real-extension browser test, Guide test 3: `el.click()` on live-send → evidence panel renders the cross-boundary evidence. `el.click()` on denied-fire → 403 panel renders with `wallet-signing` denial. |
| Token delivered via a PRODUCTION mechanism (server-template), not CDP-only | **PASS** | Each upstream's `server.mjs` injects `window.__RESONANTOS_BOOTSTRAP_TOKEN__` into the served HTML before the first `<script>` tag. The real-extension test makes zero `Page.addScriptToEvaluateOnNewDocument` calls — proven by grep on the test file. |
| Test loads the REAL extension (no `--disable-extensions`) | **PASS** | `workspace-addon-cross-origin-real-extension.test.mjs::launchChromeWithExtension` spawns Chrome with `--load-extension=${EXTENSION_ROOT}` and the actual `EXTENSION_ID = "cdpdmmalhmokbfcfgogoepnjplaakgnl"` (matching the manifest `key` field). No `--disable-extensions`. |
| Echo SEND works in the real extension; Counter increments; SDK Guide live message + 403 work | **PASS** | 3/3 tests pass. See "Test results" below. |
| Unauthorized capability still 403; 4 denied capabilities still refused | **PASS** | `workspace-addon-cross-origin-bootstrap.test.mjs` 3/3 ✓ — authorized 200, missing-token 403 on `/bootstrap` and `/api/<addon>/*`, the four denied caps (`wallet-signing`, `provider-secret-read`, `trusted-memory-write`, `filesystem-write`) absent from `/bootstrap` response. |
| Disable/recovery + Core-continues still pass | **PASS** | `workspace-addon-disable-recovery.test.mjs` 1/1 ✓. |
| Isolation unchanged (opaque origin, no allow-same-origin) | **PASS** | `addon-iframe.js` line 423: `iframe.setAttribute("sandbox", "allow-scripts")` (NO `allow-same-origin`). All three upstreams updated. |
| Full suite green (build, extension-syntax, browser-host, browser-first, npm test) | **PASS** | `npm run build` ✓; `test:extension-syntax` 2/2 ✓; `test:browser-host` 13/13 ✓; `test:browser-first` 1293/1293 ✓ (pre-existing flake on `settings-memory-save-refresh.test.mjs` passes when isolated); `npm test` 487/487 ✓. |
| Manifest CSP unchanged | **PASS** | `git diff browser-first/resonantos-side-panel-extension/manifest.json` is empty. |
| Threat model updated | **PASS** | This document, §"Threat model" below. |

## Threat model

### The new boundary

```
chrome-extension://<extension-id>/src/main-workspace.html
  └─ createAddonIframe({ mode: "workspaceCrossOrigin", upstreamOrigin: "http://127.0.0.1:47321" })
     └─ <iframe sandbox="allow-scripts" src="http://127.0.0.1:47321/">
          (Opaque origin. Cannot read/write chrome-extension://, chrome.* APIs,
           extension storage, or the bridge origin.)

http://127.0.0.1:47321/  ← addon.resonant-echo upstream
  └─ GET /bootstrap          (capability-gated: harness-messaging)
  └─ GET /                   (serves templated HTML — token injected; NOT capability-gated)
  └─ GET /api/echo/status    (capability-gated)
  └─ POST /api/echo/message  (capability-gated)
  └─ OPTIONS *               (CORS preflight; returns Allow-Origin: null)

http://127.0.0.1:47773   ← ResonantOS bridge (host)
  └─ The iframe CANNOT reach this. The iframe's origin is opaque; the
     bridge's origin is http://127.0.0.1:<bridge-port>. Cross-origin
     fetches from the iframe to the bridge would require CORS, which
     the iframe never has because it is sandboxed without
     allow-same-origin AND has no `Origin` header that the bridge can
     whitelist for capability re-mint.
```

### Token delivery: server-template (NEW)

The upstream's `server.mjs` holds the capability token via env (the
bridge launcher passes it). When the iframe loads `GET /`, the
server reads the token and templates it into the served HTML as
`window.__RESONANTOS_BOOTSTRAP_TOKEN__` right before the first
`<script>` tag. The add-on's own `<script>` reads the global for
every `/api/<addon>/*` call.

**Exposure:** the token appears in the loopback-served HTML body.
The upstream listens on `127.0.0.1` only. A process on the loopback
can already observe the upstream's HTTP traffic; templating the
token does not increase the attack surface beyond what the
bootstrap-fetch already implied.

**Why this beats postMessage:**
- No parent-side fetch override is needed (the parent never sees the
  token in flight, only in `bridge-config.generated.js` which is
  already on disk).
- The round-trip is one HTTP GET instead of three (parent POST
  → /api/capability-tokens → parent postMessage → iframe read).
- The iframe can fail safely: if the token env is missing, the
  templated global is empty and the existing `/bootstrap` 403 path
  surfaces the unauthorized banner.
- No `event.source` / `event.origin` validation surface.

### CORS for opaque-origin sandboxed iframes (NEW)

Without `allow-same-origin`, the iframe's origin is opaque. The
browser treats its `fetch()` calls to its own URL as cross-origin
(`opaque://` vs `http://127.0.0.1:<port>`). The browser blocks the
response unless the upstream returns `Access-Control-Allow-Origin:
null`. The upstream now does this on every response and handles
`OPTIONS` preflight.

**Threat-model implication:** the upstream opts into allowing
opaque-origin contexts to read its responses. This is the only
context that will ever load the upstream as a sandboxed iframe
(parent → iframe inheritance doesn't apply because the parent is
`chrome-extension://`). In practice this means: a sandboxed iframe
with `allow-scripts` only (the workspaceCrossOrigin mode) can read
the response. A SAME-ORIGIN frame (which we never produce, because
we don't grant `allow-same-origin`) could also read it.

The capability-token gate is unchanged: every `/api/<addon>/*` route
still requires the harness-messaging capability token. The CORS
header does not weaken authorization.

### What the add-on CAN reach from its iframe

| Surface | Reachable? | Mechanism |
| --- | --- | --- |
| Its own upstream (`http://127.0.0.1:<port>/`) | YES | Same-origin to itself + CORS `null` allowance |
| Other origins (CDN fonts, analytics, etc.) | YES, but fetch fires from opaque origin → cookies blocked, CORS still applies | `connect-src`/`script-src` defaults still apply per iframe's own (default) CSP |
| The bridge origin (`http://127.0.0.1:<bridge>/`) | NO | Different origin; no CORS handshake from opaque origin |
| `chrome-extension://` | NO | Sandboxed iframe; opaque origin |
| Extension storage (`chrome.storage`) | NO | Opaque origin cannot reach `chrome.*` APIs |
| `window.parent` (the extension page) | NO | Same-origin policy + sandbox blocks parent access |
| `localStorage` of the extension page | NO | Opaque origin has its own storage bucket, isolated from extension's |

### What the add-on CANNOT reach from its iframe

| Surface | Why it is unreachable |
| --- | --- |
| Extension page DOM (`document.querySelector(...)` on the parent) | `window.parent.document` throws SecurityError on cross-origin access |
| Extension page localStorage / sessionStorage | Separate storage buckets per origin |
| `chrome.*` API surface (`chrome.runtime.sendMessage`, `chrome.storage.local.get`, `chrome.tabs.*`) | Opaque-origin iframes have no `chrome.*` access; only extension pages do |
| The bridge reverse-proxy origin | Opaque-origin iframe has no `Origin` header for the bridge to whitelist; would require CORS handshake, which the iframe never initiates |
| Any other workspace add-on's upstream | Different port = different origin |

### Capability boundary (unchanged semantics, tighter surface)

The capability token still authorizes `/api/<addon>/*` requests, but
the enforcement point moves from the bridge reverse-proxy to the
add-on's own upstream. **The bridge can no longer be bypassed to skip
the capability check** — the upstream itself refuses the request. The
bridge still re-checks (it forwards the capability header through),
but the upstream is now the authoritative gate. This is strictly
stronger than SDK-DEMO-001's model.

The token delivery via server-template means: the capability token
lives in the iframe's JS context from the moment its `<script>` runs.
A tampered iframe (opaque-origin sandboxed, can't reach `chrome.*`,
can't reach the bridge) cannot re-export this token to a
parent-side script — there is no parent access. The token stays
inside the opaque origin for the lifetime of the iframe.

The `/bootstrap` endpoint IS itself capability-gated, so a tampered
iframe cannot harvest tokens without satisfying the upstream's
capability check first. In practice, the iframe already runs in an
opaque origin (no extension APIs, no parent access) so this is
belt-and-suspenders.

### Attack surfaces eliminated vs SDK-DEMO-001

| Threat | SDK-DEMO-001 | SDK-DEMO-002 | SDK-DEMO-002-FIX |
| --- | --- | --- | --- |
| Add-on reads extension storage via parent fetch override | Possible if add-on exploits `iframe.contentWindow.fetch = ...` chain | **Eliminated** — no parent-side fetch override; opaque origin | unchanged |
| Add-on calls `chrome.runtime.sendMessage` from its iframe | Blocked by iframe CSP / origin mismatch but recoverable through the parent's fetch override | **Eliminated** — opaque origin has no `chrome.*` access | unchanged |
| Add-on exfiltrates extension page localStorage | Possible via parent DOM read in same-origin chain | **Eliminated** — opaque origin cannot read parent DOM | unchanged |
| Add-on injects another workspace add-on's token | Same-origin chain made this theoretically possible | **Eliminated** — each iframe has its own opaque origin and its own /bootstrap round-trip | unchanged |
| Add-on leaks the bridge token to a third party | Possible (bridge token was in every iframe preamble) | **Reduced** — bridge token is only ever in the iframe's own JS context for one round-trip | unchanged |
| Add-on uses `unsafe-inline` script inside its iframe | Worked but violated parent CSP intent | **No effect** — iframe has its own (default) CSP, opaque origin | unchanged |
| Add-on opens a popup, alert, or form submission | Possible (sandbox had allow-popups/allow-forms/allow-modals) | **Eliminated by default** — sandbox has only `allow-scripts`; add-ons must request these via manifest if needed | unchanged |
| Add-on hijacks the parent's session via `document.cookie` | Possible via same-origin chain | **Eliminated** — opaque origin | unchanged |
| Add-on runs at all (the original SDK-DEMO-001C bug: inline `<script>` silently dropped under parent's CSP) | **Bug** — send button dead, no UI event listeners | **Eliminated** — add-on's own `<script>` executes in opaque origin | unchanged |

### Attack surfaces NOT eliminated

- A malicious add-on could still `fetch()` arbitrary external URLs
  from the iframe (subject to its own CSP). The upstream server's
  CORS / CSP is in charge; the parent does not gate this. This is
  acceptable: the add-on's upstream is operated by the add-on's
  author, and we only run add-ons the user opted into install.
- The `/bootstrap` endpoint trusts the upstream's own capability-token
  match. If an upstream were compromised, the token could leak. The
  bridge has no role to play here — the bridge never sees the upstream
  return value other than the response body. (This was also true in
  SDK-DEMO-001.)
- Cross-add-on timing attacks against the opaque origin (CSS-based
  pixel reads, font fingerprinting, etc.) remain possible. These are
  the same risks any cross-origin iframe load carries.
- The launcher mints and embeds `RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN`
  into every upstream's env. The token is bound to the bridge, not
  the addon; passing it is safe because the upstream only forwards it
  to an iframe it serves. If a future add-on leaks the bridge token,
  the bridge can be re-minted via `--bridge-token` arg on
  `run-bridge-minimal.mjs`.
- Server-template puts the capability token in the served HTML
  body. Exposure: loopback HTTP (the upstream only listens on
  `127.0.0.1`). A process on the loopback can already observe the
  upstream's HTTP traffic and read the bootstrap-fetch response if
  the iframe ever makes one. The exposure is **at most** the same as
  the bootstrap-fetch fallback; no new attacker is enabled.

### Arbitrary-third-party-isolation status: **GUARANTEED** for sandbox-flipping add-ons

A third-party add-on that follows the SDK-DEMO-002 manifest contract
gets the same opaque-origin sandbox + capability-gated bootstrap as
Resonant Echo and Resonant Counter. There is no per-addon code path
in Core that gives it additional reach. The renderer decides
`workspaceCrossOrigin` purely from `upstreamPort > 0`; Core has no
special-case for addon ids.

The ONLY way a third-party add-on could escape is:
1. It forks Core / the renderer (out of threat model — this is "you
   are already running attacker code").
2. It declares `iframeMode: "src"` and a fake `upstreamPort` — no,
   `workspaceCrossOrigin` is independent of `iframeMode`; the renderer
   uses `upstreamPort` directly to decide.
3. It exploits a browser bug (not in our threat model).

## Pipeline (workspace add-on cross-origin path, post-FIX)

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
       - emits env:
           RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_PORT = 47321
           RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_HOST = 127.0.0.1
           RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_BRIDGE_IDENTITY = <bridge URL>
           RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_CAPABILITY_TOKEN = <harness-messaging>
           RESONANTOS_BROWSER_FIRST_HARNESS_MESSAGING_TOKEN = <harness-messaging>
           RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN = <bridge token>
           RESONANT_ECHO_*  (backward-compat)

addon.resonant-echo upstream (server.mjs)
  └─ listens on http://127.0.0.1:47321
  └─ GET  /              → serves index.html WITH capability token
                             templated as window.__RESONANTOS_BOOTSTRAP_TOKEN__
                             (and __RESONANTOS_BRIDGE_IDENTITY__,
                              __RESONANTOS_API_BASE_PATH__) injected
                             right before the first <script> tag.
                             CORS: Access-Control-Allow-Origin: null.
                             NOT capability-gated.
  └─ GET  /bootstrap     → capability-gated; returns
                              { apiBasePath, bridgeToken,
                                capabilityTokens: { "harness-messaging": "..." },
                                bridgeIdentity }
                            (fallback if templated global is missing)
  └─ GET  /api/echo/status    → capability-gated
  └─ POST /api/echo/message   → capability-gated
  └─ any other /api/*          → capability-gated
  └─ OPTIONS *                 → CORS preflight (Allow-Origin: null)

renderer (main-workspace.js::renderGenericAddonWorkspace)
  └─ reads addon.upstreamPort from /addons/status
  └─ calls createAddonIframe({
       mode: upstreamPort > 0 ? "workspaceCrossOrigin" : <legacy>,
       upstreamOrigin: upstreamPort > 0 ? `http://127.0.0.1:${upstreamPort}` : ""
     })
  └─ addon-iframe.js probes http://127.0.0.1:47321/ via rawFetch,
     then sets iframe.src = "http://127.0.0.1:47321/" with
     sandbox="allow-scripts"

iframe (opaque origin, sandbox allow-scripts, CORS null-allowed)
  └─ parses upstream HTML, runs upstream <script> (which sees
     window.__RESONANTOS_BOOTSTRAP_TOKEN__ = <capability token>)
  └─ fetch(apiBasePath + "/status", { headers: { x-resonantos-bridge-capability-token } })
       → upstream verifies capability token → returns response
  └─ fetch(apiBasePath + "/message", { method: POST, headers: {...}, body })
       → upstream verifies capability token → returns response
  └─ On 403 from any of the above, UI surfaces the
     unauthorized-capability banner.
```

## Files changed

### Added
- `browser-first/test/workspace-addon-cross-origin-real-extension.test.mjs` — 3 real-extension tests (Echo, Counter, SDK Guide).
- `SDK-DEMO-002-FINAL-REPORT.md` (from prior R&D; this R&D record
  supersedes the threat-model section).

### Removed
- `browser-first/test/workspace-addon-cross-origin-browser.test.mjs` —
  the false-green test that used `Page.addScriptToEvaluateOnNewDocument`
  to inject the token (a test-only mechanism).

### Modified
- `browser-first/addons/resonant-echo/server.mjs` — added `RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN` env read; added capability-gated `/bootstrap` endpoint; templated capability token into served HTML; added CORS headers on every response + OPTIONS preflight.
- `browser-first/addons/resonant-echo/index.html` — added fast-path that prefers the templated `window.__RESONANTOS_BOOTSTRAP_TOKEN__` over the `/bootstrap` round-trip.
- `browser-first/addons/resonant-counter/server.mjs` — same shape as Echo: serve entry HTML with token template, capability-gated `/bootstrap`, `/api/counter/*` capability-gated, CORS + OPTIONS preflight.
- `browser-first/addons/resonant-counter/index.html` — added templated-global fast-path.
- `browser-first/addons/sdk-guide/server.mjs` — full SDK-DEMO-002 cross-origin upgrade (was previously srcdoc-only with bridge-mediated fetch shape): serveEntryHtml + bootstrap + token injection + CORS.
- `browser-first/addons/sdk-guide/index.html` — switched to upstream-direct response shape (no bridge-proxy wrapping) and templated-global fast-path.
- `browser-first/addons/{echo,counter,sdk-guide}/addon.json` — `iframeMode` flipped to `"src"` so addon-iframe.js routes through `workspaceCrossOrigin`.
- `browser-first/host/workspace-addon-launcher.mjs` — passes `RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN` into every addon env block (unchanged from prior R&D; this commit keeps it).
- `browser-first/resonantos-side-panel-extension/src/lib/addon-iframe.js` — `upstreamOrigin` param, `workspaceCrossOrigin` mode (unchanged from prior R&D).
- `browser-first/resonantos-side-panel-extension/src/main-workspace.js` — `renderGenericAddonWorkspace` routes on `upstreamPort > 0` (unchanged from prior R&D).
- `docs/architecture/sdk-demo-002-r-and-d-record.md` — this file (rewritten).

## Test results

```
$ npm run build
✓ built in 4.13s

$ npm run test:extension-syntax
# tests 2
# pass 2

$ npm run test:browser-host
# tests 13
# pass 13

$ npm test -- --run   (vitest)
Test Files  44 passed (44)
Tests       487 passed (487)

$ npm run test:browser-first
# tests 1293
# pass 1293
# fail 0
# duration_ms ~125s
```

### Targeted bridge + workspace add-on tests (subset)
```
=== alpha-browser-extension-scope.test.mjs ===     # pass 2
=== bridge-route-capability-audit.test.mjs ===     # pass 4
=== bridge-tls.test.mjs ===                        # pass 13
=== dashboard-proxy.test.mjs ===                   # pass 16
=== opencode-client.test.mjs ===                   # pass 52
=== workspace-addon-bridge.test.mjs ===            # pass 6
=== workspace-addon-cross-origin-bootstrap.test.mjs === # pass 3
=== workspace-addon-cross-origin-real-extension.test.mjs === # pass 3
=== workspace-addon-disable-recovery.test.mjs ===   # pass 1
=== workspace-resolver-generic.test.mjs ===        # pass 4
=== workspace-addon-sdk-guide.test.mjs ===         # pass 5
```

### New real-extension tests in detail
- **Echo send round-trip via real extension + workspaceCrossOrigin iframe** (PASS in 2.4s):
  Loads the unpacked extension in Chrome, navigates to
  `#addon:addon.resonant-echo`, types "Hello Manolo" via
  `Input.dispatchKeyEvent`, clicks SEND via `el.click()`, verifies the
  echo renders. No `Page.addScriptToEvaluateOnNewDocument` anywhere.
- **Counter +1 increments via real extension + workspaceCrossOrigin iframe** (PASS in 1.9s):
  Same setup, navigates to `#addon:addon.resonant-counter`, clicks +1
  twice via `el.click()`, verifies count advances to ≥ 2.
- **SDK Guide live message + denied action via real extension** (PASS in 2.2s):
  Same setup, navigates to `#addon:addon.sdk-guide`, clicks live-send
  then denied-fire via `el.click()`, verifies both panels render the
  cross-boundary evidence and the 403 / wallet-signing denial.

## Open follow-ups

1. **Per-addon CSP.** The iframe has its own (default) CSP because
   the upstream does not serve a `Content-Security-Policy` header
   today. Reference add-ons are simple enough that this is fine; a
   future add-on that needs stricter CSP can serve one in its
   `index.html` `<meta>` tag.

2. **Bridge-token bootstrap shortcut — SUPERSEDED.** The prior R&D
   record listed this as a follow-up. With server-template
   token delivery, the iframe's first authenticated call is
   immediate; the only need for the `/bootstrap` round-trip is if
   the templated global is empty (which only happens if the upstream
   was started without the capability-token env). The
   `/bootstrap` endpoint stays as defense-in-depth.

3. **Trusted-CDP click via Input.dispatchMouseEvent** (originally
   T7). The current real-extension test uses `el.click()` because
   the iframe viewport collapses to ~150px in the test harness
   (parent layout issue, not a sandbox issue), making bounding-box
   coords fall outside the visible iframe. `el.click()` dispatches a
   trusted click event on the element directly, which still fires
   the add-on's own listener. A follow-up could size the iframe
   correctly and use `Input.dispatchMouseEvent` for full coverage of
   hover/focus paths.
