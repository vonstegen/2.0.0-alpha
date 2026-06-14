# TASK-SP-004: Add Dependency Audit Adapters

## Objective

Add supply-chain audit adapters for npm and Rust lockfile vulnerabilities.

## Parent Layer

L1 Supply Chain MVP

## Source Contracts

- `docs/security-pipeline/SECURITY-PIPELINE-DESIGN.md`
- `docs/security-pipeline/IMPLEMENTATION-LAYERING.md`

## Write Scope

- `scripts/security-pipeline/checks/npm-audit.mjs`
- `scripts/security-pipeline/checks/rust-audit.mjs`
- optional shared process/result utilities

## Implementation Detail

`npm-audit` algorithm:

1. Read configured npm surfaces.
2. For each dependency-bearing surface with lockfile, run `npm ci --ignore-scripts`.
3. Run `npm audit --audit-level=high`.
4. Preserve per-surface command, exit code, and summary.
5. Fail only according to registry policy.

`rust-audit` algorithm:

1. Read configured Rust lockfile paths.
2. Run a pinned or explicitly documented `cargo-audit` invocation against each lockfile.
3. Preserve advisory summary and command evidence.
4. Fail on vulnerable advisory findings according to policy.

## Smallest Working Units

### SWU-SP-004

- Goal: implement `npm-audit`.
- Dependencies: SWU-SP-002, SWU-SP-003.
- Write scope: `scripts/security-pipeline/checks/npm-audit.mjs`.
- Done criteria: adapter runs audit per configured npm surface.
- Acceptance evidence: commands include `npm ci --ignore-scripts` and `npm audit --audit-level=high`.
- Verification: `node scripts/security-pipeline/run-check.mjs --check npm-audit --config .github/security-pipeline/checks.yml`.
- Execution owner: local-fallback.
- Handoff note: avoid executing dependency lifecycle scripts in audit install phase.

### SWU-SP-005

- Goal: implement `rust-audit`.
- Dependencies: SWU-SP-002.
- Write scope: `scripts/security-pipeline/checks/rust-audit.mjs`.
- Done criteria: adapter checks both committed Rust lockfiles.
- Acceptance evidence: command covers `src-tauri/Cargo.lock` and `crates/resonator-control/Cargo.lock`.
- Verification: `node scripts/security-pipeline/run-check.mjs --check rust-audit --config .github/security-pipeline/checks.yml`.
- Execution owner: local-fallback.
- Handoff note: pin or document cargo-audit installation strategy before CI enforcement.

## Expected Result Shape

```yaml
swu_id: SWU-SP-004 | SWU-SP-005
result: pass | flag | block | interrupted
files_touched:
  - scripts/security-pipeline/checks/npm-audit.mjs
  - scripts/security-pipeline/checks/rust-audit.mjs
validation:
  - relevant runner command and result
blockers:
  - blocker or none
handoff_note: audit findings and tool-install status
```
