# T5 — Operator Grant / Revoke UI

## Finding
The Add-ons workspace needed an explicit operator lifecycle representing host authority without recreating privileged authority in browser code.

## Decision
Cards represent Discovered, installed/Denied, Granted, and pending/error states. Lifecycle:

`Discover → Install → Denied → Grant → Granted → Revoke → Denied`.

The UI sends intent-only install by `addonId`, derives current authority from host-reported registry state, and uses the T4 converged revoke route. It never constructs/sends privileged admin URL/token fields. Failed mutations do not render false success; pending mutation suppresses duplicates.

## Real graphical proof
The real unpacked extension drives Install → Grant → Revoke and verifies the same bearer changes from HTTP 200 to HTTP 403 after revoke.

## Acceptance
Candidate `20726e395909e135782205d7fdad37d481aa5400` independently verified by VIGIL Test Lab #41:
- Browser-first 2234/2235, exit 0
- Extension 5/5
- source mutation none
- artifact verification PASS

## Status
CLOSED / independently verified.
