# CP-7.5 Phase 7.5 continuation prompt

This document is the **Phase 7.5 continuation prompt** for the CP-7.5 Add-on SDK hardening workstream. Read it before starting a fresh session on Phase 7.5. It picks up where CP-5 (Phase 5 reference harness migration) closed and where Tom's framework-stack feedback left the hardening track.

## Why CP-7.5, not Phase 6 or Phase 7

ResonantOS's CP-6 (resource governor) is the next gate after CP-5. CP-7 (continuity + context exchange) follows. Tom's framework-stack feedback, however, flagged a **separate track** of trust-layer gaps that gate "community-ready" add-on SDK status — not resource accounting (CP-6) and not continuity (CP-7). The cleanest place for these gaps is **between CP-6 and CP-7**: CP-7.5. CP-7.5 does not replace any existing phase; it sits alongside CP-6 and CP-7 as a focused hardening workstream.

## Workstream context

**Branch to cut from**: `feat/cp5-phase5-reference-harnesses` (the just-pushed CP-5 branch). The CP-5 follow-up branches (`adopt-tab-mention-334`, `cp5-fu-decision-3-and-4`, `cp5-fu-doc-pr`, `cp5-fu-adr-055`) are also reachable.

**Current heads on those branches (at the time of this prompt)**:

