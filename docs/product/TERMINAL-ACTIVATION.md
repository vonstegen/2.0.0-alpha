# Terminal Activation — User Guide (CP-BR7 / CP-BR9 / CP-BR10 / CP-BR11)

> Status: **CP-BR7 + CP-BR9 + CP-BR10 + CP-BR11 (Complete on `r-and-d/terminal-host-current-dev`)**.
> Source of truth:
> [`browser-first/host/terminal-runtime-factories.mjs`](../../browser-first/host/terminal-runtime-factories.mjs),
> [`runtime-factory-registry.mjs`](../../browser-first/host/runtime-factory-registry.mjs),
> [`runtime-reconciler.mjs`](../../browser-first/host/runtime-reconciler.mjs),
> [`terminal-addon-seed.mjs`](../../browser-first/host/terminal-addon-seed.mjs),
> [`terminal-host-service-owner.mjs`](../../browser-first/host/terminal-host-service-owner.mjs),
> [`run-bridge-minimal.mjs`](../../browser-first/host/run-bridge-minimal.mjs),
> [`resonantos-side-panel-extension/src/lib/settings/addon-tools-section.js`](../../browser-first/resonantos-side-panel-extension/src/lib/settings/addon-tools-section.js),
> [`resonantos-side-panel-extension/src/lib/main-workspace-terminals.js`](../../browser-first/resonantos-side-panel-extension/src/lib/main-workspace-terminals.js),
> [`resonantos-side-panel-extension/src/lib/terminal-cards.js`](../../browser-first/resonantos-side-panel-extension/src/lib/terminal-cards.js),
> [`resonantos-side-panel-extension/src/lib/terminals-host-seams.js`](../../browser-first/resonantos-side-panel-extension/src/lib/terminals-host-seams.js),
> [`docs/architecture/SDK-RUNTIME-LIFECYCLE-CONTRACT.md`](../architecture/SDK-RUNTIME-LIFECYCLE-CONTRACT.md),
> [`docs/architecture/BRIDGE-RUNTIME-PROJECTION.md`](../architecture/BRIDGE-RUNTIME-PROJECTION.md),
> [`docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md`](../architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md) §1, §13, §14, §15.

Ghostty and iTerm2 are the first two production add-on runtimes wired
onto the generic lifecycle. The lifecycle is owned by the bridge
host; the UI is a renderer of public state.

## Installation (CP-BR9)

The two terminal add-ons are installed automatically on every
bridge boot. The seed lives in
[`terminal-addon-seed.mjs`](../../browser-first/host/terminal-addon-seed.mjs):
it reads the reviewed manifests from the canonical bundled catalog
([`public/addons/terminal-host-ghostty.json`](../../public/addons/terminal-host-ghostty.json),
[`public/addons/terminal-host-iterm2.json`](../../public/addons/terminal-host-iterm2.json))
and pairs them with the CP-BR7 reviewed factory ids from
[`terminal-runtime-factories.mjs`](../../browser-first/host/terminal-runtime-factories.mjs).
The harness host service installs them through the same
`/addons/install` path the operator would use — durable, idempotent,
never enabled and never granted by default.

A second boot with the same registry store does NOT bump the
revision: the seed is idempotent and operator state (enabled, granted,
projection generation) is preserved. A legacy installation that
predates CP-BR9 (installed and enabled but without a factory pin) is
repaired by the seed on the next boot; the pin is added without
touching consent.

## Activation flow

A terminal add-on goes through the closed desired-state rule from
CP-BR3:

```text
installed AND enabled AND required capabilities granted
AND compatible AND reviewed factory exists AND no hard-stop revocation fence
```

When every input is true, the runtime is `ready`. When any input is
false, the runtime is `stopped` (or `degraded` for revocation policies).

