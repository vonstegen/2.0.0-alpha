# SDK-DEMO-001 — Current Add-on Pipeline Map

Authoritative audit against `/home/vigil/Developer/2.0.0-alpha` @ `dev` (HEAD `6aa0bb68a01c16b0c73973da994f6d0fabe0fc8d`).

This map documents the **current** pipeline that a workspace add-on must flow through. Each stage is classified:

- **GENERIC** — accepts arbitrary add-on metadata, no add-on-specific code paths.
- **PARTIALLY GENERIC** — the primitive is generic, but a specific add-on-ID or path list is hard-coded.
- **ADD-ON-SPECIFIC** — branch on `addon.id` / hard-coded ID.

The map separates two surfaces:

- **Surface A: workspace / iframe add-ons** (Hermes dashboard is the only example). The pipeline Resonant Echo must traverse.
- **Surface B: content-script add-ons** (resonant-context, resonator). Built into the extension's `manifest.json` at compile time, not discoverable at runtime. Out of scope for SDK-DEMO-001.

---

## Surface A — Workspace add-on pipeline

```
addon source/manifest
      ↓
registration/discovery
      ↓
/addons/status
      ↓
Add-ons UI (settings + main workspace)
      ↓
capability disclosure
      ↓
workspace selection
      ↓
iframe/workspace renderer
      ↓
bridge proxy
      ↓
host/runtime
```

### Stage 1 — addon source/manifest

- Manifest lives in repo as `browser-first/addons/<id>/addon.json`.
- Two current examples: `browser-first/addons/resonant-context/addon.json`, `browser-first/addons/resonator/addon.json`. **These are Surface B (content-script) add-ons** — their `addon.json` is **not** read at runtime; it is referenced only by `browser-first/test/hrr033-certification/certification.config.json` as a static evidence file.
- **No workspace-type manifest schema exists yet.** Surface A workspace add-ons (Hermes, OpenCode) have **no** `addon.json` at all. Their contract is implicit: a known proxy path (`/hermes-dashboard`) and a known upstream port.

Classification: **PARTIALLY GENERIC** (the file format is generic; the absence of a workspace declaration is the gap).

### Stage 2 — registration/discovery (host-side)

- `executeAddonsStatus()` in `browser-first/host/addon-delegation-service.mjs:2655-2716` returns a **statically constructed array of 5 add-ons**: `addon.hermes`, `addon.opencode`, `addon.living-archive`, `addon.email`, `addon.calendar`.
- No file-system scan of `browser-first/addons/`. No merge with `addon.json` data.
- The five entries are hand-written literals: each entry has `id`, `name`, `available` (often a hard-coded `existsSync(...)` check), `mode`, `trust`, `requestedCapabilities`, `grantedCapabilities`, optional `deniedCapabilities`, optional `execution`, optional `boundary`, optional `providers`.

Classification: **ADD-ON-SPECIFIC** (5 hard-coded entries). The shape is generic; the population is not.

### Stage 3 — `/addons/status` route

- Route declared in `browser-first/host/addon-delegation-host-service.mjs:13-16` with `requiredCapability: "addon-runtime-read"`.
- Mounted via `addonDelegationRoutes` array; consumed by `createBridgeRequestHandler()` in `bridge-server.mjs`.
- The extension reads it via `BRIDGE_ROUTE_CAPABILITIES["GET /addons/status"]` → `"addon-runtime-read"` in `browser-first/resonantos-side-panel-extension/src/lib/bridge-client.js:96`.

Classification: **GENERIC** (the route and capability are correctly decoupled from add-on identity).

### Stage 4a — Add-ons UI (Settings → Add-ons)

- `browser-first/resonantos-side-panel-extension/src/lib/settings/addons-section.js`.
- Calls `bridge()("/addons/status", { method: "GET" })`.
- `addons-section.js:70` `addonCard()` is **generic** — it renders any add-on object using only the JSON keys it knows (`id`, `name`, `mode`, `trust`, `available`, `enabled`, `boundary`, `execution`, `requestedCapabilities`, `grantedCapabilities`, `deniedCapabilities`).
- One **ADD-ON-SPECIFIC** branch at `addons-section.js:73`: `if (["addon.hermes", "addon.opencode"].includes(addon.id))` — only renders the local-execution toggle for those two add-ons.
- Capability disclosure UI: `addon-capability-review.js` is **GENERIC** — `capabilityReviewState(addon)` reads `grantedCapabilities`, `deniedCapabilities`, `requestedCapabilities`, `pendingCapabilities` from any addon object and renders groups (`Declared`, `Needs review`, `Denied by policy`). One specific branch: `addon-capability-review.js:24-32` adds a live `shell` capability row for `addon.id === "addon.opencode"`. Acceptable; an OpenCode-specific shell toggle, not a generic gap.

Classification: **GENERIC** for card rendering; **ADD-ON-SPECIFIC** for the local-execution toggle (small, acceptable).

### Stage 4b — Add-ons UI (Main workspace → Add-ons tab)

