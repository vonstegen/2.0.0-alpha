# Work Pack: Security Pipeline MVP

## Objective

Implement the first ResonantOS security pipeline slice: a registry-driven CI control plane with supply-chain MVP checks.

## Output Mode

Split work-pack.

Reason: medium complexity. The work spans GitHub Actions, registry configuration, a Node runner, multiple adapters, policy behavior, and validation.

## Source Design Refs

- `docs/security-pipeline/SECURITY-PIPELINE-DESIGN.md`
- `docs/security-pipeline/IMPLEMENTATION-LAYERING.md`
- Internal refinement artifacts are omitted from PR scope.

## Target Source Paths

Planned future implementation paths:

- `.github/workflows/security.yml`
- `.github/security-pipeline/checks.yml`
- `scripts/security-pipeline/run-check.mjs`
- `scripts/security-pipeline/checks/npm-lockfiles.mjs`
- `scripts/security-pipeline/checks/npm-audit.mjs`
- `scripts/security-pipeline/checks/rust-audit.mjs`
- `scripts/security-pipeline/checks/actions-hardening.mjs`
- optional `scripts/security-pipeline/lib/*.mjs`
- optional `docs/security-pipeline.md`

## Validation Strategy

Run before declaring the L0 slice done:

- `node scripts/security-pipeline/run-check.mjs --list --config .github/security-pipeline/checks.yml`
- `node scripts/security-pipeline/run-check.mjs --check npm-lockfiles --config .github/security-pipeline/checks.yml`
- `npm test`
- `npm run build`

Run the broader checks before declaring the full supply-chain MVP done:

- `node scripts/security-pipeline/run-check.mjs --family supply-chain --config .github/security-pipeline/checks.yml`
- `cargo fmt --check && cargo test` from `src-tauri`
- YAML syntax check for `.github/workflows/security.yml`

Security-tool validation:

- npm audit adapters must use `npm ci --ignore-scripts` before `npm audit --audit-level=high`.
- Rust audit adapter must run against both committed lockfiles.
- action-hardening adapter must scan `.github/workflows/*.yml`.
- dependency review must be PR-gated in the workflow.

## Task Board

| Task | Layer | Status | Contract |
| --- | --- | --- | --- |
| TASK-SP-001 | L0 | complete | [TASK-SP-001](work-pack/tasks/TASK-SP-001.md) |
| TASK-SP-002 | L0 | complete | [TASK-SP-002](work-pack/tasks/TASK-SP-002.md) |
| TASK-SP-003 | L0 | complete | [TASK-SP-003](work-pack/tasks/TASK-SP-003.md) |
| TASK-SP-004 | L1 | ready | [TASK-SP-004](work-pack/tasks/TASK-SP-004.md) |
| TASK-SP-005 | L1 | ready | [TASK-SP-005](work-pack/tasks/TASK-SP-005.md) |
| TASK-SP-006 | L1 | ready | [TASK-SP-006](work-pack/tasks/TASK-SP-006.md) |
| TASK-SP-007 | L2 | ready | [TASK-SP-007](work-pack/tasks/TASK-SP-007.md) |
| TASK-SP-008 | L2 | ready | [TASK-SP-008](work-pack/tasks/TASK-SP-008.md) |

## SWU Manifest

| SWU | Parent Task | Layer | Goal | Verification |
| --- | --- | --- | --- | --- |
| SWU-SP-001 | TASK-SP-001 | L0 | Add registry schema and initial supply-chain entries | registry can be parsed and listed |
| SWU-SP-002 | TASK-SP-002 | L0 | Add runner CLI with list/filter/execute behavior | list and check commands pass locally |
| SWU-SP-003 | TASK-SP-003 | L0 | Add npm lockfile adapter | lockfile check passes on current surfaces |
| SWU-SP-004 | TASK-SP-004 | L1 | Add npm audit adapter | audit command runs per lockfile surface |
| SWU-SP-005 | TASK-SP-004 | L1 | Add Rust advisory adapter | Rust lockfile audit commands are wired |
| SWU-SP-006 | TASK-SP-005 | L1 | Add actions hardening adapter | workflow scan reports current baseline |
| SWU-SP-007 | TASK-SP-006 | L1 | Add `security.yml` workflow and dependency review job | workflow syntax and local runner commands pass |
| SWU-SP-008 | TASK-SP-007 | L2 | Document add/remove/promote check lifecycle | docs explain policy modes and examples |
| SWU-SP-009 | TASK-SP-008 | L2 | Run deterministic validation and sync result state | required checks recorded with pass/flag/block |

## Execution Order

1. W0 skeleton: TASK-SP-001, TASK-SP-002, TASK-SP-003.
2. W1 supply-chain MVP: TASK-SP-004, TASK-SP-005, TASK-SP-006.
3. W2 governance/readiness: TASK-SP-007, TASK-SP-008.

## Current Blockers

- SWU-SP-004 needs an explicit npm audit execution strategy before it can become a blocking CI check.
- SWU-SP-005 needs a Rust advisory strategy and a pinned `cargo-audit` installation path or maintained action.
- `actions-hardening` starts as `warn` unless the implementation also pins every current third-party action to full commit SHAs.

## Handoff Rule

Execute one SWU at a time. If a future task-session starts with a task but no SWU, select the first incomplete SWU for that task.

## Execution Evidence

### 2026-05-29 Task Session

Completed:

- `SWU-SP-001`: added `.github/security-pipeline/checks.yml`.
- `SWU-SP-002`: added `scripts/security-pipeline/run-check.mjs`.
- `SWU-SP-003`: added `scripts/security-pipeline/checks/npm-lockfiles.mjs`.

Validation:

- `node scripts/security-pipeline/run-check.mjs --list --config .github/security-pipeline/checks.yml` passed.
- `node scripts/security-pipeline/run-check.mjs --check npm-lockfiles --config .github/security-pipeline/checks.yml` passed.
- `node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('.github/security-pipeline/checks.yml','utf8'))"` passed.

Blocked:

- `SWU-SP-004`: the npm audit adapter needs an explicit execution strategy before promotion to a blocking CI check.
