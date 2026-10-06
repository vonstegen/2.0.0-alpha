# ResonantOS Bridge Bootstrap Protocol

> **Status:** Implemented at **CP-BR1**. Paired with
> [BRIDGE-BOOTSTRAP-MACOS-RUNBOOK.md](BRIDGE-BOOTSTRAP-MACOS-RUNBOOK.md)
> for installation and with [ADR-047](ADR-047-core-bridge-bootstrap-runtime-lifecycle.md)
> for the architectural decision. Extension startup integration is **CP-BR2**
> and is explicitly out of scope here.

## 1. Purpose

The Alpha bridge is a privileged local service. A stopped bridge cannot
serve an HTTP route that starts itself; that bootstrapping loop is owned
by a separately installed, narrowly scoped Chrome native-messaging host.
This document is the normative reference for the contract that host
implements.

The host is **reachable while the bridge HTTP server is offline** and is
the only Alpha runtime authority for `status`, `start`, `restart`, and
`stopForShutdown`. It is not a route authority and never sees bridge
credentials, capability tokens, prompt content, memory content, or any
provider value.

## 2. Package And Host Identity

| Item | Source |
| --- | --- |
| Native host name | `com.resonantos.bridge_bootstrap` |
| Manifest file | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.resonantos.bridge_bootstrap.json` (macOS) |
| Extension origin (allowed_origins) | `chrome-extension://cdpdmmalhmokbfcfgogoepnjplaakgnl/` |
| Bootstrap package | `browser-first/bootstrap/` |
| Pinned bridge entry | `browser-first/host/run-bridge-minimal.mjs` |
| Authoritative Alpha loopback endpoint | `http://127.0.0.1:47773` |

The native host name is reverse-DNS, lowercase, dots/underscores only,
matching Chrome's native host naming rules. The extension origin is
key-pinned (extension key in
`browser-first/resonantos-side-panel-extension/manifest.json`); the
manifest is regenerated from that key, not from the unpacked extension
ID alone.

## 3. Protocol Version

The host accepts exactly:

```jsonc
{ "protocol": "resonantos/bootstrap/v1", "requestId": "...", "operation": "..." }
```

`protocol` is a single fixed string. Any other value — `v2`, missing,
unrecognized, or non-string — is rejected with the closed failure code
`invalid-request`. This is the only protocol version the host
recognizes.

## 4. Request Envelope

```ts
type BootstrapRequest =
  | { protocol: "resonantos/bootstrap/v1"; requestId: string; operation: "status" }
  | { protocol: "resonantos/bootstrap/v1"; requestId: string; operation: "start" }
  | { protocol: "resonantos/bootstrap/v1"; requestId: string; operation: "restart" }
  | { protocol: "resonantos/bootstrap/v1"; requestId: string; operation: "stopForShutdown" };
```

Exact-shape rules (all enforced by
`bootstrap-protocol.mjs#validateBootstrapRequest`):

- `requestId` must be a non-empty string of length 1..128.
- `operation` must be exactly one of `status`, `start`, `restart`,
  `stopForShutdown`.
- The envelope MUST be a plain JSON object (not an array, not `null`).
- Unknown fields (including `command`, `argv`, `cwd`, `path`, `endpoint`,
  `env`, `token`, `secret`, `pid`, `bridgeConfig`, …) are rejected.
- Any violation returns the closed failure code `invalid-request`; the
  `requestId` is echoed only when the JSON parsed and the `requestId`
  itself is a string (see §8).

The envelope is the only path between the extension and the bootstrap
host. Nothing in the envelope ever selects an executable, script path,
argv, working directory, endpoint, environment key, or environment value.
All process inputs are host-pinned (`bootstrap/bridge-policy.mjs`).

## 5. Native-Message Framing

Chrome native-messaging frames:

```
[4-byte little-endian unsigned length][UTF-8 JSON payload]
```

- Inbound maximum message size: **256 KiB**. A declared length above the
  bound is unrecoverable: the host reports exactly one terminal frame
  error and exits with code `2`.
- Outbound maximum message size: **1 MiB**, matching Chrome's documented
  native-messaging limit. An outbound payload above the bound is dropped
  before any write; the host emits a `stdout-write-failed` /
  `oversized-outbound-frame` event to stderr.
- stdout carries framed protocol messages ONLY. The host neuters
  `console.log` / `console.info` / `console.warn` / `console.error` to a
  bounded stderr logger at startup.
- stderr carries one-line JSON events with closed-vocabulary fields
  (`event`, `operation`, `status`, `failureCode`, `code`, `generation`),
  truncated at 400 characters. The logger never receives request
  payloads, environment values, paths, PIDs, argv, exception messages,
  token-shaped strings, or arbitrary caller values.

## 6. Operations