- `browser-first/resonantos-side-panel-extension/src/lib/main-workspace-addons.js`.
- Calls `bridge()("/addons/status", { method: "GET" })` at line ~417.
- `createAddonCard()` (line 37) is generic — same shape as `settings/addons-section.js`.
- **Gap**: `workspaceForAddon(addon)` at lines 26-31 hard-codes the mapping:
  ```js
  if (addon.id === "addon.hermes") return "hermes";
  if (addon.id === "addon.opencode") return "opencode";
  if (addon.id === "addon.living-archive") return "memory";
  return "";
  ```
  Anything else returns `""` and the **Open** button is suppressed (lines 77-85).
- `addonExecutionKey(addon)` at lines 33-37 hard-codes `addon.hermes` and `addon.opencode` for the local-execution toggle; otherwise returns `""` and the panel is suppressed.

Classification: **PARTIALLY GENERIC** (the card is generic; the workspace and execution key are hard-coded ID switches — this is the primary abstraction gap).

### Stage 5 — capability disclosure

- Already covered in 4a. Generic; no per-add-on branches other than the `addon.opencode` `shell` row.

Classification: **GENERIC**.

### Stage 6 — workspace selection → renderer

- `setActiveWorkspace(workspaceId, …)` in `browser-first/resonantos-side-panel-extension/src/main-workspace.js:640-648` is the single entry point.
- Whitelist enforced at `main-workspace.js:200`:
  ```js
  const allowedWorkspaces = new Set(["answer", "artifacts", "addons", "memory", "hermes", "opencode", "settings"]);
  ```
  Anything else is silently dropped to `"answer"`.
- `renderMessages()` at lines 794-861 has hard-coded branches:
  - `activeWorkspace === "hermes"` → `renderHermesWorkspace()`
  - `activeWorkspace === "memory"` → `renderLivingArchiveWorkspace(…)`
  - `activeWorkspace === "artifacts"` → `renderArtifactsWorkspace(…)`
  - `activeWorkspace === "addons"` → `renderAddOnsWorkspace(…)`
  - `activeWorkspace === "opencode"` → `renderOpenCodeWorkspace(…)`
  - `activeWorkspace === "settings"` → `renderSettingsWorkspace(…)`
- **No generic workspace branch.** The `workspaceForAddon` mapping in 4b is therefore the *only* way to land in one of these branches.

Classification: **ADD-ON-SPECIFIC** (whitelist + 6 hard-coded branches).

### Stage 7 — iframe/workspace renderer

- `browser-first/resonantos-side-panel-extension/src/lib/addon-iframe.js` is **GENERIC** by construction: `createAddonIframe({ addonId, proxyPath, addonLabel, apiBasePath, rawFetch, bridgeUrl, bridgeToken, mode })`.
- Two render modes: `"src"` (cross-origin iframe; bridge-token-injected via rawFetch probe; suitable for SPAs whose bundles come from a different origin than the extension) and `"srcdoc"` (inlines rewritten HTML into a sandboxed `chrome-extension://` iframe; bridge-token injected via inlined preamble; suitable for same-origin bundles).
- Today only `main-workspace-hermes.js` uses `createAddonIframe` (line 70, `addonId: "hermes"`, `proxyPath: "/hermes-dashboard/"`, `mode: "src"`).
- OpenCode workspace has its own bespoke renderer (`main-workspace-opencode.js`, 541 lines) that does **not** use `addon-iframe.js`.

Classification: **GENERIC** (renderer). The renderer exists but is wired into only one workspace.

### Stage 8 — bridge proxy

- `createAddonProxyHandler()` in `browser-first/host/bridge-server.mjs:543` is **GENERIC**: accepts `bridgeToken`, `extensionOrigin`, `allowedOrigins`, `openPathPrefixes`, `upstreamHostname`, `upstreamPort`, `addonId`, `addonLabel`, `notRunningHint`, `mirrorPaths`.
- `createDashboardProxyHandler()` (lines 278-318) wraps it for Hermes with hard-coded mirror paths.
- `DASHBOARD_PROXY_MIRROR_PATHS` (lines 115-123) is a frozen array of Hermes-specific path patterns:
  ```js
  { bridge: "/hermes-dashboard", upstream: "" },
  { bridge: "/auth", upstream: "/auth" },
  { bridge: "/api", upstream: "/api" },
  { bridge: "/assets", upstream: "/assets" },
  { bridge: "/fonts-terminal", upstream: "/fonts-terminal" },
  { bridge: "/dashboard-plugins", upstream: "/dashboard-plugins" },
  { bridge: "/favicon.ico", upstream: "/favicon.ico" },
  ```
- `dashboardProxyPathPrefix()` (line 96-100) returns the literal `"/hermes-dashboard"`.
- Tester: `RESONANTOS_BRIDGE_OPEN_PROXY_PREFIXES` env var, plus `getBridgeOpenProxyPrefixes()` (line 967) returns `DASHBOARD_PROXY_MIRROR_PATHS.map((e) => e.bridge)` for loopback.
- Wiring: `run-bridge-minimal.mjs:429` calls `startBridgeServerWithFallback({ ... })` **without** passing `dashboardProxyHandler`, so the default Hermes proxy is always used.
- Capability system: `bridge-capability-tokens.mjs` lists 26 capabilities. Adding a new capability requires editing this list. `BRIDGE_CAPABILITY_TOKEN_SPECS` is the single source of truth, mirrored into the extension's `BRIDGE_ROUTE_CAPABILITIES` in `bridge-client.js:24-124` via a consistency test.

