# Alpha Runtime Boundary

## Normative Boundary

At CP-BR0, ResonantOS 2.0.0 Alpha has exactly two implemented runtime components:

1. The Chrome Manifest V3 extension in
   `browser-first/resonantos-side-panel-extension/`.
2. The authenticated local Node.js bridge started by
   `npm run browser-first:bridge`, implemented under `browser-first/host/`.

ADR-047 selects a dedicated Browser-First Chrome native-messaging bootstrap host
as the third packaged Alpha boundary. CP-BR1 implements and ships that host
under `browser-first/bootstrap/`, including its macOS per-user installer
(`install-macos.mjs`) and uninstaller (`uninstall-macos.mjs`). **CP-BR2
extends the boundary into the extension**: the manifest carries
`nativeMessaging`; `bootstrap-client.js`,
`bootstrap-startup.js`, `bootstrap-renderer.js`, and
`rebind-coordinator.js` are the extension-side owners of the lifecycle;
the background service worker drives the bounded startup sequence
through `chrome.runtime.connectNative("com.resonantos.bridge_bootstrap")`.
See [BRIDGE-BOOTSTRAP-ROS-STARTUP.md](BRIDGE-BOOTSTRAP-ROS-STARTUP.md)
for the contract. **CP-BR3 + CP-BR4 add the host-side add-on runtime
lifecycle**: the pure resolver in
[`packages/addon-sdk/src/runtime-lifecycle.ts`](../../packages/addon-sdk/src/runtime-lifecycle.ts)
produces the desired-state decision; the reviewed factory registry and
idempotent reconciler in
[`browser-first/host/runtime-factory-registry.mjs`](../../browser-first/host/runtime-factory-registry.mjs)
and
[`browser-first/host/runtime-reconciler.mjs`](../../browser-first/host/runtime-reconciler.mjs)
translate it into bounded, generation-fenced, per-add-on
start / stop / degrade actions. The composition root is
[`browser-first/host/runtime-lifecycle-host.mjs`](../../browser-first/host/runtime-lifecycle-host.mjs).
See [SDK-RUNTIME-LIFECYCLE-CONTRACT.md](SDK-RUNTIME-LIFECYCLE-CONTRACT.md)
and
[RUNTIME-FACTORY-REGISTRY-AND-RECONCILER.md](RUNTIME-FACTORY-REGISTRY-AND-RECONCILER.md)
for the contract. A macOS `launchd` unit may be an optional supervisor
but is not the Alpha lifecycle authority. **CP-BR5 adds the
non-secret runtime/connector/session projection** at
[`browser-first/host/runtime-projection.mjs`](../../browser-first/host/runtime-projection.mjs),
[`runtime-projection-service.mjs`](../../browser-first/host/runtime-projection-service.mjs),
and
[`bridge-runtimes-host-service.mjs`](../../browser-first/host/bridge-runtimes-host-service.mjs);
the public route is `GET /bridge/runtimes` (`addon-runtime-read`,
`loopbackHostOnly`). See
[BRIDGE-RUNTIME-PROJECTION.md](BRIDGE-RUNTIME-PROJECTION.md) for the
schema, the privacy/redaction contract, the failure-code catalog, and
the update mechanism. The Bridge & Runtimes UI (CP-BR6) consumes this
projection; CP-BR5 ships the data contract and host route only.
**CP-BR6 adds the Settings → Bridge & Runtimes surface** at
[`browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-section.js`](../../browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-section.js)
with the pure view model at
[`bridge-runtimes-view.js`](../../browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-view.js).
The surface renders only the public projection; enable/disable route
through `POST /addons/enabled`; restart/retry is omitted when no host
transaction exists. See
[BRIDGE-AND-RUNTIMES.md](../product/BRIDGE-AND-RUNTIMES.md) for the
user guide, [UI-STATE-GLOSSARY.md](UI-STATE-GLOSSARY.md) for the
status vocabulary, and
[BRIDGE-AND-RUNTIMES-TROUBLESHOOTING.md](../BRIDGE-AND-RUNTIMES-TROUBLESHOOTING.md)
for the operator runbook.
**CP-BR7 wires the CP-BR4 reconciler into the production composition
root** at
[`browser-first/host/run-bridge-minimal.mjs`](../../browser-first/host/run-bridge-minimal.mjs)
with the two reviewed terminal factories at
[`terminal-runtime-factories.mjs`](../../browser-first/host/terminal-runtime-factories.mjs).
Ghostty and iTerm2 activate entirely through the generic lifecycle
(enable + grant → start; disable / revoke / remove → stop with
session cleanup). Connection badges derive from the CP-BR5
projection; `Open in Terminal` is gated on `projectionRuntimeStatus
=== "ready"`. The Pi grant / resource projection is unchanged; the
no-confirm Ghostty teardown and zero-leaked-windows invariants are
preserved. **CP-BR9 makes the two terminal add-ons live in the ROS
extension**: the reviewed seed at
[`terminal-addon-seed.mjs`](../../browser-first/host/terminal-addon-seed.mjs)
installs the canonical bundled manifests
([`public/addons/terminal-host-ghostty.json`](../../public/addons/terminal-host-ghostty.json),
[`public/addons/terminal-host-iterm2.json`](../../public/addons/terminal-host-iterm2.json))
into the host registry on every bridge boot (idempotent; pinFactory
repairs legacy unpinned installations without touching consent);
[`terminal-host-service-owner.mjs`](../../browser-first/host/terminal-host-service-owner.mjs)
owns the single live terminal-host service so `Open in Terminal`
and `Enable + grant` share one instance; a family lock in the
factories serializes switching (stop-old-before-start-new);
the Bridge & Runtimes enable button is a registry-revision-aware
transaction. **CP-BR10 adds the Settings → Add-on Tools section**:
the renderer in
[`addon-tools-section.js`](../../browser-first/resonantos-side-panel-extension/src/lib/settings/addon-tools-section.js)
is a plain-DOM, textContent-only surface driven by the host's
`/terminal-host/status` projection; the new
`POST /terminal-host/connection-script` route reuses the existing
`composeBootstrapCommand` / `mintSessionBootstrapGrant` family to
mint a single-use, audience-bound grant and write the token to a
0600 file, then return a shell snippet the operator pastes into
an already-running terminal. The renderer's launch and copy
affordances share the CP-BR9 single owner; the connection script
adoption is tracked for `disable` / `revoke` / `remove` cleanup.
See
[TERMINAL-ACTIVATION.md](../product/TERMINAL-ACTIVATION.md) for the
user guide,
[TERMINAL-SWITCHING-AND-CLEANUP.md](../operations/TERMINAL-SWITCHING-AND-CLEANUP.md)
for switching semantics, and
[TERMINAL-PREREQUISITES.md](../operations/TERMINAL-PREREQUISITES.md)
for the Ghostty / iTerm2 platform prerequisites.

