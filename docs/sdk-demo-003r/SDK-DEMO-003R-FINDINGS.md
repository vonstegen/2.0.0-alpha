# SDK-DEMO-003R Findings

## T1 — Privileged admin-revoke authority

**Finding:** caller-controlled request data could carry privileged upstream administrative URL/credential information.

**Resolution:** caller supplies identity/intent only; host resolves trusted authority from host-owned configuration. Caller injection is rejected.

**Status:** CLOSED and independently verified.

## T2 — Status/discovery mutated registry state

**Finding:** status/discovery could call installation logic and therefore mutate state.

**Resolution:** discovery caches canonical manifests and reports registry state without installing. Explicit install remains the mutation boundary.

**Status:** CLOSED and independently verified.

## T3 — Required workspace-install handler integration

**Finding:** making `executeWorkspaceAddonInstall` required exposed stale host-service constructions.

**Resolution:** required-handler contract retained and regression-locked; no production weakening.

**Status:** CLOSED and independently verified.

## Additional live admin-revoke defect

Real graphical extension testing exposed two HTTP 500 failures. Root causes were stale pre-T1 request shapes and incorrect host-owned admin endpoints.

**Resolution:** intent-only callers plus corrected host-owned endpoints. Graphical Extension moved from 2/4 to 4/4.

**Status:** CLOSED and independently verified.

## OpenCode environment mismatch

**Finding:** certification expected OpenCode 1.18.4 while VIGIL resolved 1.14.33.

**Resolution:** test environment upgraded/qualified to exact 1.18.4; SDK pin was not weakened.

**Status:** CLOSED as environment issue.

## T4 — Two independent revocation channels

**Finding:** registry revoke and upstream admin revoke could diverge in both directions.

**Resolution:** both routes now coordinate registry grant state and upstream enforcement through a common host-owned convergence helper. Deny is fail-closed; partial failure is never reported as converged success.

**Status:** CLOSED and independently verified at `c57d4d0f579f601de91fcf3b7d7faca343d68c7d`.

## T5 — Operator grant/revoke UI

**Finding:** operator-facing explicit install/grant/revoke lifecycle needed to be represented in the Add-ons workspace without inventing authority in the browser.

**Engineering result:** explicit Install → Grant → Revoke controls; authoritative host refresh; pending/error handling; no browser-owned admin URL/token; revoke uses T4 convergence; real Chromium flow added.

**Status:** engineering complete at `20726e395909e135782205d7fdad37d481aa5400`; independent acceptance must be recorded in the verification ledger when final.
