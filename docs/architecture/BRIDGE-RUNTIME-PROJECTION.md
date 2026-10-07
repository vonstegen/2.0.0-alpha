# Bridge, Runtime, Connector, And Session Projection (CP-BR5)

> Status: **CP-BR5 (Complete on `r-and-d/terminal-host-current-dev`)**.
> Source of truth:
> [`browser-first/host/runtime-projection.mjs`](../../browser-first/host/runtime-projection.mjs),
> [`browser-first/host/runtime-projection-service.mjs`](../../browser-first/host/runtime-projection-service.mjs),
> [`browser-first/host/bridge-runtimes-host-service.mjs`](../../browser-first/host/bridge-runtimes-host-service.mjs).
> Decision history: [ADR-047](ADR-047-core-bridge-bootstrap-runtime-lifecycle.md),
> [SDK Runtime Lifecycle Contract (CP-BR3)](SDK-RUNTIME-LIFECYCLE-CONTRACT.md),
> [Runtime Factory Registry And Reconciler (CP-BR4)](RUNTIME-FACTORY-REGISTRY-AND-RECONCILER.md),
> [Bridge Bootstrap Protocol (CP-BR1)](BRIDGE-BOOTSTRAP-PROTOCOL.md),
> [Bridge Bootstrap ROS Startup, Shutdown, And Recovery (CP-BR2)](BRIDGE-BOOTSTRAP-ROS-STARTUP.md),
> [Module Ownership](MODULE-OWNERSHIP.md).

CP-BR5 adds the **public, non-secret projection** that the future
Bridge & Runtimes UI (CP-BR6) consumes. It carries four shapes:

- `bridgeOverview` — the core bridge status snapshot (CP-BR1/CP-BR2);
- `runtimeList` — the per-add-on add-on runtime snapshot (CP-BR3/CP-BR4);
- `connectorList` — the per-connector public view;
- `activeSessions` — public session counts and public identifiers.

The projection is the **data contract**; the UI is CP-BR6. The UI is
never rebuilt from bridge route replies; it consumes the projection.

This document covers:

