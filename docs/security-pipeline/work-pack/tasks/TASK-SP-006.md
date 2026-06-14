# TASK-SP-006: Add Security Workflow

## Objective

Add the GitHub Actions workflow that runs the security pipeline and PR dependency review.

## Parent Layer

L1 Supply Chain MVP

## Source Contracts

- `docs/security-pipeline/SECURITY-PIPELINE-DESIGN.md`
- `docs/security-pipeline/WORK-PACK.md`

## Write Scope

- `.github/workflows/security.yml`

## Implementation Detail

Workflow behavior:

- Trigger on pull requests to `dev` and `main`.
- Trigger on pushes to `dev`.
- Support `workflow_dispatch`.
- Set top-level `permissions: contents: read`.
- Run registry-driven supply-chain checks.
- Run GitHub dependency review only for pull requests.
- Avoid secrets in security jobs.
- Keep alpha packaging in `alpha-build.yml`.

Use separate jobs if it improves isolation:

- `security-pipeline`
- `dependency-review`

## Smallest Working Units

### SWU-SP-007

- Goal: add `.github/workflows/security.yml`.
- Dependencies: SWU-SP-001 through SWU-SP-006.
- Write scope: `.github/workflows/security.yml`.
- Done criteria: workflow runs local runner family command and PR dependency review.
- Acceptance evidence: YAML syntax check and local runner command pass.
- Verification: YAML syntax check, plus `node scripts/security-pipeline/run-check.mjs --family supply-chain --config .github/security-pipeline/checks.yml`.
- Execution owner: local-fallback.
- Handoff note: do not add packaging or release attestations to this MVP workflow.

## Expected Result Shape

```yaml
swu_id: SWU-SP-007
result: pass | flag | block | interrupted
files_touched:
  - .github/workflows/security.yml
validation:
  - yaml syntax check
  - node scripts/security-pipeline/run-check.mjs --family supply-chain --config .github/security-pipeline/checks.yml
blockers:
  - blocker or none
handoff_note: CI readiness and dependency-review status
```
