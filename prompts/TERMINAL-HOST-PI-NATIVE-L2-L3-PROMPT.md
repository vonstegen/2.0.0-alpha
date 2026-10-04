# Terminal Host ↔ Pi-Native — L2 + L3 (Projections + Credential Adapter) — OMP Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before acting.**

L1 (CP-M2) is green and verified. This prompt carries **Layer 2** (projections)
and **Layer 3** (credential adapter), plus two dependencies that surfaced during
the L1 audit.

---

## 0. Authority (read first)

- `docs/architecture/TERMINAL-HOST-PI-NATIVE-CARRYOVER-PLAN.md` — Layers 2 & 3.
- `prompts/TERMINAL-HOST-PI-NATIVE-MERGE-PROMPT.md` — Phase 3 (TH-P3).
- `docs/architecture/TERMINAL-HOST-PI-NATIVE-RECONCILIATION.md` — the "why".

---

## 1. Pre-flight (resolve before carrying L3)

1. **`deriveProviderProtocol` is NOT on this branch** (confirmed by AVIS: 0
   matches in `browser-first/host/provider-fabric-core.mjs`). The credential
   adapter imports it, so you must carry two symbols from
   `../pi-phase2/browser-first/host/provider-fabric-core.mjs` — **additively**:
   `PROVIDER_PROTOCOL_BY_TYPE` (a frozen const) and `deriveProviderProtocol`
   (a small pure fn). Do not replace the whole file; append these two exports.
2. **Confirm `agentRuntime.credentialSource` placement.** The credential adapter
   reads `manifest?.agentRuntime?.credentialSource === "provider-profile"`. Verify
   the field you added in L1 (`69a8a4eb`) is on the path the adapter actually
   reads. If it's on `AddOnAgentRuntimeAdapterContract` but the adapter reads a
   different shape, fix the placement now (one line) rather than after L3.

---

## 2. L2 — carry Layer 2 (projections) · gate CP-M3

Carry (byte-identical, import paths only):

- `browser-first/host/harness-resource-projection.mjs`
- `browser-first/host/harness-skills-projection.mjs`

Carry their tests:

- `browser-first/test/harness-resource-projection.test.mjs`
- `browser-first/test/harness-skills-projection.test.mjs`
- `browser-first/test/harness-skills-staging-audit.test.mjs`
- `browser-first/test/harness-skills-staging-hardening.test.mjs`

Dependencies to confirm present: `addons/resonant-browser-host/src/lib/path-contains.mjs`
(present ✓) and `packages/addon-sdk/src/harness-resources.ts` (carried L1 ✓).

**CP-M3 gate:** `node --experimental-strip-types --test` on the four projection
tests passes; `npx tsc --noEmit` clean; core = 721/721.

`STOP AND REPORT` here.

---

## 3. L3 — carry Layer 3 (credential adapter) · gate CP-M3

Carry:

- `browser-first/host/pi-native-credential-adapter.mjs`
- The two `provider-fabric-core.mjs` symbols from §1.1 (additive).
- `browser-first/test/pi-native-session-credential.test.mjs`

**Test dependency to resolve:** `pi-native-session-credential.test.mjs` imports
`piCommand` from `../host/pi-runtime.mjs` (currently deferred). Two options —
pick one and note it:

- **(a) carry `pi-runtime.mjs`** (small leaf: the reviewed Pi executable
  allowlist), since it's needed for L6 anyway; or
- **(b) scope the test** to drop the executable-allowlist assertion for now and
  re-add it when `pi-runtime.mjs` is carried.

**CP-M3 gate:** `node --experimental-strip-types --test` on
`pi-native-session-credential.test.mjs` passes; core + demo unchanged.

`STOP AND REPORT` here.

---

## 4. Hard rules (unchanged)

- No `git merge feature/pi-testing-phase`. Carry by blob read
  (`git show feature/pi-testing-phase:<path>`) + write.
- Both sides of any conflict file survive.
- Byte-identical carries (except the two additive `provider-fabric-core.mjs`
  symbols and the comment-only provider-map note).
- Do not carry `pi-native-session-service.mjs`, `pi-native-tui-host-service.mjs`,
  `pi-process-launcher.mjs`, `grok-native-*.mjs`, `opencode-session-host-service.mjs`
  (unless option (a) in §3 is chosen for `pi-runtime.mjs`).

---

## 5. Verification discipline + STOP AND REPORT

Re-run every command yourself; paste summary + last ~20 lines. Commit per phase
(`feat(terminal-host):` / `test(terminal-host):`). Never push to `dev`/`main`/
`upstream`. Report test counts named by label (core / demo / browser-first).