| Step | What happens in the UI                                | What the host does                                           |
| ---- | ----------------------------------------------------- | ------------------------------------------------------------ |
| 1    | (automatic, CP-BR9) Both add-ons are installed        | Seed installs them on every bridge boot                      |
| 2    | Enable the add-on (Bridge & Runtimes)                 | Registry marks `enabled: true`                               |
| 3    | Grant the `terminal-host` capability                  | Registry adds the grant to `grantedCapabilities`             |
| 4    | (automatic)                                            | Reconciler detects the desired-state change; the CP-BR7 factory starts the adapter; the **CP-BR9 single owner** binds the started service |
| 5    | The runtime row in Bridge & Runtimes reads "Active"   | Projection carries `runtimeList[].status === "ready"`        |
| 6    | `Open in Terminal` is enabled                         | The launch route sees the same live service the enable produced (CP-BR9) |

The whole flow is a single host transaction. The UI never toggles a
local flag; the bridge host is the sole owner of process state. The
`Bridge & Runtimes` enable button is a registry-revision-aware
transaction: it reads the host registry revision immediately before
the mutation and posts it as `expectedRevision`, so a stale read
fails closed with `ownership-conflict` and the UI surfaces the error.

## One terminal at a time (CP-BR9)

Only one of Ghostty / iTerm2 can hold the live terminal-host service
at any moment — they share a single service owner. The terminal
singleton is enforced by [`terminal-host-service-owner.mjs`](../../browser-first/host/terminal-host-service-owner.mjs):

- The first terminal enabled + granted wins the singleton.
- A second terminal enabled + granted while the incumbent is live is
  refused by the factory's start gate (no spawn, no leaked window)
  and the projection reports the add-on as `failed` (not a
  registry-derived `ready`).
- The refused start leaves a failed record with no live handle, so
  the moment the incumbent is disabled, the reconciler retries the
  refused start without a new authority transaction.

Both terminal factories share a family lock so a switching reconcile
deterministically stops the old adapter BEFORE the new one starts
(`stop-old-before-start-new`). The lock is created by the seed and
held across both factories; without it, a parallel reconcile tick
could overlap the old adapter's teardown with the new adapter's
spawn.

## Lifecycle states the UI renders

| Public status | Surface label     | Tone   | `Open in Terminal` |
| ------------- | ----------------- | ------ | ------------------ |
| `inactive`    | Disabled          | info   | disabled           |
| `starting`    | Starting…         | info   | disabled           |
| `ready`       | Active            | ok     | **enabled**        |
| `degraded`    | Degraded          | warn   | disabled           |
| `failed`      | Failed            | error  | disabled           |
| `stopping`    | Stopping…         | info   | disabled           |

The `Open in Terminal` button is enabled **only** when the selected
runtime is `ready` in the generic projection. Any other state
disables the button with a tooltip that points to Bridge & Runtimes.

## Deactivation flow

| Step | What happens in the UI                                | What the host does                                           |
| ---- | ----------------------------------------------------- | ------------------------------------------------------------ |
| 1    | Disable the add-on (Settings → Add-ons)               | Registry marks `enabled: false`                              |
| 2    | (automatic)                                            | Reconciler calls factory `stop`                              |
| 3    | The runtime row in Bridge & Runtimes reads "Disabled" | Projection carries `runtimeList[].status === "inactive"`     |
| 4    | `Open in Terminal` is disabled                        | Button checks the projection gate                            |

Disabling closes ROS-owned terminal sessions before stopping the
adapter. The no-confirm Ghostty teardown is preserved: cleanup
never throws, and the zero-leaked-windows invariant holds.

## Revocation

Revoking the `terminal-host` grant stops the adapter immediately.
Re-granting requires the operator to re-open the grant; the
projection re-derives the desired state on the next reconcile tick.

## Removal

Removing the add-on from the registry marks the installation
`installed: false` on the next reconcile. The reconciler stops the
adapter and closes its sessions.

## Add-on Tools section (CP-BR10)

Settings → **Add-on Tools** is the canonical surface for launching
the reviewed terminal add-ons and for re-attaching an
already-running terminal that started before the bridge was up
(or after the bridge restarted). The section is a thin renderer
over the same public host data the Bridge & Runtimes surface uses;
the bridge host owns the process and the credentials.