The only privileged request path is:

```text
Chrome MV3 extension
  -> authenticated bridge request on loopback
  -> capability-gated Node bridge route
  -> approved provider endpoint or local service
```

The extension owns browser UI and browser-page interaction. The bridge owns
provider credentials, provider calls, local filesystem state, process-backed
add-ons, Living Archive mutation, diagnostics export, and other privileged
local operations. The planned native-messaging bootstrap host owns only core
bridge status/start/restart/shutdown and its private process-generation state; it
does not own bridge routes, add-on grants, provider credentials, or runtime
factory policy. No web page or add-on iframe is a privileged authority.

## Extension Boundary

The extension manifest, background worker, content scripts, side panel, and
new-tab workspace live under
`browser-first/resonantos-side-panel-extension/`.

The extension may:

- read and mutate browser state through declared Chrome extension permissions;
- run governed browser actions through extension controllers;
- maintain browser-side session, job, preference, and presentation state;
- call bridge routes through `src/lib/bridge-client.js`;
- request only the route capabilities needed for the active operation.

The extension must not persist provider credentials, scoped route-capability
tokens, wallet secrets, private keys, or privileged filesystem state as product
data. An operator-configured bridge target is the narrow exception: its bridge
token and capability-bootstrap token are stored in the local Chrome extension
profile so the selected target survives a browser restart. Clearing the bridge
override removes that local record. Wallet signing, payments, credentials,
login, public submission, and other irreversible value actions remain
human-only.

## Bridge Boundary

`browser-first/host/run-bridge-minimal.mjs` composes the bridge route services.
`browser-first/host/bridge-server.mjs` owns listener setup, request
authentication, capability-token checks, route dispatch, CORS handling, and
generated extension configuration.

The default bridge binds to `127.0.0.1`. Alpha documentation and validation
assume loopback operation. A non-loopback bind is an explicit operator
configuration and does not change the Alpha release boundary.

Every JSON route requires the bridge token. Privileged route families also
require a scoped capability token. Capability tokens are minted from a
separate bootstrap token and are checked again by the Node bridge; UI state or
an extension control is not an authorization boundary.

The bridge may connect only to configured provider endpoints and local
services requested through named route owners. Direct page-to-provider,
page-to-filesystem, and page-to-process paths are outside the architecture.

## Route Owners

