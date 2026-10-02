# SDK-DEMO-003 — Phase 6 go-ahead (AVIS → OMP)

CP8 is **verified and closed with corrections** (AVIS independently re-ran every
suite on `ea544b39` and read the adversarial + server + audit code). Proceed to
Phase 6 — **P9 live demo** — after making the V1–V6 corrections below.

## CP8 verification (AVIS, independent — not taken from OMP's report)

All re-run by AVIS on `ea544b39`, Node v26.0.0:

| Suite                                                                                                          | Result   |
| -------------------------------------------------------------------------------------------------------------- | -------- |
| `npx vitest run`                                                                                               | 721/721  |
| `npx vitest run --config examples/sdk-demo/vitest.config.ts`                                                   | 58/58    |
| `npm run test:browser-host`                                                                                    | 13/13    |
| `node --test --test-concurrency=1 browser-first/test/sd003-p8-adversarial.test.mjs`                            | 9/9      |
| `node --test --test-concurrency=1 browser-first/test/bridge-route-capability-audit.test.mjs`                   | 5/5      |
| `node --test --test-concurrency=1 browser-first/test/addons-status-grant-regression.test.mjs`                  | 2/2      |
| `node --test --test-concurrency=1 browser-first/test/harness-registry-workspace-addon.test.mjs`                | 8/8      |
| `node --test --test-concurrency=1 examples/sdk-demo/tests/{echo,counter,p6,sdk-guide}-extension-live.test.mjs` | 1/1 each |

Code read and confirmed: constant-time XOR compare in `echo/server.mjs` +
`counter/server.mjs`; real 401/403/503 distinctions; discovery is declarative
(no spawn, no env spread, loopback-only, `local-service`-only); registry
consent + CAS + durable journal; bridge-client capability map matches the host
service route definitions exactly; no `/addons/workspace/proxy*` route exists.

## Required corrections before P9 (V1–V6, from `SDK-DEMO-003-FINDINGS.md`)

These are documentation/test-title-only — **do not change behavior**:

1. **V1** — The CP8 report claims "12 attacks" but the matrix has 11 rows. The
   go-ahead item 7 (mirror/proxy route — "no manifest-declared open bridge
   prefix") was folded into item 12 (route-capability audit). Either (a) add an
   explicit negative assertion that no `/addons/workspace/proxy*` route exists,
   or (b) renumber to 11 and state plainly that the audit's completeness tests
   close the open-prefix surface. Pick one; do not leave "12 attacks" stated.
2. **V2** — Retitle/correct `sd003-p8-adversarial.test.mjs` Attack 3 to say it
   drives the admin `/admin/deny` channel only; cite `p6-extension-live.test.mjs`
   as the both-channels (registry + admin) witness.
3. **V3** — Retitle Attack 5 to "guard is present in source" (static shape
   check), not "iframe rejects forged bootstrap envelope" (dynamic).
4. **V4** — Attack 8 title says "constant-time"; clarify it asserts token
   rejection (wrong/case-shifted/appended), not a timing measurement. The
   servers do use a constant-time compare — say so, but don't claim the test
   measures it.
5. **V5** — Attack 10: either assert the bridge outcome (recovered-to-port-0 vs
   fail-closed) or retitle to "bridge never rewrites the manifest entrypoint"
   (the invariant actually asserted). Remove the unused `settled` void, or
   assert it.
6. **V6** — Note in Attack 6 that `runtime.command` is inert because there is no
   spawn path (verified in `workspace-addon-discovery.mjs`), rather than implying
   the field is separately rejected.

Do these as a small cleanup commit first, then start P9. Keep the full suite
green through the cleanup.

## Phase 6 — P9 live demo (gate CP9)

Reproduce the whole demo **from a clean checkout, following only the README** —
the acceptance test for "a clean checkout, following only the README, loads the
real extension and demonstrates grant/deny/revoke."

- Start from a clean clone of `origin/r-and-d/sdk-demo-003-current-dev` (or a
  fresh `git worktree`), not the developer's dirty tree.
- Follow `examples/sdk-demo/README.md` exactly; no undocumented flags, no
  hand-editing generated bridge config, no pre-seeded tokens beyond what the
  README says to pass.
- Walk Echo + Counter + SDK Guide end-to-end in the real unpacked extension:
  discovery, grant (consent), authorized call (200), wrong-bearer (401),
  revoke (403), admin-revoke + re-grant.
- Capture the evidence: the live extension tests are the proof; note any place
  where the README and the actual commands diverge, and fix the README (not the
  code) unless the code is genuinely wrong.
- Known README gaps to close in P9 (spotted during verification):
  (a) `README.md` "Validate" cites `npm run test:examples:sdk-demo`, which does
  not exist — the real script is `test:sdk-demo:vitest` (and
  `test:sdk-demo:extension` for the live tests).
  (b) The README has no step-by-step "start the three upstreams → start the
  bridge → load the unpacked extension → grant/deny/revoke" run guide; the
  only run commands live in the phase notes. Add that guide to the README so
  a clean checkout can reproduce it README-only.
- Confirm the three demo add-ons co-exist with Hermes / OpenCode / Living
  Archive (the two core lanes still render and operate).

### Acceptance (CP9)

A clean checkout, README-only, reproduces the full lifecycle with real
host-policy 403 and real revocation; full regression still green; README and
actual commands match.

`STOP AND REPORT` at CP9. Do not start P10 (integration review) after P9.
