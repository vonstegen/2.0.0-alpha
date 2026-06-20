# TASK-SP-007: Document Check Lifecycle

## Objective

Document how to add, remove, disable, warn, observe, and promote security checks.

## Parent Layer

L2 Governance

## Source Contracts

- `docs/security-pipeline/GLOSSARY-CONSISTENCY.md`
- `docs/security-pipeline/SECURITY-PIPELINE-DESIGN.md`

## Write Scope

- optional `docs/security-pipeline.md`
- optional comments in `.github/security-pipeline/checks.yml`

## Implementation Detail

Document:

- check families
- registry fields
- policy modes
- promotion lifecycle: `observe -> warn -> block`
- disable/removal expectations
- validation command per adapter
- when to create a new family versus a check

## Smallest Working Units

### SWU-SP-008

- Goal: add security pipeline lifecycle docs.
- Dependencies: SWU-SP-001 through SWU-SP-007.
- Write scope: optional `docs/security-pipeline.md`, optional registry comments.
- Done criteria: docs explain adding and removing checks without editing workflow internals.
- Acceptance evidence: docs include one add-check and one disable-check example.
- Verification: reviewable check against docs.
- Execution owner: local-fallback.
- Handoff note: keep docs concise and tied to actual implemented paths.

## Expected Result Shape

```yaml
swu_id: SWU-SP-008
result: pass | flag | block | interrupted
files_touched:
  - docs/security-pipeline.md
validation:
  - reviewable documentation check
blockers:
  - blocker or none
handoff_note: lifecycle clarity and remaining doc gaps
```
