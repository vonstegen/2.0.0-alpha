# Terminal Activation — User Guide (CP-BR7 / CP-BR9 / CP-BR10)

> Status: **CP-BR7 + CP-BR9 + CP-BR10 (Complete on `r-and-d/terminal-host-current-dev`)**.
> Source of truth:
> [`browser-first/host/terminal-runtime-factories.mjs`](../../browser-first/host/terminal-runtime-factories.mjs),
> [`runtime-factory-registry.mjs`](../../browser-first/host/runtime-factory-registry.mjs),
> [`runtime-reconciler.mjs`](../../browser-first/host/runtime-reconciler.mjs),
> [`terminal-addon-seed.mjs`](../../browser-first/host/terminal-addon-seed.mjs),
> [`terminal-host-service-owner.mjs`](../../browser-first/host/terminal-host-service-owner.mjs),
> [`run-bridge-minimal.mjs`](../../browser-first/host/run-bridge-minimal.mjs),
> [`resonantos-side-panel-extension/src/lib/settings/addon-tools-section.js`](../../browser-first/resonantos-side-panel-extension/src/lib/settings/addon-tools-section.js),
> [`docs/architecture/SDK-RUNTIME-LIFECYCLE-CONTRACT.md`](../architecture/SDK-RUNTIME-LIFECYCLE-CONTRACT.md),
> [`docs/architecture/BRIDGE-RUNTIME-PROJECTION.md`](../architecture/BRIDGE-RUNTIME-PROJECTION.md),
> [`docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md`](../architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md) §13.

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