### Launch (auto-connect)

Each terminal tab carries an **Open in Terminal** button. The
button is gated on:

- the selected terminal runtime being `ready` in the projection
  (the same gate `OpenInTerminalButton` uses for the doc tab), and
- a valid 0600 prompt file (the prompt-path resolver at
  `GET /terminal-host/prompt-path` reports the file path + the
  0600 mode; the button is disabled with "Write a prompt first."
  when no 0600 file exists).

On click, the renderer posts `POST /terminal-host/launch` with the
documented `{ agentId, terminalAddonId, promptPath }` body. The
host composes the same `ros-session attach` invocation the
auto-connect path uses (the CP-BR7 `pi-terminal-v1` policy); the
terminal window opens, attaches through the bridge, and the TUI
harness inside it receives the projected project / skills / memory
/ credential resources. The renderer never sees a token, a
credential, an env value, or a path the prompt file resolver
didn't already publish.

The documented rejection vocabulary is the same as
`OpenInTerminalButton`:

- `bridge-not-running` — the renderer deep-links Settings →
  Bridge Target.
- `capability-not-granted` — the renderer surfaces an Authorize
  action (no auto-grant, no local flag).
- `executable-unavailable` / `policy-not-reviewed` / `launch-failed` —
  the renderer surfaces a typed error and a recovery hint.

### Copy connection script (manual re-attach)

The fallback for an already-running terminal is **Copy connection
script** on the same tab. The button posts to
`POST /terminal-host/connection-script` (loopback-only,
addon-runtime-read). The route reuses the same machinery the
auto-connect launch path uses:

- `mintSessionBootstrapGrant` + `trackSessionBootstrapGrant` —
  a single-use, audience-bound grant scoped to the requested
  terminal add-on, with the same 60s TTL.
- The grant token is written to a 0600 file in the host's temp
  dir. The host returns the file **path** in the receipt; the
  token itself never appears in the receipt, the script, the
  logs, the route response, the bridge-server transport, or the
  DOM.
- `composeBootstrapCommand` against the fixed-install-root
  `ros-session` CLI path. The script the operator pastes is a
  single `eval "$(node <rosSessionPath> attach --session-id <id>
  --token-file <path> --provider-profile-id <ppid>)"` line.

The renderer shows the script in a `<pre>` block (textContent
only, no innerHTML, no event-handler attributes) with a Copy
button. Copy uses `navigator.clipboard.writeText`; if the
clipboard API rejects (denied permission, missing API), the
renderer falls back to manual selection. The shape-walker covers
the entire receipt; the launch / status / connection-script
capabilities are declared in `BRIDGE_ROUTE_CAPABILITIES` and the
route-capability audit fails closed on drift.

### Trackable ownership

The host records the adopted sessionId in
`connectionScriptAdoptions` so disable / revoke / remove can
`terminateSession` the running terminal. The grant TTL (60s) is
the safety net for adoptions the operator never pastes; on
disable / remove the host iterates the adoption map and calls
`terminalHost.service.terminateSession` best-effort. The
zero-leaked-windows invariant therefore covers both auto-connect
and manual re-attach paths.

## What you should never do

- **Do not call `createTerminalHostService` directly from the UI.** The
  UI is a renderer; the host owns the service.
- **Do not bypass the reconciler.** Disabling / enabling / granting /
  revoking / removing all flow through the registry, which the
  reconciler reads.
- **Do not pass a command / argv / env to the factory.** The factory
  pins its own spawn policy. The factory never reads the ambient
  `process.env` for driver selection.
- **Do not interpret `starting` as `ready`.** `Open in Terminal` is
  gated on `ready` for a reason: launching against a half-started
  adapter is a race the host does not support.

## Terminals rail (CP-BR11)

The **Terminals** workspace in the main workspace's left rail is
the operator's everyday surface for the reviewed terminal
add-ons. It is the same public state the Settings → Add-on Tools
section renders, exposed where the operator is most likely to look
— next to Living Archive, Hermes, and OpenCode. The renderer is a
thin view of the host's harness registry + projection; the host
still owns process state.

