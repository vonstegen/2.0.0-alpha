# T5 — Operator Grant / Revoke UI

## Finding
The Add-ons workspace needed an explicit operator lifecycle that represented host authority without recreating privileged authority in browser code.

## Engineering decision
Workspace cards represent:
- Discovered
- Installed but denied
- Granted
- mutation pending/error

The operator lifecycle is explicit:
`Discover → Install → Denied → Grant → Granted → Revoke → Denied`.

The UI submits intent-only install by `addonId`, builds grant requests from requested grant shape, derives current authority from host-reported registry state, and uses the T4 converged revoke route. It never constructs or sends privileged admin URL/token fields.

After mutation, authoritative state is re-read. Failed mutations do not render false success; pending mutation suppresses duplicate actions.

## Real graphical proof
The new extension-live test drives the real unpacked extension through Install → Grant → Revoke and verifies the same bearer changes from accepted (200) to denied (403) after UI revoke.

## Engineering candidate
`20726e395909e135782205d7fdad37d481aa5400`.

## Status
ENGINEERING COMPLETE. Independent Test Lab #41 must be final before marking CLOSED.
