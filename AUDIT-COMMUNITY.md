# Community Readiness & DevEx Audit — ResonantOS vNext

**Auditor:** Analog 6 (subagent)
**Date:** 2026-06-08
**Scope:** `~/2.0.0-alpha` evaluated as a new developer discovering the repo on GitHub

---

## Build Verification

```
npm ci      → EXIT 0 (audit warnings, no errors)
npm run build → EXIT 0 (large chunk warning from Vite, build succeeds in ~3.8s)
```

Build path works. That's the good news. Everything below is what stands between a curious developer and that build.

---

## Question 1 — Is the README clear in the first 30 seconds?

**Verdict: ⚠️ Partially — but immediately confusing**

The opening line is "New desktop-first ResonantOS foundation built as a Tauri + React shell." This is **factually stale**: `docs/PROJECT_STATUS.md` (updated 2026-06-01) says the active product direction is now **browser-first** per ADR-037. A new developer reading the README gets the wrong mental model on line 1.

What's missing in the first 30 seconds:
- **No tagline or one-sentence value prop.** "What is ResonantOS?" is not answered. A developer landing on this page doesn't know if it's a desktop app, an AI framework, a platform, or a dev tool.
- **No screenshots or GIF.** None. A new developer cannot see what they're about to run.
- **No audience definition.** Who is this for? AI developers? End users? SDK builders?
- **No "why this over alternatives?"** The README is all internal architecture description.

The bullet list of features ("modular desktop shell", "add-on SDK manifest format", etc.) is written for people who already understand the architecture. It's not a pitch; it's a vocabulary list.

**Fix:** Rewrite the opening section: one sentence on what it is, one sentence on who it's for, one sentence on the current direction (browser-first), and a screenshot.

---

## Question 2 — Can I install and run it?

**Verdict: ❌ Fails on step 1**

The README install block is:

```bash
cd resonantos-vnext
npm install
npm run tauri:dev
```

**The directory name is wrong.** The repo directory is `2.0.0-alpha`, not `resonantos-vnext`. A new developer cloning this repo and following the README will fail at `cd resonantos-vnext` before typing a single other command.

Additional issues:
- `npm install` (README) vs `npm ci` (ALPHA_DISTRIBUTION.md) — inconsistent; `npm ci` is the audited path.
- `npm run tauri:dev` requires a Rust toolchain pinned at `1.94.1`. This is not mentioned in the README at all. A developer without Rust installed gets an opaque error.
- No Node.js version requirement stated. No `engines` field in `package.json`.
- The browser-only preview (`npm run dev`) works without Rust and is actually the fast path for new contributors — but it's listed second, after the broken Tauri command.

**What actually works for a new developer:**
```bash
# In the actual repo root (not resonantos-vnext)
npm ci
npm run dev
# → browser preview at localhost:1430
```

That path works. It's just not the one in the README.

**Fix:** 
1. Remove or correct the `cd resonantos-vnext` step.
2. Lead with the browser-only path (`npm run dev`) as the zero-dependency quickstart.
3. Add a prerequisites section: Node.js ≥X (add `engines` to `package.json`), Rust 1.94.1 (for desktop build only).
4. Link to Tauri prerequisites: https://v2.tauri.app/start/prerequisites/

---

## Question 3 — Time-to-first-AI-response?

**Verdict: ❌ Undocumented and high-friction**

No section in README, ALPHA_DISTRIBUTION.md, or visible top-level docs describes:
- What provider you need to talk to an AI
- What configuration step enables the AI response
- What the expected latency is

`docs/PROJECT_STATUS.md` mentions MiniMax as "the current working provider path" — but this is buried in a 400+ line status file and is not mentioned in README or any getting-started doc.

A developer who installs and runs the app will see a chat interface and have no idea why it won't respond, or what credentials to enter where.

**Fix:** Add a "First AI Response" section to README:
- State required provider (MiniMax or bring-your-own)
- Show where to enter the API key in the UI (Settings → Strategy / Provider)
- State expected time-to-first-response once configured

---

## Question 4 — What API keys do I need?

**Verdict: ❌ Not mentioned in README**

The README says nothing about API keys. Zero.

ALPHA_DISTRIBUTION.md says "reviewers should configure providers and memory using their own data" — but doesn't name a single provider or show where to configure one.

PROJECT_STATUS.md mentions MiniMax as the current integration, but this is not linked from README.

**What a new developer needs to know:**
- MiniMax API key (or compatible provider) for AI features
- No other keys required for basic operation (wallet/vault/etc. are architectural stubs)

**Fix:** Add a "Prerequisites / API Keys" section to README with the provider name, a link to where to get a key, and a screenshot or path of where to enter it.

---

## Question 5 — What if I'm on Windows or Linux?

**Verdict: ⚠️ Partially addressed, but only in internal docs**

The README mentions no platform-specific notes.

ALPHA_DISTRIBUTION.md (internal) covers:
- **Windows:** SmartScreen warning expected on unsigned builds. Build pipeline exists via GitHub Actions.
- **Linux:** Known blocker — Rust 1.95 / LLVM 20 compiler ICE on Haswell hardware when compiling GTK bindings. Workaround: use Rust 1.94.1. GitHub-hosted Linux artifacts available.
- **Linux prerequisite gap:** Tauri on Linux requires WebKitGTK dev packages (`libwebkit2gtk-4.1-dev` etc.). Not mentioned in any user-facing doc.

A Linux developer will almost certainly hit the WebKitGTK dependency error and have no idea what happened.

