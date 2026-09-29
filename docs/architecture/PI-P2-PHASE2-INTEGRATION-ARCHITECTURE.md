# Pi P2 + Phase II Integration Architecture

**Status:** Design contract — no runtime integration performed by this document  
**Date:** 2026-09-29  
**Reference lines:** Phase-II candidate `2ac7fc8`; AVIS P2 implementation `d545edae`; AVIS P2 evidence `5ac7c248`  
**Integration prerequisite:** Phase 2C staging hardening must be accepted before implementation begins.

## 1. Purpose

Define how the independently proven Pi P2 native launcher is integrated with the Generic Harness Resource Projection architecture without regressing either security model.

AVIS P2 proved that a ResonantOS Settings provider credential can power a real Pi process through a private session environment without persisting the credential in Pi. Phase II independently established generic Project/Files and Skills resource projections with current-grant lifecycle fencing.

The integration MUST compose those systems. It MUST NOT restore raw caller paths, Pi-specific resource authority, or primary-agent slot ownership as launch authority.

## 2. Proven inputs

### 2.1 AVIS P2

Commit `d545edae` adds:
- `pi-process-launcher.mjs`;
- `pi-native-session-service.mjs`;
- NVM-aware `piCommand()` resolution;
- bounded/redacted proof wiring.

Commit `5ac7c248` records the live proof:
- real Pi process;
- OpenRouter provider profile;
- session-environment credential delivery;
- real model inference;
- unchanged Pi `auth.json`;
- post-proof permission-denied revocation.

P2's temporary compromises are NOT integration requirements:
- host-supplied raw `projectPath`;
- authorization coupled to `primary-agent` slot ownership;
- proof-only route as the eventual product UI.

### 2.2 Phase II

Phase II provides:
- generic Harness Resource Request contract;
- Project + Files session projection;
- current-grant stale-projection fencing;
- Skills projection and native Pi skills materialization design.

The accepted invariant remains:

```
RESOURCE REQUEST != CAPABILITY GRANT != SESSION PROJECTION
```

## 3. Target composed session

```
User / ROS UI
     |
     v
Harness Session Request
     |
     +--------------------+
     |                    |
     v                    v
Provider Authority    Resource Authority
     |                    |
Provider Profile       Project/Files Projection
Credential Vault       Skills Projection
Protocol/Model         future Memory/Tools
     |                    |
     +---------+----------+
               |
               v
       Pi Session Composer
               |
       +-------+--------+
       |                |
       v                v
 private env       projected cwd
       |                |
       +-------+--------+
               |
       materialized skills
               |
               v
        bounded Pi launcher
               |
               v
             REAL Pi
               |
        provider / model
               |
               v
            response
               |
               v
        lifecycle cleanup
```

## 4. Replace raw projectPath

P2 currently accepts a host-approved `projectPath`. The integrated service MUST instead consume an authorized Project/Files projection.

Required chain:

```
validated harness request
        ->
current filesystem grant
        ->
Project/Files projection
        ->
consume() at launch time
        ->
projection.cwd
        ->
Pi launcher cwd
```

Rules:
- no public/caller `projectPath` parameter;
- manifest cannot choose cwd;
- stale/revoked projection blocks launch;
- Pi launcher receives cwd only after current-authority revalidation;
- launcher cannot widen the projected filesystem boundary.

## 5. Replace primary-agent slot authorization

P2's proof authorization temporarily depended on Pi owning `primary-agent`. This is incompatible with generic harness/add-on execution because launching Pi must not displace Augmentor or another primary chat agent.

Native harness launch authority MUST derive from authoritative host state:

```
installed
  AND enabled
  AND binding valid
  AND required capability grants active
  AND provider/profile authorized
  AND resource projections valid
  AND executable approved
        ->
launch authorized
```

System-slot ownership may affect UI routing or default-agent behavior, but MUST NOT be a prerequisite for an otherwise authorized native harness session.

The implementation should reuse the existing registry snapshot/binding/grant machinery. Do not create a second authorization database.

## 6. Provider/credential composition

Preserve the audited P1/P1.1/P2 chain:

```
Provider Profile exists
        ->
host-derived protocol compatible
        ->
native Pi provider mapping
        ->
selected model belongs to profile
        ->
binding/grant authorization
        ->
approved Pi executable
        ->
credential resolution
        ->
private session environment
```

The credential:
- never enters argv;
- never enters a resource projection;
- never enters a manifest;
- never enters Skills materialization;
- never enters logs/evidence;
- never writes Pi `auth.json`.

Only environment variable names may cross the redacted evidence boundary.

## 7. Skills composition

Before Pi launch:
1. consume the current Skills projection;
2. materialize only eligible/read-authorized skills into the projection-owned staging tree;
3. use the host-owned Pi layout `.pi/skills/<name>/SKILL.md`;
4. launch Pi from the composed session environment;
5. clean only that projection-owned Skills staging tree after process termination.

Canonical ROS skill sources remain unchanged.

Failure to materialize an authorized required skill must fail the composed session rather than silently broadening access or falling back to an uncontrolled skill location.

## 8. Session composer

Introduce one host-owned composition boundary rather than making the process launcher understand ROS policy.

Conceptual input:

