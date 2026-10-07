# Terminal Activation — User Guide (CP-BR7)

> Status: **CP-BR7 (Complete on `r-and-d/terminal-host-current-dev`)**.
> Source of truth:
> [`browser-first/host/terminal-runtime-factories.mjs`](../../browser-first/host/terminal-runtime-factories.mjs),
> [`runtime-factory-registry.mjs`](../../browser-first/host/runtime-factory-registry.mjs),
> [`runtime-reconciler.mjs`](../../browser-first/host/runtime-reconciler.mjs),
> [`run-bridge-minimal.mjs`](../../browser-first/host/run-bridge-minimal.mjs),
> [`docs/architecture/SDK-RUNTIME-LIFECYCLE-CONTRACT.md`](../architecture/SDK-RUNTIME-LIFECYCLE-CONTRACT.md),
> [`docs/architecture/BRIDGE-RUNTIME-PROJECTION.md`](../architecture/BRIDGE-RUNTIME-PROJECTION.md),
> [`docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md`](../architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md) §13.

Ghostty and iTerm2 are the first two production add-on runtimes wired
onto the generic lifecycle. The lifecycle is owned by the bridge
host; the UI is a renderer of public state.

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
| 1    | Install `addon.resonant-terminal-ghostty` (or iTerm2) | Registry records the installation                             |
| 2    | Enable the add-on (Settings → Add-ons)                | Registry marks `enabled: true`                               |
| 3    | Grant the `terminal-host` capability                  | Registry adds the grant to `grantedCapabilities`             |
| 4    | (automatic)                                            | Reconciler detects the desired-state change and calls factory `start` |
| 5    | The runtime row in Bridge & Runtimes reads "Active"   | Projection carries `runtimeList[].status === "ready"`        |
| 6    | `Open in Terminal` is enabled                         | Button checks `projectionRuntimeStatus === "ready"`          |

The whole flow is a single host transaction. The UI never toggles a
local flag; the bridge host is the sole owner of process state.

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
