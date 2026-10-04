# Terminal Host ↔ Pi-Native — L0 Commit + L1 Reconcile — OMP Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before acting.**

You just completed **L0** (carried `harness-session-environment.mjs` +
`pi-native-provider-map.mjs`, byte-identical to `pi-phase2`). This prompt: commit
that work + the reference docs, then execute **L1** (the SDK contracts reconcile),
plus two flags.

---

## 0. Authority (read first)

- `docs/architecture/TERMINAL-HOST-PI-NATIVE-CARRYOVER-PLAN.md` — Layer 1 + the
  conflict surface. **This is the authority.**
- `prompts/TERMINAL-HOST-PI-NATIVE-MERGE-PROMPT.md` — Phase 2 (TH-P2).
- `docs/architecture/TERMINAL-HOST-PI-NATIVE-RECONCILIATION.md` — the "why".

---

## 1. Commit first (two commits, in this order)

```bash
cd /Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha

# 1. The L0 carry (2 files)
git add browser-first/host/harness-session-environment.mjs \
        browser-first/host/pi-native-provider-map.mjs
GIT_EDITOR=true git commit -m "feat(terminal-host): carry session-env + provider-map leaves (ADR-041 seam)"

# 2. The reference docs (3 files) — capture the plan OMP is executing
git add docs/architecture/TERMINAL-HOST-PI-NATIVE-CARRYOVER-PLAN.md \
        docs/architecture/TERMINAL-HOST-PI-NATIVE-RECONCILIATION.md \
        prompts/TERMINAL-HOST-PI-NATIVE-MERGE-PROMPT.md
GIT_EDITOR=true git commit -m "docs(terminal-host): add pi-native carry-over plan + reconciliation + merge prompt"
```

Do **not** push yet (commit-per-phase discipline; push on a later gate).

---

## 2. L1 — SDK contracts reconcile · gate CP-M2

**Goal:** land `packages/addon-sdk/src/harness-resources.ts` and the contract
symbols it needs, reconciling the two conflict files.

1. Read the pi source to learn the **exact** symbols:
   `../pi-phase2/packages/addon-sdk/src/harness-resources.ts` — note every symbol
   it imports from `./contracts.ts` (`HARNESS_RESOURCE_FAMILIES`,
   `HARNESS_RESOURCE_OPERATIONS`, `Capability`, …).
2. Reconcile `packages/addon-sdk/src/contracts.ts`: add
   `HARNESS_RESOURCE_FAMILIES` + `HARNESS_RESOURCE_OPERATIONS` **alongside** the
   existing `terminal-host` entry in `ADDON_CAPABILITIES`.
3. Reconcile `src/core/contracts.ts`: add `harnessProviderConnection`,
   `agentRuntime.credentialSource`, and any `HarnessResource*` types **alongside**
   the existing `terminal-host` capability + `HarnessEvent` `terminal.*` variants.
4. Carry `packages/addon-sdk/src/harness-resources.ts` verbatim (byte-identical),
   changing only its relative import path if needed.

**Hard rule — both sides survive.** Do not drop or overwrite either branch's
additions in those two files. If a region overlaps, merge the additions manually;
do not `git checkout` one branch's version over the other.

**CP-M2 gate:**
- `npx tsc --noEmit` clean.
- `npx vitest run` (core) = **721/721** (no regression).

`STOP AND REPORT` here.

---

## 3. Flag #1 — early credential test (security-sensitive leaf)

Add `browser-first/test/harness-session-environment.test.mjs` (self-contained, no
repo-internal deps) covering at least:

- invalid env-name keys are filtered by the regex;
- `envAllowlist` copies a key from `parentEnv`;
- the credential lands under `credentialName` (never dropped);
- a `baseEnv` key wins over a parent key (no parent leak);
- `redactEnvironment` returns **names only**, sorted.

Run with `node --experimental-strip-types --test browser-first/test/harness-session-environment.test.mjs`.

---

## 4. Flag #2 — provider-map comment vs. behavior

`browser-first/host/pi-native-provider-map.mjs` — the resolve comment names
`shared-minimax` / `shared-openai` as legacy `providerType` fallbacks, but the
frozen map has no `shared-*` keys, so they fail closed (`null`).

Resolve by **comment-only clarification** (recommended): state that `shared-*`
profiles are intentionally out-of-scope (no non-persistent env-var key) and fail
closed. Do **not** add a `shared-*` → base-provider mapping without flagging it —
if it looks like a real mapping gap, record it as a follow-up for the pi-phase2
owner rather than changing behavior unilaterally.

---

## 5. Verification discipline + STOP AND REPORT

Re-run every command yourself; paste summary + last ~20 lines. Commit per phase
with `feat(terminal-host):` / `test(terminal-host):` / `docs(terminal-host):`.
Never push to `dev`/`main`/`upstream`.

Report at CP-M2: exact commits, exact commands + output tails, files changed, test
counts **named by label** (core / demo / browser-first), and any known limitations.
