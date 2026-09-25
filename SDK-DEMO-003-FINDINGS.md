# SDK-DEMO-003 — Findings & deferred items

Running record of issues found during independent review and their status, so
nothing that needs fixing later is lost. Complement to `SDK-DEMO-003-ARCHITECTURE-MAP.md`.

## Resolved (closed during SDK-DEMO-003)

| # | Finding | Where | Resolution |
| --- | --- | --- | --- |
| R1 | **Self-grant placeholder** — bootstrap `capabilityTokens`/`grantedCapabilities` were derived from the manifest's `grantPresets` (author-controlled `granted: true`), not the host. | CP3/CP4, tracked since CP3 | **Closed in P6** (`9a6ffe88`): grants now come from `harness-registry` via `registry.install` + `registry.setGrants(consent: true)`; the renderer reads the registry snapshot, never `grantPresets`. |
| R2 | **CP4 false-green** — `counter-extension-live.test.mjs` reported 1/1 but failed deterministically (`bridge bootstrap probe … fetch failed`) due to a stale `bridge-config.generated.js`. | CP4 | **Closed** (`c6809f08`): stale-config cleanup added, matching `echo-extension-live`. |
| R3 | **CP3 deferred real-extension test** — Phase-1 gate required a real-browser test; a network smoke test was substituted. | CP3 | **Closed**: `echo-extension-live.test.mjs` loads the real unpacked extension, no `--disable-extensions`, no `addScriptToEvaluateOnNewDocument`. |
| R4 | `apiBasePath` carried an origin (not a path); dead no-op loop in `main-workspace.js`. | CP3 follow-up | **Closed** (`186f4bad`): field dropped, loop removed. |

## Deferred (fix later — not blocking the demo)

| # | Item | Why it matters | Target |
| --- | --- | --- | --- |
| D1 | **Host-mediated enforcement** — the sandboxed iframe still fetches its own upstream directly on loopback, so the host is not the *only* path a mutating request can take (architecture map §6 item **e**). | A malicious/hostile add-on could bypass the host's grant surface by calling its own loopback upstream directly; the demo proves the registry is the right authority but not that the host is the only enforcement point. | Route the iframe's mutating requests through a bridge-owned proxy (`POST /addons/workspace/proxy/{addonId}/...`) that is the sole listener on the upstream's loopback port and validates the grant before forwarding. |
| D2 | **Operator-pinned bearer token** — the bearer is a static value pinned at operator startup (`--*-bearer-token`), not a host-minted, expiring, audience-bound credential. | The review (002 finding #4) flagged shared/non-expiring tokens. P6 gives per-add-on tokens but not rotation/expiry. | Mint per-grant, per-add-on bearer tokens host-side with expiry; rotate on revoke. |
| D3 | **Revocation mechanism (B) is demo-pragmatic** — revocation is an out-of-band `POST /admin/deny` with a host-only admin token, flipping an in-memory flag on the add-on's upstream. | It couples the host to an add-on-specific admin endpoint and is not the host-mediated production shape. | Fold revocation into the D1 host-mediated proxy (revoke at the bridge boundary, no add-on-side flag needed). |
| D4 | **Real-extension tests are not in the default CI run** — they live on `test:sdk-demo:extension` / `node --test` and are not part of `test:browser-first`. | They can silently drop out of the gate. | Wire the three `*-extension-live.test.mjs` into CI (with a skip-when-no-browser policy), or an explicit release gate. |
| D5 | **Pre-existing `openai-harness-adapter.test.mjs` flake** (timing-sensitive, unrelated to the demo). | It intermittently fails on Node 26; currently not our scope. | Re-check on pinned Node 24.21.0; fix or exclude independently of SDK-DEMO-003. |

## Definition of "done" for the demo (unchanged)

The demo succeeds when a clean checkout, following only the README, loads the
real extension and demonstrates Echo + Counter + grant/deny/revoke with a real
host-policy 403 and real revocation — without exposing host secrets, creating a
second trust model, or regressing Hermes/OpenCode/Living Archive. D1–D3 are
explicitly out of scope for the *demo* and recorded here so they are not lost.
