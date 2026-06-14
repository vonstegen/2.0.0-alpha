# TASK-SP-003: Add Npm Lockfile Adapter

## Objective

Add the first real check adapter: verify dependency-bearing npm package surfaces have committed lockfiles.

## Parent Layer

L0 Skeleton

## Source Contracts

- `docs/security-pipeline/SECURITY-PIPELINE-DESIGN.md`
- `.github/security-pipeline/checks.yml`

## Write Scope

- `scripts/security-pipeline/checks/npm-lockfiles.mjs`
- optional shared result utility

## Implementation Detail

Algorithm:

1. Read the registry entry for `npm-lockfiles`.
2. For each configured surface, read `package.json`.
3. Determine whether `dependencies` or `devDependencies` contain entries.
4. If dependencies exist, require one supported lockfile.
5. Treat a package with no dependencies as pass even if it has no lockfile.
6. Emit a normalized result with per-surface evidence.

Current expected surfaces:

- `.`
- `addons/resonant-browser-host`
- `addons/resonant-browser-native`

Edge case:

- `addons/resonant-browser-native` has scripts but no dependencies. It should pass lockfile presence unless dependencies are later added.

## Smallest Working Units

### SWU-SP-003

- Goal: implement and verify `npm-lockfiles`.
- Dependencies: SWU-SP-001, SWU-SP-002.
- Write scope: `scripts/security-pipeline/checks/npm-lockfiles.mjs`.
- Done criteria: adapter emits pass/fail evidence per npm surface.
- Acceptance evidence: current repo surfaces pass with native add-on skip/pass rationale.
- Verification: `node scripts/security-pipeline/run-check.mjs --check npm-lockfiles --config .github/security-pipeline/checks.yml`.
- Execution owner: local-fallback.
- Handoff note: do not fail merely because a package has scripts; fail when dependency entries lack lockfiles.

## Expected Result Shape

```yaml
swu_id: SWU-SP-003
result: pass | flag | block | interrupted
files_touched:
  - scripts/security-pipeline/checks/npm-lockfiles.mjs
validation:
  - node scripts/security-pipeline/run-check.mjs --check npm-lockfiles --config .github/security-pipeline/checks.yml
blockers:
  - blocker or none
handoff_note: surfaces with missing lockfiles or skip rationale
```
