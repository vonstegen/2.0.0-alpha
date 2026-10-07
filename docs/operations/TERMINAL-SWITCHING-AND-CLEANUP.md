# Terminal Switching And Cleanup (CP-BR7)

> Status: **CP-BR7 (Complete on `r-and-d/terminal-host-current-dev`)**.
> Companion to
> [`docs/product/TERMINAL-ACTIVATION.md`](../product/TERMINAL-ACTIVATION.md).

The terminal add-on runtime is a singleton per bridge: at most one
terminal adapter is `ready` at a time. Switching terminals is
deterministic and bounded.

## Switching semantics

When the operator changes the active terminal add-on (e.g. from
Ghostty to iTerm2), the host projection reflects both add-ons with
the new one `enabled: true` and the old one `enabled: false`. The
reconciler sees both, decides the new one should be `ready` and the
old one should be `stopped`, and drives the factory calls in a
single `reconcile()` tick.

The reconciler enforces a strict order:

1. The old adapter's `closeSessions` is called.
2. The old adapter's `stop` is called.
3. The new adapter's `start` is called.
4. The new adapter's `health` is checked.

The reconciler never runs two active adapters. If the old `stop`
times out, the reconciler surfaces the public failure code
`addon-stop-timeout` and does not start the new adapter. The
operator can retry.

## What "switch" means in the UI

The UI does not present a "switch" button. The operator:

1. Disables the current terminal add-on (Settings → Add-ons).
2. Enables the new one.
3. Grants the `terminal-host` capability to the new one (if it does
   not already carry it).

The Bridge & Runtimes surface reflects the transition:

- The old row transitions `Active → Disabled` (then drops out of
  `runtimeList` if the add-on is removed).
- The new row transitions `Disabled → Starting → Active`.

## Cleanup invariants

The CP-BR7 factories preserve the existing XH4/XH5 cleanup
invariants:

- **No-confirm Ghostty teardown.** `closeSessions` never throws.
  If a session close fails, the factory swallows the error and
  continues.
- **Zero leaked windows.** `stop` calls `closeSessions` first, then
  the adapter's `stop`. The `closeTimeoutMs` bound (default 2000ms)
  caps the total cleanup time.
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
  not granular enough.
- **Do not interpret a `degraded` status as `failed`.** A degraded
  adapter is still alive; the host is recovering. The operator
  can retry the action; the reconciler will drive the next
  transition.
