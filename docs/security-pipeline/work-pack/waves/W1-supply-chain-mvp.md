# Wave W1: Supply Chain MVP

## Layer

L1 Supply Chain MVP

## Layer Question

Can the pipeline block meaningful supply-chain risk before alpha packaging?

## Tasks

- [TASK-SP-004](../tasks/TASK-SP-004.md)
- [TASK-SP-005](../tasks/TASK-SP-005.md)
- [TASK-SP-006](../tasks/TASK-SP-006.md)

## Promotion Evidence

- npm dependency checks run per configured surface
- Rust advisory checks run per configured lockfile
- GitHub Actions hardening reports baseline
- security workflow runs the registry-driven checks
- dependency review is PR-gated

## Gate

Do not promote the MVP until local runner commands and workflow syntax checks pass.