The four operations are closed:

| Operation | Effect |
| --- | --- |
| `status` | Report the current lifecycle projection. May run a bounded probe to distinguish `connected` from `degraded` (owned bridge) and to detect an externally healthy bridge (`connected` without an instance id). |
| `start` | Idempotent: if an owned bridge is already `connected`/`degraded`, returns `alreadyRunning: true` and never spawns. If a foreign bridge is healthy, returns `alreadyRunning: true` and never spawns. Otherwise spawns a new generation, polls health bounded, and returns `connected` with a fresh `instanceId` and `startedAt`. |
| `restart` | Fences the current generation, stops only a host-owned bridge, refuses when a foreign healthy bridge occupies the endpoint, otherwise spawns a new generation. |
| `stopForShutdown` | Signals only the host-owned bridge with bounded `SIGTERM` → `SIGKILL` escalation. An externally discovered bridge is NEVER signalled. |

## 7. Response Envelope

Every well-framed request returns exactly one framed response:

```ts
type BootstrapResponse =
  | {
      protocol: "resonantos/bootstrap/v1";
      requestId: string | null;
      ok: true;
      result: PublicResult;
    }
  | {
      protocol: "resonantos/bootstrap/v1";
      requestId: string | null;
      ok: false;
      failureCode: PublicFailureCode;
      result: PublicResult; // projected, may still include `status`
    };

type PublicResult = {
  status: "offline" | "starting" | "connected" | "degraded" | "restarting" | "failed";
  version?: string | null;        // bridge version when known; null under auth-guard healthz
  endpoint?: string;              // host-pinned loopback URL
  instanceId?: string;            // owned-generation id; absent for an unowned bridge
  startedAt?: string;             // ISO timestamp; only for owned generations
  failureCode?: PublicFailureCode;
  alreadyRunning?: boolean;       // true for start's no-spawn paths
```

The result object is the single chokepoint through which every internal
lifecycle outcome passes before framing. It whitelist-copies only the
fields above and drops everything else (PID, process paths, argv,
environment, raw errors, private state) even if a lifecycle bug tried to
attach them. See `bootstrap-protocol.mjs#projectPublicResult`.

## 8. Status Vocabulary (Closed)

```
offline | starting | connected | degraded | restarting | failed
```

- `starting` — owned bridge is spawning and waiting for health.
- `connected` — owned bridge is alive and healthy, OR a foreign bridge
  answers the pinned endpoint with the ROS bridge auth-guard signature
  (401 with `{"ok":false,"error":"Unauthorized browser-first bridge request."}`)
  or `{ok:true}` JSON.
- `degraded` — owned bridge is alive but the bounded probe failed; the
  child has not been fenced. Recovery path: `restart`.
- `failed` — terminal failure on the most recent start/restart attempt;
  result carries a `failureCode`. Next `start` clears the latch.
- `restarting` — restart op is in flight.
- `offline` — nothing answers the pinned endpoint.

## 9. Public Failure Codes (Closed)

```
invalid-request   start-failed      health-timeout
restart-failed    stop-failed       version-mismatch
unexpected-exit   internal-error
```

| Code | Source |
| --- | --- |
| `invalid-request` | Envelope failure: unknown field, bad protocol version, bad operation, bad requestId, unparseable JSON. |
| `start-failed` | Spawn threw synchronously, owned child died while starting, or `start` returned without `connected`. |
| `health-timeout` | Spawned child did not become healthy within `timeouts.startHealthMs`. Bounded cleanup attempted. |
| `restart-failed` | Restart could not fence an owned bridge, or a foreign healthy bridge blocked the new generation. |
| `stop-failed` | `stopForShutdown` could not terminate the owned bridge within the bounded TERM+KILL budget. |
| `version-mismatch` | A probed bridge reported a `version` that differs from the host-pinned expected bridge version. The owned child is stopped, bounded. |
| `unexpected-exit` | The connected owned bridge exited without a `stopForShutdown` request. The lifecycle clears its ownership and reports `failed` until the next start. |
| `internal-error` | Defensive fallback for host bugs only; the lifecycle converts every expected failure to a closed code without throwing. |

The codes are the only values `result.failureCode` may carry. Unknown
strings from a hostile lifecycle are dropped by the public projection.

## 10. State Machine

```
          start                    health ok
offline ────────▶ starting ──────────────▶ connected ──── exit/error ──▶ failed
   ▲                  │                        │                            │
   │                  │ spawn error /          │ owned child has               │
   │                  │ exit /                 │ no health probe             │
   │                  │ timeout                ▼                            │
   │                  ▼                     degraded ◀── next status ──────┘
   │                failed (start-failed / health-timeout / version-mismatch)
   │
   │              stopForShutdown
   └──────────────────────────────────────────▶ offline
   │                                                        │
   │              restart fences                             │
   └─────────── restarting ──── fence ──── start new gen ───┘
```

