# Tom's feedback — cross-reference vs current repo state

Reviewed the three unread docs against the actual `feat/cp5-phase5-reference-harnesses` branch at `9c19d9b` (just pushed; PR #2 OPEN). Below: status of every point Tom raised, split into **already done** / **needs decision** / **needs new code**.

The Executive Summary is excluded per your note — this response only touches the three new docs.

---

## File 1: ResonantOS-Andrew-Overlap-Gap-Alignment.pdf

### Already done (verified against this repo)

| Tom's claim | Repo state |
|---|---|
| "SDK duplication" is an extraction, not a fork | Confirmed — `src/sdk/addons/*.ts` are 7-line `export *` re-exports of `packages/addon-sdk/src/...`. Single source of truth. |
| `p1c` / `p1d` "containment" branches are stale | Confirmed — path-contains + launch-config landed via PR #300 (Aug 18); these branches are stale duplicates of work already on dev. **Action: close/abandon.** |
| `addon.deepseek-harness` example manifest is the concrete re-authoring path | Confirmed — `public/addons/deepseek-harness.json` exists, registered in `index.json`, and the SDK reference adapter `deepseek-provider-adapter.ts` is the conformance gate. |
| `agentRuntime` contract validation now exists | Confirmed — `src/sdk/addons/validation.ts:1027+` (per Tom's cite). |
| The Augmentor SDK extraction pattern | Confirmed — `packages/addon-sdk` (single source) + `src/sdk/addons/*` (re-exports). |

### Needs decision

| Tom's point | What to decide |
|---|---|
| "ADR-056 ↔ #321" boundary reconciliation | **ADR-056 doesn't exist in this repo** (only ADR-001 through ADR-054, plus ADR-017 and the supersession chain into ADR-053). Tom's ADR-056 is on his side. Before Phase 7+ work, decide: (a) bring ADR-056 across as the governing policy doc, (b) point #321 at our ADR-053 (browser-first multi-harness architecture) as the policy anchor, or (c) write a new ADR-055 in this repo that bridges both. **My recommendation: (b)** — ADR-053 is the canonical multi-harness boundary doc and supersedes ADR-026's primary-agent slot work; #321 should reference it directly. |
| #334 adopts our #252 (`@tab` referencing) | **Action: review-and-adopt on my side.** Tom built the @tab feature as PR #334; I should pull + merge it into `feat/dev-external-agent-runtimes-panel` once Phase 5 lands. |
| beta.1 vs beta.2 timing question | **Owed to Tom.** Phase 5 is alpha-2.0; Phase 6 (resource governor) is the next gate. Phase 7 (continuity) is what unblocks beta.1; Phase 8 (Ground-0) is beta.2. I'll write back with the alpha-2.0 release plan in the reconciliation thread. |
| `backup/tab-referencing-pre-split` vs `#331 release-mirror split` | Already settled in my head — `backup/tab-referencing-pre-split` is the `#327 → #334` split, not the release-mirror split. The release-mirror work (browser-first/release/ as a build-output) is genuinely separate and belongs in beta.2 with the alpha-build gate cleanup. |

### Gaps still on his side (we are NOT on the hook)

- #320 unauthenticated server
- #321 bridge reverse-proxy + attributed bus
- #326 delegation OS isolation

These are Tom's workstream; my CP-5 cutover does not affect them.

### SDK hardening gaps Tom flagged (relevant to my track)

- **Gap 2 — sdkVersion / shellVersion enforcement**: Neither side has built this. **My track (CP-5 follow-up).**
- **Gap 4 — cross-manifest id-collision**: Within-manifest exists; cross- does not. **My track (CP-5 follow-up).**
- **agents[] / delegation runtime validation**: agents[] and delegation block remain unvalidated; the Exclude<TrustTier,"core"> guard is compile-time only. **My track.**

---

## File 2: ResonantOS-Framework-Stack-Feedback.pdf

This doc reviews a separate 5-PR stack (#327–#331) — Framework V0.1 + F1–F10 negative-test harness + `addon.deepseek-harness` example + bridge-side dispatcher + dev-panel/boot. **All five PR are pre-Phase-5 and pre-this-branch.** They are CI-red because of **two maintainer-owned blockers** + **one contributor-owned blocker**.

### Already done (closes Tom's "real progress, credit where due")

| Tom's claim | Repo state at `9c19d9b` |
|---|---|
| Ships the actual `@resonantos/addon-sdk` package | Confirmed — `packages/addon-sdk/` exists. |
| Adds the ADR-040 §7 F1–F10 negative-test harness | Confirmed — `packages/addon-sdk-testing/test/...` exists. |
| Adds `addon.deepseek-harness` example manifest | Confirmed — `public/addons/deepseek-harness.json`. |

### Maintainer-owned blockers (NOT my work; these are yours)

1. **Release-scope audit (`scripts/browser-first-release-scope-audit.mjs`) doesn't know `packages/addon-sdk*`** — gates alpha-build for #327/#328/#329/#331. **Owner: maintainer.** Tom's recommended fix: small PR + test for the allowlist.
2. **F1 credential-exfiltration fixture false-positive** in `packages/addon-sdk-testing/src/failure-modes/f1-credential-exfiltration.ts`. **Owner: contributor (me).** Recommended fix: add to hygiene content-allowlist (matching existing entries) — cleanest for a deliberate fixture. **Decision needed from you: do this in a follow-up PR, or hold until after Phase 5 lands?**

### Contributor-owned blocker (my work)

- **#331 release-mirror bloat.** 445 files / ~72k lines; 58 of them are `browser-first/release/` build mirror. Tom: "the release directory should be regenerated at release time, not carried in a dev-panel PR." **Action:** split `browser-first/release/` out of #331 entirely. This is pre-Phase-5 work and lives on the older stack, not the branch we just shipped — but if you want, I can do a hygiene PR that cleans the mirror out of `feat/cp5-phase5-reference-harnesses` too (it has 0 files under `browser-first/release/`, so nothing to do there; it's already clean). **My recommendation: leave #331 alone; it's a separate stack.**

### Tom's recommended sequence — my response

| Step | Tom's owner | My stance |
|---|---|---|
| 1 — Release-scope audit | Maintainer | Not my work. |
| 2 — Allowlist F1 fixture | Contributor | I'll do it as a follow-up PR if you want. |
| 3 — Split mirror out of #331 | Contributor | Not my branch — separate stack. |
| 4 — Re-run live-cert lane | Maintainer | Not my work. |
| 5 — Full dep-order code review | Maintainer | Not my work. |
| 6 — beta.2 merge decision | Maintainer | Not my work. |

### Beta.2 hardening Tom wants tracked (my follow-ups)

Tom says: "Before the SDK opens to untrusted community submissions, the eval's trust-layer gaps still stand and should be tracked as beta.2 items":

- Manifest signing / hash verification
- Enforced sdkVersion / shellVersion
- Runtime validation of `agents[]` and `delegation` manifest blocks
- Cross-manifest id-collision detection
- Wire `permission-diff` escalation gate into install path
- Contribution path in CONTRIBUTING.md / AGENTS.md / Change-to-Check / Project-2 Area lane
- Make `npm run validate:manifest` real

**My recommendation:** these go into a new CP between Phase 6 and Phase 7 — call it CP-7.5 — because Phase 7 is about continuity/context-exchange, not SDK hardening.

---

## File 3: Tom Pennington - ResonantOS-Augmentor-SDK-Technical-Evaluation.pdf

### Already done

| Tom's claim | Repo state |
|---|---|
| SDK shape is right for first-party add-ons | Confirmed by the Phase 5 conformance: 7 reference adapters, 5 gate checks × 8 providers, all green. |
| Re-authoring Manolo's Augmentor → main agent is the right path | The Phase 5 work makes this concrete: `addon.augmentor-chat` already provides `primary-agent` + `chat-interface`, and the harness-provider model is the runtime path. |
| Hermes / OpenCode / OpenClaw / etc. are all first-party add-ons in the SDK | Phase 5 migration: 7 reference adapters, conformance suite, manifests in `public/addons/`. |
| Exclude<TrustTier,"core"> guard | The structural protection is real — defaults.ts sources core agents only. |

### Partially done (Tom's caveats honest)

| Tom's caveat | Status |
|---|---|
| "primary-agent slot is declared but not yet consumed by runtime" | **Phase 5's CP-5 migration is the wiring:** the harness-provider model + `addon.augmentor-chat` providing `primary-agent` + the workspace-lease gate means the slot is now consumable. ADR-053 supersedes ADR-026. |
| "agents[] / delegation runtime validation is missing" | Not built — Gap 3 from file 1. **My track (beta.2).** |

### Needs decision

| Tom's point | What to decide |
|---|---|
| "Make `npm run validate:manifest` real" | **Add to package.json** as `"validate:manifest": "node packages/addon-sdk/src/cli.js validate-manifest <path>"` or similar. **Need to scope: does `packages/addon-sdk` have a CLI module already, or does this need to be built?** |
| "Add an add-on row to CONTRIBUTING.md / AGENTS.md / Change-to-Check / Project-2 Area lane" | **Action: trivial doc changes.** I can do this in a follow-up PR (one file each, plus the area lane taxonomy). **Need a doc:** does this repo have a Change-to-Check matrix? `grep` found none; Tom's reference may be to a maintainer-internal doc. |
| "Manifest signing / hash verification; enforced sdkVersion; cross-manifest id-collision detection; runtime validation of agents[] / delegation; wire permission-diff escalation" | **Beta.2 workstream** — see File 2's recommendation above. New CP between Phase 6 and Phase 7. |

### Tom's recommendations explicitly addressed

> "Treat it as a **re-author, not a swap**: port its five browser tools onto AddOnToolDefinition with `coversNativeTool:"browser.session"`, declare `runtimeType:"agent-addon"` + an agentRuntime contract, and claim the primary-agent slot with the agent-delegation capability. Follow the hermes.agent / addon.augmentor-chat pattern."

This is exactly what Phase 5 enables. The harness-provider model + the existing augmentor-chat manifest = the re-authoring target is ready. **No new code needed from me for this recommendation; it's a downstream exercise once the primary-agent slot is wired.**

> "Its browser control must route through host-side Agent Control on the :9119 bridge, not a private :3080 native host"

Confirmed by `bridge-server.mjs:98,288` (token minting) + `bridge-capability-tokens.mjs:1-6`. The :9119 bridge IS the governed, capability-gated path.

---

## What to decide (concrete)

| # | Decision | Default if you say nothing |
|---|---|---|
| 1 | Adopt #334 (Tom's @tab feature) into `feat/dev-external-agent-runtimes-panel`? | Hold until Phase 6 cuts; we have time. |
| 2 | ADR-056 ↔ #321 reconciliation: bring ADR-056 across, or point #321 at ADR-053? | Point #321 at ADR-053. ADR-053 already is the multi-harness boundary doc. |
| 3 | F1 credential-exfiltration fixture: add to hygiene content-allowlist? | Yes — clean fix. |
| 4 | `npm run validate:manifest` — scope the work (does the CLI module exist)? | I'll read `packages/addon-sdk/package.json` and report back. |
| 5 | CONTRIBUTING.md / AGENTS.md / Change-to-Check / Project-2 add-on rows: scope? | Trivial doc PR. |
| 6 | New CP between Phase 6 and Phase 7 for SDK hardening (signing + sdkVersion + cross-manifest id + agents[]/delegation runtime validation + permission-diff wiring)? | Yes — call it CP-7.5 or fold into Phase 7. |
| 7 | CP-5 follow-up: per-harness archive parity contract doc update? | The per-harness-archive-parity.test.mjs (Phase 5.3) IS the contract doc — the test pins the contract. No additional doc needed. |

## What to do (already committed, no decision needed)

- **Phase 5 PR #2 is OPEN.** Tom can review.
- **The four CP-5 rows (98/99/100/103) are done** with 26 new tests, 1227/1227 ext + 734/734 vitest.
- **No "wasted parallel effort."** Tom's analysis is right: the SDK is an extraction, the containment branches are stale, and Phase 5 fills in the harness-provider gap that Manolo's Augmentor will need.

## What needs new code

- **CP-5 follow-up #1: F1 fixture allowlist** (one-line hygiene PR; trivial).
- **CP-5 follow-up #2: `npm run validate:manifest`** (depends on whether `packages/addon-sdk` has a CLI scaffold already — I'll scope and report).
- **Beta.2 workstream (CP-7.5 or new CP): SDK hardening** — manifest signing, sdkVersion enforcement, cross-manifest id-collision, agents[]/delegation runtime validation, permission-diff escalation wiring. Big multi-PR effort; should be its own workstream prompt.
- **Doc PR: CONTRIBUTING.md + AGENTS.md + Change-to-Check + Project-2 Area lane** for add-ons. Trivial.

Let me know which decisions to take and I'll execute.