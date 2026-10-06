# SDK Add-on Runtime Lifecycle Contract (CP-BR3)

> Status: **CP-BR3 (Complete on `r-and-d/terminal-host-current-dev`)**.
> Source of truth: [`packages/addon-sdk/src/runtime-lifecycle.ts`](../../packages/addon-sdk/src/runtime-lifecycle.ts).
> Decision history: [ADR-047](ADR-047-core-bridge-bootstrap-runtime-lifecycle.md),
> [ADR-018](ADR-018-addon-sdk-v0.md), [ADR-046](ADR-046-addon-classification-category-discovery.md),
> [ADDON-BRIDGE-RUNTIME-ROADMAP §4](ADDON-BRIDGE-RUNTIME-ROADMAP.md).

CP-BR3 adds the **pure, generic add-on runtime lifecycle contract** to the
SDK package: public lifecycle status types, a `deriveDesiredRuntimeState()`
resolver, deterministic fixtures, and the add-on author guide. The contract
is a **decision** — it does not start or stop anything. Translating the
decision into a process is CP-BR4 (runtime factory registry + reconciler).

This document covers:

1. [Public lifecycle types](#1-public-lifecycle-types)
2. [Desired-state rule](#2-desired-state-rule)
3. [`deriveDesiredRuntimeState()`](#3-derivedesiredruntimestate)
4. [Revocation mapping](#4-revocation-mapping)
5. [User-facing state mapping](#5-user-facing-state-mapping)
6. [Fail-closed matrix](#6-fail-closed-matrix)
7. [Purity and security rules](#7-purity-and-security-rules)
8. [Author guide: when a runtime is required](#8-author-guide-when-a-runtime-is-required)
9. [CP-BR4 grant-completeness correction](#9-cp-br4-grant-completeness-correction)
10. [What CP-BR3 deliberately does NOT do](#10-what-cp-br3-deliberately-does-not-do)
11. [Test evidence](#11-test-evidence)

---

## 1. Public lifecycle types

`packages/addon-sdk/src/runtime-lifecycle.ts` defines the only lifecycle
vocabulary the SDK contract emits. The vocabulary is closed — CP-BR3
deliberately does not invent new states.

```ts
export type AddOnRuntimeLifecycleStatus =
  | "inactive"
  | "starting"
  | "ready"
  | "degraded"
  | "failed"
  | "stopping";

export interface AddOnRuntimeLifecycleSnapshot {
  addonId: string;
  runtimeId: string;
  status: AddOnRuntimeLifecycleStatus;
  generation: number;
  activeSessionCount: number;
  startedAt?: string;
  lastTransitionAt?: string;
  publicFailureCode?: string;
}
```

The snapshot carries public identifiers and bounded state only. The
shape-walker in
[`packages/addon-sdk/test/runtime-lifecycle.test.mjs`](../../packages/addon-sdk/test/runtime-lifecycle.test.mjs)
recursively walks every snapshot and asserts no token-, credential-,
path-, PID-, or env-shaped value is reachable.

**Public failure codes** (closed list of 10):

| Code                              | Meaning                                                   |
| --------------------------------- | --------------------------------------------------------- |
| `addon-not-installed`             | Authority projection reports `installed: false`           |
| `addon-disabled`                  | Authority projection reports `enabled: false`             |
| `addon-authorization-required`    | `grantedCapabilities` does not cover a required grant     |
| `addon-incompatible`              | `compatible: false` against the current shell             |
| `addon-factory-missing`           | No reviewed runtime factory is available (CP-BR4 input)    |
| `addon-revoked`                   | `hard-stop` revocation fence is active                    |
| `addon-degraded-by-policy`        | `degrade` revocation policy is in effect                  |
| `addon-runtime-type-unknown`      | `runtimeType` is missing or not in the known vocabulary    |
| `addon-authority-input-invalid`   | Authority projection shape is malformed or forged         |
| `addon-manifest-invalid`          | Top-level input shape is malformed (not an object, etc.)  |

---

## 2. Desired-state rule

```text
desiredRunning =
  installed
  AND enabled
  AND required capabilities granted
  AND compatible
  AND reviewed runtime factory exists
  AND no hard-stop revocation fence is active
```

UI state never starts a service directly. The **host-owned registry
projection** is the source of truth. CP-BR3 only describes the rule;
CP-BR4 will translate the decision into start / stop / degrade actions.

---

## 3. `deriveDesiredRuntimeState()`

The resolver is **pure**: no I/O, no process, no timer, no `Date.now()`,
no `fs`, no `spawn`, no `fetch`. Its inputs are a validated manifest
summary and a host-owned authority projection. Its output is a public
decision.

```ts
import {
  deriveDesiredRuntimeState,
  projectLifecycleSnapshot,
} from "@resonantos/addon-sdk";

const decision = deriveDesiredRuntimeState({
  addonId: manifest.id,
  runtimeType: manifest.runtimeType,
  classification: manifest.classification,
  authority: {
    installed: entry.installed,
    enabled: entry.enabled,
    grantedCapabilities: grantedSet,
    compatible: entry.compatibility.shellVersion === currentShell,
    reviewedFactoryAvailable: false, // populated by CP-BR4
    revocation: entry.revocation,
  },
});
// decision.desiredState is "running" | "stopped" | "degraded"
// decision.publicFailureCode is one of the 10 codes above, or undefined
```

`projectLifecycleSnapshot(decision, options)` is the pure projection
helper that converts a decision into a public snapshot. It enforces:

- `runtimeId` is a non-empty string
- `generation` is a non-negative safe integer
- `activeSessionCount` is a non-negative safe integer
- The returned snapshot is `Object.freeze`-d
- `publicFailureCode` is only surfaced on `failed` or `degraded` statuses

Timestamps (`startedAt`, `lastTransitionAt`) are caller-supplied opaque
strings. The resolver never consults the wall clock.

---

## 4. Revocation mapping

| Revocation       | Resolver decision                                  | UI consequence               |
| ---------------- | -------------------------------------------------- | ---------------------------- |
| `none`           | Normal desired-state evaluation                    | As decided                   |
| `hard-stop`      | `stopped` / `addon-revoked`                        | Not running                  |
| `degrade`        | `degraded` / `addon-degraded-by-policy`            | Running in a degraded mode   |
| `hide-surface`   | `stopped` (no failure code)                        | Surface hidden, no runtime   |

The resolver **never** emits a process action. CP-BR4 maps `stopped` →
stop, `degraded` → keep running with degraded flag, `running` → start.

---

## 5. User-facing state mapping

(From roadmap §4.4, restated for reference. CP-BR3 defines the inputs
that produce this mapping; it does not build the UI.)

| SDK / runtime condition      | UI label               |
| ---------------------------- | ---------------------- |
| no installation              | Not installed          |
| installed, disabled          | Disabled               |
| enabled, grant missing       | Authorization required |
| desired running, start pending | Starting             |
| runtime ready                | Connected / Ready      |
| runtime degraded             | Degraded               |
| start or health failure      | Failed                 |
| stop in progress             | Stopping               |
| authorized but inactive      | Disconnected           |

---

## 6. Fail-closed matrix

The resolver fails closed on **every** missing authority input:

| Missing input                    | Resolver outcome                             |
| -------------------------------- | -------------------------------------------- |
| `addonId` not a non-empty string | `stopped` / `addon-manifest-invalid`         |
| `runtimeType` missing or unknown | `stopped` / `addon-runtime-type-unknown`     |
| `classification` not a string    | `stopped` / `addon-manifest-invalid`         |
| `authority` is not an object     | `stopped` / `addon-authority-input-invalid`  |
| `authority.installed` not bool   | `stopped` / `addon-authority-input-invalid`  |
| `authority.enabled` not bool     | `stopped` / `addon-authority-input-invalid`  |
| `authority.grantedCapabilities` not `Set<string>` | `stopped` / `addon-authority-input-invalid` |
| `authority.compatible` not bool  | `stopped` / `addon-authority-input-invalid`  |
| `authority.reviewedFactoryAvailable` not bool | `stopped` / `addon-authority-input-invalid` |
| `authority.revocation` unknown   | `stopped` / `addon-authority-input-invalid`  |
| `installed: false`               | `stopped` / `addon-not-installed`            |
| `enabled: false`                 | `stopped` / `addon-disabled`                 |
| `compatible: false`              | `stopped` / `addon-incompatible`             |
| `reviewedFactoryAvailable: false` | `stopped` / `addon-factory-missing`         |
| `grantedCapabilities` empty      | `stopped` / `addon-authorization-required`   |
| `revocation: "hard-stop"`        | `stopped` / `addon-revoked`                  |
| `revocation: "degrade"`          | `degraded` / `addon-degraded-by-policy`      |
| `runtimeType: "ui-module"`       | `stopped` (no failure code)                  |

Every code listed is the public failure code that appears in the
decision (and, when the decision becomes a snapshot, in
`snapshot.publicFailureCode` for `failed` / `degraded` statuses).

---

## 7. Purity and security rules

CP-BR3 is the first package-level public surface in the SDK to assert a
purity contract. The rules are:

1. **No I/O.** The resolver module does not import `node:fs`,
   `node:child_process`, `node:net`, `node-fetch`, or any HTTP / IPC
   transport. It does not call `setTimeout`, `setInterval`, or
   `Date.now()`.
2. **Fail closed.** Every missing authority input produces a
   `stopped` (or `degraded`) decision. No authority may be inferred
   from default values.
3. **Classification is not authority.** `classification.category`
   appears in the input only so the host can carry it through; the
   resolver reads it to surface it in `publicReason` but does not
   branch on it. Two add-ons that differ only in
   `classification.category` produce byte-equal decisions.
4. **No manifest authority.** The resolver never consults
   `service.entrypoint`, install hooks, scripts, or any field that
   could be used to invoke an executable. The reviewed factory
   registry is CP-BR4.
5. **Public projection only.** The decision and the snapshot carry
   public identifiers and closed failure codes. No tokens,
   credentials, paths, PIDs, raw errors, or prompt / memory content
   can enter the public surface.
6. **No UI driver.** The resolver never reads from, writes to, or
   subscribes to UI state.

The purity contract is enforced by a static-source check
(`runtime-lifecycle.test.mjs` req #13c) and a referential-transparency
check (req #13b).

---

## 8. Author guide: when a runtime is required

Add-on authors choose a `runtimeType` to tell the host **how** their
add-on needs to run. They choose a `classification.category` to tell
the host **what** their add-on is. These are different things.

| If your add-on is…                              | `runtimeType`     | Runtime required? | Notes                                                                 |
| ----------------------------------------------- | ----------------- | ----------------- | --------------------------------------------------------------------- |
| A React panel, page, or modal                   | `ui-module`       | **No**            | The resolver always returns `stopped`; no process is started.         |
| A workspace view embedded in the host surface   | `embedded-module` | **No**            | The resolver returns `stopped`; CP-BR4 will provide no factory.       |
| A long-running local service (stdio/JSON-RPC, HTTP) | `local-service` | **Yes**           | Authors supply `service` (not consulted by CP-BR3; consumed by CP-BR4). |
| A hosted agent runtime                          | `agent-addon`     | **Yes**           | Authors supply `agentRuntime` (CP-BR4).                               |
| A persistent communication channel              | `channel-addon`   | **Yes**           | CP-BR4 will gate on a reviewed factory for the channel protocol.     |

**Classification (`classification.category`) is never lifecycle
authority.** Two add-ons that differ only in `classification.category`
must produce identical resolver decisions. Authors may use any category
they need (`agent`, `channel`, `memory`, `security`, `knowledge`,
`tool`, `integration`, `orchestration`, or an open string per
ADR-046) without affecting whether the runtime is started.

**UI-only add-ons are not punished by missing grants.** A `ui-module`
add-on is resolved as `stopped` regardless of the authority
projection, because the desired-state rule does not apply to
"no-runtime" runtimes. This is the only place the resolver uses
`runtimeType` to shape its answer.

---

## 9. CP-BR4 grant-completeness correction

The CP-BR3 contract initially treated any non-empty
`grantedCapabilities` set as authorized. CP-BR4 closed that gap.

`AddOnRuntimeAuthorityProjection` now optionally carries a
`requiredCapabilities: ReadonlySet<string>` field. When the
projection supplies it, the resolver requires
`required.every(cap => granted.has(cap))`; partial coverage fails
closed with `addon-authorization-required`. When the projection
omits the field, the resolver falls back to the legacy non-empty
`grantedCapabilities` check (preserves CP-BR3 behavior for callers
that have not yet been migrated).

```ts
const decision = deriveDesiredRuntimeState({
  addonId: "addon.test",
  runtimeType: "local-service",
  classification: "tool",
  authority: {
    installed: true,
    enabled: true,
    grantedCapabilities: new Set(["filesystem"]),
    requiredCapabilities: new Set(["filesystem", "notifications"]),
    // ↑ partial coverage → stopped / addon-authorization-required
    compatible: true,
    reviewedFactoryAvailable: true,
    revocation: "none",
  },
});
// decision.desiredState === "stopped"
// decision.publicFailureCode === "addon-authorization-required"
// decision.publicReason === "Required capability not granted: notifications."
```

The reconciler (`browser-first/host/runtime-reconciler.mjs`) is
the only CP-BR4 caller that supplies `requiredCapabilities` today.
It builds the set from the host projection's
`requiredCapabilities` field (preferred) or from the union of the
add-on's `requestedCapabilities` (fallback). The reconciler does NOT
start the runtime if the result is `stopped` /
`addon-authorization-required` — the add-on stays inactive and a
`factory_missing` / `addon-authorization-required` lifecycle event
is emitted. CP-BR7 will surface the failure to the user-facing
authorization UI.

The fix is covered by six new tests in
[`packages/addon-sdk/test/runtime-lifecycle.test.mjs`](../../packages/addon-sdk/test/runtime-lifecycle.test.mjs):
full coverage → `running`; partial coverage → `stopped`;
legacy callers (no `requiredCapabilities`) → legacy check;
forged `requiredCapabilities` → `addon-authority-input-invalid`;
non-string entries → `addon-authority-input-invalid`; and a
non-mutation check on the caller's set.

---

## 10. What CP-BR3 deliberately does NOT do

CP-BR3 is a **contract** phase. The following are explicitly deferred:

- **CP-BR4 — Runtime factory registry and reconciler.** The
  `reviewedFactoryAvailable` input is a boolean flag supplied by the
  host. CP-BR3 does not build the registry, does not call it, and does
  not act on its results.
- **CP-BR4 — `reconcile(snapshot)`.** Translating the desired-state
  decision into start / stop / degrade actions is CP-BR4. The
  resolver only returns the decision.
- **CP-BR5 — Runtime / connector / session projection.** The public
  projection shape is a contract; the live projection is CP-BR5.
- **CP-BR6 — Bridge & Runtimes UI.** The user-facing state mapping
  table is a contract; the UI is CP-BR6.
- **CP-BR7 — Terminal add-on migration.** Existing terminal-host
  add-ons are not yet wired onto this lifecycle. That is CP-BR7.
- **CP-BR2 bridge bootstrap.** CP-BR3 does not touch the bridge,
  bootstrap host, or extension startup; those remain CP-BR1 / CP-BR2
  authoritative.

If you find yourself wanting to call `child_process.spawn`, write to
disk, or open a TCP connection from a function in
`runtime-lifecycle.ts`, that is the wrong file. Put it in CP-BR4.

---

## 11. Test evidence

`packages/addon-sdk/test/runtime-lifecycle.test.mjs` covers all 15
requirements in the CP-BR3 prompt §8:

1. ✓ installed + enabled + granted + compatible + factory + no revocation → `running`
2. ✓ not installed → `stopped` / `addon-not-installed`
3. ✓ installed, disabled → `stopped` / `addon-disabled`
4. ✓ enabled but missing a required grant → `stopped` / `addon-authorization-required`
5. ✓ incompatible → `stopped` / `addon-incompatible`
6. ✓ missing reviewed factory → `stopped` / `addon-factory-missing`
7. ✓ hard-stop revocation fence → `stopped` / `addon-revoked`
8. ✓ degrade revocation → `degraded` / `addon-degraded-by-policy`
9. ✓ two add-ons differing only in `classification.category` → identical decision
10. ✓ UI-only (`ui-module`) never produces a runtime-process desired state
11. ✓ unknown `runtimeType` fails closed
12. ✓ unknown / forged authority input fails closed
13. ✓ resolver performs no I/O (static source check + referential transparency)
14. ✓ shape-walker finds no token / credential / path / PID / env value in any public result
15. ✓ fixture manifests validate under the SDK validator

Run:

```sh
node --experimental-strip-types --test packages/addon-sdk/test/runtime-lifecycle.test.mjs
```

The fixtures themselves live in
`packages/addon-sdk/test/fixtures/runtime-lifecycle-addons.ts` and
cover the four families: `localServiceAddon`, `agentAddon`,
`uiModuleAddon`, `connectorAddon`, plus the `categoryTwinAddon` that
exercises category independence.
