# Terminal Host ↔ Pi-Native — L4 + L5 (SDK Tests + ADRs) — OMP Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before acting.**

L2/L3 (CP-M3) is green and verified. This is the **final carry-over layer**: L4
(SDK contract tests) and L5 (ADRs + the ADR-number renumber). After this, step 1
of the plan is complete and we move to *building* the session manager + bootstrap.

---

## 0. Authority (read first)

- `docs/architecture/TERMINAL-HOST-PI-NATIVE-CARRYOVER-PLAN.md` — Layers 4 & 5.
- `prompts/TERMINAL-HOST-PI-NATIVE-MERGE-PROMPT.md` — Phase 4 (TH-P4).
- `docs/architecture/TERMINAL-HOST-PI-NATIVE-RECONCILIATION.md` — the "why".

---

## 1. L4 — carry the SDK contract test · gate CP-M4a

Carry (byte-identical, import paths only):

- `src/sdk/addons/harness-resources.test.ts`

This tests `packages/addon-sdk/src/harness-resources.ts` (carried L1). It runs under
the **core** vitest suite (`npx vitest run`), not `node --test`.

**CP-M4a gate:** `npx tsc --noEmit` clean; `npx vitest run` = 721 + the new
harness-resources tests (record the new core total by label).

`STOP AND REPORT` here.

---

## 2. L5 — carry ADR-041–044 + renumber the collision · gate CP-M4b

### 2a. Carry ADR-041–044 (byte-identical)

- `docs/architecture/ADR-041-harness-provider-connection.md`
- `docs/architecture/ADR-042-generic-harness-resource-request.md`
- `docs/architecture/ADR-043-generic-harness-resource-projection.md`
- `docs/architecture/ADR-044-generic-harness-skills-projection.md`

Keep their `Status` values (they are `Accepted`); ensure each passes the ADR
status vocabulary (`Accepted`/`Deferred`/`Superseded`/`Historical`).

### 2b. Renumber the colliding pi ADRs (per the carry-over plan)

The pi branch allocated `039`/`040` to different decisions than the terminal-host
branch. Renumber the **pi** ones:

- `ADR-039-harness-runtime-provider-profiles.md` → **`ADR-045-harness-runtime-provider-profiles.md`**
- `ADR-040-addon-classification-category-discovery.md` → **`ADR-046-addon-classification-category-discovery.md`**

Update any **internal cross-references** inside ADR-041–046 that point at the old
`039`/`040` numbers (grep the carried ADR files for `039` / `040` and fix them to
`045` / `046` where they meant the pi decisions, not the terminal-host ones).

### 2c. Update the index

`docs/architecture/README.md` must list **both** the terminal-host ADRs (keep
`ADR-039` = harness category, `ADR-040` = terminal host) **and** the carried
`ADR-041`…`ADR-046`. Remove nothing; add the six new rows with correct
status/owner/scope columns.

**CP-M4b gate:** `npm run docs:check` passes (no new "not reachable" for the
carried ADRs); the ADR index validates (`node scripts/validate-docs.mjs` / the ADR
index check — whichever the repo uses); no cross-reference still points at the
old `039`/`040` meaning the pi decisions.

`STOP AND REPORT` here.

---

## 3. Hard rules (unchanged)

- No `git merge feature/pi-testing-phase`; carry by blob read + write.
- Byte-identical carries except the two renames + cross-reference fixes + index.
- Both sides of any conflict survive (the index is the one shared file here).
- Do not touch the already-carried deferred-list files.

---

## 4. Verification discipline + STOP AND REPORT

Re-run every command yourself; paste summary + last ~20 lines. Commit per phase
(`test(terminal-host):` / `docs(terminal-host):`). Never push to `dev`/`main`/
`upstream`. Report test counts named by label (core / demo / browser-first) and
the new core total after L4.

After CP-M4b clears, **step 1 (carry-over) is complete** — report that explicitly,
then pause for the step-2 prompt (session manager + `ros-session attach`).
