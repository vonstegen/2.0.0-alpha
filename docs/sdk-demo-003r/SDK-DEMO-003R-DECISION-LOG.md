# SDK-DEMO-003R Decision Log

## D1 — Host owns privileged authority
Caller requests identify intent and add-on identity. Privileged endpoint and credential selection remain host-owned.

## D2 — Discovery is read-only
Manifest discovery may cache canonical definitions but must not install or grant.

## D3 — Explicit installation is a lifecycle boundary
A discovered add-on is not installed. Installation itself grants nothing.

## D4 — Required install handler remains a hard host contract
`executeWorkspaceAddonInstall` is required; missing implementations fail fast.

## D5 — Independent verification is authoritative for acceptance
Engineering-agent reports are useful evidence but do not close a task. Exact-SHA VIGIL Test Lab verification plus audit closes it.

## D6 — Revocation converges authority and enforcement
Registry grant state is authoritative; upstream host enforcement is its projection. Both revoke routes coordinate both layers.

## D7 — Partial failure is fail-closed, not falsely atomic
Cross-system transactionality is not claimed. Deny closes upstream first; allow persists authority before opening enforcement. A partial failure returns failure and is not represented as converged success.

## D8 — Operator UI represents host state
The browser UI does not treat manifest presets as current authority. It renders host-reported installed/granted/denied state and re-reads after mutation.

## D9 — Public install intent is identity-only
The operator UI submits `{addonId}`; the host resolves the canonical discovered manifest. Trusted host-side `{manifest}` use remains a distinct internal path.
