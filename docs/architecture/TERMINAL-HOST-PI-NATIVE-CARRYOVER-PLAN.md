# Terminal Host ↔ Pi-Native — Carry-Over Plan (Step 1)

- Status: **Execution plan** (pairs with `TERMINAL-HOST-PI-NATIVE-RECONCILIATION.md`)
- Branches: `r-and-d/terminal-host-current-dev` (active) ← `feature/pi-testing-phase` (source)
- Common ancestor: `c92bf898`

## Goal

Carry the **terminal-agnostic "authorized session environment" seam** (ADR-041–044)
from `feature/pi-testing-phase` into `r-and-d/terminal-host-current-dev`, **without** a
wholesale merge. Do **not** run `git merge feature/pi-testing-phase` — the branches
collide on ADR numbering and on shared contract files.

## Blocker #1 — ADR numbering collision (needs a decision)

Both branches allocated the same numbers to different decisions:

| Number | terminal-host (keep) | pi (renumber) |
|---|---|---|
| ADR-039 | harness add-on category / swappable default agent | harness runtime provider profiles → **045** |
| ADR-040 | terminal host adapter contract | addon classification / category discovery → **046** |

Decision: the active branch keeps `039`/`040`; the pi branch's `039`/`040` are renumbered
`045`/`046` (next free). Update `docs/architecture/README.md` index accordingly.

## Blocker #2 — shared-file conflict surface

These are changed on **both** branches and must be reconciled by hand, not overwritten:

- `src/core/contracts.ts` — terminal-host added `terminal-host` capability + `HarnessEvent`
  `terminal.*` variants; pi added `harnessProviderConnection`, `agentRuntime.credentialSource`,
  `HARNESS_RESOURCE_*`. **Both must survive.**
- `packages/addon-sdk/src/contracts.ts` — terminal-host added `terminal-host` to
  `ADDON_CAPABILITIES`; pi added `HARNESS_RESOURCE_FAMILIES`/`HARNESS_RESOURCE_OPERATIONS`.
- `browser-first/host/harness-adapter-contract.mjs` — `publicHarnessError` (pre-existing, used
  by pi) and `validateHarnessEvent` (terminal-host) both live here; do not drop either.

## Carry-over order (dependency-sorted)

### Layer 0 — leaves (no repo-internal deps) — carry first
1. `browser-first/host/harness-session-environment.mjs` (`buildSessionEnvironment`, `redactEnvironment`)
2. `browser-first/host/pi-native-provider-map.mjs` (`resolvePiNativeProvider`)

### Layer 1 — SDK contract additions (the conflict surface)
3. `packages/addon-sdk/src/harness-resources.ts` — imports `HARNESS_RESOURCE_FAMILIES` +
   `HARNESS_RESOURCE_OPERATIONS` from `./contracts.ts`, so those constants must land first.
4. Reconcile `packages/addon-sdk/src/contracts.ts` (add `HARNESS_RESOURCE_FAMILIES` /
   `HARNESS_RESOURCE_OPERATIONS`) and `src/core/contracts.ts` (add `harnessProviderConnection`,
   `agentRuntime.credentialSource`, and any `HarnessResource*` types) alongside the existing
   `terminal-host` additions.

### Layer 2 — projections
5. `browser-first/host/harness-resource-projection.mjs` — deps: `harness-resources.ts`,
   `addons/resonant-browser-host/src/lib/path-contains.mjs` (**present** on the branch).
6. `browser-first/host/harness-skills-projection.mjs` — deps: `harness-resources.ts`,
   `ADDON_CAPABILITIES`, `path-contains.mjs`.

### Layer 3 — credential adapter
7. `browser-first/host/pi-native-credential-adapter.mjs` — deps: `publicHarnessError`
   (**present**), `deriveProviderProtocol` from `provider-fabric-core.mjs` (**present — verify
   the export**), `pi-native-provider-map.mjs`, `harness-session-environment.mjs`.

### Layer 4 — tests
8. `browser-first/test/harness-resource-projection.test.mjs`
9. `browser-first/test/harness-skills-projection.test.mjs`
10. `browser-first/test/harness-skills-staging-audit.test.mjs` + `harness-skills-staging-hardening.test.mjs`
11. `browser-first/test/pi-native-session-credential.test.mjs`
12. `src/sdk/addons/harness-resources.test.ts`

### Layer 5 — ADRs
13. `docs/architecture/ADR-041-harness-provider-connection.md`
14. `docs/architecture/ADR-042-generic-harness-resource-request.md`
15. `docs/architecture/ADR-043-generic-harness-resource-projection.md`
16. `docs/architecture/ADR-044-generic-harness-skills-projection.md`
17. Renumber pi `ADR-039`→`045`, `ADR-040`→`046`; update the index.

## Explicitly deferred (depends on the external-vs-embedded decision)

Do **not** carry these yet — they are the "embedded browser TUI" surface (pi-native TUI host),
which is the fork decision:

- `browser-first/host/pi-native-session-service.mjs`
- `browser-first/host/pi-native-tui-host-service.mjs`
- `browser-first/host/pi-process-launcher.mjs`, `pi-runtime.mjs`
- `browser-first/host/grok-native-*.mjs`, `opencode-session-host-service.mjs`

## Verification gates

- After Layer 1: `tsc --noEmit` clean; `npx vitest run` (core) still 721/721.
- After Layer 3: `node --test` on the carried-over projection/credential tests passes.
- After Layer 5: `npm run docs:check` and the ADR index validates (`validateAdrIndex`).
- End state: demo + core + browser-first suites all green, `terminal-host` behavior unchanged.
