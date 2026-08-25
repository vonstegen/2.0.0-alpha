# ADR-041: Add-on Isolation Boundary

## Decision Metadata

- Decision status: Accepted
- Alpha applicability: Applies
- Superseded by: None
- Owner: Add-on SDK
- Decision date: 2026-08-25
- Alpha note: Alpha's worker-thread rebind for executable add-ons is
  shipped as a `workerKey` key derived from the
  field. The bridge dispatcher holds a `Map<workerKey, Worker>` and
  routes every addon-attributed call through the worker for that key.
  When the registry changes a triple's boundary, the bridge evicts
  and re-creates the worker. The validator enforces a minimal set of
  per-boundary constraints; the host enforces binding.
- Cross-reference: §23.5 / §23.7 of
  `docs/architecture/RESONANT_VSCODE_VSCODIUM_EXTENSION_REFERENCE_MODEL.md`;
  ADR-038 (`id@publisher` triple); ADR-039 (`runtimeIsolation`
  changes are hard-changes); ADR-042 (trust-tier transitions).

## Decision

Every addon-attributed bridge call routes through a **worker key**:

```
workerKey = `${id}@${publisher}:${version}|${runtimeIsolation.boundary ?? "(none)"}`
```

The bridge dispatcher holds a `Map<workerKey, Worker>` (Node
`worker_threads` for `host-mediated-*` boundaries; the host process
itself for `shell-ui` / `embedded-surface`). Two addons share a
worker only if and only if their `workerKey` is identical — which
requires same id, same publisher, same version, and same isolation
boundary.

A change to **any** of those four fields invalidates the worker
entry:

- `id` change → fresh install (ADR-039 fires
  `identity-id-changed`).
- `publisher` change → trust-tier transition (ADR-042);
  isolation rebind required because the prior worker may carry the
  prior publisher's grant tokens.
- `version` change (any direction; downgrade or major bump) →
  call site uses the new version; the prior worker's call surface
  may differ.
- `runtimeIsolation.boundary` change → ADR-039's
  `isolation-boundary-widened` / `-narrowed` rule fires; the host
  must rebind the worker with the new boundary.

The boundary enum is unchanged:

| boundary              | role                                                      |
| --------------------- | --------------------------------------------------------- |
| `shell-ui`            | UI module; runs in the same Node process as the host shell |
| `embedded-surface`    | embedded pane; same Node process but isolated UI thread   |
| `host-mediated-service` | addon local-service; runs in a dedicated Node `worker_threads` worker |
| `host-mediated-agent` | agent addon; worker_threads worker with `providers` access |
| `host-mediated-channel` | remote-channel addon; worker_threads worker with `notifications` access |

## Validator constraints

The validator (`src/sdk/addons/validation.ts`) enforces the
following for `runtimeIsolation`-bearing manifests:

1. If `runtimeIsolation.boundary` is `host-mediated-*`, the manifest
   MUST declare `runtimeType: "agent-addon"`, `"channel-addon"`, or
   `"local-service"`. Pure UI addons (`ui-module`,
   `embedded-module`) cannot request worker-hosted isolation.
2. If `runtimeIsolation.boundary` is `shell-ui` or
   `embedded-surface`, the manifest MUST NOT declare `runtimeType:
   "agent-addon"` or `"channel-addon"` (otherwise the dispatcher
   has no worker to bind to).
3. `runtimeIsolation.requiresReviewedGrant === true` requires at
   least one `requestedCapabilities` entry with
   `scope: "system"` or `revocationBehavior: "hard-stop"` — the
   `requiresReviewedGrant` flag is a hint that the add-on wants
   host-mediated review, so it must declare a non-trivial grant.
4. `runtimeIsolation.supportsDegradedMode === false` combined with
   `revocationBehavior: "degrade"` for any capability produces a
   manifest contradiction; the validator surfaces it as
   `isolation-degraded-mode-conflict`.

The `validateRuntimeIsolationForManifest(manifest)` helper is
exported from `packages/addon-sdk-testing/src/isolation.ts` so the
host-side dispatcher uses the same rule set to double-check before
worker binding.

## Worker rebind lifecycle

1. **Cold start**: bridge boots, scans registry rows, creates one
   worker per `workerKey`. Each worker has its own HMAC-signed
   token table, audit buffer, and capability grant store.
2. **Hot update**: a manifest delta (ADR-039) flows in; if any
   field changes the `workerKey`, the bridge:
   a. Marks the prior worker as `draining`.
   b. Drains its in-flight calls to a `Retry-After` retry queue
      with the prior worker.
   c. Creates the new worker keyed by the new triple.
   d. Atomically swaps the `Map` entry.
   e. After the prior worker has no in-flight calls (or its
      timeout window elapses), terminates it.
3. **Trust-tier transition (ADR-042)**: even when the
   `runtimeIsolation.boundary` is unchanged, a tier transition
   forces a rebind because the grant tokens carry the prior tier.
