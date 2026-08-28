# Threat Model and Known Limitations

CP-9 stabilization deliverable. Maps each threat the SDK must resist to the
mechanism that resists it, and records what is deliberately deferred. Authority
lives in ADRs, not this package; these mitigations are the current branch's
implementation of the target rules.

## Threat model

| Threat | Attack | Mitigation (current branch) |
| --- | --- | --- |
| Confused deputy | A harness/add-on induces Core to perform an effect beyond its grant. | Governed-request envelope (`bridge-governed-authority.mjs`): the bridge resolves the opaque grant handle and validates task/principal/chain/audience/time/scope before any effect. Extension dispatcher intersects declared capabilities with the grant (`dispatchGovernedAugmentorExtension`, `effectiveCapabilities`). |
| Token theft | A reusable bearer token leaks from browser storage/logs and is replayed. | Opaque 24-byte `grantHandle` resolved in-memory, never self-contained, never emitted to the audit log; the Phase 3.5 HMAC mint is internal-only. `bridge-redact-audit.mjs` scrubs secret-shaped values as defense-in-depth. |
| Path escape | A payload declares a path outside the granted resource selectors. | `pathsWithinSelectors` + traversal (`..`) rejection in `validateGovernedRequest`; `BaseHarnessProvider` confines artifacts to the workspace root. |
| Event spoofing | A child fabricates a completion/evidence event. | Event stream is host-mediated and cursor-ordered (`HarnessProviderAdapter.events`); results are untrusted until verification (`AugmentorExtensionResult.evidence`, `HarnessResult.verification`). |
| Memory poisoning | A harness writes directly to trusted knowledge. | Trusted-memory boundary: writes flow through intake/provenance/review/promotion (doc 09); the Continuity Gatekeeper mediates reads (`mediateContextRead`) so no actor receives identity/history merely because it is installed. |
| Resource exhaustion | A child exceeds parent budget or starves other harnesses. | `rollUpChildUsage` + `isBudgetExhausted` + `admissionDecision` (hard ceilings, deterministic exhaustion); `ResourceBudget.onExhaustion` (`stop`/`quarantine`/`return-partial`). |
| Recovery persistence | Pre-recovery executable authority survives a Ground-0 entry. | `enterGroundZero` revokes every active grant and quarantines optional items; `reEnableFromGroundZero` issues only fresh grants, never revives old ids. |

## Known limitations (deliberately deferred)

- **Live provider transport** — the Hermes/OpenCode/OpenClaw adapters are wired to
  real `diagnose()` + dispatch, but end-to-end execution (live CLI spawn + Cordis/
  `opencode serve`) is not exercised in this environment; parity and lifecycle
  dedup in `addon-delegation-service.mjs` remain pending (CP-5).
- **Compute Fabric node execution** — the governor consumes ADR-032 *types*; node
  enrollment/execution is deferred, not duplicated (D-7, doc 11).
- **Ground-0 runtime drills** — the state machine is implemented and unit-tested;
  crash-loop/corrupt-state/interrupted-recovery drills run against the live bridge
  are not yet automated.
- **`primary-agent` as an add-on-claimable slot** — the slot id remains in the
  `SystemSlotId` union (it is a real Core slot); validation rejects any add-on
  claim of it (`system-slot-reserved`), but the full slot-severance hardening is
  exercised only at manifest validation, not yet a runtime boot assertion.

These are recorded as integration/CI gaps, not contract gaps; they close in a
live-harness environment.