### The closed flow on the rail

A terminal add-on goes through the same closed desired-state rule
from CP-BR3, but the rail exposes every step as a direct action
the operator can take from one card. The full Enable → Grant →
Launch path is reachable from the rail in three clicks, with no
manual bridge command and no auto-grant.

| Step | What the operator does on the rail                       | What the host does                                           |
| ---- | ----------------------------------------------------- | ------------------------------------------------------------ |
| 1    | Open the **Terminals** workspace (left rail)          | Renderer reads `/terminal-host/status` + `/bridge/runtimes` |
| 2    | See one card per reviewed add-on (Ghostty + iTerm2)   | The card merges the live surface with the projection row    |
| 3    | Click **Enable** on an inactive card                  | `POST /addons/enabled` with the registry revision read immediately before; a stale read fails closed with `ownership-conflict` |
| 4    | Click **Grant terminal-host** on a missing-grant card | `window.confirm` dialog; on consent, `POST /addons/grants` with `terminal-host` granted, `scope: "system"`, `revocationBehavior: "degrade"`, `consent: true`, and the registry revision |
| 5    | Watch the status transition `Inactive → Grant Approved → Connected` | The reconciler starts the reviewed factory; the bridge owns the service |
| 6    | Click **Open in Terminal** (or **Copy connection script** for an already-running terminal) | Same host routes the Settings section uses (`/terminal-host/launch` or `/terminal-host/connection-script`); the rail re-uses the seam factory |

Disable / Revoke / Remove are still controlled from
**Settings → Bridge & Runtimes** and the add-on catalog. The
rail's Enable / Disable button only toggles `enabled` — it never
removes the installation.

### Why two surfaces, not one

The Settings → Add-on Tools section and the Terminals rail render
the same host data through the same shared primitives
([`terminal-cards.js`](../../browser-first/resonantos-side-panel-extension/src/lib/terminal-cards.js)):
the same DOM helpers, the same `buildTerminalsViewModel`
(status + projection + grants merge), the same
`TERMINAL_ADDON_IDS`, the same `DEFAULT_AGENT_ID`. They cannot
drift: both renderers import from the shared module, both
read their host seams from the same
[`createTerminalsHostSeams`](../../browser-first/resonantos-side-panel-extension/src/lib/terminals-host-seams.js)
factory, and both reuse the existing `bridgeRequest` callback
the workspace already provides — no new bridge client, no new
global state, no parallel registry.

The Settings section carries Launch + Copy; the rail carries
Enable + Grant + Launch + Copy. The two-registry split the
left-rail **Add-ons** workspace reads is exactly the root cause
the rail fixes: that workspace reads `/addons/status` (the
addon-delegation service), which does not include the
harness-side terminal add-ons. The rail reads the harness
registry and the projection, where the terminals live.

### The non-leak guarantee on the rail

The rail renderer follows the same closure-only contract the
Settings section follows:

- text nodes only (`textContent`, `createElement`, `append`); no
  `innerHTML`, no script injection, no event-handler attributes;
- the closed-shape view-model carries no token / credential /
  path / PID / env / prompt field; the shape-walker covers every
  payload the rail renders;
- the connection script rides a 0600 token file only; the host
  mints the grant, the renderer copies the script as text with
  `navigator.clipboard.writeText` and falls back to manual
  selection when the API is denied;
- bridge-not-running rejection deep-links the operator to
  **Settings → Bridge Target** via the injected
  `onOpenBridgeSettings` callback;
- enable / grant / disable / launch / copy all flow through the
  injected host transactions; the renderer never invents a new
  authority path and never auto-grants.

The shared primitives + the shared seam factory are the reason
the rail and the Settings section can both stay green under the
same shape-walker, the same route-capability audit, and the same
ownership / secret-detection pipeline — the architecture
implemented in CP-BR1…CP-BR10 is the rail's only dependency.