| Branch | HEAD | What's on it |
|---|---|---|
| `feat/cp5-phase5-reference-harnesses` | `9c19d9b` | Phase 5 cutover (rows 98/99/100/103 done, 26 new tests) |
| `adopt-tab-mention-334` | `48114b8` | Cherry-pick of `ResonantOS/2.0.0-alpha#334` (tab-mention-typeahead); 1248/1248 tests |
| `cp5-fu-decision-3-and-4` | `bab2fdd` | `npm run validate:manifest` + TOM-FEEDBACK-CROSS-REFERENCE.md |
| `cp5-fu-doc-pr` | `2bc294f` | AGENTS/CONTRIBUTING/PROJECT_GOVERNANCE add-on rows + reachability index |
| `cp5-fu-adr-055` | `5e72fcb` | ADR-055 (ADR-056 ↔ #321 reconciliation) |

**Goal**: close the five SDK hardening gaps Tom flagged in `ResonantOS-Augmentor-SDK-Executive-Summary.pdf` §"Before opening the SDK to the community" and `ResonantOS-Framework-Stack-Feedback.pdf` §"SDK hardening":

1. **Manifest signing / hash verification** — provenance tiers are self-attested today; the registry trusts `signed:true` labels as-is.
2. **Enforced sdkVersion / shellVersion** — currently accepted without checking.
3. **Runtime validation of `agents[]` and `delegation` manifest blocks** — the `Exclude<TrustTier,"core">` guard is compile-time only.
4. **Cross-manifest id-collision detection** — within-manifest duplicate checks exist; cross- does not.
5. **Wire `permission-diff` escalation into the install path** — the gate is built and tested but not wired.

Plus the loose-ends Tom named:

6. **Make `npm run validate:manifest` real** — DONE in CP-5 follow-up (`cp5-fu-decision-3-and-4`, commit `bab2fdd`). Confirm it still passes in the verify gate.
7. **Contribution path in CONTRIBUTING / AGENTS / Change-to-Check / Project-2 Area lane** — DONE in CP-5 follow-up (`cp5-fu-doc-pr`, commit `2bc294f`). Confirm the Project 2 `Add-on SDK` area is registered.
8. **Ship the actual `@resonantos/addon-sdk` package** — not on this branch; the maintainer's #327 (#335 MERGED to recognize `packages/addon-sdk*`) is the upstream home. CP-7.5 only owns the in-repo governance work; the package itself ships when the maintainer's stack lands.

## What's already done (Phases 0–5 + CP-5 follow-ups)

### CP-5 cutover (`9c19d9b`)

- 7 reference adapters + conformance suite (Hermes / OpenCode / OpenClaw / AgentZero / DeepSeekHarness / Pi / Aider)
- `workspace-lease.mjs` registry + lease-gated `opencodeRuntimeDispatch` (CP-5 row 99)
- `openclaw-gateway-client.mjs` (CP-5 row 100)
- Per-harness archive citation parity across 7 adapters (CP-5 row 103)
- 26 new tests; 1227/1227 ext + 734/734 vitest

### CP-5 follow-ups (4 branches on top of CP-5)

- `adopt-tab-mention-334` (PR #3 OPEN) — cherry-pick of `ResonantOS/2.0.0-alpha#334` (8 new tests, 1248/1248 ext)
- `cp5-fu-decision-3-and-4` — `npm run validate:manifest` (wires `src/sdk/addons/validation.ts::validateAddOnManifest`) + TOM-FEEDBACK-CROSS-REFERENCE.md (response to Tom's three new feedback PDFs)
- `cp5-fu-doc-pr` — AGENTS.md + CONTRIBUTING.md add-on rows in Change-To-Check + Project 2 `Add-on SDK` area in PROJECT_GOVERNANCE; reachability index fix
- `cp5-fu-adr-055` — ADR-055 (external agent runtime boundary reconciliation); points the maintainer's ADR-056 policy floor at this repo's ADR-053 as the architectural home

### Existing SDK surface (pre-CP-7.5)

- `src/sdk/addons/index.ts` exports `validateAddOnManifest`, `assertValidAddOnManifest`, `createAddOnRegistryEntry`, `createAddOnRegistrySnapshot`, and the type vocabulary
- `src/sdk/addons/validation.ts` is the manifest-shape validator (CP-5 follow-up wraps it via `npm run validate:manifest`)
- `src/sdk/addons/registry.ts` has within-manifest duplicate id checks; **cross-manifest id collision detection is the gap**
- `src/sdk/addons/contracts.ts` carries the trust-tier vocabulary; `Exclude<TrustTier,"core">` is compile-time only; **runtime `agents[]` / `delegation` validation is the gap**
- `scripts/permission-diff.ts` exists; **wiring it into the install path is the gap**
- `public/addons/index.json` is the registry; **manifest signing + sdkVersion / shellVersion enforcement are the gaps**

## What CP-7.5 needs to do

### 7.5.1 — Manifest signing / hash verification

- Add a `manifestSignature` block to the manifest schema: `{ algorithm, publicKey, signature }` where `signature` is over the canonicalized manifest body (sorted keys, no whitespace).
- Extend `validateAddOnManifest` to verify the signature against the public key when `provenance === "verified"`. Failure to verify must fail validation.
- Add a `sign-manifest` CLI tool (`scripts/sign-addon-manifest.mjs`) that takes a manifest path + a private key and writes the signature block.
- Tests:
  - At least one test that a manifest signed with a known key passes validation.
  - At least one test that a manifest with a tampered body fails validation.
  - At least one test that an unsigned manifest with `provenance: "verified"` fails validation (the unverified-trust-tier-as-verified attack).

### 7.5.2 — Enforced sdkVersion / shellVersion

- Add a `manifestVersionRange` type: `{ sdkVersion: string, shellVersion: string }` where each is a semver range.
- Extend `validateAddOnManifest` to check `ADDON_SDK_VERSION` (current runtime) against `manifest.sdkVersion` and the shell version (from `package.json`) against `manifest.shellVersion`. Failure must fail validation.
- The CP-5 follow-up `cp5-fu-decision-3-and-4` already added `npm run validate:manifest`; CP-7.5 just adds the version checks to that path.
- Tests:
  - At least one test that a manifest with `sdkVersion: "2.0.x"` passes when `ADDON_SDK_VERSION === "2.0.5"`.
  - At least one test that a manifest with `sdkVersion: "99.0.0"` fails.
  - At least one test that a manifest with `shellVersion: "banana"` fails (Tom's example).

### 7.5.3 — Runtime validation of `agents[]` and `delegation` blocks

- Add `validateAddOnRuntimeBlocks(manifest)` that walks `manifest.agents[]` and `manifest.delegation`, validates each block against the `AddOnAgentManifest` and `AddOnDelegationManifest` types, and checks the trust-tier exclusion (no `core` in either block).
- Wire `validateAddOnRuntimeBlocks` into the registry's `createAddOnRegistryEntry` so registry population fails closed on a manifest with an invalid runtime block.
- Tests:
  - At least one test that a manifest with `agents: [{ trustTier: "core" }]` fails the trust-tier exclusion.
  - At least one test that a manifest with `delegation: { humanApprovalBeforeExecution: false }` (the type-level flag) is rejected for the right reason.
  - At least one test that a manifest with a valid `agents[]` + `delegation` pair passes.

### 7.5.4 — Cross-manifest id-collision detection

- Extend `createAddOnRegistrySnapshot` to compare every manifest's `id` against every other manifest's `id` in the snapshot. First match (or "first wins" policy) decides.
- Add `AddOnRegistryIdCollision` error with `{ id, collisions: [{ addonId, publisher, manifestPath }, ...] }`.
- Wire the error into the install path: an install that introduces a collision is rejected unless `--force-override` is passed AND the install prompt is human-approved.
- Tests:
  - At least one test that two manifests with the same `id` (different publishers) surface the collision.
  - At least one test that two manifests with the same `id@publisher` (same publisher) also surface the collision (id-publisher pair is the worker key, not just id).
  - At least one test that the install path rejects a colliding manifest without `--force-override`.

### 7.5.5 — Wire `permission-diff` escalation into the install path

- The `scripts/permission-diff.ts` already implements the diff. Wire it into the host-service install handler.
- On install, compute the diff between the new manifest's `requestedCapabilities` and the previously-installed manifest's `requestedCapabilities` (or empty for a fresh install). If the diff adds, widens, weakens, or trust-changes any capability, prompt the user. The prompt handler already exists per ADR-039.
- Tests:
  - At least one test that a fresh install with non-empty `requestedCapabilities` triggers the user prompt.
  - At least one test that an update that adds a new capability triggers the prompt.
  - At least one test that an update that removes a capability (weakening) triggers the prompt.

### 7.5.6 — Tracking + doc 14

Update `IMPLEMENTATION_TRACKING.md` rows for CP-7.5 (the new phase). The Phase 5 cutover (CP-5) is in-progress; CP-7.5 will sit between CP-6 and CP-7 once Phase 5 / 6 close.

Update `14-master-phased-implementation-checklist.md` Phase 7.5 checkboxes.

### 7.5.7 — Run the full `engineer:verify` gate

```sh
cd /Users/andrewjochl/Developer/Projects/2.0.0-alpha.worktrees/feat-dev-panel
git checkout -b feat/cp75-phase75-sdk-hardening
npm run docs:check
npx tsc --noEmit
npx vitest run
node scripts/run-browser-first-extension-tests.mjs
```

All gates must be green. The CP-5 baseline is `1227/1227` extension tests + `734/734` vitest; CP-7.5 should add at least **12 new tests** (signature × 3 + sdkVersion × 3 + runtime × 3 + cross-id × 3 + permission-diff × 3) without regressing any of the 1227/734.

### 7.5.8 — Commit + push

One CP-7.5 commit per sub-area (7.5.1, 7.5.2, 7.5.3, 7.5.4, 7.5.5), then a final cutover commit that updates tracking + doc 14 + verifies the engineer:verify gate + pushes to `feat/dev-external-agent-runtimes-panel`.

## What CP-7.5 must NOT do

- Do NOT change the CP-5 cutover's workspace-lease public API — `acquire` / `release` / `inspect` / `size` / `clear` are the contract; CP-7.5 builds on it.
- Do NOT collapse the registry's within-manifest duplicate checks into the new cross-manifest check — both run.
- Do NOT add new `extensionClass` shapes — the seven reference shapes (Hermes, OpenCode, OpenClaw, AgentZero, DeepSeekHarness, Pi, Aider) are the only scope.
- Do NOT touch CP-6 (resource governor) or CP-7 (continuity) — those are separate workstreams.
- Do NOT replace the `npm run validate:manifest` script from CP-5 follow-up; CP-7.5 only extends what it checks.
- Do NOT introduce a new permission vocabulary — the existing `Capability` taxonomy is the contract.

## Risks + mitigations

- **Manifest signing key management.** If we require a public key per publisher but don't have a key registry, every verify fails. Mitigation: ship with an allowlist mode (`provenance: "verified" + allowlistedPublisher: true`) that the maintainer turns into a real signature check later. CP-7.5's signature verification is opt-in (manifests that claim `provenance: "verified"` must verify; manifests with `provenance: "curated-signed"` or `provenance: "approved"` skip the check).
- **sdkVersion / shellVersion drift.** The runtime's `ADDON_SDK_VERSION` and shell version must be in lockstep with the manifest ranges or every install fails. Mitigation: ship a single canonical `ADDON_SDK_VERSION` constant in `src/sdk/addons/contracts.ts` (already exists) and a single canonical shell version in `package.json`; the validate function reads both.
- **Cross-manifest collision noise.** Twenty bundled manifests are unlikely to collide, but a community add-on with `id: "browser"` (shadowing the bundled `addon.browser`) is the attack. Mitigation: ship the collision check first as a **warning** (logs but installs), then promote to a hard reject once the registry has been audited.
- **`permission-diff` install path performance.** Diffing every capability on every install is O(n) in the manifest size. Mitigation: cap the manifest size at 100 capabilities and cache the previous install's capability set in the registry store.
- **Signing algorithm choice.** Ed25519 is the obvious choice (small keys, fast verify, widely available). Mitigation: ship with Ed25519 only; don't try to support RSA or ECDSA — those add maintenance for no gain.

## Where to start in a fresh session

```sh
cd /Users/andrewjochl/Developer/Projects/2.0.0-alpha.worktrees/feat-dev-panel
git fetch origin
git checkout feat/cp5-phase5-reference-harnesses
git pull --ff-only
git checkout -b feat/cp75-phase75-sdk-hardening
```

Then read:
- This file (CP-7.5 continuation prompt)
- The Tom feedback cross-reference at `docs/architecture/resonantos-browser-architecture/TOM-FEEDBACK-CROSS-REFERENCE.md` (decisions 6 + 7 are the workstream context)
- ADR-018 (Add-on SDK V0) — the SDK contract that CP-7.5 hardens
- ADR-038, ADR-039, ADR-041, ADR-042 — the existing trust-tier / isolation / install-flow ADRs that CP-7.5 extends
- `src/sdk/addons/validation.ts` and `src/sdk/addons/registry.ts` — the surfaces CP-7.5 modifies

Then plan CP-7.5 commits: 7.5.1 (manifest signing) → 7.5.2 (version enforcement) → 7.5.3 (runtime block validation) → 7.5.4 (cross-manifest id collision) → 7.5.5 (permission-diff wiring) → final cutover (tracking + doc 14 + verify gate + push).