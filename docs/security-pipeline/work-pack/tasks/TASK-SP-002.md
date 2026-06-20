# TASK-SP-002: Build Registry Runner

## Objective

Add a Node-based runner that reads the check registry, lists checks, filters checks, executes adapters, and normalizes results.

## Parent Layer

L0 Skeleton

## Source Contracts

- `docs/security-pipeline/SECURITY-PIPELINE-DESIGN.md`
- `docs/security-pipeline/WORK-PACK.md`

## Write Scope

- `scripts/security-pipeline/run-check.mjs`
- optional `scripts/security-pipeline/lib/*.mjs`

## Implementation Detail

Runner behavior:

1. Parse CLI flags: `--config`, `--list`, `--check`, `--family`.
2. Load YAML registry. Use a dependency only if already available or intentionally added; otherwise implement a minimal parser strategy or use JSON-compatible YAML shape.
3. Validate registry fields and policy values.
4. For `--list`, print active checks with family and policy.
5. For execution, resolve adapters under `scripts/security-pipeline/checks/`.
6. Execute adapters one at a time.
7. Normalize each adapter result to `pass`, `warn`, `fail`, `skipped`, or `disabled`.
8. Exit nonzero only when a `policy: block` check fails or registry validation fails.

## Smallest Working Units

### SWU-SP-002

- Goal: add runner CLI and registry validation.
- Dependencies: SWU-SP-001.
- Write scope: `scripts/security-pipeline/run-check.mjs`, optional `scripts/security-pipeline/lib/*.mjs`.
- Done criteria: runner lists registry checks and fails clearly on invalid config.
- Acceptance evidence: `--list` command output.
- Verification: `node scripts/security-pipeline/run-check.mjs --list --config .github/security-pipeline/checks.yml`.
- Execution owner: local-fallback.
- Handoff note: keep adapter execution simple; avoid building a general task framework.

## Expected Result Shape

```yaml
swu_id: SWU-SP-002
result: pass | flag | block | interrupted
files_touched:
  - scripts/security-pipeline/run-check.mjs
validation:
  - node scripts/security-pipeline/run-check.mjs --list --config .github/security-pipeline/checks.yml
blockers:
  - blocker or none
handoff_note: adapter contract status
```
