# SDK Demo (SDK-DEMO-003)

Reference SDK demonstration built **against current ResonantOS `dev`** — not a
parallel architecture. The add-ons here are authored with the public
`@resonantos/addon-sdk` contract (`packages/addon-sdk/`), discovered and
validated through `validateAddOnManifest`, and (in later phases) registered,
granted, enforced, and revoked through the host-owned registry
(`browser-first/host/harness-registry.mjs`) and the loopback endpoint guard
(`browser-first/host/agent-runtime-endpoint.mjs`).

The demo **consumes** ResonantOS architecture. It does not add a second manifest
schema, a second registry, a second capability system, or a custom bridge
launcher.

## Add-ons

| Add-on | ID | Purpose |
| --- | --- | --- |
| Resonant Echo | `addon.resonant-echo` | Deterministic echo; proves the host-mediated round-trip |
| Resonant Counter | `addon.resonant-counter` | *(P4)* Second independent add-on; proves the mechanism is generic |
| SDK Guide | `addon.sdk-guide` | Interactive 9-step tutorial that teaches the SDK while using it |

## Layout

```text
examples/sdk-demo/
  README.md
  echo/
    addon.json      # AddOnSdkManifest (requests only; host owns grants)
    server.mjs      # operator-started loopback HTTP echo service (P3)
    index.html      # sandboxed add-on UI (P5)
  counter/          # (P4)
  sdk-guide/        # (P7)
  tests/            # deterministic validation + round-trip tests
```

## Manifest contract

`echo/addon.json` follows the same pattern as the existing reference manifests
(`examples/addons/*.json`):

- `requestedCapabilities` are authored with `granted: false` — they are
  **requests**, never self-grants.
- `grantPresets` carry host-approvable grant proposals.
- `service.entrypoint` is a loopback URL the operator starts; the manifest never
  declares a `runtime.command` and the bridge never spawns it.
- `provenance` and `runtimeIsolation` describe the trust posture the host
  enforces.

## Validate

```bash
# Deterministic manifest + round-trip tests (no browser):
npm run test:sdk-demo:vitest

# Real-browser tests (loads the unpacked ResonantOS extension):
npm run test:sdk-demo:extension
```

The full repository gate (vitest + browser-host + adversarial) is:

```bash
npm run build
npx vitest run
npm run test:browser-host
node --test browser-first/test/sd003-p8-adversarial.test.mjs
node --test browser-first/test/bridge-route-capability-audit.test.mjs
node --test browser-first/test/addons-status-grant-regression.test.mjs
npm run test:sdk-demo:extension
```

## Run the live demo (clean-checkout)

This is the end-to-end walkthrough a developer follows after a fresh
`git clone` of `r-and-d/sdk-demo-003-current-dev`. No undocumented flags,
no hand-edited generated config, no pre-seeded tokens.

### Prerequisites