Internal states are projected onto the public vocabulary through the
projection chokepoint; intermediate states are never surfaced as their
own public status.

## 11. Generation Fencing And Ownership

Every owned `start` and `restart` allocates a monotonically increasing
generation and a fresh non-secret `instanceId` (random hex). Child event
handlers and health-wait continuations apply their outcome ONLY while
their record is still `state.owned`. Late exits, errors, and probe
results from an older generation are ignored.

`stopForShutdown` never signals a process this host did not spawn. A
healthy bridge discovered on the pinned endpoint that this host did not
spawn:

- is reported as `alreadyRunning: true` with no `instanceId` / `startedAt`;
- blocks `restart` because no new owned generation could bind the pinned
  port behind it;
- is left completely untouched by `stopForShutdown`.

The host never reads `browser-first/resonantos-side-panel-extension/src/bridge-config.generated.js`,
its contents, or the bridge's generated tokens. The bridge mints its
own tokens on startup.

Ownership is in-process: a new host process (Chrome launched a fresh one
on a later `connectNative`) treats a surviving bridge as foreign.
Extension-side credential adoption (CP-BR2) must use an authenticated,
private operation; it MUST NOT leak tokens into public status.

## 12. Process Inputs (Host-Pinned, No Caller Path)

| Input | Value | Source |
| --- | --- | --- |
| Node executable | Installer-pinned absolute path (default: `process.execPath` of the host) | `install-macos.mjs`, `bridge-policy.mjs#createBridgePolicy` |
| Bridge entry | `browser-first/host/run-bridge-minimal.mjs` | `bridge-policy.mjs#bridgeEntryPath` |
| argv | `[entry, "--bridge-port=47773"]` | `bridge-policy.mjs#BRIDGE_ARGV` |
| Working directory | Repository root | `bridge-policy.mjs#repoRootPath` |
| Endpoint | `http://127.0.0.1:47773` | `bridge-policy.mjs#BRIDGE_ENDPOINT` |
| Spawn options | `detached: true, stdio: "ignore", shell: false, env: <allowlist>` | `bootstrap-lifecycle.mjs#spawnAndWaitGeneration` |
| Expected bridge version | `null` (override by package policy) | `bridge-policy.mjs#createBridgePolicy` |

The bridge child is launched as:

```
<pinned node> <pinned run-bridge-minimal.mjs> --bridge-port=47773
```

There is no caller path that can change any of these.

### 12.1 Child Environment Allowlist

The bridge child receives exactly four environment variables; `process.env`
is never spread:

```
RESONANT_TERMINAL_HOST_BRIDGE=1   enables the reviewed terminal-host bridge service
HOME                              Node/OS-resolved user directory
TMPDIR                              OS-resolved temp directory
PATH                                /opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
```

`PATH` is host-pinned (the same path the repository's documented Alpha
toolchain uses) so the bridge's reviewed `firstExecutable` lookups
(openssl for TLS material, optional local runtimes) are deterministic
instead of inheriting an arbitrary browser or native-host environment.

Provider credentials, capability tokens, generated bridge tokens,
prompt/memory content, and operator environment overrides are
deliberately not forwarded. Provider credentials come from **Settings >
Providers** in the running bridge, not from the bootstrap env. The
bridge also mints its own tokens on startup; this host never reads or
forwards them.

## 13. Bounded Waits

| Wait | Bound |
| --- | --- |
| Initial pre-spawn probe | `timeouts.probeMs` (1500 ms) |
| Health-wait poll | `timeouts.startHealthMs` (10 s), polled every `timeouts.healthPollMs` (250 ms) |
| Restart stop wait | `timeouts.stopMs` (5 s) then `timeouts.killEscalationMs` (2 s) |
| `stopForShutdown` | `timeouts.stopMs` (5 s) then `timeouts.killEscalationMs` (2 s) |
| `status` probe | `timeouts.probeMs` (1500 ms) |

No infinite polling, recursive restart loops, or background timers.
Transitions are driven by requests and child events only.

## 15. References

- [ADR-047: Core Bridge Bootstrap And Add-on Runtime Lifecycle](ADR-047-core-bridge-bootstrap-runtime-lifecycle.md)
- [Add-on Bridge Runtime Roadmap — CP-BR1](ADDON-BRIDGE-RUNTIME-ROADMAP.md)
- [Alpha Runtime Boundary](ALPHA_RUNTIME_BOUNDARY.md)
- [Module Ownership](MODULE-OWNERSHIP.md)
- [Bridge Bootstrap macOS Runbook](BRIDGE-BOOTSTRAP-MACOS-RUNBOOK.md)