# TOM 2026-09-28 — Inherited Acceptance Requirements Traceability

## Purpose

Tom's 2026-09-28 ResonantOS action-item review produced acceptance requirements
that are inherited by the current SDK line. This document makes those
requirements durable and traces each one to current code, tests, and docs so
they cannot be lost as the SDK architecture evolves.

Repository evidence is the only authority for status. Chat history, agent
memory, and generated run artifacts are not.

## Status vocabulary

- **VERIFIED** — a committed test and/or code path demonstrates the requirement
  against current `dev`/baseline evidence; the specific acceptance criterion is
  provably met.
- **PARTIAL** — part of the requirement is implemented/tested; a named,
  concrete sub-criterion is not yet met or not yet proven.
- **OPEN** — no committed implementation/test demonstrates the requirement, or a
  concrete defect remains at the cited site.

A requirement is only marked VERIFIED when direct repository evidence proves it.
"PARTIAL"/"OPEN" name exactly what remains and assign it to a concrete future
gate (Phase 2G or the SDK-review task named below).

---

## TOM-0928-R1 — Trusted installation identity

**Requirement.** Installation must use host-owned/trusted metadata and
destination/endpoint identity. Hostname/lookalike/override paths must fail
closed. Denial must prevent credential delivery/privileged activation.

**Status: PARTIAL.**

**Evidence that is present:**

- Host-owned destination/endpoint identity: the admin endpoint is derived from
  the validated manifest `service.entrypoint` read from the host-owned
  discovery/install cache (`workspaceAddonManifestCache`), never the caller.
  Caller-supplied `upstreamAdminUrl`/`adminToken` fields are rejected with
  `permission-denied` (`browser-first/host/addon-delegation-service.mjs`,
  `executeWorkspaceAddonAdminRevoke`).