| Route family | Primary owner | Privileged resources |
| --- | --- | --- |
| `/providers/*`, `/augmentor/chat`, `/augmentor/inline` | `provider-host-service.mjs` and `provider-bridge-service.mjs` | Session-held provider credentials, provider routing, approved cloud or local model endpoints |
| `/augmentor/control-plan`, `/augmentor/next-action`, `/web/news` | `agent-control-host-service.mjs` | Provider-backed planning and approved network reads |
| `/memory/*`, `/archive/*` | `memory-host-service.mjs`, memory source services, and `archive-review-host-service.mjs` | User-approved source roots, Living Archive intake/review/promotion state |
| `/addons/*`, `/hermes/*`, `/opencode/status`, `/opencode/delegation/*`, `/opencode/web/url`, `/goals` | `addon-delegation-host-service.mjs` and `addon-delegation-service.mjs` | Optional local runtimes, scoped workspaces, delegation artifacts |
| `/opencode/session/*`, `/opencode/sessions/list`, `/opencode/agents/list` | `opencode-boundary.mjs`, `opencode-event-bus.mjs`, `opencode-session-host-service.mjs`, and `opencode-client.mjs` | Owned OpenCode process, session registry, filtered event streams, and host-held credentials. OpenCode session events are authenticated parsed streams; their credentials remain host-side and their source/session scope is enforced before delivery. |
| `/status`, `/workspace/inspect`, `/browser/*`, `/diagnostics/report` | `browser-diagnostics-host-service.mjs` | Redacted local diagnostics and approved download actions |
| `/settings/extension-prefs` | `extension-prefs-host-service.mjs` | External user-state preference storage |

New routes must declare one owner, the required capability, and focused bridge
tests. Route registration does not grant authority by itself.

## Generated And Local State

Starting the bridge writes:

`browser-first/resonantos-side-panel-extension/src/bridge-config.generated.js`

The generated file contains the bridge URL and authentication material. It is
ignored, machine-local, mode `0600` when supported, and must never be committed
or packaged.

The Settings bridge-target override stores its URL, bridge token, and
capability-bootstrap token in `chrome.storage.local`. This is local browser
profile state, not repository or user-data-root state. Raw scoped
route-capability tokens are minted at runtime and are not written to extension
storage.

The default user-state root is `~/ResonantOS_User`, overridable for development
with `RESONANTOS_BROWSER_FIRST_USER_ROOT`. Memory, diagnostics, delegation
artifacts, and extension preferences belong outside the repository.

Provider credentials entered through Settings are held in bridge process
memory for the session. The bridge may read supported environment variables
exported into its process. The launcher does not load dotenv files.

## Approved Destinations

Bridge egress is limited by the owning service:

- provider services use configured provider profiles or approved local model
  endpoints;
- memory and archive services use the external user-state root and explicitly
  approved source paths;
- optional add-on services use reviewed loopback endpoints or bounded process
  launchers;
- browser diagnostics export redacted data and excludes credentials, bridge
  tokens, wallet secrets, private keys, and unrestricted home-directory data.

An approved destination does not remove a route's capability or human-approval
requirements.

The following are historical, deferred, experimental, or supporting code. They
are not shipped Alpha runtime components and are not Alpha build prerequisites.
The dedicated native-messaging bootstrap host shipped at CP-BR1
(`browser-first/bootstrap/`) is the sole exception; extension-side startup
integration is CP-BR2 and remains deferred.

## Out Of Scope

- Tauri shells and `src-tauri` paths;
- Electron shells or `BrowserView` hosts;
- native CEF or other embedded native browser hosts;
- Rust and Cargo toolchains;
- custom Chromium distributions or native browser packaging;
- external Chrome/Brave CDP sidecar profiles as the product browser;
- terminal workspaces and additional terminal add-ons beyond the
  reviewed Ghostty and iTerm2 production pair shipped by CP-BR9;
- Audio2TOL;
- Compute Fabric, add-on commerce, native wallet custody, and automated wallet
  signing.

`src/`, `src/sdk/`, `public/addons/`, `addons/`, `examples/`, and development
scripts can supply shared contracts, manifests, optional services, tests, or
future product work. Their presence does not add a third required Alpha runtime
component.

The optional Vite React development page may receive generated bridge
credentials only through the explicitly enabled, authenticated development
delivery path documented in
[browser-first/README.md](../../browser-first/README.md#opt-in-react-shell-development).
The bridge retains all authentication and capability checks; the operator must
separately allow the exact development origin. This is not an additional
shipped Alpha component.

## Change Rules

- Extension or bridge changes must preserve bridge-token and route-capability
  enforcement.
- Provider, filesystem, process, archive-promotion, credential, and diagnostics
  operations stay behind a named bridge service.
- Browser-page code never receives provider credentials or local filesystem
  authority.
- Work on an out-of-scope runtime requires separate release scope and must not
  be added to Alpha installation, build, or verification instructions.
- A change to the privileged path must update this document, the
  [module map](MODULE_MAP.md), and the
  [module ownership contract](MODULE-OWNERSHIP.md) when ownership changes.
