# Agent-First Documentation Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the repository to one accurate, testable documentation and contribution system optimized for a coding agent collaborating with a human developer.

**Architecture:** Five canonical entrypoints (`AGENTS.md`, `README.md`, `INSTALL.md`, `CONTRIBUTING.md`, and `docs/README.md`) form the only default reading path. Product truth is generated or maintained in a small set of undated canonical references; dated audits, execution plans, model research, and machine-local evidence are removed from the working tree after durable decisions are extracted. Deterministic validation prevents broken commands, stale runtime claims, and local-machine artifacts from returning.

**Tech Stack:** Markdown, Node.js ESM, `node:test`, npm scripts, GitHub Actions, Chrome Manifest V3, Node bridge, GitHub Project 2.

## Global Constraints

- The 2.0.0 Alpha runtime is the Chrome Manifest V3 extension plus the local Node.js bridge.
- Tauri, Electron, native CEF, Rust/Cargo, terminal add-ons, and Audio2TOL are not Alpha runtime or validation requirements.
- Start implementation in an isolated worktree based on current `origin/dev`; the existing checkout is dirty, two commits ahead, and six commits behind.
- Preserve the current browser-control and Blackboard work. Do not reset, clean, rebase, or delete the existing checkout.
- Tracked historical files may be deleted after durable facts are migrated because Git retains their history.
- Untracked files have no Git recovery path; archive them outside the repository before deletion.
- Never commit browser profiles, cookies, login databases, provider secrets, generated bridge tokens, local agent configuration, screenshots, run evidence, or model transcripts.
- Branch from `dev`, open a PR into `dev`, and never push directly to `dev` or `main`.
- Every documented command must exist and pass in the same PR.
- Documentation cleanup must not change runtime behavior except for explicit validation scripts, package metadata, ignore rules, and CI triggers.

---

## Target Documentation Tree

```text
AGENTS.md                         Agent operating contract and reading order
README.md                         Product boundary and five-minute quick start
INSTALL.md                        One complete extension + bridge installation path
CONTRIBUTING.md                   Human/agent contribution workflow and definition of done
SECURITY.md                       Security reporting and live Alpha boundaries
CHANGELOG.md                      Consolidated release history
CODE_OF_CONDUCT.md                Community behavior expectations
SUPPORT.md                        Support and issue-routing policy
docs/README.md                    Task-oriented documentation index
docs/STATUS.md                    Current generated/verified Alpha facts only
docs/ROADMAP.md                   Future work linked to GitHub issues and Project 2
docs/PROJECT_GOVERNANCE.md        Issues, Project 2, labels, status transitions, ownership
docs/architecture/README.md       ADR index with status and scope
docs/architecture/ALPHA_RUNTIME_BOUNDARY.md
docs/architecture/MODULE_MAP.md
docs/architecture/MODULE-OWNERSHIP.md
docs/product/PRODUCT_GUIDE.md     Stable user workflows; no status or roadmap claims
docs/release/ALPHA_DISTRIBUTION.md
docs/reference/CAPABILITY_MATRIX.md
browser-first/README.md           Component-local extension overview
browser-first/host/README.md      Component-local bridge overview
addons/*/README.md                Add-on-local instructions only
```

No dated audit, run report, PR plan, session-memory note, external model evaluation, or generated evidence file belongs in the default documentation tree.

---

### Task 1: Preserve Current Work And Establish A Clean Baseline

**Files:**
- Read: `.git/`, `AGENTS.md`, `README.md`, `CONTRIBUTING.md`
- Create outside repo: backup manifest and archive for untracked material
- Worktree: `/Users/dr.tom/2.0.0-alpha-docs-cleanup`

**Interfaces:**
- Consumes: current dirty checkout and `origin/dev`
- Produces: isolated cleanup branch with no runtime-file overlap

- [ ] Record the existing checkout without modifying it.

```bash
cd /Users/dr.tom/2.0.0-alpha
git status --short --branch
git rev-parse HEAD
git diff --stat
git ls-files --others --exclude-standard -z | xargs -0 shasum -a 256
```

Expected: local `dev` reports ahead 2, behind 6; browser-control and Blackboard work remains untouched.

