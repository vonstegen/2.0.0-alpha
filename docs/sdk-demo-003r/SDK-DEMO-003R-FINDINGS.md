# SDK-DEMO-003R Findings

## T1 — Privileged admin-revoke authority
Caller-controlled privileged endpoint/credential authority was removed. Caller supplies intent; host resolves trusted authority. **CLOSED / independently verified.**

## T2 — Status/discovery mutation
Discovery no longer installs. Explicit install remains the mutation boundary. **CLOSED / independently verified.**

## T3 — Required install-handler contract
Required `executeWorkspaceAddonInstall` contract retained and regression-locked. **CLOSED / independently verified.**

## Live admin-revoke integration defect
Real extension testing exposed stale request shapes and incorrect host-owned admin endpoints. Corrected; graphical Extension moved to 4/4. **CLOSED.**

## OpenCode environment mismatch
Certification environment was qualified to OpenCode 1.18.4 without weakening the SDK pin. **CLOSED as environment issue.**

## T4 — Revocation convergence
Registry revoke and upstream enforcement could diverge. Both now coordinate through one host-owned convergence operation with fail-closed partial-failure semantics. **CLOSED at `c57d4d0f...` (#39).**

## T5 — Operator grant/revoke UI
Explicit Install → Grant → Revoke controls now represent authoritative host state; browser owns no admin URL/token; real Chromium proof verifies bearer 200→403 after revoke. **CLOSED at `20726e39...` (#41).**

## T6 — Generic credential provisioning
Demo-specific token maps, literal admin endpoints, and per-demo flags were replaced with a generic host-owned resolver keyed by add-on identity + purpose. Bearer and admin credential classes remain distinct. No encrypted-vault claim; rotation is restart-bound. Engineering SHA `30197261...` was superseded before acceptance.

## T6.1 — Credential-boundary hardening
T6 audit found: raw credential JSON in argv, `0.0.0.0` accepted as an admin destination, and overstated resolver-level isolation wording.

Corrections:
- raw secret argv source removed;
- precedence = CLI file reference → env file reference → env JSON → fail closed;
- admin destinations = true loopback only (127/8, ::1, localhost);
- resolver explicitly documented as internal lookup, not authentication boundary;
- production resolver call sites audited with no identity-escalation path found.

**CLOSED at `b8735970315a8f5ab4a4656dfe6702d31ad47d13` (#45).**
