# Tom Review Guide — ResonantOS Browser Architecture (2026-08-27)

This guide walks a reviewer through the review fork
(`origin`, branch `review/tom-2026-08-27`). Everything referenced below is
committed on that branch; nothing depends on a developer's working tree.

## What is in this review

Three layers, in reading order:

1. **The proposed target architecture** — the ResonantOS Browser Architecture
   Package, now tracked in-repo:
   - `docs/architecture/resonantos-browser-architecture/README.md` (start here)
   - Docs `01`–`14` (scope/boundary, core/add-on split, Augmentor orchestrator,
     extension model, harness providers, multi-harness coexistence,
     identity/delegation, task-scoped authority, memory trust, Ground-0
     recovery, resource governance, SDK implications, repo migration map,
     master phased implementation checklist)
   - `ROADMAP.md` — checkpoints CP-0 … CP-9 with exit gates
   - `CHECKLISTS.md` — gate-review and reviewer checklists
   - `docs/architecture/ADR-052-browser-architecture-package.md` — the adoption
     record (status: Proposed, Alpha applicability: Deferred)

2. **The G0-ROS blueprint work** (committed `9d81800`, `a2fdb88`):
   - `docs/architecture/ADR-051-ros-architecture-blueprint.md` — accepted
     blueprint: fused core, vocabulary, category → rail mapping, G0 harness
     tool loop, native-tool supersede
   - `src/sdk/addons/architecture.ts` — the authoritative TypeScript encoding
   - `browser-first/host/ros-architecture-snapshot.mjs` — bridge mirror
   - `browser-first/host/dev-g0-ros-panel.mjs` + `browser-first/dev/g0-ros-panel.html` —
     read-only dev workbench surfacing the blueprint against live manifest discovery
   - `browser-first/test/ros-architecture-snapshot.test.mjs` — drift test pinning
     the mirror to ADR-051

3. **The browser-first extension workbench**:
   - `browser-first/resonantos-side-panel-extension/` — dev channel (0.2.0):
     left rail IA, add-ons management, theme sync, collapsed-rail behavior,
     footer polish, toolbar icon
   - `browser-first/release/` — frozen stable channel (0.1.14) +
     `release/README.md` (channel model and promotion flow)
   - `scripts/launch-cft-extension.mjs`, `scripts/release-extension.mjs`,
     `scripts/cft-extension-icon.mjs` — Chrome-for-Testing launcher, stable
     promotion, toolbar-pin tooling

## How to verify (the important part)

Run these from the branch checkout:

```bash
# 1. Drift test: does the bridge mirror match ADR-051?
node --test browser-first/test/ros-architecture-snapshot.test.mjs

# 2. Documentation contract: is every doc reachable and every ADR indexed?
node scripts/validate-docs.mjs

# 3. Stable channel smoke (frozen 0.1.14, CDP 9225):
npm run cft:stable

# 4. Dev channel smoke (0.2.0, CDP 9224):
npm run cft:extension

# 5. Full repository verification (heavier; optional on review):
npm run verify:alpha
```

Then, with the dev bridge running (`npm run browser-first:bridge`), open
`http://127.0.0.1:<port>/dev/g0-ros` and confirm the architecture section
matches ADR-051 section by section.

## What to check (review checklist)

The complete reviewer checklist is `CHECKLISTS.md` §1 and §5. The highest-value
checks:

1. Doc 13's migration map cites real files — spot-check three of them.
2. ROADMAP.md's checkpoint map matches doc 14's phases 1:1 with no dropped gates.
3. Every `MUST` in docs 01–12 has an enforcing test or route named in doc 14.
4. The two-channel split is real: `browser-first/release/` is frozen at the
   commit stamped in its `release-info.json`; the dev dir carries 0.2.0.
5. The cross-phase non-negotiables (doc 14) are not violated by any current code.
6. Nothing in this package broadens the Alpha runtime beyond extension +
   authenticated local bridge.

## What this review is not

- ADR-052 is **Proposed** and **Deferred for Alpha**: the package documents a
  target; it changes no runtime behavior until the checkpoint ADRs land.
- Doc 13's "Proposed ADR set" has not been written yet — the checkpoint roadmap
  sequences them; CP-0 is the only active checkpoint.
- The dev-channel UI work (rail IA, icons, launcher) is working-tree work
  snapshotted onto this branch for review; the stable channel remains the
  authoritative SDK surface.

## Agentic review note

This branch is written to be consumable by AI reviewers as well as humans.
Point an agent at this URL, instruct it to read this guide first, then work
through `CHECKLISTS.md` §1 and §5. Everything the agent needs is in-repo:

- reading order, expected verification commands, and the exact review-output
  format are specified above;
- all file paths in docs 01–14 and this guide are branch-relative;
- prerequisites: Node `>=22.13.0` (`.nvmrc`) for the drift test and docs
  validation; Chrome for Testing + the local bridge for the interactive smoke
  steps only.

## Known baseline state

The full test suite currently reports 8 failures on this snapshot:
7 pre-existing environmental failures and 1 failure in the parallel
`addon-sdk-testing` work (driven by `examples/addons/addon.hello-resonant.json`).
Reviewers should not spend time on these; the authoritative gates for this
review are the two commands in "How to verify": the drift test and docs
validation, both of which pass on this branch.


## Expected review output

Line-anchored comments on the branch, grouped by the three layers above, with
one of: `agree`, `disagree + reason`, `question`, or `gate evidence requested`
(per checkpoint).
