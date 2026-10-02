# SDK-DEMO-003 — Phase 5 go-ahead (AVIS → OMP)

CP7 is **verified and closed** (AVIS re-ran demo 58/58 and sdk-guide live 1/1,
and read the guide server: the 9 steps hit real 200/401/403 outcomes). Proceed
to Phase 5 — **P8 Adversarial gate**.

## Phase 5 — P8 Adversarial (gate CP8)

Red-team the trust boundaries. For each attack below, prove it **fails safely**
while legitimate SDK operations continue to work. Record each attack, the
attempt, the expected safe failure, and the actual result.

### Attack checklist (all against the real host + real extension where possible)

1. **Read bridge/provider secrets from add-on context** — the iframe/upstream
   must not be able to read the bridge token, capability bootstrap token, admin
   token, or any provider credential.
2. **Cross-add-on credential reuse** — Echo's bearer cannot drive Counter/Guide,
   and vice versa (already proven 3-way; re-confirm under attack framing).
3. **Use-after-revocation** — after `/addons/workspace/revoke` + `/admin/deny`,
   the previously-valid bearer returns 403; a stale bearer never works again
   until re-granted + admin-restored.
4. **Unauthorized capability acquisition** — the add-on cannot self-grant; a
   grant outside `requestedCapabilities` is rejected; a grant without
   `consent: true` is rejected.
5. **Forged postMessage origin/source** — the add-on rejects a bootstrap message
   whose `event.source` is not `window.parent`, and a wrong `type`; a forged
   `resonantos-addon-ready` from a non-iframe source is ignored by the parent.
6. **Arbitrary runtime/executable declaration** — a manifest with `runtime.command`
   or a non-loopback `service.entrypoint` is rejected (discovery enforces
   loopback-only); no spawn path exists.
7. **Unauthorized mirror/proxy route** — no manifest-declared open bridge prefix;
   the route-capability audit still enumerates every handler group honestly,
   now with the workspace-addon routes included.
8. **Missing/malformed credentials** — no bearer → 503/401; malformed bearer →
   401; malformed admin token → 401 (constant-time, no timing oracle).
9. **Add-on crash / unavailability + bridge restart** — killing an upstream makes
   its Open button disable (probe fails); the bridge restart re-discovers and
   **does not wipe grants** (regression guard from R5).
10. **Port collision** — a second process on an add-on's loopback port is handled
    without the host rewriting the manifest entrypoint.
11. **Hermes/dashboard with all three demo add-ons active** — Hermes, OpenCode,
    and Living Archive still work; the demo add-ons do not replace or disable
    the Hermes proxy.
12. **Honest route-capability audit** — `bridge-route-capability-audit.test.mjs`
    still passes with the workspace-addon routes enumerated.

### Hard rules (unchanged)

- No weakening a test or control to make an attack "pass."
- No mock bridge that skips auth/CORS/origin checks for a security assertion.
- Real-extension evidence for the interactive attacks; unit/in-process evidence
  is acceptable only where a real boundary cannot be exercised.
- No token in HTML/URL; no env spread; no second registry; Hermes untouched.

### Acceptance (CP8)

Every attack fails safely; a clean checkout still runs Echo + Counter + SDK Guide
with real grant/deny/revoke; full regression green (vitest, demo vitest,
browser-host, the four real-extension tests, and the new adversarial tests).

`STOP AND REPORT` at CP8. Do not start P9 (live demo) after P8.
