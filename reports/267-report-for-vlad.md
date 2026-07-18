# Issue #267 — full history & status

**For:** @vrondelli · **Re:** live-browser Agent Control certification · **As of:** 2026-07-18

**TL;DR —** #267 is effectively **done**. Your commit on [PR #269](https://github.com/ResonantOS/2.0.0-alpha/pull/269) landed the whole remaining spec on top of the launcher restore, and the **`Agent Control live-browser certification` job is passing in CI (1m12s)**. This closes the single largest gap the due-diligence review found. Thank you — this is exactly the work the gate needed.

---

## Why this issue exists (the history)

1. **The finding.** An independent due-diligence review (2026-07-17) concluded the #1 structural risk was **mock-only safety verification**: all 118 `browser-first/test/*.test.mjs` are deterministic Node tests with mocked `chrome.*`/DOM/`fetch`. The Agent Control safety boundaries under epic **#211** (#223 safe actions, #224 field-typing, #226 stop/cancel, #240 public-submit) had **zero real-Chrome evidence** — a green `verify:alpha` did not certify browser safety.

2. **The correction.** Before filing, a code audit found the honest framing wasn't "build a harness" — `browser-first/test/agent-control-live.mjs` (~1,129 lines, 57 assertions over a real password/submit/wallet fixture) **already existed**. Its problem was two-fold: its Chrome launcher was **orphaned** (it spawned `run-browser-first.mjs`, which became a bridge-only shim in `74199ab` "scope alpha to chrome extension", so it hung on the debug port), and it was **excluded from CI** by the `*.test.mjs` glob.

3. **So #267 = restore + gate**, not build from scratch. Filed **P0**, sub-issue of **#211**, milestone beta.1.

## What's landed (2 commits on PR #269)

### Commit 1 — launcher restore (`8524149`)
- Replaced the dead `run-browser-first.mjs` spawn with a **launch-only Playwright** call: `chromium.launchPersistentContext(profile, { headless:false, args:[--load-extension, --remote-debugging-port…] })`. The **raw-CDP assertion body is unchanged** — Playwright only starts the browser; the harness still drives it over the HTTP debug endpoint.
- Added `npm run test:browser-first:live`.
- Verified locally: Chrome launches, the extension loads (stable id from the manifest `key`), the side panel opens, and the harness runs a substantial portion of its assertions before the provider-gated deep scenarios.

### Commit 2 — live certification (`e018796`, @vrondelli) — the rest of the spec
- **CI workflow** `.github/workflows/agent-control-live.yml` — a **dedicated** `agent-control-live-certification` job (separate from `verify:alpha`): PR-path-triggered on the safety files, nightly `cron`, plus `workflow_dispatch`. Runs `xvfb-run -a npm run test:browser-first:live` on `ubuntu-latest` with SHA-pinned `browser-actions/setup-chrome@…` (stable).
- **Skip ≠ pass** — `decideUnavailableCertification` + `isCi`: Chrome-unavailable is **`failed` (exit code)** in CI and only **`excluded` (skip)** locally, and the final `Reject uncertified run` step `exit 1`s if the certification outcome isn't `success`. No more silent green.
- **Provider-independent CI profile** — `RESONANTOS_LIVE_PROFILE=agent-control` in CI vs `full` locally, excluding assertions that "require provider behavior owned by a separate certification lane." (This is the right call — it's exactly the provider-gated step the launcher-only run stalled on.)
- **Redacted proof artifacts** — `agent-control-live-report.mjs` writes a run-id-tagged report + screenshots, scrubbing `/home`/`/Users`/Windows paths and bridge/capability/bootstrap/bearer tokens; uploaded via `actions/upload-artifact` with `if-no-files-found: error`, `retention-days: 14`.
- **#240 public-submit contract** — `RESONANTOS_PUBLIC_SUBMIT_CONTRACT` (`auto`/`required`); the harness asserts `window.__submitted` stays false and matches the human-handoff signal `/human-only|click it yourself|must be performed by the human|then resume/`, with `humanHandoff = signal && no executable approval`.
- **content.js** — allows a safe action set (`click_text`, `type_text`, `read_page`, `detect_forms`, `get_selection`, `scroll_page`) to run in **subframes**, so the harness can certify Agent Control inside an iframe booking context.

## How this connects to the rest of the gate

`#269 (this harness)` → **live-proves** → `#268 (#240 public-submit fix)` → satisfies → epic `#211` gate blockers.

Your public-submit assertion is written against the **exact handoff messages** the #240 fix emits — so once #268 lands, this harness is its live proof. That's the whole dependency chain the roadmap laid out, now realized in running code.

## Review notes & open items

1. **content.js overlap with #268 is low-risk but real.** [PR #268](https://github.com/ResonantOS/2.0.0-alpha/pull/268) (the #240 fix) changes `content.js` in the **safety-guard region (~L425–720:** `isSubmitLikeElement`, `clickElement`, `typeIntoPage`); your change is the **message listener (~L1099)**. Different regions → likely a clean 3-way merge, but please rebase-check when #268 merges.
2. **`auto` → `required`.** The public-submit contract is `auto` today (tolerates the pre-#240 behavior). Once #268 merges, flip it to `required` (or default the workflow input) so CI **enforces** the human-only handoff rather than just detecting it.
3. **Subframe actions are a boundary surface.** Allowing `click_text`/`type_text` in subframes means Agent Control now acts inside iframes. The #240/#224 guards live in `clickElement`/`typeIntoPage`, so they apply in any frame the content script runs in — but it's worth a live assertion that submit/field guards actually fire **inside** the iframe, not just top-frame.
4. **Track the provider-dependent lane.** The `full` profile assertions you excluded from CI ("separate certification lane") should have a home — either a follow-up issue or a note on #211 — so they don't silently disappear.

## What remains for #267 to fully close
- ✅ Launcher restored · ✅ CI job green · ✅ skip-≠-pass · ✅ redacted artifacts · ✅ #240 contract assertion
- ⏳ #268 (#240 fix) merges → set the contract to `required`
- ⏳ the provider-dependent full-profile lane gets an owner
- ⏳ update `docs/reference/CAPABILITY_MATRIX.md` / `docs/STATUS.md` to state Agent Control is now **live-certified in CI** (you already touched both — just keep them in step)

Net: the harness that was orphaned and uncertifying is now a **green, gated, artifact-producing safety certification**. Excellent work.
