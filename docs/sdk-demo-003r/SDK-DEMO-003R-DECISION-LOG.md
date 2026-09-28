# SDK-DEMO-003R Decision Log

## D1 — Host owns privileged authority
Caller identifies intent/add-on; privileged endpoint and credential selection remain host-owned.

## D2 — Discovery is read-only
Discovery may cache canonical manifests but must not install or grant.

## D3 — Explicit installation is a lifecycle boundary
Discovered is not installed; installation grants nothing.

## D4 — Install handler remains a hard contract
`executeWorkspaceAddonInstall` is required; missing implementations fail fast.

## D5 — Independent verification closes work
Engineering reports do not close a task. Exact-SHA Test Lab verification plus audit does.

## D6 — Revocation converges authority and enforcement
Registry state is authoritative; upstream enforcement is its projection.

## D7 — Partial failure is fail-closed, not falsely atomic
No distributed-transaction claim. Partial failure returns failure and never masquerades as converged success.

## D8 — Operator UI represents host state
Manifest presets are not current authority; UI re-reads host state after mutation.

## D9 — Public install intent is identity-only
Public UI sends `{addonId}`; host resolves canonical manifest. Trusted host-side `{manifest}` is a distinct internal path.

## D10 — Generic provisioning preserves credential classes
Scoped bearer may cross its intended add-on boundary; admin credential remains host-only.

## D11 — Resolver is lookup, not authentication
`resolveWorkspaceAddonCredential(addonId, purpose)` trusts its internal host caller. Security depends on trusted call sites binding authoritative add-on identity.

## D12 — No raw secrets in argv
No raw credential JSON CLI source. Provisioning precedence: CLI file reference → env file reference → env JSON → fail closed.

## D13 — Credential-bearing admin destinations are true-loopback only
Accept 127/8, ::1, localhost. Reject `0.0.0.0`, external destinations, and non-http(s).

## D14 — Credential lifecycle claims remain conservative
Current backing is plaintext host environment/config loaded at startup. No encrypted vault and no live rotation/expiry are claimed.
