# Runtime Factory Registry And Reconciler (CP-BR4)

> Status: **CP-BR4 (Complete on `r-and-d/terminal-host-current-dev`)**.
> Source of truth:
> [`browser-first/host/runtime-factory-registry.mjs`](../../browser-first/host/runtime-factory-registry.mjs),
> [`browser-first/host/runtime-reconciler.mjs`](../../browser-first/host/runtime-reconciler.mjs),
> [`browser-first/host/runtime-lifecycle-host.mjs`](../../browser-first/host/runtime-lifecycle-host.mjs).
> Decision history: [ADR-047](ADR-047-core-bridge-bootstrap-runtime-lifecycle.md),
> [SDK Runtime Lifecycle Contract (CP-BR3)](SDK-RUNTIME-LIFECYCLE-CONTRACT.md).

CP-BR4 is the **act** side of the decide→act seam. CP-BR3 added the pure
`deriveDesiredRuntimeState()` resolver; CP-BR4 translates its decisions
into bounded, generation-fenced, per-add-on start / stop / degrade
actions through a **reviewed runtime factory registry** and an
**idempotent `reconcile(snapshot)`**. No process is started by the
registry directly; every start comes from a host-coded factory function
with a pinned spawn policy.

This document covers:

1. [Architecture](#1-architecture)
2. [Factory contract](#2-factory-contract)
3. [Factory registration guide](#3-factory-registration-guide)
4. [Reconciler flow](#4-reconciler-flow)
5. [Generation fencing and stale-completion rejection](#5-generation-fencing-and-stale-completion-rejection)
6. [Bounded waits and failure semantics](#6-bounded-waits-and-failure-semantics)
7. [Restore after bridge restart](#7-restore-after-bridge-restart)
8. [Session cleanup on stop — XH4/XH5 invariant](#8-session-cleanup-on-stop-xh4xh5-invariant)
9. [Non-secret lifecycle events](#9-non-secret-lifecycle-events)
10. [CP-BR3 grant-completeness fix](#10-cp-br3-grant-completeness-fix)
11. [Ownership contract](#11-ownership-contract)
12. [What CP-BR4 deliberately does NOT do](#12-what-cp-br4-deliberately-does-not-do)
13. [Test evidence](#13-test-evidence)

---

## 1. Architecture

Three host modules, plus the CP-BR3 pure resolver (a Node-side import
of the SDK package).

| Module                                         | Role                                              | Inputs                                          | Outputs                                         |
| ---------------------------------------------- | ------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| `runtime-factory-registry.mjs`                | Reviewed factory registry + seeders               | `(factory)` registration                        | `get` / `findForRuntimeType` / `list` lookups   |
| `runtime-reconciler.mjs`                       | Idempotent, generation-fenced `reconcile`         | host projection snapshot + registry + event sink | `transitioned` / `noop` outcome, lifecycle events |
| `runtime-lifecycle-host.mjs`                   | Composition root                                  | host registry facade + optional registry/observers | wired `{ factoryRegistry, observers, reconciler }` |

The registry is a **passive** lookup. The reconciler is the **active**
component: it consumes the host projection, calls the CP-BR3 resolver
per add-on, looks up a factory, and runs bounded lifecycle work.

The composer (`runtime-lifecycle-host.mjs`) is the only entry point the
bridge composition root should call. It is a thin glue layer: it
constructs a registry (or accepts one), seeds the registry with the
reviewed CP-BR4 fixtures, and wires the reconciler to the host
registry facade.

---

## 2. Factory contract

```ts
interface RuntimeFactory {
  spawnPolicy: {
    factoryId: string;                         // reviewed, unique, lowercase reverse-DNS
    supportedRuntimeTypes: readonly string[];  // ["ui-module" | "embedded-module" | "local-service" | "agent-addon" | "channel-addon"]
    spawnSummary: string;                       // public, single-line description
  };
  start(ctx: { addonId, bootEpoch, generation, now, signal }): Promise<RuntimeFactoryHandle>;
  stop(handle, ctx: { addonId, now, timeoutMs }): Promise<void>;
  health(handle, ctx: { addonId, now, timeoutMs }): Promise<{ ok: boolean, publicDetail?: string }>;
  degrade(handle, ctx: { addonId, publicReason, now }): Promise<RuntimeFactoryHandle>;
  closeSessions(handle, ctx: { addonId, now }): Promise<void>;
}
```

The reconciler never inspects `handle`. The factory owns the
process boundary; the reconciler only orders work and fences generations.

The factory is registered with `factoryRegistry.register(factory)`.
Registration validates:

- `factoryId` is a non-empty lowercase reverse-DNS string.
- `supportedRuntimeTypes` is a non-empty list of known `runtimeType` values.
- `spawnSummary` is a non-empty string.
- `start` / `stop` / `health` / `degrade` / `closeSessions` are all functions.

The registry refuses an unknown / unregistered `factoryId` at lookup
time. The public projection of a registered factory carries only
`factoryId`, `supportedRuntimeTypes`, and `spawnSummary` — never the
executable path, argv, cwd, env keys, or endpoint.

---

## 3. Factory registration guide

To add a new reviewed factory:

1. **Write the factory function in a host module** under
   `browser-first/host/`. The factory must:
   - Pin the executable, argv, cwd, and env allowlist at the top of
     the file (mirroring the `bridge-policy.mjs` pattern).
   - Refuse arbitrary input from the caller; the only context the
     factory receives is `{ addonId, bootEpoch, generation, now,
     signal }` (for `start`) and `{ addonId, now, timeoutMs }` (for
     the rest).
   - Bound all internal waits and surface a public failure code on
     timeout. Never throw a raw stack trace.

2. **Register the factory** in the bridge composition root or in a
   dedicated seed file:
   ```js
   import { createRuntimeFactoryRegistry } from "./runtime-factory-registry.mjs";
   const registry = createRuntimeFactoryRegistry();
   registry.register({
     spawnPolicy: {
       factoryId: "com.resonantos.factory.my-runtime",
       supportedRuntimeTypes: ["local-service"],
       spawnSummary: "Reviewed local-service factory for the my-runtime (one-line public description).",
     },
     start: async (ctx) => { /* ... */ },
     stop: async (handle, ctx) => { /* ... */ },
     health: async (handle, ctx) => { /* ... */ },
     degrade: async (handle, ctx) => { /* ... */ },
     closeSessions: async (handle, ctx) => { /* ... */ },
   });
   ```

3. **Wire the composer's host registry facade** to your host's
   authority projection. The host projection is the source of truth;
   the reconciler never reads manifest `service.entrypoint`.

4. **Test** the factory with a fake observer and a `reconcile()`
   cycle. The CP-BR4 test suite (`browser-first/test/runtime-reconciler.test.mjs`)
   shows the pattern.

**What a factory must NEVER do:**

- Read a manifest `service.entrypoint` as shell text.
- Accept a caller-supplied command, argv, path, cwd, env, or endpoint.
- Hold state that survives a bridge restart (the host registry is
  the only durable source of authority).
- Emit a PID, path, argv, env, token, credential, prompt, or memory
  content in any lifecycle event.

---

## 4. Reconciler flow

`reconcile(snapshot)` is the single entry point. It:

1. Reads the host projection (the host's `snapshot()` is the source
   of truth; the reconciler never trusts UI state).
2. For each add-on in the projection:
   - Computes the CP-BR3 authority projection from the host
     projection's installed / enabled / granted / required /
     compatible / revocation fields.
   - Calls `deriveDesiredRuntimeState()` to obtain the public
     decision.
   - Resolves a factory: the host projection's `factoryId` wins;
     otherwise the first registered factory for the add-on's
     `runtimeType` is picked. Unknown `factoryId` is a closed
     failure.
   - Serializes the transition through the per-add-on chain.
3. Returns `{ transitioned, noop, bootEpoch }`. The caller can use
   the lists to update UI state and to know which add-ons were
   processed.

The `transitioned` list carries a `publicFailureCode` when the
transition is `factory-missing` or `start-failed-*`; the `noop` list
carries add-ons that were already on the desired state for the
current generation.

---

## 5. Generation fencing and stale-completion rejection

Every reconcile call carries a `bootEpoch` (the bridge's identity) and
a per-add-on `projectionGeneration` (the host projection's
monotonically-increasing counter for the add-on's slot). The
reconciler:

- Records the `(bootEpoch, projectionGeneration)` pair against the
  active state for each add-on.
- Refuses to overwrite a newer generation's state with a stale
  completion: if a previous reconcile was in flight for an older
  generation, the new reconcile returns `{ transition: "stale" }`
  without touching the owned process.
- On generation replacement (the add-on's slot moved to a new owner
  factory, or the bootEpoch changed), the previous runtime is
  stopped deterministically before the new one is started.

`bootEpoch` and `projectionGeneration` are supplied by the host
projection, not invented by the reconciler. The harness registry
already provides this identity (`harness-registry.mjs:62-94`).

---

## 6. Bounded waits and failure semantics

All waits are bounded:

- `start` wait: configurable via `timeouts.startTimeoutMs` (default 5 s).
- `stop` wait: configurable via `timeouts.stopTimeoutMs` (default 5 s).
- `health` wait: configurable via `timeouts.healthTimeoutMs` (default 1.5 s).
- `restart` stop wait: `timeouts.stopTimeoutMs + 250 ms` grace for the
  wrapper to settle the timer.

On `start` timeout:

1. The reconciler emits `start_failed` with the public failure code
   `addon-factory-missing` (the best public code for an unresolvable
   start).
2. The active state is cleared.
3. The next reconcile that still desires `running` will try again
   (the host can act on the public failure code or the lifecycle
   events to back off).

On `health` failure:

1. The reconciler attempts a bounded stop on the owned child and
   closes its sessions.
2. The active state is cleared.
3. `start_failed` is emitted.

On `stop` failure:

1. The reconciler emits `stop_failed` with the underlying error
   message. The error does NOT propagate to the caller's `reconcile()`
   promise; the per-add-on chain records the error via the event
   sink.

There is no restart loop and no unbounded queue. The reconciler
serializes per add-on, but each add-on's chain is fully awaited
inside the current `reconcile()` call before the next reconcile
starts.

---

## 7. Restore after bridge restart

The reconciler does not persist process identity across a bridge
restart. The host projection's new `bootEpoch` is the source of
identity. When the bridge restarts:

1. The bridge composition root instantiates a new `reconciler`.
2. The first `reconcile(projection)` call reads the new projection
   and re-derives desired state from scratch.
3. Every add-on that is `installed + enabled + granted + compatible
   + factoryAvailable + no revocation` is started by the
   corresponding factory.
4. Add-ons that were not `running` before the restart are not
   started; add-ons that were `running` are re-started (the factory
   is the only producer of new processes).

The CP-BR4 test suite proves this with a simulated bridge restart
(`req #11`): two `reconcile()` calls with different `bootEpoch`
values produce two distinct `start` calls on the same factory, and
the active state is rebuilt from the new projection.

---

## 8 Session cleanup on stop (XH4/XH5 invariant)

Every `stop` call is followed by a `closeSessions` call. The factory
owns the session cleanup; the reconciler never inspects sessions.
This preserves the XH4/XH5 invariant: a stopped runtime must not
leave orphaned sessions behind.

Generation replacement and `stopped` desired state both go through
this `stop` + `closeSessions` pair. The `degrade` path does not
close sessions (the runtime is still partially active).

---

## 9. Non-secret lifecycle events

Every event emitted by the reconciler carries public identifiers only:

```ts
{
  type: "start_requested" | "ready" | "stop_requested" | "stopped" |
        "degrade_requested" | "degraded" | "factory_missing" |
        "start_failed" | "stop_failed" | "start-failed-health",
  addonId: string,
  factoryId: string | null,
  generation: number,
  publicFailureCode?: string,   // closed vocabulary
  publicReason?: string,        // generic, no secrets
  at: number,                   // milliseconds since epoch
}
```

No PID, path, argv, env, token, credential, prompt, or memory
content. The shape-walker in
[`browser-first/test/runtime-reconciler.test.mjs`](../../browser-first/test/runtime-reconciler.test.mjs)
(`req #12`) recursively walks every event and asserts no token-,
credential-, path-, PID-, or env-shaped value is reachable.

---

## 10. CP-BR3 grant-completeness fix

The CP-BR3 resolver treated any non-empty `grantedCapabilities` set
as authorized. CP-BR4 closes the gap: when the projection supplies a
`requiredCapabilities` set, the resolver requires
`required.every(cap => granted.has(cap))`. Partial coverage fails
closed with `addon-authorization-required`.

When `requiredCapabilities` is omitted (older CP-BR3 callers), the
resolver falls back to the legacy non-empty `grantedCapabilities`
check. This preserves CP-BR3 behavior for callers that have not yet
been migrated.

The fix is in [`packages/addon-sdk/src/runtime-lifecycle.ts`](../../packages/addon-sdk/src/runtime-lifecycle.ts)
and is covered by six new tests in
[`packages/addon-sdk/test/runtime-lifecycle.test.mjs`](../../packages/addon-sdk/test/runtime-lifecycle.test.mjs):

- Full coverage with `requiredCapabilities` → `running`.
- Partial coverage (subset of required caps) → `stopped` /
  `addon-authorization-required`.
- Legacy callers (no `requiredCapabilities`) → legacy non-empty check.
- Forged `requiredCapabilities` (non-`Set`) → `addon-authority-input-invalid`.
- Non-string entries in `requiredCapabilities` → `addon-authority-input-invalid`.
- Resolver does not mutate the caller's `requiredCapabilities` Set.

---

## 11. Ownership contract

| Owner                                     | Owns                                                              | Does NOT own                                                 |
| ----------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| `runtime-factory-registry.mjs`            | Factory lookup, registration validation, replace seam             | Spawn policy of any individual factory; lifecycle state      |
| `runtime-reconciler.mjs`                  | Per-add-on ordering, generation fencing, bounded waits, events    | Factory internals; UI state; provider credentials; bridge auth |
| `runtime-lifecycle-host.mjs`              | Composition glue; fresh registry + seed if the caller did not bring one | Anything else                                                |

The reconciler does NOT own:

- Provider credentials, capability minting, or bridge authentication.
- Manifest `service.entrypoint` parsing or execution.
- The XH4/XH5 session-cleanup implementation; it only calls
  `factory.closeSessions()`.
- The harness registry's authority decisions (it consumes the
  projection, never writes to it).

The host bridge composition root owns the `factoryRegistry`,
`reconciler`, and `emit` sink. It must not expose the registry
constructor to the UI; the UI is a consumer of the
`{ transitioned, noop }` outcome.

---

## 12. What CP-BR4 deliberately does NOT do

CP-BR4 is the **act** side. The following are explicitly deferred:

- **CP-BR5 — Runtime / connector / session projection.** The
  reconciler produces a private outcome (`{ transitioned, noop }`)
  and a private event stream. The public projection for the
  Bridge & Runtimes UI is CP-BR5.
- **CP-BR6 — Bridge & Runtimes UI.** The UI is not built.
- **CP-BR7 — Terminal add-on migration.** Existing terminal-host
  add-ons are not wired onto this lifecycle. The seed factories
  are no-op-shaped adapters that report the add-on's intended
  behavior without actually spawning; CP-BR7 will replace them
  with the real driver spawns.
- **Manifest `service.entrypoint` execution.** The reconciler
  never reads it; the factory must pin its own spawn policy.
- **Caller-supplied process inputs.** The factory contract is the
  only way to introduce a factory. There is no API to register a
  factory from a caller-supplied command, argv, path, cwd, env, or
  endpoint.

If you find yourself wanting to call `child_process.spawn` directly
from the reconciler, put it in a factory. If you find yourself
wanting to read a manifest field to decide which factory to start,
stop — that decision is host-owned and lives in the host projection.

---

## 13. Test evidence

`browser-first/test/runtime-reconciler.test.mjs` covers all 14
requirements in the CP-BR4 prompt §8:

1. ✓ fixture runtime starts once and a second reconcile is a no-op
2. ✓ `stopped` desired state stops the runtime and closes its sessions
3. ✓ two concurrent reconciles for one add-on produce exactly one start
4. ✓ stale start / health / exit from an older generation cannot become active
5. ✓ generation replacement stops the previous runtime deterministically
6. ✓ start / stop / health timeouts are bounded
7. ✓ unknown / unregistered factory id fails closed
8. ✓ `manifest.service.entrypoint` is never executed (hostile entrypoint fixture)
9. ✓ caller-supplied command / argv / path / env is rejected or impossible by shape
10. ✓ partial grant (subset of required capabilities) resolves `addon-authorization-required`, not `running` (CP-BR3 fix)
11. ✓ desired runtimes are restored after a simulated bridge restart
12. ✓ non-secret lifecycle events carry no PID / path / argv / env / token / credential (shape-walker)
13. ✓ a stale or forged UI / registry snapshot cannot start a runtime
14. ✓ terminal-host / external-CLI / pi fixtures still pass unchanged (no regression)

Plus the SDK contract test file picked up six new tests for the
CP-BR3 grant-completeness fix.

Run:

```sh
node --experimental-strip-types --test \
  browser-first/test/runtime-reconciler.test.mjs \
  packages/addon-sdk/test/runtime-lifecycle.test.mjs
```