1. [Public surface](#1-public-surface)
2. [The four shapes](#2-the-four-shapes)
3. [Failure-code catalog](#3-failure-code-catalog)
4. [Privacy and redaction contract](#4-privacy-and-redaction-contract)
5. [Update mechanism](#5-update-mechanism)
6. [Ordering and staleness](#6-ordering-and-staleness)
7. [Purity rules](#7-purity-rules)
8. [Test evidence](#8-test-evidence)
9. [What CP-BR5 deliberately does NOT do](#9-what-cp-br5-deliberately-does-not-do)
10. [References](#10-references)

---

## 1. Public surface

CP-BR5 ships three host modules and one host route.

| Module                                                | Role                                                                                                                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser-first/host/runtime-projection.mjs`           | Pure non-secret projection. Defines the closed shapes, the `walkShape` walker, the `redactLogValue` helper, the failure-code catalog, and the `applyProjectionUpdate` ordering helper. No I/O.                       |
| `browser-first/host/runtime-projection-service.mjs`   | Host-side composition. Derives runtime / connector / session entries from the host registry + the (optional) CP-BR4 reconciler `listActive()`, advances the projection generation, and notifies the push subscriber. |
| `browser-first/host/bridge-runtimes-host-service.mjs` | Thin host route. Attaches `GET /bridge/runtimes` to the route table; the handler returns the current projection. Exposes `logProjection()` for redacted log lines.                                                   |

The route is registered in the bridge composition root
(`browser-first/host/run-bridge-minimal.mjs`) with the standard harness
route attributes:

```text
method:               GET
path:                 /bridge/runtimes
requiredCapability:   addon-runtime-read
loopbackHostOnly:     true
errorFamily:          harness
```

The route is capability-gated and loopback-only. The `addon-runtime-read`
capability is the existing harness capability; the projection does not
introduce a new capability tier.

The handler never accepts caller input. It returns the cached projection
and does not log raw fields. The only public mutator is
`runtimeProjection.refresh()` (called by reconciler events) and
`runtimeProjection.recordEvent(event)` (the CP-BR4 event sink).

---

## 2. The four shapes

### 2.1 `bridgeOverview`

```ts
interface BridgeOverview {
  status: "offline" | "starting" | "connected" | "degraded" | "restarting" | "failed";
  version?: string; // bounded: <= 64 chars
  endpoint?: string; // bounded: <= 256 chars (loopback)
  publicEndpoint?: string; // bounded: <= 256 chars (LAN/Tailscale public URL)
  startedAt?: string; // ISO 8601 with milliseconds
  uptimeSeconds?: number; // non-negative safe integer
  generation?: number; // non-negative safe integer
  instanceId?: string; // bounded: <= 128 chars
  bootEpoch?: string; // bounded: <= 128 chars
  publicFailureCode?: string; // closed failure code (see §3)
}
```

When `status` is `offline` the projection records
`publicFailureCode: "projection-bridge-offline"`. When `status` is
`failed` it records `publicFailureCode: "projection-bridge-failed"`.
Any other status is the bridge's own public state without an additional
projection-side code.

### 2.2 `runtimeList` (ordered)

```ts
interface RuntimeListEntry {
  addonId: string; // bounded: <= 128 chars
  runtimeId: string; // bounded: <= 128 chars
  runtimeType:
    "ui-module" | "embedded-module" | "local-service" | "agent-addon" | "channel-addon" | "unknown";
  status: "inactive" | "starting" | "ready" | "degraded" | "failed" | "stopping";
  generation: number; // non-negative safe integer
  activeSessionCount: number; // non-negative safe integer
  startedAt?: string; // ISO 8601 timestamp
  lastTransitionAt?: string; // ISO 8601 timestamp
  publicFailureCode?: string; // only on `failed` or `degraded`
  factoryId?: string; // public factory id; no process internals
  classification?: string; // category; never authority
  displayLabel: string; // public display label derived from addonId
}
```

Unknown `runtimeType` values are coerced to `"unknown"` for the
canonical bucket but the public `addonId` / `runtimeId` / `displayLabel`
remain readable. The list is sorted by `addonId` so the order is stable
across re-reads.

### 2.3 `connectorList` (ordered)

```ts
interface ConnectorListEntry {
  addonId: string; // bounded: <= 128 chars
  label: string; // public label; <= 128 chars
  runtimeType:
    "ui-module" | "embedded-module" | "local-service" | "agent-addon" | "channel-addon" | "unknown";
  connectionState:
    "installed" | "enabled" | "disabled" | "not-installed" | "incompatible" | "revoked";
  authorizationState: "granted" | "partial" | "missing" | "revoked" | "not-applicable";
  lastSuccessfulHealthAt?: string; // ISO 8601 timestamp
  publicFailureCode?: string; // closed failure code
  supportedRuntimeTypes: string[]; // frozen, public identifiers only
}
```

A connector is any installation whose `classification.category === "connector"`
OR whose `runtimeType === "channel-addon"`. The list is sorted by
`addonId`.

### 2.4 `activeSessions` (ordered)

```ts
interface ActiveSessionEntry {
  addonId: string; // bounded: <= 128 chars
  runtimeId: string; // bounded: <= 128 chars
  activeSessionCount: number; // non-negative safe integer
}
```

Only add-ons with `activeSessionCount > 0` are included. Private
session data (prompt content, memory content, raw payload, tokens,
credentials) is never accepted by the projection.

### 2.5 Top-level envelope

```ts
interface BridgeRuntimesProjection {
  bridgeOverview: BridgeOverview;
  runtimeList: readonly RuntimeListEntry[];
  connectorList: readonly ConnectorListEntry[];
  activeSessions: readonly ActiveSessionEntry[];
  projectionGeneration: number; // monotonic, host-supplied
  producedAt: string; // ISO 8601 timestamp
  updateMechanism: "polling" | "push" | "both";
}
```

The envelope is `Object.freeze`-d. Every nested object is also frozen.
Consumers MUST treat the result as immutable; the route returns the
cached frozen object by reference.

---

## 3. Failure-code catalog

The projection re-uses the CP-BR3/CP-BR4 closed public failure code
vocabulary and adds seven projection-specific codes. The full closed
set is exported as `PROJECTION_FAILURE_CODES` from
`runtime-projection.mjs`.

| Code                                 | Source        | Meaning                                                                   |
| ------------------------------------ | ------------- | ------------------------------------------------------------------------- |
| `addon-not-installed`                | CP-BR3        | Authority projection reports `installed: false`.                          |
| `addon-disabled`                     | CP-BR3        | Authority projection reports `enabled: false`.                            |
| `addon-authorization-required`       | CP-BR3        | Required capability not granted.                                          |
| `addon-incompatible`                 | CP-BR3        | `compatible: false` against the current shell.                            |
| `addon-factory-missing`              | CP-BR3/CP-BR4 | No reviewed runtime factory is available.                                 |
| `addon-revoked`                      | CP-BR3        | Hard-stop revocation fence is active.                                     |
| `addon-degraded-by-policy`           | CP-BR3        | Degrade revocation policy is in effect.                                   |
| `addon-runtime-type-unknown`         | CP-BR3        | `runtimeType` is missing or not in the known vocabulary.                  |
| `addon-authority-input-invalid`      | CP-BR3        | Authority projection shape is malformed or forged.                        |
| `addon-manifest-invalid`             | CP-BR3        | Top-level input shape is malformed.                                       |
| `projection-bridge-offline`          | CP-BR5        | Bridge status is `offline`; carry the offline code in the projection.     |
| `projection-bridge-failed`           | CP-BR5        | Bridge status is `failed`; carry the failure code in the projection.      |
| `projection-shape-invalid`           | CP-BR5        | Forged or malformed projection input; the projection refuses to assemble. |
| `projection-stale-superseded`        | CP-BR5        | `applyProjectionUpdate` rejected an older or equal generation.            |
| `projection-connector-state-unknown` | CP-BR5        | Connector state is outside the closed vocabulary.                         |
| `projection-session-count-invalid`   | CP-BR5        | Session count is not a non-negative safe integer.                         |
| `projection-runtime-type-unknown`    | CP-BR5        | Runtime type is not a non-empty string.                                   |
| `projection-input-missing`           | CP-BR5        | A required input was missing or malformed.                                |

The runtime projection only surfaces the `addon-*` codes on
`runtimeList` entries that are `failed` or `degraded`. The
`projection-*` codes are surfaced either in the bridge overview
(`projection-bridge-offline` / `projection-bridge-failed`) or as
`ProjectionShapeError.publicFailureCode` on rejected input
(`projection-shape-invalid` / `projection-stale-superseded` / etc.).

---

## 4. Privacy and redaction contract

The projection is the only contract that crosses the boundary between
the host (which holds tokens, credentials, raw env, process internals)
and the UI (which renders, but never receives secrets). The contract is
fail-closed: any input that would leak is refused before the public
object is built.

### 4.1 What is NEVER in the projection

| Class                                                | Reason                              |
| ---------------------------------------------------- | ----------------------------------- |
| Capability or bootstrap tokens                       | Bridge authentication.              |
| Provider credentials, provider API keys              | Provider boundaries.                |
| Prompt content, memory content                       | Living Archive / memory boundaries. |
| Raw environment values                               | Process boundary.                   |
| Auth-file path or token-file path                    | Process boundary.                   |
| Child argv, cwd, executable path, env allowlist keys | Process boundary.                   |
| PID, process handle, factory process internals       | Process boundary.                   |
| Unredacted exception messages, stack traces          | Diagnostic boundary.                |
| Private filesystem paths, user home path             | Filesystem boundary.                |
| Wallet signing material                              | Wallet boundaries.                  |
| `bridgeToken` header value, scoped capability tokens | Auth boundary.                      |

The list is enforced by the shape-walker: every projection is walked
recursively, and every key is checked against the closed set of allowed
keys. Forbidden keys are dropped before the public object is built.

### 4.2 Redaction of log lines and rejection serialization

The `redactLogValue(value)` helper produces a deep copy of a payload
with every forbidden key replaced by the literal string
`"[REDACTED]"`. The bridge-runtimes host service exposes a
`logProjection()` method that returns the redacted form of the current
projection. Any structured log line or rejection that needs to carry
the projection MUST go through this helper.

The closed set of forbidden keys is:

```text
token, accessToken, bearer, password, secret, privateKey,
credential, authFile, tokenFile, argv, pid, childArgv,
memory, prompt, promptContent, memoryContent, privatePath,
rawError, stack, home, userPath
```

### 4.3 Whitelisting

Every projection input is whitelisted at every level:

- the bridge overview accepts only the closed field set;
- the runtime list accepts only the closed field set per entry;
- the connector list accepts only the closed field set per entry;
- the active-session summary accepts only `addonId`, `runtimeId`, `activeSessionCount`;
- the top-level envelope accepts only the closed field set.

Any field not on the closed list is dropped before the public object
is built. This is the core non-leak guard: a hostile host registry
projection that smuggles a `token` field into an installation cannot
reach the UI through the projection.

### 4.4 Failure code is always a closed code

Every `publicFailureCode` field on the public projection is one of the
18 codes in §3. Forged or unknown codes are rejected by the projection
(`projection-shape-invalid`).

---

## 5. Update mechanism

The projection supports two update mechanisms:

- **polling** — the route `GET /bridge/runtimes` returns the current
  projection. The CP-BR6 UI can poll at a bounded interval (CP-BR6
  will define the interval; the route itself does not force a refresh).
- **push** — the `runtimeProjection.onUpdate` subscriber is invoked
  whenever `refresh()` is called. The CP-BR4 reconciler's `emit` is
  the production wiring; the subscriber receives the new projection
  after the host recomputes.

The projection's `updateMechanism` field is set to `"both"` for the
host composition root, so the UI can subscribe either way without
having to inspect a separate configuration field.

`refresh()` is the only mutator. It is called by:

- the host composition root at startup, when the bridge listener is up;
- the CP-BR4 reconciler's `emit` callback (every transition);
- the host route, lazily on the first read.

There is no other public mutator. The route handler does not refresh;
it returns the cached projection.

---

## 6. Ordering and staleness

Every projection carries a monotonic `projectionGeneration` that the
host advances on every `refresh()`. The pure helper
`applyProjectionUpdate(current, incoming)` enforces the rule: a
projection with a generation less than or equal to the current is
**rejected** with a `ProjectionShapeError` carrying
`publicFailureCode: "projection-stale-superseded"`.

Stale projections never overwrite newer ones. The route returns the
cached projection by reference; the host composition root can compare
incoming and current by `===` to detect a no-op or a real change.

The generation is a non-negative safe integer. It is supplied by the
host, never by the client.

---

## 7. Purity rules

The projection module is the first host module after the CP-BR3
resolver to assert a strict purity contract. The rules are:

1. **No I/O.** The projection module does not import `node:fs`,
   `node:fs/promises`, `node:child_process`, `node:net`, `node:http`,
   `node:https`, or any HTTP/IPC transport. The service module may
   import the projection module but no other I/O module.
2. **No wall clock by default.** The projection module never calls
   `Date.now()` or `performance.now()`. The service module accepts an
   injectable `now` function and defaults to a fresh ISO timestamp.
3. **No async.** The projection module is fully synchronous; the
   service module is fully synchronous. The route handler returns the
   cached projection without awaiting anything.
4. **No manifest authority.** The projection never reads a manifest
   `service.entrypoint`, a runtime spawn policy, or a factory
   executable path. It only consumes the host registry projection
   (installations, granted capabilities, required capabilities,
   revocation) and the CP-BR4 reconciler's `listActive()`.
5. **Fail closed.** Every malformed input produces a typed
   `ProjectionShapeError` with one of the closed failure codes; the
   projection is never partially populated.
6. **Object.freeze.** Every public object is frozen. Consumers treat
   the projection as immutable.

The purity contract is enforced by a static-source check
(`runtime-projection-no-io.test.mjs`).

---

## 8. Test evidence

The CP-BR5 test suite is 40 tests in 4 files:

| File                                       | Tests | Coverage                                                                                                     |
| ------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------ |
| `runtime-projection.test.mjs`              | 24    | Req #1–#10, #12, #13 (vocabularies, four shapes, ordering, shape-walker, redaction, fail-closed, host route) |
| `runtime-projection-staleness.test.mjs`    | 6     | Req #6 (applyProjectionUpdate), req #7 (ordering and stale rejection through the host route)                 |
| `runtime-projection-shape-walker.test.mjs` | 8     | Req #8 (shape-walker contract) + hostile-input shape-walker coverage                                         |
| `runtime-projection-no-io.test.mjs`        | 6     | Req #11 (purity: no I/O, no timers, no wall clock)                                                           |

Run:

```sh
node --experimental-strip-types --test \
  browser-first/test/runtime-projection.test.mjs \
  browser-first/test/runtime-projection-staleness.test.mjs \
  browser-first/test/runtime-projection-shape-walker.test.mjs \
  browser-first/test/runtime-projection-no-io.test.mjs
```

Existing CP-BR1/CP-BR2/CP-BR3/CP-BR4 tests remain green (full
regression is the verification step).

---

## 9. What CP-BR5 deliberately does NOT do

- **No UI.** The Bridge & Runtimes UI is CP-BR6. CP-BR5 ships the
  data contract and the host route; the UI consumes them later.
- **No actions.** Enable, disable, retry, restart, and stop actions
  are CP-BR6 (UI) and CP-BR7 (terminal add-ons on the generic
  lifecycle). The CP-BR5 route is read-only.
- **No capability minting.** The route requires the existing
  `addon-runtime-read` capability; the projection does not introduce a
  new capability tier.
- **No event-stream endpoint.** The `push` mechanism is exposed as the
  `runtimeProjection.onUpdate` subscriber; the public route is the
  GET. A future SSE route for the projection is CP-BR6 territory.
- **No session content.** Private session data (prompt, memory, raw
  payload, tokens) is never accepted by the projection; only public
  identifiers and counts.
- **No classification authority.** The projection surfaces
  `classification` for display; the resolver and the route do not
  branch on it.

---

## 10. References

- [ROS Bridge + SDK Add-on Runtime Lifecycle Roadmap](ADDON-BRIDGE-RUNTIME-ROADMAP.md)
- [ADR-047: Core Bridge Bootstrap And Add-on Runtime Lifecycle](ADR-047-core-bridge-bootstrap-runtime-lifecycle.md)
- [SDK Add-on Runtime Lifecycle Contract (CP-BR3)](SDK-RUNTIME-LIFECYCLE-CONTRACT.md)
- [Runtime Factory Registry And Reconciler (CP-BR4)](RUNTIME-FACTORY-REGISTRY-AND-RECONCILER.md)
- [Bridge Bootstrap Protocol (CP-BR1)](BRIDGE-BOOTSTRAP-PROTOCOL.md)
- [Bridge Bootstrap ROS Startup, Shutdown, And Recovery (CP-BR2)](BRIDGE-BOOTSTRAP-ROS-STARTUP.md)
- [Module Ownership](MODULE-OWNERSHIP.md)
- [Alpha Runtime Boundary](ALPHA_RUNTIME_BOUNDARY.md)