- [ ] Fetch remote history and create an isolated documentation worktree.

```bash
git fetch origin --prune
git worktree add -b docs/agent-first-cleanup /Users/dr.tom/2.0.0-alpha-docs-cleanup origin/dev
```

Expected: new worktree starts at current `origin/dev` and includes the Project 2 sync workflow and script.

- [ ] Copy this plan into the isolated branch, then commit only the plan.

```bash
mkdir -p /Users/dr.tom/2.0.0-alpha-docs-cleanup/docs/superpowers/plans
cp /Users/dr.tom/2.0.0-alpha/docs/superpowers/plans/2026-07-10-agent-first-documentation-cleanup.md /Users/dr.tom/2.0.0-alpha-docs-cleanup/docs/superpowers/plans/
cd /Users/dr.tom/2.0.0-alpha-docs-cleanup
git add docs/superpowers/plans/2026-07-10-agent-first-documentation-cleanup.md
git commit -m "docs: Add agent-first documentation cleanup plan"
```

### Task 2: Quarantine Sensitive And Generated Repository Noise

**Files:**
- Modify: `.gitignore`
- Create: `scripts/check-repo-hygiene.mjs`
- Create: `scripts/check-repo-hygiene.test.mjs`
- Preserve outside repo: `output/`, `runs/`, browser profiles, ZIPs, local agent configuration

**Interfaces:**
- Consumes: repository path inventory
- Produces: deterministic rejection of machine-local artifacts

- [ ] Write failing tests covering forbidden repository artifacts.

Test fixtures must reject: Chromium `Cookies`, `Login Data`, `History`, `Web Data`, `Local State`; `output/`; `runs/`; `*.zip`; `.abacusai/`; `.codex/`; `.understand-anything/`; embedded virtual environments; absolute `/Users/dr.tom/` references outside historical fixtures; files over 10 MiB unless allowlisted.

Run:

```bash
node --test scripts/check-repo-hygiene.test.mjs
```

Expected: FAIL because the checker does not yet exist.

- [ ] Implement `scripts/check-repo-hygiene.mjs` as a pure inventory scanner with exported `classifyPath(path, stat)` and `scanRepository(root)` functions plus a CLI that exits nonzero on violations.

- [ ] Extend `.gitignore` with:

```gitignore
# Local evidence and browser profiles
output/
runs/
*.zip

# Repository-local agent and analysis state
.abacusai/
.codex/
.understand-anything/

# Local browser profile databases and report environments
**/Cookies
**/Login Data
**/History
**/Web Data
**/Local State
**/.venv/
**/venv/
```

- [ ] Quarantine the current checkout's untracked profiles and evidence to an external dated archive before any deletion. Do not copy `node_modules` or regenerate evidence inside the cleanup worktree.

- [ ] Re-run the hygiene tests and scanner.

```bash
node --test scripts/check-repo-hygiene.test.mjs
node scripts/check-repo-hygiene.mjs
```

Expected: PASS in the isolated clean worktree.

### Task 3: Build The Documentation Contract Validator First

