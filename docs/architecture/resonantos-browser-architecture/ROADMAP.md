# ResonantOS Browser Architecture — Adoption Roadmap

Converts the [master phased implementation checklist](14-master-phased-implementation-checklist.md)
into an ordered set of **checkpoints (CP-0 … CP-9)** with entry criteria, exit
gates, and evidence. A checkpoint closes only when its exit gate passes and its
evidence is recorded in the [gate evidence log](#gate-evidence-log). No later
checkpoint becomes normative before its predecessor's gate closes.

Authority: [ADR-052](../ADR-052-browser-architecture-package.md)
adopts this package as the proposed target architecture. Runtime decisions remain
governed by the [ADR index](../README.md) until individual ADRs
are amended or added. This file is planning; it is **not a runtime authority**.

## Reading order

1. [ADR-052](../ADR-052-browser-architecture-package.md) — what is adopted, what is not.
2. This roadmap — checkpoint order, gates, and rebased status.
3. [Checkpoint specification](CHECKPOINTS.md) — per-checkpoint entry/exit/owner.
4. [Master checklist](14-master-phased-implementation-checklist.md) — the full task list per checkpoint.
5. [Implementation tracking](IMPLEMENTATION_TRACKING.md) — item-by-item status vs the current branch.
6. [Review checklists](CHECKLISTS.md) — gate-review and reviewer checklists.

## Baseline correction — read this first

Doc 13's migration map was written against the `dev` mirror (`vonstegen/2.0.0-alpha`,
PR #278, commit `80dcd79`). The active work since then has **already landed pieces
of the target** on the current branch (`feat/dev-external-agent-runtimes-panel`,
`a2fdb88`; canonical repo HEAD `701ee36` on `feat/tab-referencing`):

| Landed already | Where | Covers |
| --- | --- | --- |
| G0-ROS fused-core blueprint | `src/sdk/addons/architecture.ts` + host mirror | CP-0 vocabulary, CP-8 invariant (encoding only) |
| Caller-attributed HMAC tokens | `browser-first/host/bridge-attributed-token.mjs` | CP-2 partial (identity claim ≠ authority) |
| Per-caller grants store | `browser-first/host/bridge-grants-store.mjs` | CP-2 partial (capability gate, no temporal/task scope) |
| Append-only audit ledger | `browser-first/host/bridge-audit-ledger.mjs` | CP-2 partial (audit events) |
| External-agent-runtime dispatcher | `browser-first/host/external-agent-runtime-dispatcher.mjs` | CP-4 partial (one provider shape, grant-checked) |
| G0-ROS read-only dev panel | `browser-first/dev/g0-ros-panel.html` + `dev-g0-ros-panel.mjs` | CP-0 rendering |
| Snapshot drift test | `browser-first/test/ros-architecture-snapshot.test.mjs` | CP-0/CP-1 verification pattern |
| Two-channel workbench | `browser-first/release/` (frozen) vs dev UI | every CP's regression harness |

**What this means for the plan:** the existing "Phase 3.5 hardening" is a
caller-attributed **capability** token layer. It is a foundation, **not** the
target's principal/delegation-chain + task-scoped **temporal** authority model
(docs 07–08). CP-1/CP-2 are therefore *seeded*, not *done*. Do not re-derive or
delete the hardening; extend it. [IMPLEMENTATION_TRACKING.md](IMPLEMENTATION_TRACKING.md)
carries the item-by-item status against this rebased baseline.

## Checkpoint map

| CP | Checkpoint | Gate (summary) | Status vs current branch |
| --- | --- | --- | --- |
| CP-0 | Ratify scope and vocabulary | Architecture index links accepted decisions; terminology implies no runtime change | Done |
| CP-1 | Identity, task, authority contracts | Contracts represent `user → Augmentor → Hermes → tool.git`; child supersets provably denied | Done |
| CP-2 | Enforce authority at the bridge | Integration tests reject forged identity, expired grants, sibling reuse, path escape, widening | Done |
| CP-3 | Augmentor orchestration and extensions | Augmentor invokes a focused extension under a task grant; Core authorizes every effect | Done |
| CP-4 | Harness Provider API | Fake conformance provider passes lifecycle, cancellation, confinement, replay, failure | Done |
| CP-5 | Migrate reference harnesses | Three provider shapes use the contract, no vendor-specific authority exceptions | In progress |
| CP-6 | Multi-harness concurrency + resource governor | Hermes and OpenCode run concurrently without leakage; cancellation/budget exhaustion deterministic | In progress |
| CP-7 | Trusted continuity and context exchange | Augmentor resumes a delegated task after restart; harness gets only bounded context | In progress |
| CP-8 | Ground-0 state | Recovery succeeds with all optional add-ons disabled; no pre-recovery executable authority survives | In progress |
| CP-9 | SDK stabilization and release readiness | SDK documented, versioned, enforced at effects, multi-harness validated, Ground-0 recoverable | In progress |

## Checkpoint order and dependencies

```text
CP-0 ─► CP-1 ─► CP-2 ─► CP-3 ─► CP-4 ─► CP-5 ─► CP-6 ─► CP-7 ─► CP-8 ─► CP-9
                          │        │
                          │        └── CP-3 ∥ CP-4 once CP-2 enforces the floor
                          └── CP-2 pilot envelope precedes route-by-route expansion
```

- **CP-0** must close first: later contracts use its vocabulary and its amended-ADR
  record. Serial; one owner.
- **CP-1 → CP-2** strictly ordered: contracts before enforcement.
- **CP-3 ∥ CP-4** parallelize once CP-2's governed-request envelope exists.
- **CP-5** depends on CP-4. **CP-6** on CP-5.
- **CP-7 ∥ CP-8** may proceed in parallel after CP-5 (both build on CP-2's enforcement;
  neither blocks the other). CP-8's encoding already exists; the state machine does not.
- **CP-9** consumes every earlier gate's evidence.

See [WORK_BREAKDOWN.md](WORK_BREAKDOWN.md) for the subagent-level decomposition of
each checkpoint into parallel work packages and their cross-slice contracts.

## Proposed ADR set (doc 13) → checkpoint mapping

| Proposed ADR | Ratifies | Gate |
| --- | --- | --- |
| Browser-first multi-harness architecture and terminology | docs 01–06, 13 | CP-0 |
| Principal/delegation chain and task-scoped temporal authority | docs 07–08, 12 | CP-1, CP-2 |
| Augmentor extension and harness provider SDK contracts | docs 03–05, 12 | CP-3, CP-4 |
| Ground-0 state and executable-state quarantine | docs 09–10 | CP-8 |
| Concurrent resource governance | docs 11 | CP-6 |

## Gate evidence log

| CP | Date | Gate evidence | Ratifying doc |
| --- | --- | --- | --- |
| CP-0 | 2026-08-27 | ADR-053 accepted; architecture index links ADR-053 (Accepted); terminology and boundary vocabulary ratified; no runtime change | ADR-053 |
| CP-1 | 2026-08-27 | ADR-054 accepted; SDK type modules (`identity`/`authority`/`tasks`/`continuity`/`resources`) land + 11 tests; `tsc --noEmit` clean; `PrincipalKind` full 10-value union matches CONTRACTS | ADR-054 |
| CP-2 | 2026-08-28 | Governed-request envelope (`bridge-governed-authority.mjs`) + pilot route; 43 bridge tests pass incl. forged identity, expired, sibling reuse, path escape, widening, principal-chain lineage break, approval-pending | ADR-054 |
| CP-3 | 2026-08-28 | `AugmentorExtensionManifest` + strict-combo validation + three conformance examples + approval/lineage UI; `dispatchGovernedAugmentorExtension` proves task-grant admission and per-effect `capability-not-granted` denial (6 tests) | ADR-053, ADR-054 |
| CP-4 | 2026-08-28 | `src/sdk/harnesses/` (`HarnessProviderManifest`, `HarnessProviderAdapter`) + `FakeHarnessProvider` conformance fake; 5 tests pass lifecycle, cancellation, artifact confinement, event replay, and failure | ADR-054 |

## Review infrastructure already in place

- **Two-channel workbench** (`browser-first/release/README.md`): frozen stable SDK
  surface vs dev UI surface sharing one bridge — each checkpoint changes the dev
  channel without disturbing SDK testing on the frozen channel.
- **G0-ROS dev panel** (`browser-first/dev/g0-ros-panel.html` +
  `browser-first/host/dev-g0-ros-panel.mjs`): read-only bridge view of the ADR-051
  blueprint — CP-0 vocabulary rendered against live manifest discovery.
- **Snapshot drift test** (`browser-first/test/ros-architecture-snapshot.test.mjs`):
  pins the bridge mirror to ADR-051; the same pattern applies to every contract
  introduced from CP-1 onward.

## Cross-phase non-negotiables (from doc 14)

- Never broaden the Alpha runtime beyond extension + authenticated local bridge without a separate decision.
- Never make provenance, enablement, UI state, a skill, or Augmentor judgment an authority grant.
- Never expose raw credentials or reusable grant material to add-on UI/runtime artifacts.
- Never allow direct trusted-memory writes from harnesses.
- Never allow a child actor to exceed parent/task authority or budget.
- Never conflate preserved history with executable state during recovery.
- Keep all Linux/true-OS work in a separate future project.
