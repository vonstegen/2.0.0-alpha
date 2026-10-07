# Bridge & Runtimes — User Guide (CP-BR6)

> Status: **CP-BR6 (Complete on `r-and-d/terminal-host-current-dev`)**.
> Source of truth:
> [`browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-section.js`](../../browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-section.js),
> [`bridge-runtimes-view.js`](../../browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-view.js),
> [`docs/architecture/BRIDGE-RUNTIME-PROJECTION.md`](../architecture/BRIDGE-RUNTIME-PROJECTION.md),
> [`docs/architecture/BRIDGE-BOOTSTRAP-ROS-STARTUP.md`](../architecture/BRIDGE-BOOTSTRAP-ROS-STARTUP.md),
> [`docs/architecture/UI-STATE-GLOSSARY.md`](../architecture/UI-STATE-GLOSSARY.md),
> [`docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md`](../architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md) §12.

## What this surface is

The Settings → **Bridge & Runtimes** surface is the operator's window onto
the ResonantOS bridge and its add-on runtimes. It is **render-only** for
process state — every action routes through a host transaction, and the UI
re-derives from the host after each completed action.

The surface shows five views:

1. **Core bridge** — health, endpoint, version, uptime, instance, failure code.
2. **Add-on runtimes** — per-runtime lifecycle state, active session count,
   enable/disable action.
3. **Connectors** — public connection and authorization state per connector.
4. **Active sessions** — public session identifiers and running counts.
5. **Diagnostics** — public failure code, update mechanism, projection generation.

## How to read it

### Core bridge is the OFFLINE source of truth

When the bridge is offline, the surface sources core-bridge health from
the bootstrap snapshot (the native-messaging host). No HTTP call to the
bridge is made in this state. The UI does **not** simulate a start
locally; it surfaces the public failure code from the bootstrap snapshot
and waits for a user action in the **Bridge Bootstrap** section.

When the bridge is connected, the surface sources online detail from the
non-secret projection at `GET /bridge/runtimes` (capability
`addon-runtime-read`, loopback only). The projection is **frozen** — the
UI never inspects raw fields and never branches authority on projection
data.

### Add-on runtime state is distinct from core bridge state

A runtime can be `Active` while the core bridge is `Bridge degraded`, and
vice versa. The two are rendered with distinct badges, distinct tones,
and distinct live regions. Never conflate them.

### Stale projections are dropped

The projection carries a monotonic `projectionGeneration`. If the UI
receives a projection whose generation is older than the one it already
holds, the response is dropped silently. The user sees no flicker.

## How to act

### Enable / disable a runtime

Click **Enable** or **Disable** on the runtime row. The UI calls
`POST /addons/enabled` and then re-fetches the projection. The button is
disabled while the transaction is in flight. The UI never toggles a
local flag.

### Start / stop the bridge

The bridge start/stop lives in the **Bridge Bootstrap** section, not in
Bridge & Runtimes. The two surfaces are intentionally separate: the
bootstrap is owned by the native-messaging host, the runtimes by the
bridge.

### Retry / restart

The surface does **not** present a retry or restart control. The CP-BR4
reconciler is not yet wired into the production composition root, and
the prompt is explicit: do not present restart/retry as functional
without a real host transaction. When the reconciler is wired, the
surface will gain a `restart` action that calls a real host transaction.

## Accessibility

- Every section carries a visible badge with a `data-tone` attribute
  (`ok`, `info`, `warn`, `error`) and an `aria-live="polite"` live
  region for state transitions.
- Every status change is announced through a labelled live region; screen
  readers will narrate transitions.
- The render is text-only: no `innerHTML`, no `dangerouslySetInnerHTML`,
  no script injection. All values are set through `textContent` or
  `createTextNode`.
- The surface is keyboard-navigable; focus follows the standard tab
  order.

## What the surface will never show

- Capability or bootstrap tokens.
- Provider credentials or wallet material.
- Prompt content, memory content, or raw env values.
- Auth-file or token-file paths.
- Child argv, PID, or process handles.
- Private user paths (home, project roots, ResonantOS_User contents).
- Raw error stacks or stack traces.

If you see any of these in the surface, treat it as a security bug.

## Lifecycle states

The surface uses the CP-BR3 vocabulary for runtime lifecycle and the
CP-BR2 vocabulary for core bridge. See the
[UI state glossary](../architecture/UI-STATE-GLOSSARY.md) for the full
mapping.

## What comes next

- **CP-BR7** will migrate the terminal add-ons (Ghostty, iTerm2) to the
  generic runtime lifecycle. After that migration, the Bridge & Runtimes
  surface will show the terminal runtime alongside the other add-on
  runtimes, with the same enable/disable affordances.
- **CP-BR6 future** may add a thin event-stream route so the UI can
  receive push updates instead of polling. The CP-BR5 projection already
  exposes a `onUpdate` subscriber; the route is a thin SSE wrapper.
