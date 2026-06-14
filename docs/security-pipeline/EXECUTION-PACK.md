# Execution Pack: Security Pipeline MVP

## Purpose

Coordinate medium-complexity execution for the security pipeline MVP without executing implementation during Invoke.

## Wave Order

| Wave | Layer | Purpose | Contract |
| --- | --- | --- | --- |
| W0 | L0 | Establish registry, runner, and first adapter | [W0](work-pack/waves/W0-skeleton.md) |
| W1 | L1 | Add supply-chain blocking checks and CI workflow | [W1](work-pack/waves/W1-supply-chain-mvp.md) |
| W2 | L2 | Add lifecycle documentation and validation sync | [W2](work-pack/waves/W2-governance-readiness.md) |

## Parallelization

- TASK-SP-001 must complete before TASK-SP-002.
- TASK-SP-002 must complete before adapter execution can be verified.
- TASK-SP-003, TASK-SP-004, and TASK-SP-005 can share utility code after the runner exists.
- TASK-SP-006 should wait until the workflow shape is clear enough to scan.
- TASK-SP-007 and TASK-SP-008 should happen after the MVP behavior is known.

## Gate Summary

- W0 gate: one local registry-driven check runs successfully.
- W1 gate: supply-chain checks are represented in CI and local runner commands.
- W2 gate: lifecycle docs and validation evidence make future check additions repeatable.

## Task Session Entry

Recommended first SWU:

```text
SWU-SP-001
```

Reason: the registry is the smallest source artifact that proves the abstraction and unlocks runner implementation.