```text
PiSessionComposer
  addonId
  sessionId
  manifest
  providerProfileId
  selectedModel
  ProjectFilesProjection
  SkillsProjection
  prompt / session mode
```

Conceptual responsibilities:
1. revalidate harness authorization;
2. consume current Project/Files projection;
3. consume current Skills projection;
4. materialize Skills;
5. request the private credential launch plan;
6. bind `cwd` to Project projection;
7. invoke bounded Pi launcher;
8. collect sanitized evidence;
9. terminate process;
10. dispose projection-owned staging;
11. release session-only secret material.

The composer must not serialize the private launch plan.

## 9. Launcher boundary

Retain the P2 launcher constraints:
- executable only from `piCommand()`;
- `shell:false`;
- no arbitrary caller argv;
- no `--api-key`;
- bounded prompt;
- bounded stdout/stderr;
- secret redaction;
- bounded timeout;
- deterministic SIGTERM -> SIGKILL;
- private child environment;
- no blanket `process.env` inheritance.

The launcher should remain policy-light: it executes an already-authorized composed plan.

## 10. Pi version qualification

AVIS mechanically observed Pi `0.74.2` on its test host while prior design evidence referenced `0.80.3`.

The integrated runtime MUST record and qualify the executable version actually selected by `piCommand()`.

Provider/model and native-resource compatibility must be checked against the actual executable version, not a stale configuration/changelog value.

Version skew should produce a clear compatibility state rather than silently assuming newer Pi behavior.

## 11. Failure semantics

Fail closed when any of the following occurs:
- harness disabled/revoked;
- binding invalid;
- provider/profile unauthorized;
- protocol incompatible;
- selected model invalid;
- Project/Files projection stale;
- Skills projection stale;
- Skills materialization escapes or fails required ownership checks;
- executable not allowlisted;
- credential unavailable;
- process timeout/launch failure.

No failure may cause fallback to:
- raw caller cwd;
- Pi durable credential store;
- uncontrolled Skills directories;
- primary-agent slot mutation;
- arbitrary executable;
- local model unless explicitly selected and authorized.

## 12. Cleanup ordering

Preferred lifecycle:

```
stop/finish Pi
   ->
close process streams
   ->
discard private credential environment
   ->
cleanup projection-owned Skills staging
   ->
close session projection handles
   ->
record sanitized lifecycle evidence
```

Cleanup failure must be surfaced as a lifecycle error and must never broaden authority.

## 13. Integration test matrix

Minimum acceptance cases:

1. authorized Project + Skills + Provider -> real Pi response;
2. Project projection revoked before launch -> DENY;
3. Project operation changed after issuance -> stale -> DENY;
4. Skills grant changed after issuance -> stale -> DENY;
5. required skill capability absent -> unavailable -> no materialization;
6. provider grant revoked -> DENY;
7. Pi enabled but not primary-agent -> launch still authorized when all required grants/bindings are valid;
8. Pi becoming primary-agent is NOT a side effect of launch;
9. credential absent -> DENY;
10. credential never appears in argv/logs/projections/staging;
11. Pi `auth.json` unchanged;
12. projected cwd equals authorized Project projection cwd;
13. Skills staging cleaned after successful launch;
14. Skills staging cleaned after failed/timed-out launch;
15. another harness/session cannot reuse projections or staging;
16. actual Pi version recorded;
17. incompatible provider/model for actual Pi version -> explicit DENY;
18. synthetic second harness remains unaffected by Pi-specific adapter logic.

## 14. Branch convergence

Do not merge branches blindly.

Implementation should start from the accepted Phase-II line after 2C staging hardening.

Transplant/reimplement the reviewed P2 pieces:
- bounded Pi process launcher;
- native session service/composer concepts;
- NVM executable allowlist support;
- redacted evidence patterns;
- focused launcher/service tests.

Do not transplant:
- raw `projectPath` authority;
- `primary-agent` launch requirement;
- proof-only assumptions that conflict with generic resource projection.

The separate Tom 9/28 R1/R2 hardening line remains independently tracked until its controlled integration checkpoint.

## 15. Implementation checkpoints

### I1 — P2 delta inventory
Map each AVIS P2 file/function to current Phase-II equivalents and identify conflicts.

### I2 — Generic launch authorization
Remove primary-agent slot dependency; prove installed+enabled+binding+grant authorization.

### I3 — Project projection integration
Replace raw `projectPath` with consumed Project/Files projection cwd.

### I4 — Skills composition
Consume/materialize Skills before launch and projection-own cleanup afterward.

### I5 — Bounded launcher transplant
Bring the proven launcher/NVM support onto the current line without weakening resource boundaries.

### I6 — Deterministic integration tests
Run the 18-case matrix without a real credential.

### I7 — Live re-proof
User configures/selects credential through ROS Settings. Run real Pi inference and repeat credential hygiene/auth.json/revocation evidence.

### I8 — Audit
Independent audit before Memory (2D) or terminal/UI work continues.

## 16. Acceptance definition

The integrated Pi reference add-on is accepted when a user can authorize a Pi session through ROS and the host composes provider credentials plus Project/Files plus Skills into a real Pi process without duplicated credentials, raw caller filesystem authority, primary-agent slot displacement, cross-session resource leakage, or persistent session staging.

This integration is the reference pattern for later native harness adapters.