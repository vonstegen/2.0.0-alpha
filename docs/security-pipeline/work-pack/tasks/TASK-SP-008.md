# TASK-SP-008: Validate And Synchronize Work-Pack State

## Objective

Run deterministic validation and sync the work-pack state after implementation.

## Parent Layer

L2 Governance

## Source Contracts

- `AGENTS.md`
- `docs/security-pipeline/WORK-PACK.md`

## Write Scope

- `docs/security-pipeline/WORK-PACK.md`
- optional `docs/security-pipeline/VALIDATION-REPORT.md`

## Implementation Detail

Validation commands:

1. `node scripts/security-pipeline/run-check.mjs --list --config .github/security-pipeline/checks.yml`
2. `node scripts/security-pipeline/run-check.mjs --family supply-chain --config .github/security-pipeline/checks.yml`
3. `npm test -- --run`
4. `npm run build`
5. `cargo fmt --check && cargo test` from `src-tauri`
6. YAML syntax check for `.github/workflows/security.yml`

Record:

- commands run
- pass/flag/block result
- remaining gaps
- whether first task-session route is complete

## Smallest Working Units

### SWU-SP-009

- Goal: validate and synchronize plan state.
- Dependencies: SWU-SP-001 through SWU-SP-008.
- Write scope: `docs/security-pipeline/WORK-PACK.md`, optional validation report.
- Done criteria: validation results are recorded and next route is clear.
- Acceptance evidence: command results or exact blocked reasons.
- Verification: reviewable validation report.
- Execution owner: local-fallback.
- Handoff note: this SWU closes the MVP implementation slice, not the broader L3 release-integrity track.

## Expected Result Shape

```yaml
swu_id: SWU-SP-009
result: pass | flag | block | interrupted
files_touched:
  - docs/security-pipeline/WORK-PACK.md
  - docs/security-pipeline/VALIDATION-REPORT.md
validation:
  - command results or blocked reasons
blockers:
  - blocker or none
handoff_note: MVP readiness and next deferred layer
```
