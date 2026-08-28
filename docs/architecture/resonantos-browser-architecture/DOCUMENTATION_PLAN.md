# ResonantOS Browser Architecture — Documentation Plan

The forward documentation set: what exists, what each checkpoint ADR must add,
and how the graph stays valid under `scripts/validate-docs.mjs`.

## Document graph (canonical entry points)

```text
docs/architecture/README.md  (ADR index — single source of decision authority)
  ├─ ADR-051  G0-ROS blueprint (accepted)
  ├─ ADR-052  Browser Architecture Package adoption (proposed)
  └─ resonantos-browser-architecture/   ← this package (design target, not authority)
       ├─ README.md                        index + document map
       ├─ 01..15-*.md                      design docs (target rules; 15 = identity/continuity vault)
       ├─ ROADMAP.md                       checkpoint order + gate evidence
       ├─ CHECKPOINTS.md                   per-checkpoint entry/exit/owner
       ├─ IMPLEMENTATION_TRACKING.md       doc-14 items → live status
       ├─ WORK_BREAKDOWN.md                subagent wave/WP decomposition
       ├─ DECISIONS.md                     open Q&A register
       ├─ DOCUMENTATION_PLAN.md            this file
       └─ CONTRACTS.md                     canonical type/route schemas
```

Rules inherited from the repo's documentation contract:

- Every new ADR is listed in `docs/architecture/README.md` with decision status,
  Alpha applicability, supersession, owner, and scope note.
- Every doc is reachable from a canonical entrypoint (`AGENTS.md`, `README.md`,
  `INSTALL.md`, `CONTRIBUTING.md`, `docs/README.md`).
- Any new implicit consumer is added to `IMPLICIT_DOCUMENT_CONSUMERS` in
  `scripts/validate-docs.mjs`.
- `docs/STATUS.md` changes only with a verified fact + evidence.

## ADR plan (the five checkpoint ADRs)

| # | ADR | Ratifies | Amends | Landing checkpoint |
| --- | --- | --- | --- | --- |
| 1 · [ADR-053](../ADR-053-browser-first-multi-harness-architecture.md) | Browser-first multi-harness architecture and terminology | docs 01–06, 13 | ADR-006, ADR-026 | CP-0 |
| 2 · [ADR-054](../ADR-054-principal-delegation-chain-task-scoped-authority.md) | Principal/delegation chain and task-scoped temporal authority | docs 07–08, 12 | ADR-038, ADR-042 (grant/tier semantics) | CP-1, CP-2 |
| 3 | Augmentor extension and harness provider SDK contracts | docs 03–05, 12 | ADR-018 (SDK V0) | CP-3, CP-4 |
| 4 | Ground-0 state and executable-state quarantine | docs 09–10 | ADR-010, ADR-051 | CP-8 |
| 5 | Concurrent resource governance | docs 11 | ADR-032 | CP-6 |

Each carries the standard metadata ADR-052 already uses: **Decision status**
(`Proposed` → `Accepted` on gate close), **Alpha applicability**, **Superseded by**,
**Owner**, **Decision date**. No checkpoint ADR merges before its prerequisites'
gates close (ADR-052 rule).

## Per-checkpoint documentation deliverable

| CP | Doc deliverables |
| --- | --- |
| CP-0 | [ADR-053](../ADR-053-browser-first-multi-harness-architecture.md) drafted; index amended; D-1/D-2/D-5 resolved |
| CP-1 | ADR #2 (contracts half); `CONTRACTS.md` updated with final schemas; `src/sdk/*/README.md` barrel docs |
| CP-2 | ADR #2 (enforcement half); route/envelope reference; audit-event taxonomy |
| CP-3 | ADR #3 (extension half); extension manifest reference + one example each (skill/tool/connector) |
| CP-4 | ADR #3 (provider half); adapter protocol + conformance-runner doc |
| CP-5 | Migration notes per harness; compatibility-matrix row |
| CP-6 | ADR #5; budget/lease semantics; UI states |
| CP-7 | Context-envelope reference; snapshot metadata; redaction/export policy |
| CP-8 | ADR #4; Ground-0 transition diagram; quarantine inventory format |
| CP-9 | Protocol versions, capability glossary, deprecation policy, manifest templates, threat model |

## Governance

- **Authority lives in ADRs, not in this package.** The package's `MUST`/`MUST NOT`
  describe the *target*; runtime change happens only through a checkpoint ADR or a
  reviewed implementation change.
- **Supersession is explicit.** Amended ADRs keep their number and gain a
  "Superseded by" / "Amended by" pointer; nothing is silently rewritten.
- **Review loop.** Every checkpoint gate uses [CHECKLISTS.md](CHECKLISTS.md); gate
  evidence is recorded in [ROADMAP.md](ROADMAP.md)'s gate evidence log and the
  ratifying ADR's Decision section.

## Validation contract

- `node scripts/validate-docs.mjs` must pass with every checkpoint ADR (ADR-052 rule).
- `node scripts/validate-discipline-catalog.mjs` and the snapshot drift test
  (`browser-first/test/ros-architecture-snapshot.test.mjs`) guard the ADR-051 mirror.
- `npm run verify:alpha` runs before any release/PR decision that touches runtime.

## Out of scope (kept out of this documentation set)

- Any Linux distribution, kernel, init system, bootloader, distro recovery, or
  system package manager documentation. A future "Resonance OS" project must have
  its own repository, threat model, ADR set, and roadmap (README + doc 01).