**Fix:**
- Add a platform notes table to README: macOS (full), Windows (SmartScreen warning), Linux (WebKitGTK deps required, Haswell known issue).
- Link to https://v2.tauri.app/start/prerequisites/ for platform-specific setup.
- Note: browser-only path (`npm run dev`) works on all platforms without any of these issues.

---

## Question 6 — What documentation is missing?

**Verdict: ❌ Several standard open-source essentials are absent**

| Document | Status | Impact |
|----------|--------|--------|
| `CONTRIBUTING.md` | **Missing** | No contributor onboarding path. How do I submit a PR? Branch model? Code style? Tests required? |
| `CHANGELOG.md` | **Missing** | No version history. What changed between builds? What's new in this alpha? |
| `LICENSE` | **Missing** | Legal status is undefined. Cannot fork or contribute safely without knowing the license. |
| `CODE_OF_CONDUCT.md` | **Missing** | Standard for community repos. |
| `.github/ISSUE_TEMPLATE/` | **Missing** | No structured bug reports or feature requests. |
| `.github/PULL_REQUEST_TEMPLATE.md` | **Missing** | |
| Getting Started / Quickstart guide | **Missing** | README install steps are incomplete and broken. |
| Provider Setup guide | **Missing** | No documentation on configuring AI providers. |
| Add-on SDK getting started | **Partial** | `src/sdk/addons` exists, contracts in `src/core/contracts.ts`, but no SDK README or tutorial. |
| `package.json` `engines` field | **Missing** | Node.js version requirement is undeclared. |

The `docs/` directory has substantial internal documentation (`PROJECT_STATUS.md`, `ALPHA_DISTRIBUTION.md`, ADRs) but it is written for the founding team, not new contributors. It uses terms like "ADR-037", "Living Archive", "Paperclip", "Audio2TOL" without definition.

---

## Question 7 — Where is the "I give up" moment?

**In order of likelihood:**

1. **`cd resonantos-vnext` → No such file or directory** — First command in README fails. Many developers stop here. (Estimated: ~30 seconds in.)

2. **`npm run tauri:dev` → error: cargo not found** — Rust not installed, no guidance. (Estimated: ~2 minutes in, for developers who push past step 1.)

3. **App launches, AI chat returns nothing** — No provider configured, no docs on what to configure. Developer doesn't know if it's broken or just unconfigured. (Estimated: ~5–10 minutes in.)

4. **Reads `docs/PROJECT_STATUS.md` looking for answers** — 400+ lines of dense internal status notes, references to 30+ ADRs, no "start here" anchor. Developer gives up on understanding the architecture. (Estimated: ~15 minutes in.)

5. **Tries Linux native build** — Hits WebKitGTK compile error with no documented fix. (Estimated: varies, but high frustration.)

The highest-impact fix is #1: correcting the `cd resonantos-vnext` command. That alone removes the first and most demoralizing blocker.

---

## Question 8 — CONTRIBUTING guide, CHANGELOG, Release notes?

**CONTRIBUTING.md:** Does not exist. No contributor workflow, no PR process, no test requirements documented for contributors, no style guide reference.

**CHANGELOG.md:** Does not exist. Git log exists (active dev, recent commits) but no curated change log.

**Release notes:** None in any user-facing location. `ALPHA_DISTRIBUTION.md` serves as the closest equivalent but is written for internal reviewers, not the community.

The Git workflow is documented in README ("Active development happens on `dev`. `main` is the stable preview/release branch.") — this is useful but incomplete without a CONTRIBUTING doc explaining the PR lifecycle.

---

## Summary — Prioritized Fixes

### P0 — Blockers (break first 5 minutes for all users)
1. **Fix `cd resonantos-vnext` → should be the actual repo directory name or removed entirely.** Every new developer fails here.
2. **Lead README with `npm run dev` (browser-only, no Rust).** This is the zero-dependency path and should be the quickstart.
3. **Add prerequisites section: Node.js version, Rust 1.94.1 (desktop only), link to Tauri prerequisites.**

### P1 — High friction (breaks within 10 minutes)
4. **Document required API key and provider setup** — what key, where to get it, where to enter it.
5. **Add a LICENSE file.** Cannot fork or contribute without knowing the license.
6. **Reconcile README "desktop-first" with current "browser-first" direction.** The opening sentence is wrong.

### P2 — Community table stakes
7. **Add CONTRIBUTING.md** — branch model, test commands, PR checklist.
8. **Add CHANGELOG.md** — even a single entry for this alpha is better than nothing.
9. **Add `engines` to `package.json`** — declare the minimum Node.js version.
10. **Add platform notes to README** — Linux WebKitGTK deps, Windows SmartScreen, browser-only path works everywhere.

### P3 — Nice to have
11. Add a screenshot or GIF to README.
12. Add `.github/ISSUE_TEMPLATE` and PR template.
13. Write an Add-on SDK getting-started guide.
14. Simplify or link `docs/` — the internal docs are valuable but inaccessible without a map.

---

## What's Working

- `npm ci` and `npm run build` both pass cleanly (exit 0).
- Browser preview (`npm run dev`) is a viable zero-Rust quickstart that no one would know to use from the README.
- ALPHA_DISTRIBUTION.md is thorough internal documentation — it just needs to be surfaced and condensed for external developers.
- The add-on SDK contracts, capability model, and architecture are technically solid from what's visible.
- 168 Vitest tests passing, cargo tests passing — the codebase is not broken, just undocumented for newcomers.

The core product is in better shape than the documentation suggests. The gap is presentation, not substance.
