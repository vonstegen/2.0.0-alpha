# ResonantOS Browser Architecture — Adoption Roadmap

Converts the [master phased implementation checklist](14-master-phased-implementation-checklist.md)
into an ordered set of **checkpoints (CP-0 … CP-9)**. A checkpoint closes only
when its exit gate passes and its gate evidence is recorded here or in the
ratifying ADR. No later checkpoint becomes normative before its predecessor's
gate passes.

Authority: [ADR-052](../ADR-052-browser-architecture-package.md) adopts this
package as the proposed target architecture. Runtime decisions remain governed
by the [ADR index](../README.md) until individual ADRs are amended or added.

## Reading order

1. [ADR-052](../ADR-052-browser-architecture-package.md) — what is adopted, what is not.
2. This roadmap — checkpoint order, gates, and current status.
3. [Master checklist](14-master-phased-implementation-checklist.md) — the full task list per checkpoint.
4. [Checklists](CHECKLISTS.md) — gate-review and reviewer checklists.

## Checkpoint map

| CP | Checkpoint | Gate (summary) | In-repo seeds today | Status |
| --- | --- | --- | --- | --- |
| CP-0 | Ratify scope and vocabulary | Architecture index links accepted decisions; terminology alone implies no runtime change | [ADR-051](../ADR-051-ros-architecture-blueprint.md) encodes shell/harness/agent vocabulary, fused core, Ground-0 invariant | In progress |
| CP-1 | Identity, task, authority contracts | Contracts represent `user → Augmentor → Hermes → tool.git`; child supersets are provably denied | `src/core/contracts.ts`, `src/sdk/addons/contracts.ts` (broad `CapabilityGrant`, delegation shapes) | Not started |
| CP-2 | Enforce authority at the bridge | Integration tests reject forged identity, expired grants, sibling reuse, path escape, widening | `browser-first/host/bridge-server.mjs` capability gates; `addon-delegation-service.mjs` bounded packets | Not started |
| CP-3 | Augmentor orchestration and extensions | Augmentor invokes a focused extension under a task grant; Core authorizes every effect | `augmentorSkills` contract; Strategist/Augmentor chat rail | Not started |
| CP-4 | Harness Provider API | Fake conformance provider passes lifecycle, cancellation, confinement, replay, failure | `addon-delegation-host-service.mjs`, `hermes-runtime.mjs`, `opencode-runtime.mjs` (provider-specific duplication to extract) | Not started |
| CP-5 | Migrate reference harnesses | Three provider shapes use the contract without vendor-specific authority exceptions | Hermes + OpenCode manifests/runtimes; OpenClaw manifest | Not started |
| CP-6 | Multi-harness concurrency + resource governor | Hermes and OpenCode run concurrently without leakage; cancellation and budget exhaustion deterministic | ADR-032 compute contracts (deferred) | Not started |
| CP-7 | Trusted continuity and context exchange | Augmentor resumes a delegated task after restart; harness receives only bounded context | ADR-016 compaction; Living Archive intake boundaries | Not started |
| CP-8 | Ground-0 state | Recovery succeeds with all optional add-ons disabled; no pre-recovery executable authority survives exit | ADR-051 fused core + `recoverySession`; `src/modules/recovery` ladder | Not started |
| CP-9 | SDK stabilization and release readiness | SDK documented, versioned, enforced at privileged effects, multi-harness validated, Ground-0 recoverable | Add-on SDK V0 + conformance patterns; two-channel workbench | Not started |

## Checkpoint order and dependencies

```text
CP-0 ─► CP-1 ─► CP-2 ─► CP-3 ─► CP-4 ─► CP-5 ─► CP-6 ─► CP-7 ─► CP-8 ─► CP-9
                          │        │
                          │        └── CP-3 and CP-4 are parallelizable once CP-2
                          │            enforces the authority floor
                          └── CP-2 pilot route precedes route-by-route expansion
```

- CP-0 must close first: later contracts use its vocabulary and its amended-ADR
  record.
- CP-1 and CP-2 are strictly ordered: contracts before enforcement.
- CP-3 (Augmentor extensions) and CP-4 (harness provider API) may proceed in
  parallel once CP-2's governed-request envelope exists.
- CP-5 depends on CP-4; CP-6 on CP-5; CP-7 and CP-8 build on CP-2's enforcement
  and may proceed in parallel after CP-5.
- CP-9 consumes every earlier gate's evidence.

## CP-0 detail — the only active checkpoint today

Exit gate: the architecture index links the accepted decisions; no runtime
change is implied by terminology alone.

Work items (from the master checklist, doc 14):

- [ ] Adopt the browser-first definition and explicit Linux/true-OS exclusion.
- [ ] Decide whether `primary-agent` is the orchestration slot or add a compatible `orchestrator` alias.
- [ ] Normalize public meanings of Core, platform service, add-on, Augmentor extension, harness provider, and Ground-0.
- [ ] Record which statements amend ADR-006, ADR-018, ADR-026, and ADR-010.
- [ ] Mark current baseline versus proposed/future requirements in every new ADR.
- [ ] Run repository documentation validation.

Proposed ADR set (doc 13) mapped to checkpoints:

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
| — | — | No gate has closed yet. | — |

## Review infrastructure already in place

These exist today and serve every checkpoint:

- **Two-channel workbench** ([release README](../../../browser-first/release/README.md)):
  frozen stable SDK surface (`browser-first/release/`) vs dev UI surface sharing
  one bridge — each checkpoint can change the dev channel without disturbing SDK
  testing on the frozen channel.
- **G0-ROS dev panel** (`browser-first/dev/g0-ros-panel.html` +
  `browser-first/host/dev-g0-ros-panel.mjs`): read-only bridge view of the
  ADR-051 blueprint, harness menu, and add-on mapping — CP-0's vocabulary
  rendered against live manifest discovery.
- **Snapshot drift test** (`browser-first/test/ros-architecture-snapshot.test.mjs`):
  pins the bridge mirror to ADR-051; the same pattern applies to every contract
  introduced from CP-1 onward.