4. **Worker dies / crashes**: bridge restarts the worker keyed by
   the same `workerKey`; the prior calls' retry queue resumes
   against the new worker. Audit ledger records the crash as a
   `worker-restart` row.

## Pure helpers

```ts
export type WorkerKey = `${string}@${string}:${string}|${string}`;

export function buildWorkerKey(manifest: AddOnManifest): WorkerKey;

export type IsolationCheckResult =
  | { valid: true; workerKey: WorkerKey }
  | { valid: false; errors: { code: string; path: string; message: string }[] };

export function validateRuntimeIsolationForManifest(
  manifest: AddOnManifest,
): IsolationCheckResult;

export function shouldRebindWorker(
  prior: AddOnManifest,
  next: AddOnManifest,
): boolean;
```

These helpers are pure and ship from
`packages/addon-sdk-testing/src/isolation.ts`.

## Wire and bridge changes

1. **`packages/addon-sdk-testing/src/isolation.ts`** (new): pure
   module exporting `buildWorkerKey`,
   `validateRuntimeIsolationForManifest`, and `shouldRebindWorker`.
2. **`packages/addon-sdk-testing/src/index.ts`**: re-export.
3. **`src/sdk/addons/validation.ts`**: call
   `validateRuntimeIsolationForManifest` from
   `validateAddOnManifest` so the §4 constraints land at the same
   time as the manifest validates. New error codes:
   `isolation-runtime-type-mismatch`,
   `isolation-degraded-mode-conflict`,
   `isolation-missing-non-trivial-grant`.
4. **`browser-first/host/bridge-dispatcher.mjs`**: hold a
   `Map<workerKey, Worker>`; route addon-attributed calls through
   the worker; on manifest delta, call `shouldRebindWorker` and
   follow the lifecycle above.
5. **`browser-first/host/bridge-audit-ledger.mjs`**: record
   `worker-rebind` rows with `{oldKey, newKey, callerId, deltaKind:
   "boundary-change" | "trust-tier-change" | "manifest-id-change"
   | "worker-restart"}` so a future audit can replay.
6. **`run-bridge-minimal.mjs`**: remains unchanged; trusts the
   dispatcher and audit ledger to record rebinds.

## Cross-cutting

- **ADR-038**: identity triple (`id@publisher`) is the spine of the
  worker key. Without it, two unrelated addons may share a worker.
- **ADR-039**: a worker-key-changing delta is already a hard-change
  in the permission diff; this ADR is what *executes* the rebind
  rather than gating it.
- **ADR-042**: tier transitions force a rebind even when the
  boundary is unchanged; the dispatcher consults both.

## Open work (delegated to follow-up ADRs)

- **Per-worker memory ceiling**: Alpha runs the worker inside the
  host's address space; a future ADR quantifies a `maxMemoryMb`
  hint per worker.
- **Cross-worker capability brokering**: `agent-delegation` from a
  `host-mediated-agent` worker to a `host-mediated-service` worker
  is mediated by the dispatcher today; a follow-up ADR specifies
  the broker protocol.
- **Worker re-use across publishers**: not allowed by this ADR; a
  registry mode where multiple Verified addons share a single
  worker is conceivable but out of scope.
- **Cgroup / namespace isolation**: the Alpha runs in a single
  Node process; OS-level isolation (cgroups, namespaces, JIT
  disable) lands in a follow-up ADR.

## Rules

- The `buildWorkerKey` and `shouldRebindWorker` functions MUST be
  pure. No I/O, no `Date.now()`.
- The `validateRuntimeIsolationForManifest` function MUST return
  the same verdict across runs.
- The bridge dispatcher MUST route addon-attributed calls through
  the worker indicated by the manifest's current `workerKey`.
- The bridge dispatcher MUST evict the prior worker after the
  drain timeout (default 30s) regardless of how many retries are
  queued against it.
- The audit ledger MUST record every rebind with a stable
  `deltaKind`.

## Validation

- `buildWorkerKey` produces a deterministic string per (id,
  publisher, version, boundary) tuple.
- `shouldRebindWorker` returns `true` for:
  - boundary widening / narrowing
  - version change
  - publisher change
  - id change
- `shouldRebindWorker` returns `false` for cosmetic-only changes
  (description, label).
- `validateRuntimeIsolationForManifest` rejects:
  - `host-mediated-agent` + `runtimeType: "ui-module"`
  - `shell-ui` + `runtimeType: "agent-addon"`
  - `requiresReviewedGrant: true` with no non-trivial capability
  - `supportsDegradedMode: false` + capability with
    `revocationBehavior: "degrade"`
- vitest: every prior test stays green. New
  `packages/addon-sdk-testing/test/isolation.test.ts` exercises
  each rule.
- vitest: existing `src/sdk/addons/validation.test.ts` surfaces the
  new error codes for curated contradictory fixtures.

Out of scope (delegated to ADR-038 / 039 / 042):
- Identity-triple mechanics (`id@publisher`).
- New-permission review on boundary-changing updates.
- Trust-tier rebind rules.