- Credential resolution is an internal host-owned lookup keyed by add-on id; the
  resolver is never exposed to the iframe or an add-on
  (`browser-first/host/workspace-addon-credentials.mjs` header "TRUST
  SEMANTICS").
- A non-loopback `service.entrypoint` fails closed at install/discovery with
  `manifest-entrypoint-not-loopback`
  (`browser-first/host/workspace-addon-discovery.mjs`).

**Evidence of the gap (not fail-closed against lookalikes):**

- The loopback validator uses **prefix matching**, not exact loopback:
  `if (lower.startsWith("127.")) return true;`
  (`browser-first/host/workspace-addon-credentials.mjs:105` and
  `browser-first/host/workspace-addon-discovery.mjs:45`). A hostname such as
  `127.evil.example` or `127.0.0.1.evil.example` is accepted as loopback.
- `docs/architecture/ADR-043`-adjacent review doc
  (`SDK-DEMO-003-ARCHITECTURE-MAP.md` §10.1) *claims* "accepts only true
  loopback (`127.0.0.0/8`, `::1`, `localhost`)", but the code does not enforce
  that exact set. This is a documentation/implementation divergence in addition
  to the lookalike gap.

**What remains.** Replace prefix matching with an exact-loopback validator
(`127.0.0.0/8`, `::1`, `localhost` only; no prefix match; DNS re-resolution with
all-answers-loopback at the credential-bearing boundary; redirect refusal).

**Assigned gate.** SDK-review architecture-hardening task
(`feature/sdk-review-architecture-hardening-20260929`) — the exact-loopback
validator (`browser-first/host/loopback-url.mjs`) is implemented on that branch,
not on this branch. Phase 2G must assert the trusted-install identity tests.

---

## TOM-0928-R2 — Explicit fail-closed admin revoke

**Requirement.** An addonId-only or otherwise ambiguous revoke must never
default to broad grant or implicit allow. Intent must be explicit/validated.
Route/upstream state and tests must prove denial.

**Status: OPEN.**

**Evidence of the gap:**

- `browser-first/host/addon-delegation-service.mjs:3099`:
  `const enforcementGranted = granted !== false;`
  A request that omits `granted` (addonId-only) or supplies a non-boolean
  (`granted: "no"`) evaluates to `true`, **granting** the whole add-on surface
  instead of revoking. Intent is not validated as an explicit boolean.

**Evidence that is present (adjacent hardening, not the gap itself):**

- The handler rejects caller-supplied `upstreamAdminUrl`/`adminToken`
  (`permission-denied`) and validates `addonId` is a string; a missing host
  admin credential maps to `permission-denied` before any mutation.

**What remains.** Require `typeof granted === "boolean"`; missing/non-boolean
intent must be a deterministic 4xx with no mutation.

**Assigned gate.** SDK-review architecture-hardening task
(`feature/sdk-review-architecture-hardening-20260929`) — the explicit-boolean
guard is implemented on that branch, not on this branch. Phase 2G must assert
the explicit-admin-revoke intent tests.

---

## TOM-0928-R3 — Upstream unavailable / revocation fail-closed

**Requirement.** When upstream authority is unavailable or revoked, previously
held authority must become unusable according to the defined lifecycle policy.
Ordering, retry/recovery, and fail-closed behavior require evidence.

**Status: PARTIAL.**

**Evidence that is present:**

- Revoke/grant convergence fail-closed
  (`browser-first/host/addon-delegation-service.mjs`):
  `convergeWorkspaceAddonEnforcement` and
  `applyWorkspaceAddonUpstreamEnforcement` fail a grant as `runtime-unavailable`
  (5xx) when the upstream is unreachable and leave the endpoint closed; revoke
  closes upstream first, then persists the registry denial (§11.3 of the review
  architecture map).
- Phase 2B.1 (this change): operation-level stale-authority fencing — an issued
  Project/Files projection whose CURRENT requested∩granted operation set differs
  from the issued set fails closed at `consume()` as `projection-stale`
  (`browser-first/host/harness-resource-projection.mjs`). This is PART of R3,
  not the entire requirement.
- Phase 2C (this change): Skills held-authority revocation — an issued Skills
  projection whose CURRENT harness-session authority, catalog identity (skill
  version/source/requiredCapabilities), or per-skill eligibility differs from
  issuance fails closed at `consume()` as `projection-stale`
  (`browser-first/host/harness-skills-projection.mjs`). This is PART of R3,
  not the entire requirement.

**What remains.** Full lifecycle evidence across authority types: ordering,
retry/recovery, and fail-closed behavior when upstream authority becomes
unavailable for non-filesystem authority (memory/tools, Phase 2D+), and the
held-authority revocation proofs.

**Assigned gate.** Phase 2G qualification (upstream-unavailable fail-closed
tests + held-authority revocation tests).

---

## TOM-0928-R4 — Acceptance/browser enforcement

**Requirement.** Browser/live acceptance must run with a provisioned graphical
environment (Xvfb or repo-approved equivalent) and must fail explicitly rather
than silently weakening the gate. Preserve/document the known headed-Chromium
`$DISPLAY` condition and the previously proven Xvfb path.

**Status: PARTIAL.**

**Evidence that is present:**

- Proven Xvfb path: `.github/workflows/agent-control-live.yml` runs
  `xvfb-run -a npm run test:browser-first:live` (line 99),
  `xvfb-run -a node --test browser-first/test/live-sdk-lane.test.mjs` (line
  154), and `xvfb-run -a npm run test:browser-first:live-sdk` (line 164).
- Documented `$DISPLAY` condition: `browser-first/test/tool-rail-live.test.mjs`
  declares "Requires a headed browser (xvfb)" and skips when
  `!process.env.DISPLAY` with the message
  "no X display for headed Chromium (run under xvfb-run -a)" (lines 3, 57-58).

**What remains.** The local `t.skip(...)` on missing `$DISPLAY` is a silent skip,
not an explicit failure; the 2G gate must assert that the browser acceptance
gate fails (not skips) when the graphical environment is absent in a CI/cert
context. The Xvfb path and `$DISPLAY` condition are documented here and must
remain.

**Assigned gate.** Phase 2G qualification (Xvfb/browser acceptance).

---

## Documentation / root-document violations (9/28 review)

The specific documentation/root-document violations identified in the 9/28
review originate in that review's own item list, which is not committed to this
repository. Their status is therefore recorded as **not enumerable from repo
evidence** and is not fabricated here.

The following documentation/implementation divergences are observable from
current repository evidence and are recorded so they are not lost:

| # | Observable divergence | Site | Status |
| --- | --- | --- | --- |
| 1 | Review doc claims "accepts only true loopback (`127.0.0.0/8`, `::1`, `localhost`)"; code uses `startsWith("127.")` prefix matching. | `SDK-DEMO-003-ARCHITECTURE-MAP.md` §10.1 vs `workspace-addon-credentials.mjs:105`, `workspace-addon-discovery.mjs:45` | OPEN (R1) |
| 2 | Admin-revoke handler requires `{ addonId, granted }` in its error string but never validates `granted` is a boolean, so `granted !== false` broadens to grant. | `addon-delegation-service.mjs:3073` vs `:3099` | OPEN (R2) |

Both are assigned to the SDK-review architecture-hardening task (the branch that
owns the R1/R2 fixes); Phase 2G re-verifies resolution.

---

## Cross-reference

- Phase 2 roadmap and Phase 2G qualification mapping:
  [PI-NATIVE-PHASE-2-ROADMAP.md](PI-NATIVE-PHASE-2-ROADMAP.md).
- Projection lifecycle correction (Phase 2B.1):
  [ADR-043](ADR-043-generic-harness-resource-projection.md).