Classification: **PARTIALLY GENERIC** (handler generic; mount path list and default wiring hard-coded to Hermes).

### Stage 9 — host/runtime

- `executeHermesDashboardStatus / Start / Stop` in `addon-delegation-service.mjs` ~2780-2840 spawns a Hermes CLI child process. Hard-coded.
- `executeOpenCodeStatus` and the opencode session service are hard-coded.
- For Resonant Echo we will not need a CLI spawn — the deterministic responder is the runtime.

Classification: **ADD-ON-SPECIFIC** at the Hermes/OpenCode level; will be **GENERIC** for Resonant Echo (no spawn).

---

## Summary — where the abstractions are generic vs hard-coded

| # | Stage | Status |
|---|---|---|
| 1 | Manifest file format | PARTIALLY GENERIC — file exists, no workspace schema |
| 2 | Registration/discovery | **ADD-ON-SPECIFIC** — 5 hard-coded entries |
| 3 | `/addons/status` route | GENERIC |
| 4a | Settings Add-ons card | GENERIC + small OpenCode shell row |
| 4b | Main workspace Add-ons card + workspace key | **PARTIALLY GENERIC — hard-coded `workspaceForAddon` switch** |
| 5 | Capability disclosure | GENERIC |
| 6 | Workspace selection (whitelist + branches) | **ADD-ON-SPECIFIC** — `allowedWorkspaces` + 6 branches |
| 7 | iframe renderer (`addon-iframe.js`) | GENERIC (only used by Hermes today) |
| 8 | Bridge proxy handler | PARTIALLY GENERIC — handler generic, mount path list Hermes-specific |
| 9 | Host/runtime | ADD-ON-SPECIFIC for Hermes/OpenCode; GENERIC possible for Resonant Echo |

## SDK gaps discovered (evidence-backed)

1. **Registry is a hand-written array.** `executeAddonsStatus` returns 5 literal entries. No `addon.json` is read at runtime. → must extend the host to discover workspace add-ons generically.
2. **`workspaceForAddon` is an ID switch.** `main-workspace-addons.js:26-31`. Add-ons with no entry silently lose their **Open** button. → must move to a manifest-driven workspace contribution.
3. **`allowedWorkspaces` is a closed set.** `main-workspace.js:200`. A new workspace ID would be silently dropped to `"answer"`. → must extend the workspace whitelist mechanism (or replace it with a manifest-driven dynamic check).
4. **`renderMessages` has no generic branch.** `main-workspace.js:794-861`. Each workspace has bespoke code. → must add a generic workspace branch that calls `createAddonIframe()` based on the manifest contribution.
5. **Proxy mirror paths are Hermes-specific.** `DASHBOARD_PROXY_MIRROR_PATHS`. For Resonant Echo, a different mirror set (e.g. `/echo`) is needed. → must pass a custom `dashboardProxyHandler` from the launcher, or extend the mirror set generically.
6. **Capability list is centralized.** `bridge-capability-tokens.mjs`. Adding new capabilities requires editing this list and `BRIDGE_ROUTE_CAPABILITIES` (locked by `bridge-capability-token-consistency.test.mjs`). For Resonant Echo's `harness.messaging` capability, the cleanest path is to add **one** capability scoped to the SDK demo and gate it with the same per-route mechanism Hermes/OpenCode use.

## What is genuinely generic and reusable

- The iframe renderer (`addon-iframe.js`) — already generic. Re-use as-is.
- The capability contract model (`requestedCapabilities` / `grantedCapabilities` / `deniedCapabilities`) — generic. Re-use as-is.
- The capability disclosure UI (`addon-capability-review.js`) — generic. Re-use as-is.
- The settings Add-on card (`settings/addons-section.js`) — generic. Re-use as-is.
- The bridge reverse proxy handler (`createAddonProxyHandler`) — generic. Pass different `mirrorPaths`, `upstreamHostname/Port`, `addonId`, `addonLabel`, `notRunningHint`.
- The capability token mint pipeline (`bridge-capability-tokens.mjs` + `bridge-client.js` + consistency test) — generic. Add a new entry per new capability.

## What needs new generic mechanism

- A workspace add-on **registry**: scan `browser-first/addons/<id>/addon.json` (with `mode: "workspace-addon"` or similar discriminator), merge into the `/addons/status` response, alongside the legacy static entries.
- A **workspace contribution** declaration in the manifest: `contributions.workspace = { type: "iframe", proxyPath, apiBasePath, upstreamPort, mirrorPaths }`. Resolves the `workspaceForAddon` hard-code.
- A **generic workspace branch** in `renderMessages` that reads `addon.contributions.workspace` and dispatches to `createAddonIframe(...)`.
- A **registry-driven capability map**: `addon.requestedCapabilities` → capability token name. Allow each add-on to declare its own capability namespace.
