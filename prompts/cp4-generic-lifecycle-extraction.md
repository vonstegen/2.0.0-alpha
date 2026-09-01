# Prompt: CP-4 Generic Lifecycle Extraction

**Branch:** `feat/dev-external-agent-runtimes-panel` (worktree `.../worktrees/feat-dev-panel`)
**Last synced HEAD:** `bce7cf7`
**Status of this prompt:** ready to run

## Goal

Eliminate the provider-specific lifecycle duplication that still lives in the legacy
`addon-delegation-*` services. The new generic adapter `BaseHarnessProvider`
(`src/sdk/harnesses/base-harness-provider.ts`) already implements the full
contract (start / sendMessage / status / events / cancel / resume /
describeArtifact / diagnose / cancelBridge). The two `.mjs` services reimplement
those methods per-provider.

**End state:** `browser-first/host/addon-delegation-host-service.mjs` (16K, 397
lines) and `browser-first/host/addon-delegation-service.mjs` (95K, 2257 lines)
become thin glue over the generic adapter + a per-provider `HarnessProviderAdapter`
implementation. CP-5's "Remove duplicated provider lifecycle logic" (currently
`not-started`) then becomes a one-line status flip.

## Constraints (non-negotiable)

1. **No live key required.** Live-only tests stay live-only; parity tests must
   pass on the existing fixtures.
2. **`engineer:verify` must stay green** (type-check + SDK vitest + browser-first
   extension tests + docs:check + recipes + security pipeline + project-sync).
3. **`docs:check` (`node scripts/validate-docs.mjs`) must stay green.** Any new
   doc cross-reference is a markdown link (not backtick-quoted), and every
   touched file must remain reachable from its entrypoint.
4. **No dead code left behind.** Migration is full cutover: remove the old
   provider-specific branches once the generic path covers them. No
   "compatibility shim", no `// removed in next PR`.
5. **`docs/architecture/resonantos-browser-architecture/IMPLEMENTATION_TRACKING.md`**
   reflects reality before commit (CP-4 row "Extract generic
   start/status/events/cancel/artifact" flips from `seeded` to `done`; CP-5 row
   "Remove duplicated provider lifecycle logic" flips to `seeded` only after
   parity tests pass, or to `done` if you complete it in the same change).
6. **Doc 14 checkbox** "Extract generic start/status/events/cancel/artifact
   lifecycle from delegation services" flips to `[x]`.

## Scope (what "done" means)

### Phase 1 — Map the duplication

Read both services end-to-end and produce a migration table with one row per
provider-specific method:

| Service | Symbol | Per-provider branch? | Generic counterpart in `BaseHarnessProvider` | Migration cost |

Fill this table BEFORE editing. It is the contract for the rest of the work.

### Phase 2 — Migrate one provider end-to-end

Pick the provider with the **lowest blast radius** (smallest blast radius =
least coupling to other systems, most coverage from existing tests). Recommended
heuristic: the one whose existing test in `browser-first/test/` most resembles
the new parity contract. Land that one fully — generic path + per-provider
implementation that extends `BaseHarnessProvider` — before touching the next.

### Phase 3 — Repeat for the remaining providers

Land the rest one provider per commit, so each commit is independently
reviewable and bisectable. Each commit:

1. Migrates one provider.
2. Keeps the old branch behind a `if (provider === "X")` guard only while its
   parity tests don't yet exist; **delete the guard the same commit the parity
   tests land**.
3. Updates `IMPLEMENTATION_TRACKING.md` to reflect the migrated provider.
4. Re-runs `node scripts/run-browser-first-extension-tests.mjs`.

### Phase 4 — Final cutover

When all providers are migrated:

- Delete the remaining old branches and the provider-specific helper methods.
- Confirm `addon-delegation-service.mjs` is now thin glue (target: under ~600
  lines; the 95K / 2257-line version should shrink dramatically).
- Update `IMPLEMENTATION_TRACKING.md` CP-4 + CP-5 rows.
- Check doc 14 boxes.
- Run the full `engineer:verify` gate.

## Acceptance

- [ ] Migration table committed (Phase 1 artifact — keep it as a doc or PR
      description; do not land it in-tree unless it's referenced from another
      doc, in which case it must be reachable from its entrypoint).
- [ ] All providers use `BaseHarnessProvider`. No per-provider lifecycle code
      remains in `addon-delegation-*.mjs`.
- [ ] `addon-delegation-service.mjs` line count reduced by ≥ 50%.
- [ ] `engineer:verify` green.
- [ ] `docs:check` green.
- [ ] `IMPLEMENTATION_TRACKING.md` CP-4 row: `done`. CP-5 row "Remove duplicated
      provider lifecycle logic": `done` (or `seeded` only with explicit reason
      why a follow-up commit is needed).
- [ ] Doc 14 CP-4 checkbox: `[x]`.

## Steps

```bash
cd ~/Developer/Projects/2.0.0-alpha.worktrees/feat-dev-panel
git status --short                      # expect: clean
git log --oneline -1                    # expect: bce7cf7 or later
git fetch -q origin
# Phase 1: read & map
wc -l browser-first/host/addon-delegation-*.mjs
# Read both files in full (use offset/limit ranges, not whole-file dumps).
# Build the migration table; do not start editing until it's complete.

# Phase 2+: edit, test, commit (one provider per commit).
# Per-provider loop:
git add -p                                # review each hunk
node scripts/run-browser-first-extension-tests.mjs
git commit -q -m "refactor(cp4): migrate <provider> to BaseHarnessProvider"

# Phase 4: full gate
npm run engineer:verify                   # MUST end green
npm run docs:check                        # MUST end green
git commit -q -m "refactor(cp4): final cutover — remove duplicated lifecycle"
git push origin feat/dev-external-agent-runtimes-panel
```

## Risks to watch

- **Status/event ordering** — `BaseHarnessProvider` guarantees an ordering;
  the old service does not. Migration must preserve the observable event
  sequence tests depend on.
- **Bridge-resume semantics** — `resumeBridge` is not the same as
  `restartProvider`. Don't fold them.
- **Provider-specific `cancelBridge` overrides** — some providers override the
  bridge-cancel timeout. Preserve the override; do not silently move it to
  the generic default.
- **Workspace lease interaction** — OpenCode's lease is enforced by the old
  service. Migration must keep the lease check or move it to the adapter
  (tracked separately under CP-5 "workspace lease enforcement").

## Do NOT

- Touch `feat/tab-referencing` or the CP workstream's main worktree.
- Open PR #327 or #334 (Tom review only).
- Add a live-key dependency. If a test requires live access, mark it
  `live-only` (parity tests must not).
- Force-push. Rebase/drop only.
- Modify `browser-first/release/**` by hand.
- Introduce a compatibility shim or `TODO: migrate` comment.

## Open-decision log

If the work surfaces a decision (e.g. "where should the per-provider `cancel`
override live?"), append it to the relevant ADR's Decision Metadata, not to
this prompt.

## Out of scope

- The CP-5 "Remove duplicated provider lifecycle logic" follow-up row is
  resolved by this work; do not start it separately.
- Anything in the REF/SDK workstream.
