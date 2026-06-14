# TASK-SP-005: Add Actions Hardening Adapter

## Objective

Add a workflow hardening adapter that scans GitHub Actions workflows for baseline CI security policy.

## Parent Layer

L1 Supply Chain MVP

## Source Contracts

- `docs/security-pipeline/SECURITY-PIPELINE-DESIGN.md`
- `.github/workflows/alpha-build.yml`

## Write Scope

- `scripts/security-pipeline/checks/actions-hardening.mjs`

## Implementation Detail

Checks:

1. Workflows should declare least-privilege top-level permissions where practical.
2. `pull_request_target` should not be used for untrusted code paths.
3. Third-party actions should be pinned to full commit SHAs when policy is `block`.
4. Jobs that install dependencies should not receive secrets.
5. Risky event-context interpolation in shell scripts should be flagged if detected.

Policy:

- Start as `warn` unless implementation also pins existing workflow actions.
- Promote to `block` after baseline cleanup.

## Smallest Working Units

### SWU-SP-006

- Goal: implement `actions-hardening` adapter.
- Dependencies: SWU-SP-002.
- Write scope: `scripts/security-pipeline/checks/actions-hardening.mjs`.
- Done criteria: adapter scans `.github/workflows/*.yml` and emits warning/failure evidence.
- Acceptance evidence: current `alpha-build.yml` baseline is reported without crashing.
- Verification: `node scripts/security-pipeline/run-check.mjs --check actions-hardening --config .github/security-pipeline/checks.yml`.
- Execution owner: local-fallback.
- Handoff note: keep initial enforcement at `warn` unless action SHA pinning is completed in the same implementation slice.

## Expected Result Shape

```yaml
swu_id: SWU-SP-006
result: pass | flag | block | interrupted
files_touched:
  - scripts/security-pipeline/checks/actions-hardening.mjs
validation:
  - node scripts/security-pipeline/run-check.mjs --check actions-hardening --config .github/security-pipeline/checks.yml
blockers:
  - blocker or none
handoff_note: hardening findings and whether policy can promote
```