- Node `>=24.21.0` (the repo's `.nvmrc` pins `24.21.0`; we develop on `v26.0.0`).
- `npm ci` completed at the repo root.
- A Chromium-family browser (Chrome, Edge, Brave, Arc).

### 1. Build + start the three upstream add-on services

Open three terminals; each starts one operator-owned loopback HTTP service
on its declared port. The bridge never spawns them.

```bash
# Terminal 1 — Resonant Echo on :47321
node examples/sdk-demo/echo/server.mjs \
  --echo-bearer-token=demo-echo-bearer \
  --echo-admin-token=demo-echo-admin

# Terminal 2 — Resonant Counter on :47322
node examples/sdk-demo/counter/server.mjs \
  --counter-bearer-token=demo-counter-bearer \
  --counter-admin-token=demo-counter-admin

# Terminal 3 — SDK Guide on :47323
node examples/sdk-demo/sdk-guide/server.mjs \
  --sdk-guide-bearer-token=demo-guide-bearer \
  --sdk-guide-admin-token=demo-guide-admin
```

Smoke-check each upstream:

```bash
curl -fsS http://127.0.0.1:47321/health
curl -fsS http://127.0.0.1:47322/health
curl -fsS http://127.0.0.1:47323/health
```

### 2. Start the bridge (terminal 4)

The bridge's full token flag set is the `BRIDGE_CAPABILITY_TOKEN_SPECS`
table in `browser-first/host/bridge-capability-tokens.mjs`. Each flag
mints a capability-scoped token; the bridge 401s requests whose
`requiredCapability` lacks a token. For a clean-checkout demo, the
canonical "all-on" invocation is:

```bash
node browser-first/host/run-bridge-minimal.mjs \
  --bridge-port=47300 \
  --bridge-token=demo-bridge-token \
  --capability-bootstrap-token=demo-bootstrap-token \
  --addon-runtime-read-token=demo-addon-runtime-read \
  --addon-runtime-control-token=demo-addon-runtime-control \
  --addon-record-read-token=demo-addon-record-read \
  --addon-record-write-token=demo-addon-record-write \
  --addon-execution-settings-token=demo-addon-execution-settings \
  --memory-read-token=demo-memory-read \
  --memory-settings-token=demo-memory-settings \
  --memory-source-browse-token=demo-memory-source-browse \
  --memory-source-scan-token=demo-memory-source-scan \
  --memory-source-manage-token=demo-memory-source-manage \
  --memory-source-move-token=demo-memory-source-move \
  --memory-source-review-token=demo-memory-source-review \
  --memory-source-intake-token=demo-memory-source-intake \
  --memory-source-file-intake-token=demo-memory-source-file-intake \
  --archive-read-token=demo-archive-read \
  --archive-write-token=demo-archive-write \
  --diagnostics-report-token=demo-diagnostics-report \
  --bridge-diagnostics-read-token=demo-bridge-diagnostics-read \
  --browser-download-action-token=demo-browser-download-action \
  --extension-prefs-read-token=demo-extension-prefs-read \
  --extension-prefs-write-token=demo-extension-prefs-write \
  --echo-bearer-token=demo-echo-bearer \
  --echo-admin-token=demo-echo-admin \
  --counter-bearer-token=demo-counter-bearer \
  --counter-admin-token=demo-counter-admin \
  --sdk-guide-bearer-token=demo-guide-bearer \
  --sdk-guide-admin-token=demo-guide-admin
```

The bridge prints a banner like:

```
Load <repo>/browser-first/resonantos-side-panel-extension in Chrome as an unpacked extension.
```

Leave it running.

### 3. Load the real ResonantOS extension

1. Open `chrome://extensions` (or your Chromium equivalent).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select:
   ```
   /path/to/2.0.0-alpha/browser-first/resonantos-side-panel-extension/
   ```
4. Click the **Extensions** menu (puzzle-piece icon) and pin **ResonantOS
   Side Panel**. Open the side panel.

### 4. Walk the host-mediated lifecycle

Inside the side panel:

1. **Add-ons tab** — the three demo add-ons (Echo, Counter, SDK Guide)
   appear with **Missing** / **Available** status and grant buttons. Each
   add-on's status reflects the loopback upstream you started in step 1
   (green = reachable).
2. **Grant** an add-on — host-owned registry records the grant, the
   iframe re-renders, the add-on can now call its own upstream
   (`200 OK`). This is the **200** leg.
3. **Wrong bearer** — open DevTools on the iframe and call
   `fetch("/api/echo/message", { headers: { authorization: "Bearer wrong" } })`.
   The upstream returns **401** (host boundary intact).
4. **Revoke** in the side panel — registry flips `granted: false`. The
   add-on's iframe gets a **403** on its next call. This is the real
   host-policy 403, not a renderer-side simulation.
5. **Admin revoke + re-grant** — the harness's out-of-band admin
   channel (`POST /admin/deny {granted:false}`) overrides the upstream's
   admin flag; re-granting flips it back. The add-on's next call is
   **200** again.
6. **Co-existence** — switch back to **Hermes**, **OpenCode**, and
   **Living Archive** tabs in the side panel. Their routes and
   capabilities are unchanged: each still wires through the bridge and
   still gates on its declared capability token.

### 5. Tear down

```bash
# In each of terminals 1–3, Ctrl-C. In terminal 4, Ctrl-C. Unload the
# extension from chrome://extensions.
```

## Roadmap status

- **P2 scaffold** — this directory and a validating Echo manifest. [OK] (shipped)
- **P3 Echo** — operator-started loopback echo service + host-mediated round-trip. [OK] (shipped)
- **P4 Counter** — second independent add-on and cross-add-on isolation. [OK] (shipped)
- **P5 Cross-origin UI** — port the verified sandboxed iframe + postMessage renderer. [OK] (shipped)
- **P6 Capabilities** — real host grant / deny / revoke. [OK] (shipped)
- **P7 SDK Guide** — interactive tutorial with a real policy denial. [OK] (shipped)
- **P8 Adversarial** — red-team the trust boundaries. [OK] (shipped)
- **P9 Live demo** — clean-checkout unpacked extension + real bridge. (this phase)
- **P10 Integration review** — diff audit, regression, 002-findings disposition.

See `SDK-DEMO-003-ARCHITECTURE-MAP.md` (repo root) for the full contract.
See `SDK-DEMO-003-FINDINGS.md` (repo root) for open D1–D6 items.
