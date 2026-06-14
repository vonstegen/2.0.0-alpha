# Implementation Layering: Security Pipeline

## Invoke Metadata

- Mode: `plan`
- Target artifact: ResonantOS modular security pipeline
- Source design: `docs/security-pipeline/SECURITY-PIPELINE-DESIGN.md`
- Mode contract: Arcanum plan mode
- Complexity: medium

## Layer Summary

| Layer | Question | Output Boundary | Promotion Evidence |
| --- | --- | --- | --- |
| L0 Skeleton | Can the repo declare security checks and run one local adapter deterministically? | registry, runner, lockfile adapter | local registry validation and lockfile check pass |
| L1 Supply Chain MVP | Can the pipeline block meaningful supply-chain risk? | npm, Rust, action-hardening, dependency-review checks | CI and local commands prove high-risk failures block |
| L2 Governance | Can checks be added, removed, warned, observed, and promoted safely? | policy modes, docs, result envelope, disabled check handling | check lifecycle documented and tested |
| L3 Release Integrity | Can security evidence connect to release artifacts? | SBOM/provenance/attestation hooks | deferred until MVP and alpha build boundary are stable |

## L0: Skeleton

Goal: prove the security control plane can read a registry, select enabled checks, and run one adapter without touching source code.

Required outputs:

- `.github/security-pipeline/checks.yml`
- `scripts/security-pipeline/run-check.mjs`
- `scripts/security-pipeline/checks/npm-lockfiles.mjs`

Promotion evidence:

- `node scripts/security-pipeline/run-check.mjs --list --config .github/security-pipeline/checks.yml`
- `node scripts/security-pipeline/run-check.mjs --check npm-lockfiles --config .github/security-pipeline/checks.yml`
- invalid registry fixture or malformed entry fails with a clear message

## L1: Supply Chain MVP

Goal: make the first security family useful enough for CI.

Required outputs:

- `npm-audit` adapter
- `rust-audit` adapter
- `actions-hardening` adapter
- `.github/workflows/security.yml`
- dependency review job on pull requests

Promotion evidence:

- npm checks use `npm ci --ignore-scripts` before audit.
- `npm audit --audit-level=high` is run per dependency-bearing npm surface.
- Rust advisory checks cover `src-tauri/Cargo.lock` and `crates/resonator-control/Cargo.lock`.
- workflow hardening detects broad permissions, risky triggers, or unpinned third-party actions.
- dependency review blocks high or critical vulnerable dependency changes on PRs.

## L2: Governance

Goal: make security checks maintainable after MVP.

Required outputs:

- documented policy lifecycle: `observe -> warn -> block -> disabled`
- normalized result envelope
- local validation command for each adapter
- guidance for adding/removing checks

Promotion evidence:

- a disabled check is skipped without failing CI.
- a `warn` check records a warning but does not fail.
- a `block` check fails when its adapter returns failure.

## L3: Release Integrity

Goal: connect security evidence to packaged artifacts.

Deferred outputs:

- SBOM generation
- artifact attestation hooks
- provenance verification
- release package integrity checks

Deferral reason:

The alpha build boundary and supply-chain MVP should stabilize first. GitHub artifact attestations and SBOM generation are release-adjacent controls, not required to prove the initial pipeline abstraction.

## Layer Gates

- Do not start L1 until L0 can list and run at least one check locally.
- Do not promote `actions-hardening` to `block` until current workflow pinning expectations are explicitly decided.
- Do not start L3 until the MVP pipeline is stable in CI and alpha packaging boundaries are documented.
