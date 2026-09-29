# SDK-DEMO-003 — Findings & deferred items

Running record of issues found during independent review and their status, so
nothing that needs fixing later is lost. Complement to `SDK-DEMO-003-ARCHITECTURE-MAP.md`.

## Resolved (closed during SDK-DEMO-003)

| #   | Finding                                                                                                                                                                                                                                                           | Where                                             | Resolution                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Self-grant placeholder** — bootstrap `capabilityTokens`/`grantedCapabilities` were derived from the manifest's `grantPresets` (author-controlled `granted: true`), not the host.                                                                                | CP3/CP4, tracked since CP3                        | **Closed in P6** (`9a6ffe88`): grants now come from `harness-registry` via `registry.install` + `registry.setGrants(consent: true)`; the renderer reads the registry snapshot, never `grantPresets`. |
| R2  | **CP4 false-green** — `counter-extension-live.test.mjs` reported 1/1 but failed deterministically (`bridge bootstrap probe … fetch failed`) due to a stale `bridge-config.generated.js`.                                                                          | CP4                                               | **Closed** (`c6809f08`): stale-config cleanup added, matching `echo-extension-live`.                                                                                                                 |
| R3  | **CP3 deferred real-extension test** — Phase-1 gate required a real-browser test; a network smoke test was substituted.                                                                                                                                           | CP3                                               | **Closed**: `echo-extension-live.test.mjs` loads the real unpacked extension, no `--disable-extensions`, no `addScriptToEvaluateOnNewDocument`.                                                      |
| R4  | `apiBasePath` carried an origin (not a path); dead no-op loop in `main-workspace.js`.                                                                                                                                                                             | CP3 follow-up                                     | **Closed** (`186f4bad`): field dropped, loop removed.                                                                                                                                                |
| R5  | **Grant-wipe on re-poll** — `executeAddonsStatus` re-ran `registry.install()` on every `/addons/status` poll, replacing the entry and resetting `grantedCapabilities` to `granted: false`; any grant was silently wiped the next time the Add-ons panel rendered. | P6 (caught by live browser test, missed by suite) | **Closed** (`da20c987`): guarded install (`!snapshot().installations[id]`) + regression test `addons-status-grant-regression.test.mjs`.                                                              |

## Deferred (fix later — not blocking the demo)

