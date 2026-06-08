# PR Guide: Security Pipeline → ResonantOS/2.0.0-alpha

**For:** Vlad (vrondelli)
**Target repo:** `ResonantOS/2.0.0-alpha`
**Target branch:** `dev`

---

## Overview

Your security pipeline design and L0 implementation belong in the main repo. This guide walks you through getting your work into a proper PR with full contributor credit.

## Step 1: Fork the current repo (if you haven't already)

Your existing fork (`vrondelli/resonantos-vnext`) is based on an older snapshot. The active repo has moved to `ResonantOS/2.0.0-alpha`:

```bash
# Fork via GitHub UI:
# https://github.com/ResonantOS/2.0.0-alpha → Fork button

# Then clone your fork
git clone https://github.com/vrondelli/2.0.0-alpha.git
cd 2.0.0-alpha
git remote add upstream https://github.com/ResonantOS/2.0.0-alpha.git
git fetch upstream
git checkout -b security-pipeline upstream/dev
```

## Step 2: Port your files into the right locations

The repo already has `.github/workflows/alpha-build.yml`. Your security pipeline goes alongside it. Here's the target layout:

```
.github/
  security-pipeline/
    checks.yml                          ← Your registry (SWU-SP-001)
  workflows/
    alpha-build.yml                     ← Already exists, don't touch
    security.yml                        ← Future: your workflow (SWU-SP-007)

scripts/
  security-pipeline/
    run-check.mjs                       ← Your runner (SWU-SP-002)
    checks/
      npm-lockfiles.mjs                 ← Your first adapter (SWU-SP-003)

docs/
  security-pipeline/
    SECURITY-PIPELINE-DESIGN.md         ← Your architecture doc
    IMPLEMENTATION-LAYERING.md          ← Your layering plan
    WORK-PACK.md                        ← Your task board
```

### What to include

**Code files (from your local SWU-SP-001/002/003 execution):**
- `.github/security-pipeline/checks.yml`
- `scripts/security-pipeline/run-check.mjs`
- `scripts/security-pipeline/checks/npm-lockfiles.mjs`

If you don't have the code files saved from your Codex session, rebuild them from your task specs — the designs are thorough enough to reproduce exactly. The TASK-SP-001/002/003 specs are the contracts.

**Design docs (from your branch):**
- `docs/security-pipeline/SECURITY-PIPELINE-DESIGN.md`
- `docs/security-pipeline/IMPLEMENTATION-LAYERING.md`
- `docs/security-pipeline/WORK-PACK.md`

### What NOT to include
- `development/` directory (Arcanum execution artifacts — not needed in the product repo)
- `refinement-runs/` (internal process)
- `research/` (keep for reference but not in PR scope)
- Any files from the old `resonantos-vnext` snapshot (README, BUILD-PLAN, QA reports, etc.)

## Step 3: Verify it works

The repo now has `npm` and full Node available. Run your validation commands:

```bash
# List checks
node scripts/security-pipeline/run-check.mjs --list \
  --config .github/security-pipeline/checks.yml

# Run lockfile check
node scripts/security-pipeline/run-check.mjs --check npm-lockfiles \
  --config .github/security-pipeline/checks.yml

# Make sure you haven't broken anything
npm test          # Should be 296/296
npm run build     # Should pass clean
```

## Step 4: Verify lockfile surfaces

The current repo has these npm surfaces (verify your `checks.yml` covers them):

```
.                                    ← root (has package-lock.json ✅)
addons/resonant-browser-host/        ← has package.json (check if lockfile exists)
addons/resonant-browser-native/      ← has package.json (no deps — should pass without lockfile per your design)
```

The old `server/` surface from your fork doesn't exist in this repo. Remove it from `checks.yml` if present.

## Step 5: Set your commit author correctly

Make sure your commits use your real identity for contributor credit:

```bash
git config user.name "Vladimir Rondelli"
git config user.email "rondelli.vladimir@gmail.com"
```

This ensures GitHub links your commits to your profile and you show up in the Contributors tab.

## Step 6: Commit and push

