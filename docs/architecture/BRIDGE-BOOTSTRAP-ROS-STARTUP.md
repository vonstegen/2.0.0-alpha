# ResonantOS Bridge Bootstrap — ROS Startup, Shutdown, And Recovery

> CP-BR2 documents the extension-side wiring to the CP-BR1 bootstrap host,
> the bounded startup / shutdown / recovery policy, and the explicit
> ownership rule for shutdown. The native host remains the sole owner of
> process policy; the extension drives it through a single privileged
> client module and never supplies a command, argv, path, cwd, endpoint,
> environment, or token. Companion documents:
> [BRIDGE-BOOTSTRAP-PROTOCOL.md](BRIDGE-BOOTSTRAP-PROTOCOL.md) (the wire
> contract) and [BRIDGE-BOOTSTRAP-MACOS-RUNBOOK.md](BRIDGE-BOOTSTRAP-MACOS-RUNBOOK.md)
> (installation).

## 1. Startup sequence

On MV3 service-worker boot (`background.js`):

```text
boot (status)  ──┐
                ├──> offline/starting  → start → poll health → bind
                ├──> connected         → reuse; do not start again
                ├──> version-mismatch  → Failed; no reuse
                └──> anything else     → start → poll health → bind
```

Concretely:

1. `bootstrapStartup.boot()` issues a single `status` envelope.
2. The response drives the next step:
   - `connected` — the orchestrator reuses the bridge and skips `start`.
     No `onHealthyAfterStart` rebind runs (the bridge is already bound).
   - `starting` — another panel/SW revival is already driving the host;
     the orchestrator joins by polling health and verifying with `status`.
     It does NOT issue a parallel `start`.
   - `offline` / `failed` — the orchestrator issues `start` once, then
     polls `/healthz` with a bounded `healthPollTimeoutMs` (10s default),
     then verifies with `status`.
3. When the orchestrator reaches `connected` via a fresh start, it fires
   the **healthy-after-start** trigger: `bootstrapCoordinator.rebind()`
   re-fetches the generated bridge config, rebuilds `bridgeRequest` and
   `rawFetch`, and re-runs `initCapabilityTokens`. Until that succeeds
   the orchestrator holds `degraded`; it never silently reuses stale
   credentials.

Concurrent boots (MV3 worker revival, multiple panels, multiple tabs) all
call `bootstrapStartup.boot()`. The orchestrator joins a single in-flight
boot promise, so only one `start` ever reaches the host.

## 2. Reuse

`status` returning `connected` short-circuits `start`. Reloading the
extension or restarting ROS does NOT create a second bridge — the same
owned generation is reused.

## 3. Post-start credential adoption and rebind

The CP-BR1 host never returns the bridge token or capability-bootstrap
token. After a fresh start, the bridge rewrites
`browser-first/resonantos-side-panel-extension/src/bridge-config.generated.js`.
The extension re-adopts those credentials through one shared owner:

- `bootstrapCoordinator` (in `src/lib/rebind-coordinator.js`) is the
  single subscriber to "bridge just became healthy" events.
- The background service worker subscribes and re-assigns its
  `bridgeRequest` / `rawFetch` closures.
- `side-panel.js` and `main-workspace.js` continue to use their
  existing rebind chains (which are the 401-driven path); they also
  re-render the status badge from the orchestrator's snapshot via
  `createBootstrapRenderer`.

The legacy in-line rebind chains in the three entry points are kept
intact so the 401-driven rebind continues to work. The new
"healthy-after-start" trigger converges on the same shared owner.

## 4. Version mismatch

If the host (or a subsequent `status` verification) reports
`version-mismatch`, the orchestrator transitions to `failed` with
`failureCode: "version-mismatch"`. The orchestrator does NOT issue a
second `start` and does NOT reuse the bridge for privileged operations.
The Settings → Bridge Bootstrap section surfaces the failure code; the
"Retry" button is disabled until the user upgrades the bridge or the
extension.

## 5. Shutdown

MV3 service workers do not provide a reliable "extension unload" hook.
CP-BR2 therefore exposes an **explicit, testable stop action** in
**Settings → Bridge Bootstrap → Stop bridge**. The action calls
`bootstrapStartup.stopForShutdown()` which forwards to the host's
`stopForShutdown` operation.

