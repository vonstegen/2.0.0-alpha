# ResonantOS 2.0.0-alpha — Codebase Re-Evaluation

**Date:** 2026-06-07
**Branch:** `dev` (tracking `origin/dev`; no local `main`)
**Working tree:** 9 modified files, 5 untracked paths (uncommitted)
**Scope:** Entire codebase + all changes made and proposed

---

## 1. Verdict

The project remains an **architecturally strong, unusually well-documented alpha**. The kernel/add-on model, the Rust-side privileged-IPC boundary, and the Living Archive trust pipeline are real, enforced designs rather than aspirations. Recent committed work is a healthy "extract and harden" refactoring sprint.

The **uncommitted work-in-progress is not in a landable state.** A new "Resonant Context SDK" has been added but is wired end-to-end to nothing (a no-op), it is duplicated byte-for-byte in two locations, and three of the fixes its own task docs mark "APPROVED" were never applied. A self-commissioned red-team report found two P0 security issues — **neither is fixed in the tree.**

Recommendation: **do not commit the working tree as-is.** Land it in two clean pieces (the idempotency guards; then the SDK once it is actually consumed and de-duplicated), and resolve the P0 security items first.

---

## 2. Codebase snapshot (first-party code only; vendored CEF excluded)

| Area | Files | LOC | Notes |
|---|---|---|---|
| `src/` (React/TS) | 129 | ~52,400 | Shell + feature modules |
| `src-tauri/src/` (Rust) | 25 | ~28,950 | 128 `#[tauri::command]` handlers |
| `browser-first/` (Node ESM) | 143 | ~34,500 | Chromium side-panel + bridge |
| `docs/` | 84 md | — | **37 ADRs**, module map, status, audits |
| Tests | — | — | 37 vitest suites + 103 node test files |

Two parallel product shells coexist: the Tauri desktop app (`src/` + `src-tauri/`) and the browser-first Chromium track (`browser-first/`). Docs state browser-first is now the active direction and desktop is a "feature reservoir." This ~87k-LOC overlap is the single biggest strategic question in the repo.

---

## 3. Changes already committed (recent history)

The last 60 commits are dominated by disciplined refactoring, not new features:

- **14× "Extract …"** (e.g. control approval actions, tab-target helpers, side-panel chat hydration, settings provider catalog, Living Archive workspace layout)
- **6× "Harden …"** (browser control page targeting, readable tab selection, agent-control live readiness, MCP test transport)
- **4× "Preserve …" boundary** commits, plus a few targeted fixes

**Assessment:** this is exactly the right kind of activity for an alpha of this size — shrinking god-objects (`App.tsx` is still 3,158 lines) into module controllers and adding guard rails. No churn or thrash visible. Good.

---

## 4. Changes made but uncommitted (working tree)

### 4.1 New feature — Resonant Context SDK
- `src/sdk/resonant-context/resonant-context.js` (831 LOC) + `.d.ts` (215) + `.test.ts` (249)
- `browser-first/resonantos-side-panel-extension/src/lib/resonant-context.js` (831 LOC — **byte-identical copy**)
- `content.js` now initializes the SDK and broadcasts `resonant-context-snapshot` messages
- `browser-page-actions.js` programmatic injection now injects all lib scripts + the SDK
- Idempotency guards (`if (globalThis.X) return;`) added to 5 content-script modules
- `manifest.json` reformatted (multiline arrays; **trailing newline removed**)
- A flaky-cleanup retry added to `main-workspace-settings.test.mjs`
- `package-lock.json`: `libc` fields stripped from optional deps (npm-version regeneration artifact — noise)

**SDK code quality:** reasonable. Clean IIFE exposing `ViewportObserver`, `FormsTracker`, `SessionTracker` (viewport dwell tracking, overlay/dialog detection, click-trail, session history). The vitest test loads it in jsdom with an `IntersectionObserver` stub and checks instantiation + snapshot schema. Adequate unit coverage for a first cut.

**The problems are integration-level:**

1. **The feature is a no-op end to end.** `content.js` broadcasts `resonant-context-snapshot`, but **`background.js` has no handler** — confirmed by grep. Snapshots are produced and silently dropped. The SDK's own red-team report flags this as informational ("a no-op until a handler is added"). Nothing consumes the snapshots, so this delivers zero user-facing value today.

2. **The SDK never loads on normal page loads.** `resonant-context.js` was **not** added to `manifest.json` `content_scripts`. It is only injected on the programmatic `executeScript` path. So on ordinary `document_idle` injection, `window.ResonantContext` is undefined and `content.js` "skips silently." The SDK runs only when the agent explicitly re-injects — narrower than the task intended.

3. **831 lines duplicated verbatim** across `src/sdk/` and `browser-first/.../lib/`. Guaranteed to drift. Should be one source with a copy/build step, or a shared import.

**Net:** the idempotency guards are a genuine correctness fix (they prevent ref-counter resets and redeclaration errors when scripts are injected both via manifest and via `executeScript`). That part is good and could land on its own. The SDK itself is dead wiring until a consumer + single-source-of-truth exist.

### 4.2 Discrepancy: proposed fixes marked "APPROVED" but not applied
`browser-first/.../TASK-FIX-ERRORS.md` lists five steps. Verified against the tree:

