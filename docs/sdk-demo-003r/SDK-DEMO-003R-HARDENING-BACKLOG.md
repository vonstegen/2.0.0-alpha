# SDK-DEMO-003R Future Hardening Backlog

These are recommendations and follow-up risks, not unresolved acceptance blockers unless explicitly marked.

## H1 — Per-capability operator consent
**Origin:** T5 audit. **Current:** UI grants all currently ungranted requested capabilities together. **Recommendation:** per-capability toggles if production SDK requires finer consent. **Priority:** Medium.

## H2 — Public vs trusted install contract
**Origin:** T5. **Current:** public UI uses intent-only `{addonId}`; trusted host callers may use canonical `{manifest}`. **Recommendation:** formalize this distinction in the public SDK contract. **Priority:** Medium.

## H3 — Partial-failure reconciliation
**Origin:** T4. **Current:** deny is fail-closed; registry persistence can still fail after upstream denial. **Recommendation:** operator-visible reconciliation/retry tooling. **Priority:** High.

## H4 — Bootstrap reinstall semantics
Bootstrap may reinstall cached manifest after registry removal but initializes grants denied. Keep this explicit and regression-tested. **Priority:** Medium.

## H5 — Error taxonomy stability
Preserve deterministic policy 4xx versus runtime 5xx behavior as an SDK contract. **Priority:** Medium.

## H6 — Test-state isolation
Require isolated user/registry roots for live certification lanes. **Priority:** High.

## H7 — VIGIL-MCP operator-session isolation
Infrastructure-only follow-up: investigate historical operator OMP PID disappearance observations. Not an SDK acceptance issue. **Priority:** Medium.

## H8 — Finding-to-test traceability
Maintain an explicit closed-finding → regression-test map. **Priority:** Medium.

## H9 — Host-mediated enforcement proxy
**Origin:** cumulative/T6 audit; existing D1. **Current:** iframe can reach its own loopback upstream directly. **Recommendation:** bridge-owned proxy as sole mutating path, validating registry authority before forwarding. **Priority:** High production hardening.

## H10 — Expiring/rotating credentials
**Origin:** T6/T6.1. **Current:** credentials are read at startup and rotation is restart-bound. **Recommendation:** per-grant minting, expiry, and rotate-on-revoke. **Priority:** High production hardening.

## H11 — Encrypted-at-rest credential storage
No encrypted vault exists and none is claimed. Introduce a real secret store before making encryption-at-rest claims. **Priority:** High production hardening.

## H12 — Credential-file ownership/mode enforcement
T6.1 accepts a credential-file reference but does not enforce ownership or mode such as 0600. Add portable owner/mode validation in deployment hardening. **Priority:** High.

## H13 — Registry reinstall semantics
`harness-registry.install()` can reset grants; guarded production callers avoid the immediate problem, but the primitive remains a footgun. Decide reject/no-op/reset semantics explicitly. **Priority:** Medium.

## H14 — R&D documentation reachability
Engineering docs reported informational docs-tree reachability warnings. Wire SDK-DEMO-003R records into the canonical documentation entrypoint when appropriate. **Priority:** Low/Medium.