Ownership rule: the host decides whether the bridge is owned by the
bootstrap. If a bridge was already running before ROS started (e.g.
the user launched it via `npm run browser-first:bridge`), the host
returns `ok: true, status: "offline"` from `stopForShutdown` (it had no
owned record to stop). The orchestrator re-probes `/healthz` after the
host's response; if the loopback endpoint is still answering, the
bridge is externally-started and the orchestrator restores the
`connected` snapshot. The bridge is left untouched.

`chrome.runtime.onSuspend` is **not** used. The CP-BR2 surface is the
explicit Settings action only.

## 6. Unexpected exit and bounded recovery

If a bridge that was `connected` exits unexpectedly, the host returns
`unexpected-exit` (CP-BR1 §5.5). The extension-side signals this through
`bootstrapStartup.reportUnexpectedExit({ failureCode })`. The
orchestrator:

1. Transitions to `failed` with the public failure code
   (`unexpected-exit`, `health-timeout`, or whatever the host returned).
2. Surfaces the failure to the Settings → Bridge Bootstrap section.
3. Schedules a bounded retry (only if `bootRetries < BOOTSTRAP_MAX_RETRIES`).
   The backoff schedule is `BOOTSTRAP_RETRY_BACKOFF_MS = [1000, 2000, 5000, 10_000]`
   — capped at 10 seconds.
4. After the cap, the orchestrator holds the `failed` state and waits
   for the user to click "Retry" (`bootstrapStartup.retryOnce()`).

The orchestrator never auto-starts in a tight loop. There is no
recursive auto-restart.

## 7. Security invariants (preserved)

- The extension sends only `{ protocol, requestId, operation }` to the host.
- The host remains the sole owner of process policy and child environment.
- Public bootstrap status never carries tokens, credentials, PID, paths,
  argv, or raw errors. The extension must not log or render such values
  either (the public `failureMessage` is preserved as a public field but
  the orchestrator projects it to a 256-char cap and the Settings UI
  uses a closed failure-code label, not the raw message).
- Generated bridge config is read only through the existing
  extension-resource fetch (`refreshGeneratedBridgeConfig`); never from
  disk or a private path.
- `allowed_origins` in the CP-BR1 macOS manifest stays pinned to the
  Alpha extension origin; no wildcard.
- `/bridge/launch` and `bridge_launch` (CP-BR0) remain absent. The
  bridge-target section UI exposes the override only through
  `chrome.storage.local`; the bootstrap client does not interact with
  it.

## 8. Node version requirement

Node 26+ is required. Under nvm Node 22.13 the
`bridge-auth-inprocess-self-test.test.mjs` test fails with
`ERR_UNKNOWN_FILE_EXTENSION` because it spawns a bridge entry that
imports `.ts`; that is a Node-version requirement, not a code defect.
Always verify with Node 26.

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
node --version  # must be 26.x
```

## 9. Generic add-on runtime lifecycle (CP-BR3 / CP-BR4)

CP-BR2 does NOT build the generic add-on runtime lifecycle manager. The
extension only owns the core bridge lifecycle. Reviewed add-on runtime
factories (terminal-host, etc.) remain independent of the bootstrap
host and use the bridge's `/api/runtime/...` route family. The
Settings → Add-ons section is unchanged.

## 10. Architecture reference

- Bootstrap client: `browser-first/resonantos-side-panel-extension/src/lib/bootstrap-client.js`
- Orchestrator: `browser-first/resonantos-side-panel-extension/src/lib/bootstrap-startup.js`
- Renderer helper: `browser-first/resonantos-side-panel-extension/src/lib/bootstrap-renderer.js`
- Rebind coordinator: `browser-first/resonantos-side-panel-extension/src/lib/rebind-coordinator.js`
- Settings page: `browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-bootstrap-section.js`
- Background service worker wiring: `browser-first/resonantos-side-panel-extension/src/background.js`
- Side panel / main workspace: `side-panel.js` / `main-workspace.js`
- CP-BR1 package (consumed): `browser-first/bootstrap/`
- Wire contract: [BRIDGE-BOOTSTRAP-PROTOCOL.md](BRIDGE-BOOTSTRAP-PROTOCOL.md)
- Installation: [BRIDGE-BOOTSTRAP-MACOS-RUNBOOK.md](BRIDGE-BOOTSTRAP-MACOS-RUNBOOK.md)
- Architecture decision: [ADR-047](ADR-047-core-bridge-bootstrap-runtime-lifecycle.md)