| Step | Claim | Actual state |
|---|---|---|
| 1. Remove `audioCapture` from manifest | ✅ APPROVED | ❌ **Still present** (line 10). Task doc notes it is invalid for MV3 and would error on load. |
| 2. IIFE + guard in `content.js` | ✅ APPROVED | ✅ Applied |
| 3. Idempotency guards on lib scripts | ⚠️ REVISED | ✅ Applied (5 files) |
| 4. Context-invalidated handling | ✅ (no code change) | ✅ n/a |
| 5. `npm test` verify | — | Unverified here |

So Step 1 was approved and skipped — leaving an invalid MV3 permission in the manifest.

---

## 5. Security: the self-commissioned red-team report

`SECURITY-RED-TEAM-REPORT.md` (untracked, dated 2026-06-06) is a credible, specific audit. Its **green findings are real strengths**: loopback-only bridge bind, `timingSafeEqual` token checks, three-layer path-traversal defense (normalize → resolve → realpath), wallet/payment hard-blocks enforced in the content script, no hardcoded secrets, per-endpoint auth. These match what I see in the code.

Its open findings — **status verified against the current tree, none fixed:**

| Pri | Finding | Fixed? |
|---|---|---|
| 🔴 P0-1 | All 13 capability tokens + main token written to `bridge-config.generated.js` (mode 0600, gitignored) — any same-user process can read full bridge access while host runs | ❌ Not fixed |
| 🔴 P0-2 | `vitest` CVE GHSA-5xrq-8626-4rwp (RCE when UI server listens). Pinned `^3.2.4`, installed **3.2.4** (`<4.1.0`) | ❌ Not fixed |
| 🟡 P1-1 | `inline_assistant_request` body forwarded to bridge without schema/length validation | ❌ Not fixed |
| 🟡 P1-2 | Provider API keys + Telegram token in `window.localStorage` on the browser fallback path (`runtime.ts`) | ❌ Not fixed |
| 🟡 P1-3 | Extension CSP has no `connect-src` — XSS in an extension page could exfiltrate to any origin | ❌ Not fixed |

**P0-2 is the cheapest win** (dependency bump + test run) and should be done before any further dev that runs `vitest --ui`. **P0-1** is the more architecturally interesting one: the report's token-exchange / split-file recommendation is sound and aligns with ADR-037's note that the per-session token model is preview-grade and must move to native-messaging/signed IPC before public wallet/DAO readiness.

One caveat on the report itself: its headline test baseline ("296 passing / 286 original") does not match `PROJECT_STATUS.md`'s "168 frontend + 100 Rust." The numbers count different suites; treat the report's "no regressions" claim as plausible but re-run the canonical suite before relying on it.

---

## 6. Changes proposed (planning docs / roadmap)

The proposed work is well-organized across `PROJECT_STATUS.md` (Still Missing / Next Moves), `FEATURE_BACKLOG.md`, and 37 ADRs. The high-leverage items:

- **Consolidate the two shells.** Decide desktop-vs-browser-first formally; ~87k LOC carries double maintenance cost otherwise. (Biggest item; not yet an explicit backlog decision.)
- **Living Archive:** audited reorganisation *execution* (currently preview-only by design), file watchers/scheduled sync, semantic merge/conflict handling, Resonant Notes graph view.
- **Provider strategy:** user-created/reordered fallback chains, provider health history, complete Anthropic/Gemini/OpenAI + local runtime support.
- **Add-on platform:** signed registry, sideload hardening, service lifecycle manager, runtime isolation — none built yet.
- **Security/Web3:** wallet/vault are architectural only; capability gates need deeper enforcement; the P0/P1 items above should be folded into this hardening pass.
- **Cross-platform:** Windows/Linux validation outstanding (Linux native build blocked by a rustc 1.95/LLVM ICE; pinned to Rust 1.94.1 as workaround). Vite large-chunk warning unresolved.

**Assessment:** the roadmap is realistic and honestly scoped — the docs repeatedly distinguish "implemented," "preview-only," and "architectural only," which is rare and trustworthy. The main gap is that the **shell-consolidation decision** and the **security P0s** are not yet first-class, near-term backlog items, even though both gate a public alpha.

---

## 7. Recommended next actions (in order)

1. **Do not commit the working tree as one blob.** Split it.
2. **Land the idempotency guards + the `content.js` IIFE** as one small, reviewed commit — these are correct and independently valuable.
3. **Apply the skipped TASK-FIX Step 1** (remove invalid `audioCapture`) in that same commit.
4. **Fix P0-2** (`vitest` upgrade) and re-run the canonical suite (`npm test`, `cargo test --lib`, the node test scripts).
5. **Hold the Resonant Context SDK** until (a) it is a single source (delete one copy, add a copy/build step), (b) a `background.js` handler actually consumes snapshots, and (c) it is registered where it's meant to run. Until then it is dead code with a passing unit test.
6. **Promote P0-1 and the shell-consolidation decision** into `FEATURE_BACKLOG.md` as explicit pre-alpha gates.
7. Keep doing the extract/harden work on the large files (`App.tsx`, `archive_service.rs`, `provider_service.rs`).

---

*Findings in §4–5 were verified directly against the working tree (grep/diff) on 2026-06-07, not taken from the task docs.*