| #   | Item                                                                                                                                                                                                       | Why it matters                                                                                                                                                                                                           | Target                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Host-mediated enforcement** — the sandboxed iframe still fetches its own upstream directly on loopback, so the host is not the _only_ path a mutating request can take (architecture map §6 item **e**). | A malicious/hostile add-on could bypass the host's grant surface by calling its own loopback upstream directly; the demo proves the registry is the right authority but not that the host is the only enforcement point. | Route the iframe's mutating requests through a bridge-owned proxy (`POST /addons/workspace/proxy/{addonId}/...`) that is the sole listener on the upstream's loopback port and validates the grant before forwarding. |
| D2  | **Operator-pinned bearer token** — the bearer is a static value pinned at operator startup (`--*-bearer-token`), not a host-minted, expiring, audience-bound credential.                                   | The review (002 finding #4) flagged shared/non-expiring tokens. P6 gives per-add-on tokens but not rotation/expiry.                                                                                                      | Mint per-grant, per-add-on bearer tokens host-side with expiry; rotate on revoke.                                                                                                                                     |
| D3  | **Revocation mechanism (B) is demo-pragmatic** — revocation is an out-of-band `POST /admin/deny` with a host-only admin token, flipping an in-memory flag on the add-on's upstream.                        | It couples the host to an add-on-specific admin endpoint and is not the host-mediated production shape.                                                                                                                  | Fold revocation into the D1 host-mediated proxy (revoke at the bridge boundary, no add-on-side flag needed).                                                                                                          |
| D4  | **Real-extension tests are not in the default CI run** — they live on `test:sdk-demo:extension` / `node --test` and are not part of `test:browser-first`.                                                  | They can silently drop out of the gate.                                                                                                                                                                                  | Wire the three `*-extension-live.test.mjs` into CI (with a skip-when-no-browser policy), or an explicit release gate.                                                                                                 |
| D5  | **Pre-existing `openai-harness-adapter.test.mjs` flake** (timing-sensitive, unrelated to the demo).                                                                                                        | It intermittently fails on Node 26; currently not our scope.                                                                                                                                                             | Re-check on pinned Node 24.21.0; fix or exclude independently of SDK-DEMO-003.                                                                                                                                        |

| D6 | **`harness-registry.install()` is non-idempotent** — it replaces the entry and resets grants. R5 fixed the immediate wipe with a caller-level guard, but any future caller that re-installs an already-registered add-on could still silently reset grants. | Latent footgun; only the harness-adapter path (re-install on manifest replacement) is safe today. | Decide whether `install()` should reject/no-op on an identical re-install, vs. documenting that re-install intentionally resets grants. |

## CP8 verification-quality notes (documentation corrections — not security holes)

Independently verified `ea544b39` (all suites re-run green; server + audit code
read). The adversarial controls are real, but several test titles and the CP8
report overstate what each test alone proves. These were verification-quality
corrections, now closed in `8c4709e4` — **not** live holes.

| #   | Item                                                                  | Detail                                                                                                                                                                                                                                                                                                                                                                                                                | Resolution                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | **Attack matrix is 11 rows, not 12**                                  | The P8 go-ahead item 7 ("mirror/proxy route — no manifest-declared open bridge prefix") was folded into item 12 ("honest route-capability audit") and never separately asserted. Verified: no `/addons/workspace/proxy*` route exists, and the audit's completeness tests would catch a new ungated route — so no live hole, but the "12 attacks" claim is inaccurate and the explicit negative assertion is missing. | **Closed in `8c4709e4`**: explicit `P8 Attack 7 (open-mirror negative)` test added — greps every `browser-first/host/*.mjs` and asserts no `/addons/workspace/proxy*` route declaration exists. |
| V2  | **Attack 3 (use-after-revoke) overclaims in-title**                   | `sd003-p8-adversarial.test.mjs` Attack 3 drives only the `/admin/deny` channel against the Counter upstream; it never drives the registry. The "both channels independent" proof actually lives in `p6-extension-live.test.mjs` (real-extension, passing). The test's own comment admits "we don't drive the registry here."                                                                                          | **Closed in `8c4709e4`**: retitled "admin channel only"; body drives only `/admin/deny`; cites `p6-extension-live.test.mjs` as the both-channel witness.                                        |
| V3  | **Attack 5 (forged postMessage) is a static shape check**             | Both Attack 5 tests regex-match source/HTML for the guard (`event.source !== window.parent`, `postMessage(..., addonOrigin)`) — they do not dynamically execute the listener or drive a forged message. Proves the guard is present, not that forgery is blocked at runtime.                                                                                                                                          | **Closed in `8c4709e4`**: both Attack 5 tests retitled "static shape check"; titles state the assertion is regex-over-source, not runtime.                                                      |
| V4  | **Attack 8 "constant-time" is asserted, not measured**                | The test proves wrong / case-shifted / appended tokens → 401; it does not measure timing. The servers do use a constant-time XOR compare (verified in `echo/server.mjs` + `counter/server.mjs`), so the control exists, but the title overstates the test.                                                                                                                                                            | **Closed in `8c4709e4`**: retitled "are rejected"; title states the test asserts token rejection, not timing; notes the constant-time XOR compare is verified in source.                        |
| V5  | **Attack 10 `settled` result is void-ed**                             | The test asserts only that `echo/addon.json` is SHA-256 identical before/after a port-busy bridge launch; the "recovered to port 0" outcome is never asserted (timing-dependent, 6 s cap, completed ~208 ms). Valid "no manifest rewrite" check; weaker than reported.                                                                                                                                                | **Closed in `8c4709e4`**: `settled` is now asserted (`ready` / `exit` / `timeout`); strict launcher-outcome assertion intentionally deferred (timing-sensitive).                                |
| V6  | **Go-ahead item 6 "runtime.command rejection" not separately tested** | Attack 6 tests only non-loopback entrypoint + non-`local-service` runtimeType. There is no spawn path (discovery is declarative — verified in `workspace-addon-discovery.mjs`), so a `runtime.command` field is inert, but its explicit rejection is not asserted.                                                                                                                                                    | **Closed in `8c4709e4`**: Attack 6 title and body now state the field is silently ignored (declarative discovery, no spawn path).                                                               |

## Definition of "done" for the demo (unchanged)

The demo succeeds when a clean checkout, following only the README, loads the
real extension and demonstrates Echo + Counter + grant/deny/revoke with a real
host-policy 403 and real revocation — without exposing host secrets, creating a
second trust model, or regressing Hermes/OpenCode/Living Archive. D1–D3 are
explicitly out of scope for the _demo_ and recorded here so they are not lost.

## SDK-DEMO-003R T6 — generic credential provisioning (closed)

T6 replaces the demo-specific/hard-coded credential wiring with a generic
host-owned resolver (`browser-first/host/workspace-addon-credentials.mjs`):
callers name `(add-on identity + purpose)` and the host resolves the scoped
material. One provisioning document (JSON, env/config-backed — no vault) is
read by both the bridge and the operator-started upstreams. See
`SDK-DEMO-003-ARCHITECTURE-MAP.md` §10 for the contract, trust/storage
boundary table, and lifecycle semantics.

### SDK-DEMO-003R T6.1 — credential-boundary hardening (closed)

T6.1 corrected three narrow credential-boundary issues found by the T6 audit,
without redesigning T6 and without starting T7:

1. **No raw secret material in argv.** The historical
   `--workspace-addon-credentials=<json>` flag is removed and no longer read;
   if present it is ignored (the loader fails closed). There is no replacement
   raw-secret argv flag. Provisioning precedence is now:
   `--workspace-addon-credentials-file=<path>` (file reference) →
   `RESONANTOS_WORKSPACE_ADDON_CREDENTIALS_FILE` (env file path) →
   `RESONANTOS_WORKSPACE_ADDON_CREDENTIALS` (env JSON) → `{}` (fail closed).
   Environment variables are process-level host configuration, not an
   encrypted vault; credential-file permissions/ownership are not enforced.
2. **True loopback only.** The admin-destination validator now accepts only
   `127.0.0.0/8`, `::1`, and `localhost`, and rejects `0.0.0.0` (bind-any) and
   all external hosts/IPs and non-http(s) schemes.
3. **Resolver trust semantics.** `resolveWorkspaceAddonCredential(addonId,
   purpose)` is an internal host-owned lookup, not an authentication boundary.
   It resolves material *by* add-on id and trusts the caller already holds that
   id. Add-on isolation depends on the trusted host call sites binding the
   authoritative add-on identity (resolver never exposed to iframe/add-on,
   routes capability-gated, addonId from host lifecycle registry/install state,
   manifest entrypoint from the host-owned discovery/install cache, caller
   material cannot override host provisioning). Production call sites were
   audited (see `SDK-DEMO-003-ARCHITECTURE-MAP.md` §10.3).

Non-blocking future hardening (recorded, not expanded in scope):

- **Live rotation / expiry (D2).** Credentials are read once at bridge startup
  and are restart-bound; per-grant minting, expiry, and rotate-on-revoke remain
  future work.
- **Host-mediated enforcement (D1).** The iframe still reaches its own loopback
  upstream directly; routing mutating requests through a bridge-owned proxy is
  still deferred.
- **Encrypted-at-rest store.** None exists; do not claim one until a real
  encrypted store ships.
- **Credential-file ownership/mode enforcement.** The loader does not currently
  validate the provisioning file's ownership or permissions (e.g. 0600);
  enforcing owner-only access is future hardening, not claimed here.

## SDK-DEMO-003R T7 — endpoint enforcement (closed)

T7 is the endpoint-enforcement finding that T4 convergence left open. T4
converged only the revoke/admin-revoke directions; the grant direction and the
upstream default were never anchored to the authoritative registry.

### Finding

The upstream mutating endpoints (`POST /api/echo/message`,
`POST /api/counter/{increment,decrement,reset}`, `POST /api/guide/ping`) were
enforced by an in-memory `hostGranted` flag that:

1. **Failed open on startup** — every upstream initialized `hostGranted = true`,
   so a fresh/restarted upstream re-opened the mutating endpoint. A stale bearer
   bypassed a revoked registry state simply by the upstream restarting.
2. **Converged in only one direction** — `POST /addons/workspace/grant` mutated
   the registry (`setGrants`) but never called the upstream `/admin/deny`, while
   revoke/admin-revoke did. Grant-after-revoke left the registry granted but the
   endpoint closed; a subsequent restart re-opened it regardless of registry
   state.

Consequence: the "upstream enforcement is its projection" invariant (T4) held
only for the deny direction, and the projection could diverge from the registry
in both directions and across restarts.

### Correction (narrower than D1)

- Upstreams initialize `hostGranted = false` (fail closed).
- `POST /addons/workspace/grant` now converges the upstream flag through the
  same host-owned admin channel as revoke. Allow-ordering: registry grant first
  (source of truth), then upstream open; an unreachable upstream fails the grant
  as 5xx and enforcement stays closed (never a reported success without
  convergence).
- Discovery rejects `0.0.0.0` (bind-any) as a `service.entrypoint`, aligning the
  entrypoint loopback guard with the T6.1 admin-destination guard.

D1 (host-mediated proxy) is NOT required for T7 and remains deferred: the iframe
still reaches its own loopback upstream directly, but the enforcement flag is
now a faithful, restart-safe projection of the registry in both directions.
D2/D3 remain deferred and are untouched.

## SDK-DEMO-003R T7.1 — graphical integration closure (closed)

Independent VIGIL Test Lab #49 ran the exact T7 candidate
(`f99667b4641a51861d65a4fad8e4bd7aa07e7e06`). The browser-first suite passed
(2259/2260, 0 failures) but the graphical extension suite failed 4/5 with the
T5 operator grant/revoke UI test recording `403 !== 200` on the post-grant
bearer call.

### Finding

Not a production grant-convergence defect. The T5 extension-live test asserted
the card state with a loose whole-card regex — `waitForText(/granted/i)` —
which matches the `Grant requested capabilities` button label (always present
while the card is DENIED). After clicking Grant, the wait returned while the
grant mutation was still in flight, so the direct bearer fetch raced the
bridge's upstream `/admin/deny` convergence. Under full-suite contention the
bearer fetch reached the still-fail-closed upstream first (403); in isolation
the convergence finished first (200). Reproduction: 9/12 full-suite runs failed
before the fix; 0/12 after.

### Correction (test-only)

The T5 test now waits on the exact card status label
(`.addon-card-header span`, case-insensitive) for `Discovered` / `Denied` /
`Granted`, so it synchronizes with the mutation's authoritative re-read before
issuing the bearer call. The T7 production contract is unchanged: registry is
source of truth; allow-ordering persists registry grant first, then upstream
open; an unreachable upstream still fails the grant 5xx with enforcement
closed.

## September 28 review — R1–R4 (SDK-DEMO-003R architecture hardening)

The September 28 Action Items report acknowledges all nine SDK-DEMO-003R
implementation items and green suites, but reports four defects against the
post-T7.1 candidate (`914ff57`). The referenced *detailed review with eight
further findings* is **not present in this repository** (searched all branches,
`--all` history, and review-artifact trees; only the T1–T7.1 records on
`origin/docs/sdk-demo-003r-rd-audit-record` and this file exist). That detailed
review is recorded as an **unresolved source dependency**; the eight findings
are not invented here and full review closure is not claimed.

### Review-integration register

| # | Finding | Code boundary | Test | Status | Owner / next increment | Acceptance evidence |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | Install trusted a caller-supplied manifest and derived the admin credential destination from it; the loopback **prefix** check (`hostname.startsWith("127.")`) accepted hostile hostnames | `addon-delegation-service.mjs` (`executeWorkspaceAddonInstall`, `applyWorkspaceAddonUpstreamEnforcement`), `workspace-addon-credentials.mjs` (`deriveUpstreamAdminUrl`/`validateAdminUrl`), `workspace-addon-discovery.mjs` (entrypoint guard) | `sd003r-review-r1-r2.test.mjs` | **CLOSED** in this increment (candidate on `feature/sdk-review-architecture-hardening-20260929`) | R1/R2 increment (this work order) | Mechanical pre-fix reproduction (hostile hosts accepted, forged install accepted); post-fix hostile/userinfo/non-loopback rejected, redirect refused with zero credential forwarded |
| R2 | admin-revoke body `{ addonId }` without an explicit boolean granted everything (`granted !== false`) | `addon-delegation-service.mjs` (`executeWorkspaceAddonAdminRevoke`) | `sd003r-review-r1-r2.test.mjs` | **CLOSED** in this increment | R1/R2 increment (this work order) | Pre-fix `{ addonId }` mutated registry to `network:true`; post-fix missing/non-boolean intent is `invalid-event` with no mutation, explicit `true`/`false` round-trips |
| R3 | Denial through grant commits the registry first; an unreachable upstream leaves a held bearer usable (registry says denied while the endpoint is still open) | `addon-delegation-service.mjs` (`executeWorkspaceAddonGrant` allow-ordering applied to a deny-shaped grant; `convergeWorkspaceAddonEnforcement` deny-ordering is correct but grant does not reuse it) | follow-up (not yet written) | **DEFERRED** — CP4 follow-up increment | Phase 2C+ / R3 failure-injection increment | See `R3 — failure-injection follow-up` below |
| R4 | Graphical `*-extension-live` tests run in no mandatory gate and silently skip without a browser; root documents fail `docs:check` | `package.json` (`test:sdk-demo:extension` separate from `test:browser-first`; `t.skip` when `!chromeAvailable()`); `scripts/validate-docs.mjs` (7 unreachable tracked docs) | `docs:check` + merge-gate lane (follow-up) | **DEFERRED** — CP4 follow-up increment | Phase 2C+ / R4 graphical+docs-gate increment | See `R4 — graphical/docs-gate follow-up` below |

### Capability floor (recorded; pending Tom's decision)

The September 28 review records a requirement that an adapter/add-on's
*operation* requirements cannot be understated by a manifest's *requested
consent*. This is **not implemented** here: the existing host capability
catalog (`ADDON_CAPABILITIES` in `packages/addon-sdk/src/contracts.ts`; 14
capabilities) and the harness policy (`harness-policy.mjs`) project authority
from host-owned grants, but no "capability floor" (operation → minimum
required grant) mechanism exists. This is marked **proposed / pending Tom's
decision**; no broad new policy is silently introduced in this increment.

### R3 — failure-injection follow-up (deferred)

Not fixed by architectural text. Exact work for the next bounded increment:

- **Boundary.** `browser-first/host/addon-delegation-service.mjs` →
  `executeWorkspaceAddonGrant` must converge a deny-shaped grant through the
  same fail-closed deny-ordering as `convergeWorkspaceAddonEnforcement` (close
  upstream first, then persist registry denial), or refuse a grant that would
  deny while leaving a live bearer effective.
- **Acceptance cases.** (a) grant-to-deny with the upstream down must leave the
  held bearer **denied** and never advertise the denial as converged; (b) after
  upstream recovery, a retry converges both layers; (c) concurrent grant/revoke
  and revision (CAS) semantics under timeout/disconnect/non-2xx/partial failure;
  (d) restart semantics: a denied registry state re-opens nothing on upstream
  restart. Retaining the grant until acknowledgment alone is **not sufficient**
  if denial can leave effective access active.
- **Dependencies.** none beyond the existing registry/upstream convergence
  machinery; the shared loopback validator added here is reused.

### R4 — graphical/docs-gate follow-up (deferred)

Not fixed by architectural text. Exact work for the next bounded increment:

- **Boundary.** `package.json` `test:sdk-demo:extension` (the five
  `examples/sdk-demo/tests/*-extension-live.test.mjs` files) must become a
  mandatory merge-gate lane, not a separate opt-in script; a missing
  display/browser must report **BLOCKED**, never PASS, and must not silently
  drop out of the gate.
- **Infrastructure.** Qualify the Xvfb / Test Lab pattern
  (`browser-first/test/live-sdk-lane.mjs` already pairs headed launch with
  xvfb) for the extension-live tests; record exact-SHA independent verification
  for the qualified environment.
- **docs:check.** Fix the seven `docs:check` failures without disabling checks:
  `docs/addons/sdk-category-discovery.md`, `examples/sdk-demo/README.md`,
  `examples/sdk-demo/{counter,echo,sdk-guide}/index.html`,
  `SDK-DEMO-003-ARCHITECTURE-MAP.md`, `SDK-DEMO-003-FINDINGS.md` are tracked but
  not reachable from a canonical entrypoint or an explicit runtime/GitHub
  consumer.
