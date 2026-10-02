# SDK-DEMO-003 — Phase 7 go-ahead (AVIS → OMP)

CP9 is **verified and closed** (AVIS independently re-ran every suite on
`6ac4f0c5` and read the corrected adversarial test + README + bridge launcher
+ `bridge-capability-tokens.mjs`). Proceed to Phase 7 — **P10 integration
review**.

## CP9 verification (AVIS, independent — not taken from OMP's report)

All re-run by AVIS on `6ac4f0c5`, Node v26.0.0:

| Suite | Result |
| ----- | ------ |
| `npx vitest run` | 721/721 |
| `npx vitest run --config examples/sdk-demo/vitest.config.ts` | 58/58 |
| `npm run test:browser-host` | 13/13 |
| `sd003-p8-adversarial.test.mjs` | 10/10 |
| `bridge-route-capability-audit.test.mjs` | 5/5 |
| `addons-status-grant-regression.test.mjs` | 2/2 |
| `harness-registry-workspace-addon.test.mjs` | 8/8 |
| `npm run test:sdk-demo:extension` (echo + counter + p6 + guide) | 4/4 |
| **Total** | **821** |

Confirmed in source (not just titles):

- V1–V6 corrections are accurate and honest; the new `P8 Attack 7` test greps
  every `browser-first/host/*.mjs` for `path:` declarations and asserts no
  `/addons/workspace/proxy*` route exists.
- README flag names match the actual argv parsers:
  - Upstreams: `--{echo,counter,sdk-guide}-{bearer,admin}-token` (echo + counter
    accept space or `=`; sdk-guide accepts `=` — README uses `=` throughout, so
    it's correct).
  - Bridge: `--bridge-port`, `--bridge-token`, `--capability-bootstrap-token`,
    and the `--<arg>-token` names from `BRIDGE_CAPABILITY_TOKEN_SPECS`; the
    `parseArgs` helper only accepts `--flag=value` (README uses `=`, correct).
- `test:sdk-demo:extension` now walks all four live tests in one command.
- The stale "12 attacks" claim is gone from the architecture map + README.

## Minor nits for P10 (non-blocking)

1. **README "all-on" wording** — the bridge invocation is called the "canonical
   'all-on' invocation" but omits 5 capability tokens (`provider-credential`,
   `provider-routing`, `provider-diagnostics`, `provider-model-invoke`,
   `agent-control-plan`). They are auto-minted by `buildBridgeCapabilityTokens`,
   so the demo still runs, but "all-on" is slightly inaccurate. Either add the
   5 omitted flags or reword to "all demo-relevant capabilities."
2. **Manual UI path is not automated** — the 4 live tests boot their own
   upstreams + bridge + extension and drive grant/deny/revoke via the bridge
   HTTP routes; the literal side-panel button-click walkthrough in README §4 is
   not covered by the suite. Acknowledged limitation; the code-path proof is
   the live tests. (Keep this honest in the PR notes / report.)

## Phase 7 — P10 integration review (gate CP10)

Close out the integration before the report/user-guide and any merge:

1. **Dispose of all SDK-DEMO-002 findings** — go through the 002 findings list
   and mark each: resolved here, still-open, or out-of-scope-for-the-demo. No
   002 finding may be left unclassified.
2. **Diff audit** — produce a clean, reviewable diff of
   `r-and-d/sdk-demo-003-current-dev` against `upstream/dev @ 19665c06`,
   grouped by concern (demo add-ons, host routes, renderer, tests, docs).
   Confirm no Core/`src` change, no Hermes/OpenCode/Living Archive behavior
   change, no second registry, no env spread, no token in HTML/URL.
3. **README + architecture map + findings consistency** — the three docs must
   agree on: what's shipped (P0–P9), what's deferred (D1–D6), the demo-vs-
   production gap (§6), and the known limitations above.
4. **PR notes (no auto-merge)** — draft the PR description for a fast-forward
   merge into `origin` (vonstegen fork), plus the reviewer checklist. Do not
   merge; do not push to `upstream` (ResonantOS org).

### Acceptance (CP10)

Every 002 finding disposed; the diff audit shows zero unintended Core/`src` or
Hermes/OpenCode/Living Archive change; the three docs agree; a PR notes file is
written and the branch is left fast-forward-clean, not merged.

`STOP AND REPORT` at CP10. Do not start the LaTeX report/user-guide until AVIS
verifies CP10.
