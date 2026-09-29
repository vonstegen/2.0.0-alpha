# Pi-Native Phase 2 — Roadmap & Qualification

## Purpose

Phase 2 ("Generic Harness Resource Projection") turns the declarative
resource-request contract (Phase 2A) into bounded, host-owned session
projections. This document records the phase plan, the evidence-backed status of
each phase, and the Phase 2G qualification gate. It is the durable roadmap for
this SDK line; issue state and Project 2 remain the release-planning authority.

## Phase status (repository evidence)

| Phase | Scope | Status | Evidence |
| --- | --- | --- | --- |
| 2A | Generic Harness Resource Request contract (request != grant != projection; pure normalization/resolution helpers). | Done | `1a442f7`; `docs/architecture/ADR-042-generic-harness-resource-request.md` |
| 2B | Generic Project + Files projection (authoritative root, requested∩granted operation subset, session identity binding, symlink-aware containment). | Done | `26eb6c7`, `914ff57`; `docs/architecture/ADR-043-generic-harness-resource-projection.md` |
| 2B.1 | Operation-level revocation: an issued projection is fenced when CURRENT operation authority differs (narrowed or expanded); no silent in-place downgrade. | Done (this change) | `browser-first/host/harness-resource-projection.mjs` `consume()`; `CP-B1.3` lifecycle tests |
| 2C | Skills resource family projection. | Done | `browser-first/host/harness-skills-projection.mjs`; `browser-first/test/harness-skills-projection.test.mjs`; `docs/architecture/ADR-044-generic-harness-skills-projection.md` |
| 2G | Qualification gate (below). | Mapped here; not yet executed | This document |

Intermediate phases not yet recorded in repository evidence are intentionally
not enumerated here — no phase is invented.

## Phase 2G — qualification gate

Phase 2G is the qualification gate that certifies the inherited Tom 2026-09-28
acceptance requirements and the Phase 2 revocation lifecycle together. It must
explicitly include:

- **trusted-install identity tests** (TOM-0928-R1): exact-loopback validator, no
  prefix matching, DNS re-resolution with all-answers-loopback, redirect
  refusal at the credential-bearing boundary; lookalike/override paths fail
  closed.
- **explicit admin-revoke intent tests** (TOM-0928-R2): addonId-only /
  non-boolean `granted` is a deterministic 4xx with no mutation; never broad
  grant.
- **upstream-unavailable fail-closed tests** (TOM-0928-R3): unreachable/revoked
  upstream makes previously held authority unusable per the lifecycle policy,
  with ordering/retry/recovery evidence.
- **held-authority revocation tests**: issued projections are fenced when
  current authority narrows or expands (`CP-B1.3` A-E; the Phase 2B.1 fix).
- **cross-harness isolation**: Session A's projection is never reusable as
  Session B; cross-harness/session/project identity denied (`CP-B1.3` F).
- **Xvfb/browser acceptance** (TOM-0928-R4): headed Chromium under `xvfb-run`
  or repo-approved equivalent; the gate fails (not skips) when the graphical
  environment is absent; the known `$DISPLAY` condition and the proven Xvfb path
  are preserved.
- **docs/root-document gate**: the documentation/root-document violations
  recorded in `TOM-2026-09-28-REQUIREMENTS-TRACEABILITY.md` are resolved and the
  docs match the implementation.
- **security/regression suite**: the full security pipeline plus the projection,
  Pi session-credential, Phase 2A resource-contract, harness registry/grant, and
  provider/credential regressions pass.
- **ancestry/integration check**: the qualification branch is verified against
  the SDK review baseline/history (the Phase 2B baseline `914ff57` and the SDK
  review architecture-hardening line) where applicable, so the revocation fix
  and the R1/R2 hardening are not evaluated in isolation.

## Cross-reference

- Inherited Tom 2026-09-28 requirements and evidence:
  [TOM-2026-09-28-REQUIREMENTS-TRACEABILITY.md](TOM-2026-09-28-REQUIREMENTS-TRACEABILITY.md).
