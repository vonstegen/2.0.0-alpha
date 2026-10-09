# Terminal Switching And Cleanup (CP-BR7 / CP-BR9)

> Status: **CP-BR7 + CP-BR9 (Complete on `r-and-d/terminal-host-current-dev`)**.
> Companion to
> [`docs/product/TERMINAL-ACTIVATION.md`](../product/TERMINAL-ACTIVATION.md).

The terminal add-on runtime is a singleton per bridge: at most one
terminal adapter is `ready` at a time. The singleton is enforced by
[`browser-first/host/terminal-host-service-owner.mjs`](../../browser-first/host/terminal-host-service-owner.mjs)
— the second terminal's start is refused by the factory's
singleton gate before any spawn. Switching terminals is deterministic
and bounded.

## Switching semantics

When the operator changes the active terminal add-on (e.g. from
Ghostty to iTerm2), the host projection reflects both add-ons with
the new one `enabled: true` and the old one `enabled: false`. The
reconciler sees both, decides the new one should be `ready` and the
old one should be `stopped`, and drives the factory calls in a
single `reconcile()` tick.

The reconciler + the shared terminal family lock enforce a strict
order:

1. The old adapter's `closeSessions` is called.
2. The old adapter's `stop` is called and the **CP-BR9 single owner**
   is detached.
3. The new adapter's `start` is called.
4. The new adapter's `health` is checked.
5. The new adapter's started service is attached to the single
   owner so the launch route sees the same live instance.

The family lock ([`createTerminalFamilyLock`](../../browser-first/host/terminal-runtime-factories.mjs))
serializes the two factories' work so the new start cannot overlap
the old stop even when the reconciler fires them in the same tick.

The reconciler never runs two active adapters. If the old `stop`
times out, the reconciler surfaces the public failure code
`addon-stop-timeout` and does not start the new adapter. The
operator can retry.

## What "switch" means in the UI

The UI does not present a "switch" button. The operator:

1. Disables the current terminal add-on (Bridge & Runtimes).
2. Enables the new one.
3. Grants the `terminal-host` capability to the new one (if it does
   not already carry it).

The Bridge & Runtimes surface reflects the transition:

- The old row transitions `Active → Disabled` (then drops out of
  `runtimeList` if the add-on is removed).
- The new row transitions `Disabled → Starting → Active`.

A second terminal enabled while the incumbent is live (operator
error) is reported as `Failed` in the projection with no leaked
window. Once the incumbent is disabled, the refused add-on retries
on the next reconcile tick without a new authority transaction.

## Cleanup invariants

The CP-BR7 factories preserve the existing XH4/XH5 cleanup
invariants:

- **No-confirm Ghostty teardown.** `closeSessions` never throws.
  If a session close fails, the factory swallows the error and
  continues.
- **Zero leaked windows.** `stop` calls `closeSessions` first, then
  the adapter's `stop`. The `closeTimeoutMs` bound (default 2000ms)
  caps the total cleanup time. If the singleton is contended, the
  second factory's start throws before any spawn and the refused
  adapter's `stop` runs synchronously to keep the invariant.
- **Bounded waits.** `start`, `stop`, and `health` are all bounded.
  The reconciler surfaces a public failure code on timeout.

## Failure recovery

If a terminal adapter fails to start, the reconciler records the
public failure code in the projection. The Bridge & Runtimes surface
renders it. The operator can:

- Disable and re-enable the add-on to retry.
- Inspect the host's redacted log line for the public failure code.
- Switch to the other terminal adapter (iTerm2 ↔ Ghostty) and back.

The factory does not auto-restart on its own. Process authority
lives in the host; the UI is a renderer.

## What you should never do

- **Do not call `kill` or `pkill` on the terminal adapter from the
  shell.** The factory owns the child process; killing it from
  outside the factory breaks the zero-leaked-windows invariant.
- **Do not disable one terminal and enable the other in a single
  batch.** Each transition flows through the reconciler; batching
  them can produce overlapping adapters if the reconcile tick is
  not granular enough. The family lock in CP-BR9 prevents the
  overlap during a parallel reconcile, but the semantic is
  unchanged: disable, then enable.
- **Do not interpret a `degraded` status as `failed`.** A degraded
  adapter is still alive; the host is recovering. The operator
  can retry the action; the reconciler will drive the next
  transition.
- **Do not start the bridge manually with
  `RESONANT_TERMINAL_HOST_BRIDGE=1`** as a workaround for an
  unresponsive terminal. The bridge composition always boots
  without the bridge-level service; the terminal add-ons are
  the live service source. The operator works the Bridge &
  Runtimes surface.