```bash
# Stage your files
git add .github/security-pipeline/checks.yml
git add scripts/security-pipeline/run-check.mjs
git add scripts/security-pipeline/checks/npm-lockfiles.mjs
git add docs/security-pipeline/SECURITY-PIPELINE-DESIGN.md
git add docs/security-pipeline/IMPLEMENTATION-LAYERING.md
git add docs/security-pipeline/WORK-PACK.md

# Commit with a clear message
git commit -m "feat: Add registry-driven security pipeline (L0 skeleton)

- Add declarative check registry at .github/security-pipeline/checks.yml
- Add Node-based runner CLI (run-check.mjs) with list/filter/execute
- Add npm-lockfiles adapter for supply-chain validation
- Include architecture design, layering plan, and work-pack docs

Implements SWU-SP-001, SWU-SP-002, SWU-SP-003 from the security
pipeline work-pack. Remaining adapters (npm-audit, rust-audit,
actions-hardening) and the security.yml workflow are ready for
follow-up PRs per the documented wave plan.

Co-designed with the ResonantOS Hot Rod Rig v4 review methodology."

# Push to your fork
git push origin security-pipeline
```

## Step 7: Open the PR

Go to: `https://github.com/ResonantOS/2.0.0-alpha/compare/dev...vrondelli:2.0.0-alpha:security-pipeline`

**PR Title:** `feat: Security pipeline L0 — registry, runner, and lockfile adapter`

**PR Body (template):**

```markdown
## What

Registry-driven CI security pipeline for automated supply-chain validation.

Architecture: GitHub event → check registry → runner → adapters → normalized results.

## What's included

- `.github/security-pipeline/checks.yml` — declarative check registry
- `scripts/security-pipeline/run-check.mjs` — CLI runner (list, filter, execute)
- `scripts/security-pipeline/checks/npm-lockfiles.mjs` — first adapter
- `docs/security-pipeline/` — design, layering, and work-pack docs

## What's next (follow-up PRs)

- [ ] SWU-SP-004: npm audit adapter
- [ ] SWU-SP-005: Rust advisory adapter  
- [ ] SWU-SP-006: Actions hardening adapter
- [ ] SWU-SP-007: security.yml GitHub Actions workflow
- [ ] SWU-SP-008: Documentation and governance

## Validation

```bash
node scripts/security-pipeline/run-check.mjs --list --config .github/security-pipeline/checks.yml
node scripts/security-pipeline/run-check.mjs --check npm-lockfiles --config .github/security-pipeline/checks.yml
npm test  # 296/296
```

## Context

Designed using the Arcanum/Craft methodology. Architecture reviewed in
the Hot Rod Rig v4 analysis (docs/THE-HOT-ROD-RIG-V4.md, Layer 5).
```

## Step 8: Contributor credit (automatic)

Once the PR is merged, GitHub automatically adds you to the **Contributors** list on the repo. Your commits will show your avatar and link to your profile.

Additionally, Tom can add you to the repo's `CONTRIBUTORS.md` or the README acknowledgments. Your work is already credited in `docs/THE-HOT-ROD-RIG-V4.md` under the Attribution section:

> **Vlad (vrondelli)** — CI security pipeline design + implementation (registry, runner, adapters)

## Quick reference: What changed in the repo since your fork

Since your `resonantos-vnext` snapshot, the active repo (`ResonantOS/2.0.0-alpha`) has:
- Moved from `tompennington/resonantos-vnext` → `ResonantOS/2.0.0-alpha`
- Added browser-first Chromium extension path (`browser-first/`)
- Added Resonant Context SDK (`src/sdk/resonant-context/`)
- Operation Nightwatch security hardening (17 fixes, June 8)
- 296 frontend tests + 144 Rust tests
- CI already runs `npm run test:browser-first` and packages the extension

Your pipeline plugs in cleanly — the CI workflow, scripts directory, and docs structure are all waiting for it.

---

**Questions?** Ping in #resonantos or open a draft PR and we'll help you through it.

Welcome aboard. 🔥
