# Bridge & Runtimes — Operator Troubleshooting (CP-BR6)

> Status: **CP-BR6 (Complete on `r-and-d/terminal-host-current-dev`)**.
> Companion to
> [`docs/product/BRIDGE-AND-RUNTIMES.md`](product/BRIDGE-AND-RUNTIMES.md)
> and
> [`docs/architecture/UI-STATE-GLOSSARY.md`](architecture/UI-STATE-GLOSSARY.md).

The Bridge & Runtimes surface is a read-mostly window. When something
is wrong, the surface shows the public failure code and the view state;
this runbook walks through the three most common flows.

## Flow 1 — Bridge offline

**Symptom:** The core bridge card reads "Bridge offline" with a red
tone. The runtimes / connectors / sessions sections are in `degraded`
state. The diagnostics section lists the public failure code from the
bootstrap snapshot (for example `start-failed`).

**What the surface did:** It detected `bootstrap.status === "offline"`
and stopped calling the projection route. The projection route is only
called when the bridge reports `connected`.

**Operator action:**

1. Open the **Bridge Bootstrap** section.
2. The bootstrap card shows the same public failure code.
3. If the code is `bridge-not-running` or similar transport error, the
   bridge is not installed or is not listening on the loopback port.
   Verify the bridge process is running and the generated
   `bridge-config.generated.js` points at the expected loopback URL.
4. If the code is `start-failed`, the bootstrap host tried to start the
   bridge and the start command exited non-zero. Inspect the
   host's redacted log line (never the raw stderr) for the public
   failure code.
5. If the code is `version-mismatch`, the bridge version is below the
   Alpha minimum. Upgrade the bridge package.

**What the surface will NOT do:** It will not auto-restart, will not
toggle a local flag, and will not show raw stderr. Process authority
lives in the bootstrap host.

## Flow 2 — Bridge failed

**Symptom:** The core bridge card reads "Bridge failed" with a red tone.
The diagnostics section shows the public failure code (for example
`health-timeout`).

**What the surface did:** It detected `bootstrap.status === "failed"`
and stopped calling the projection route. The bridge process exited
without a graceful stop; the bootstrap host holds the public `failed`
state and waits for an explicit user action.

**Operator action:**

1. The bootstrap card in **Bridge Bootstrap** lists the same failure code.
2. The bootstrap section has a **Retry** action. The retry is bounded
   (1s → 2s → 5s → 10s, capped at 10s, max 5 retries per offline cycle).
3. If retry is exhausted, the bootstrap host holds `failed` until a
   user action. There is no automatic restart.
4. After a successful retry, the bridge returns to `connected` and the
   Bridge & Runtimes surface re-derives online detail.

**What the surface will NOT do:** It will not call the projection
route while the bridge is `failed`. Online detail stays `degraded`.

## Flow 3 — Bridge degraded

**Symptom:** The core bridge card reads "Bridge degraded" with a warn
tone. The projection route returns a projection with a
`bridgeOverview.publicFailureCode` set (for example
`bridge-health-stale`).

**What the surface did:** It detected `bootstrap.status === "degraded"`.
The surface still calls the projection route (the bridge is reachable)
and renders the projection's public failure code in the diagnostics
section.

**Operator action:**

1. The diagnostics section lists the public failure code.
2. The projection's runtimes / connectors / sessions sections still
   render. A degraded core bridge does not mean the runtimes are
   degraded; inspect each runtime's badge independently.
3. If the public failure code is `bridge-health-stale`, the bridge is
   reachable but its last health probe was outside the freshness
   window. The host will recover automatically; the surface will reflect
   the recovery on the next poll.
4. If the public failure code is `addon-health-stale`, a specific
   runtime is degraded. The runtime row shows the same code.

**What the surface will NOT do:** It will not present a restart control
for the bridge (the CP-BR4 reconciler is not yet wired into the
production composition root). It will present an enable/disable control
for each runtime whose host transaction exists.

## Flow 4 — Stale projection

**Symptom:** The diagnostics section shows a `projectionGeneration`
that does not advance. The surface appears to ignore server updates.

**What the surface did:** The projection carries a monotonic
`projectionGeneration`. The surface drops any projection whose
generation is less than or equal to the current generation. This is
intentional — the projection is the source of truth, and a stale
projection is never allowed to overwrite a newer one.

**Operator action:**

1. Reload the Settings page. The surface re-derives from the first
   projection it receives.
2. If the projection is still stale after a reload, the host's
   generation counter is not advancing. Inspect the host's log line
   for the public `projection-stale-superseded` code.

## Flow 5 — Runtime in `failed`

**Symptom:** A runtime row in the add-on runtimes section reads
"Failed" with a red tone. The row lists the runtime's public failure
code.

**Operator action:**

1. The diagnostics section lists the same code at the bottom.
2. The runtime's `Disable` action is available. Disabling removes the
   runtime from the active set; the host re-fetches the projection.
3. The surface does not present a restart action for the runtime. The
   CP-BR4 reconciler is not yet wired into the production composition
   root.

## What the operator must never do

- **Do not paste a token, path, or credential into the surface.** The
  surface is text-only and does not accept input. If a UI ever appears
  to accept one, treat it as a security bug.
- **Do not interpret the surface as process state.** The surface shows
  the public projection; the host owns the process. The surface can be
  stale for one polling interval; the host is the source of truth.
- **Do not restart the bridge from the surface.** Bridge start/stop
  lives in the **Bridge Bootstrap** section. The Bridge & Runtimes
  surface renders only the public lifecycle state.

## When to escalate

- The surface shows a public failure code that is not in the
  vocabulary. This is a host bug; the surface should never see an
  unknown code.
- The surface shows a secret-shaped value (token, credential, path).
  This is a renderer bug; the surface should never render one.
- The surface shows the same state for more than five minutes with no
  recovery. The host is not progressing; restart the bridge from
  **Bridge Bootstrap**.