**Files:**
- Create: `scripts/validate-docs.mjs`
- Create: `scripts/validate-docs.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Markdown files, `package.json`, repository paths, canonical-doc allowlists
- Produces: `npm run docs:check`

- [ ] Add failing tests for these exact rules:

1. Every local Markdown link and anchor resolves.
2. Every documented `npm run <name>` exists in `package.json`.
3. Normative docs cannot positively prescribe Tauri, Electron, CEF, Rust/Cargo, `src-tauri`, or native packaging as Alpha work.
4. Normative docs cannot name `browser-first-preview`, `main` as the development branch, or fixed historical test counts as current truth.
5. Normative docs cannot contain founder-specific absolute paths.
6. Only `docs/STATUS.md` may claim to be the current status source of truth.
7. Every ADR appears in `docs/architecture/README.md` with `Accepted`, `Deferred`, `Superseded`, or `Historical` status and Alpha applicability.
8. Required entrypoints exist and link to one another in the canonical order.
9. Node-version claims agree with `package.json`, `.nvmrc`, CI, and installed dependency engine floors.

Run:

```bash
node --test scripts/validate-docs.test.mjs
```

Expected: FAIL against the current documentation set.

- [ ] Implement the validator with exported functions `extractMarkdownLinks`, `extractNpmScripts`, `validateCanonicalClaims`, `validateAdrIndex`, and `validateRepositoryDocs`.

- [ ] Add package scripts:

```json
"docs:check": "node scripts/validate-docs.mjs",
"test:docs": "node --test scripts/validate-docs.test.mjs scripts/check-repo-hygiene.test.mjs"
```

- [ ] Keep the failing output as the cleanup inventory; do not weaken checks to make stale docs pass.

### Task 4: Rewrite The Five-File Contributor Front Door

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Create/replace: `INSTALL.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/README.md`
- Create: `.nvmrc`
- Modify: `package.json`

**Interfaces:**
- Consumes: actual package scripts and browser-first runtime
- Produces: one deterministic reading and contribution path

- [ ] Rewrite `AGENTS.md` under these exact headings:

```text
Repository Mission
Alpha Runtime Boundary
Required Reading Order
Git And GitHub Rules
Ownership And Scope Rules
Secrets And Local State
Change-To-Check Matrix
Definition Of Done
Prohibited Actions
```

State: branch from current `dev`; PR into `dev`; never push directly to `dev` or `main`; preserve unrelated dirty work; read module ownership before cross-module changes; use Project 2 as release planning truth; never use chat history as repository authority.

- [ ] Rewrite `README.md` to describe only the extension + bridge Alpha, provide the five-minute quick start, and link to `INSTALL.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/STATUS.md`, and `docs/README.md`.

- [ ] Merge valid setup content from `browser-first/INSTALL.md` and the untracked `docs/onboarding.md` into root `INSTALL.md`. Document environment variables only when the launcher actually loads them; otherwise instruct users to export them in the bridge process environment.

- [ ] Rewrite `CONTRIBUTING.md` so the first workflow is `npm install`, `npm run browser-first:bridge`, load unpacked extension, make a feature branch, run the change-specific checks, and open a PR into `dev`. Remove all Rust/Tauri guidance from Alpha contribution instructions.

- [ ] Rewrite `docs/README.md` as a task-oriented router: understand runtime, change extension, change bridge, change provider routing, change Agent Control, change Living Archive, change add-on, change docs, release Alpha, inspect history.

- [ ] Set `.nvmrc` to `22.13.0` and `package.json.engines.node` to `>=22.13.0`, matching dependency floors and the Node 22 CI line.

- [ ] Run:

```bash
npm run docs:check
npm run test:docs
```

Expected: contributor-front-door checks pass; remaining failures point only to documents scheduled for consolidation/removal.

### Task 5: Consolidate Installation, Status, Roadmap, And Capability Truth

**Files:**
- Create: `docs/STATUS.md`
- Create: `docs/ROADMAP.md`
- Create: `docs/reference/CAPABILITY_MATRIX.md`
- Rename/rewrite: `docs/PRODUCT_GUIDE_BROWSER_FIRST.md` -> `docs/product/PRODUCT_GUIDE.md`
- Rename/refine: `docs/ALPHA_DISTRIBUTION.md` -> `docs/release/ALPHA_DISTRIBUTION.md`
- Modify: `CHANGELOG.md`
- Delete after merge: `browser-first/INSTALL.md`
- Delete after merge: `CHANGELOG-P0-FIXES.md`

**Interfaces:**
- Consumes: code/package facts, GitHub issues, Project 2, existing inventories
- Produces: one status source, one roadmap, one feature matrix, one install path

- [ ] Generate `docs/STATUS.md` from verifiable facts only: package version, extension manifest version, branch policy, runtime components, last validated commands, known failing gates, and links to GitHub issues. Do not copy test counts unless generated by the current run.

- [ ] Create `docs/ROADMAP.md` with Alpha MVP, Community Test, Beta.1, Beta.2, Deferred, Experimental, and Native Future sections. Each entry must link to a GitHub issue or Project 2 view; no free-floating TODO list.

- [ ] Replace overlapping feature lists with `docs/reference/CAPABILITY_MATRIX.md`, including capability, implementation path, status, safety boundary, primary issue, deterministic test, and live-proof requirement.

- [ ] Replace `docs/PRODUCT_GUIDE_BROWSER_FIRST.md` with `docs/product/PRODUCT_GUIDE.md`, reducing the 998-line status/roadmap mixture to stable product concepts and user workflows. Move volatile status into `STATUS.md`, planned work into `ROADMAP.md`, and implementation detail into the capability matrix.

- [ ] Merge still-valid P0 changelog entries into `CHANGELOG.md`, then delete `CHANGELOG-P0-FIXES.md`.

- [ ] Merge unresolved, current release facts from untracked `docs/ALPHA-RELEASE-PLAN.md` and `docs/SECURITY-REMEDIATION-PLAN.md` into `docs/release/ALPHA_DISTRIBUTION.md`; archive the untracked originals externally rather than committing them.

- [ ] Delete `browser-first/INSTALL.md` after root `INSTALL.md` contains every valid component-specific instruction and inbound links are updated.

### Task 6: Establish Architecture And ADR Authority

**Files:**
- Create: `docs/architecture/README.md`
- Create: `docs/architecture/ALPHA_RUNTIME_BOUNDARY.md`
- Rewrite: `docs/architecture/MODULE_MAP.md`
- Refine: `docs/architecture/MODULE-OWNERSHIP.md`
- Remove current-authority links to: `docs/architecture/VNEXT_SYSTEM_DIAGRAM.md`
- Modify: `docs/architecture/ADR-001-*.md` through `ADR-038-*.md` metadata only

**Interfaces:**
- Consumes: current extension/bridge tree and decision history
- Produces: explicit current, deferred, superseded, and historical architecture layers

- [ ] Create an ADR index recording number, title, decision status, Alpha applicability, superseded-by link, and owning module.

- [ ] Mark ADR-001, ADR-004, ADR-007 through ADR-009 as superseded for the Alpha runtime where they prescribe desktop/Tauri ownership. Mark ADR-017, ADR-025, ADR-035, and ADR-036 historical/native-future. Mark ADR-037 as the long-term product target while distinguishing the unpacked-extension Alpha package.

- [ ] Create `ALPHA_RUNTIME_BOUNDARY.md` with the only privileged runtime path: Chrome extension -> authenticated loopback Node bridge -> approved providers/local services. Include source directories, generated files, secret boundaries, and out-of-scope systems.

- [ ] Rewrite `MODULE_MAP.md` from the current source tree. Keep `MODULE-OWNERSHIP.md` normative and remove links that present Tauri diagrams as current.

- [ ] Retain all ADR files as decision history; do not delete them merely because they are deferred or superseded.

### Task 7: Remove Tracked Historical And Executable-Looking Agent Traps

**Required run artifact (do not merge):** `documentation-disposition.tsv`

Before deleting any tracked documentation, generate a complete disposition ledger from `git ls-files` covering every Markdown, text, HTML, and PDF documentation asset. Each row must contain `path`, `tracked`, `category`, `authority`, `inbound_links`, `durable_facts_migrated_to`, and one of `KEEP`, `MERGE_THEN_DELETE`, or `DELETE_HISTORICAL`. The cleanup gate fails if any documentation asset is absent or unclassified. Attach the ledger to the draft PR or preserve it with the external cleanup evidence; do not add it to the final repository.

**Files to delete after extracting any still-valid decision:**

```text
CODEBASE-EVALUATION-2026-06-07.md
browser-first/PR-PLAN.md
browser-first/resonantos-side-panel-extension/TASK-FIX-ERRORS.md
src/styles/PR-PLAN-UI-OVERHAUL.md
docs/ALPHA_PREVIEW_AUDIT_2026-04-28.md
docs/BROWSER_FIRST_STABILIZATION_2026-06-02.md
docs/PROJECT_STATUS.md
docs/RESONANTOS-2.0.0-ALPHA-STATUS-REPORT.md
docs/FEATURE_BACKLOG.md
docs/FEATURE_INVENTORY_2026-05-26.md
docs/THE-HOT-ROD-RIG-V4.md
docs/UX_AUDIT_2026-06-01.md
docs/VLAD-PR-GUIDE.md
docs/working/SESSION_CONTEXT_2026-04-25.md
docs/reviews/
docs/rig-run/
```

**Interfaces:**
- Consumes: canonical replacements from Tasks 5-6
- Produces: removal of stale default context while preserving Git history

- [ ] For each path, run an inbound-link scan and record the replacement destination in the PR description.

```bash
rg -n 'CODEBASE-EVALUATION|PR-PLAN|TASK-FIX-ERRORS|PROJECT_STATUS|FEATURE_BACKLOG|FEATURE_INVENTORY|THE-HOT-ROD-RIG|SESSION_CONTEXT|docs/reviews|docs/rig-run' . --glob '!node_modules/**' --glob '!dist/**'
```

- [ ] Copy any still-valid requirement into `docs/STATUS.md`, `docs/ROADMAP.md`, `docs/reference/CAPABILITY_MATRIX.md`, `docs/release/ALPHA_DISTRIBUTION.md`, or an ADR before deletion.

- [ ] Reconcile the deletion shortlist against `documentation-disposition.tsv`. Review every `MERGE_THEN_DELETE` row for migrated facts and every `KEEP` row for a concrete current reader and owner. Zero unclassified rows are permitted.

- [ ] Delete the listed tracked files with `git rm`. Do not create an in-repository archive; Git history is the archive and keeping copies would preserve the context problem.

- [ ] Evaluate `docs/ADDON-MIGRATION-PLAN.md`, `docs/architecture/*AUDIT*`, `docs/architecture/AUDIO2TOL_*`, `docs/product/UX-*`, `docs/product/SETTINGS-*`, and `docs/security-pipeline/work-pack/` using the same rule: keep only binding current requirements tied to code or an open issue; otherwise extract the decision and remove the document.

### Task 8: Remove Or Externally Archive Untracked Extraneous Material

**Files/directories:**

```text
TASK.md
ANALOG6-ANTHROPIC-INCIDENT-REMEDIATION-PLAN.txt
hello-world.html
hello-world-2.html
simple-page.html
resonantos-side-panel-extension.zip
docs/AI-TOOLING-INVENTORY-FULL-REPORT-2026-07-02.md
docs/Embedded-Bias-in-LLM-Models-Explained.html
docs/Embedded-Bias-in-LLM-Models-Explained.pdf
docs/VLAD-BUNDLE-EVALUATION.md
docs/vlad-eval/
docs/video/
docs/rig-run/W1-*.md
docs/rig-run/W2-*.md
output/
runs/
.abacusai/
.codex/
.understand-anything/
```

- [ ] Create an external checksum manifest and archive for any untracked file the human wants retained.

- [ ] Delete untracked machine-local evidence only after archive verification. Never use `git clean` in the existing checkout.

- [ ] Preserve the untracked Blackboard code and tests, `.env.example`, and five untracked validation tests for separate review; they are active WIP, not documentation cleanup debris.

- [ ] Remove `/Users/dr.tom/AGENTS.md`'s broken `@RTK.md` reference or restore a reviewed `/Users/dr.tom/RTK.md` outside this repository. This parent-level repair must be a separate explicit host-configuration action, not part of the repository PR.

### Task 9: Complete Contribution Intake And Project Governance

**Files:**
- Create: `.github/pull_request_template.md`
- Create: `.github/ISSUE_TEMPLATE/bug.yml`
- Create: `.github/ISSUE_TEMPLATE/feature.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `CODE_OF_CONDUCT.md`
- Create: `SUPPORT.md`
- Create: `docs/PROJECT_GOVERNANCE.md`
- Preserve from `origin/dev`: `.github/workflows/project-issue-sync.yml`, `scripts/sync-project-issue-labels.mjs`
- Modify: `.github/workflows/alpha-build.yml`

- [ ] Make the PR template require scope, linked issue, affected modules, ownership review, safety/privacy impact, exact commands run, live-browser proof when required, and documentation impact.

- [ ] Make issue forms collect reproducible environment details without requesting secrets. Feature requests must identify Alpha/Beta/deferred scope and human-only boundaries.

- [ ] Document Project 2 URL, Issues-as-intake rule, field meanings, status transitions, who may promote scope, label conflict resolution, sync-token recovery, and dry-run commands.

- [ ] Add root contributor files and `scripts/validate-docs*` to docs-validation CI path filters. Pin all GitHub Actions by full commit SHA in the same PR or a prerequisite security PR.

- [ ] Do not create `CODEOWNERS` until maintainers and verified GitHub handles are confirmed; module ownership remains authoritative in `MODULE-OWNERSHIP.md` meanwhile.

### Task 10: Add One Deterministic Alpha Verification Entry Point

**Files:**
- Modify: `package.json`
- Create: `scripts/verify-alpha.mjs`
- Create: `scripts/verify-alpha.test.mjs`
- Modify: `AGENTS.md`, `CONTRIBUTING.md`, `.github/workflows/alpha-build.yml`

- [ ] Implement `verify-alpha.mjs` to run, in order, and report each command without hiding failures:

```text
npm run docs:check
npm run test:docs
npm run build
npm test -- --run
npm run test:browser-first
npm run test:browser-host
npm run test:living-archive-mcp
npm run test:living-archive-memory-service
npm run test:health
npm run test:engineer-runner
node scripts/security-pipeline/run-check.mjs
npm run browser-first:audit-scope
```

- [ ] Add `"verify:alpha": "node scripts/verify-alpha.mjs"` to `package.json` and make CI call this single command.

- [ ] Test fail-fast behavior, command reporting, exit-code propagation, and redaction of environment values.

- [ ] Replace scattered validation lists in `AGENTS.md` and `CONTRIBUTING.md` with the change-to-check matrix plus `npm run verify:alpha` for release-impacting work.

### Task 11: Clean-Clone Certification And Deletion Gate

**Files:**
- All files changed by Tasks 2-10
- PR description containing deletion/replacement matrix

- [ ] Run the full verification in the isolated worktree.

```bash
npm install
npm run verify:alpha
git status --short
```

Expected: all checks pass; only intentional cleanup changes appear.

- [ ] Clone the cleanup branch into a fresh temporary directory and follow only `README.md` -> `INSTALL.md` -> `CONTRIBUTING.md`. Confirm the extension and bridge can be started without chat history, private paths, undocumented scripts, or local configuration.

- [ ] Ask a coding agent with no prior thread context to answer these questions using repository files only:

1. What ships in Alpha?
2. Which branch should I create and target?
3. Which module owns my change?
4. Which checks must I run?
5. Where do secrets belong?
6. How do Issues and Project 2 differ?
7. Which documents are normative versus historical?

Expected: each answer cites one canonical file and no conflicting source.

- [ ] Review the deletion diff with `git diff --summary` and `git diff --stat`. Confirm every removed tracked document has a canonical replacement or is purely historical.

- [ ] Regenerate `documentation-disposition.tsv` from the final tree and confirm: every remaining documentation asset is classified `KEEP`, has a named reader/owner, and is reachable from one canonical index or a component-local README; no deleted path remains in a live link.

- [ ] Commit in reviewable slices:

```text
chore: Quarantine generated repository artifacts
test: Add documentation and contributor contract validation
docs: Rewrite agent and contributor entrypoints
docs: Consolidate status roadmap and capability truth
docs: Clarify Alpha architecture and ADR status
docs: Remove obsolete reports plans and agent traps
docs: Add contribution templates and Project 2 governance
ci: Add deterministic Alpha verification entrypoint
```

- [ ] Open a draft PR into `dev`. Do not delete the external untracked backup until the PR merges and a clean clone passes again.

---

## Self-Review Results

- **Specification coverage:** The plan covers agent readability, human contribution flow, duplicate removal, stale instruction removal, sensitive local artifacts, current remote divergence, Project 2, deterministic validation, and rollback.
- **Deletion discipline:** A 100% disposition ledger prevents omissions. Tracked historical material is removed only after durable facts migrate; untracked material is externally archived before deletion; active Blackboard/browser-control WIP is excluded.
- **Scope discipline:** No Tauri, Electron, CEF, Rust/Cargo, or native packaging work is introduced into Alpha instructions.
- **Context budget:** The final default reading path is five files plus one task-specific component/architecture reference.
- **No placeholder scan:** No TBD, TODO, or unspecified implementation step remains.
