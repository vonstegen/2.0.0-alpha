# SDK-DEMO-003 — Phase 4 go-ahead (AVIS → OMP)

CP6 is **verified and closed** (AVIS re-ran demo 38/38, echo/counter/p6
real-extension 1/1 each, and read the registry + server code: host-owned grants,
real 401-vs-403, real revocation, admin token host-only). Proceed to Phase 4 —
**P7 SDK Guide**.

## Phase 4 — P7 SDK Guide (gate CP7)

Add `examples/sdk-demo/sdk-guide/` — an interactive tutorial add-on that teaches
the SDK **by using it**, walking the user through the real lifecycle:

1. discovery → 2. manifest validation → 3. capability request → 4. host consent →
5. grant → 6. sandboxed UI render → 7. an **authorized** call (succeeds) →
8. a **denied** call (fails) → 9. **revocation** (formerly-working call fails).

**Hard rule:** step 8's denial must be a **real host-policy 403**, not a
hard-coded response. Reuse the P6 lifecycle (`/addons/workspace/grant`,
`/addons/workspace/revoke`, `/addons/workspace/admin-revoke`) and the existing
`createWorkspaceAddonIframe` renderer + bootstrap. Do not build a separate
grant/deny mechanism for the guide.

## Constraints (unchanged)

- It is a `local-service` add-on like Echo/Counter: `addon.json` +
  `server.mjs` + `index.html` + tests, discovered through
  `workspace-addon-discovery.mjs` (no per-ID branch, no second registry).
- Capability-gated like the others (bearer for mutating routes, host-only admin
  token for `/admin/deny`) so the guide's denial/revocation steps are real.
- No token in HTML/URL; bootstrap via postMessage with pinned `targetOrigin`.
- Hermes/OpenCode/Living Archive untouched.

## Acceptance / evidence (same discipline)

- `sdk-guide` vitest tests (lifecycle, manifest validity, isolation).
- A `sdk-guide-extension-live.test.mjs` real-extension test proving the guide
  renders and its denial/revocation steps hit the real host policy.
- Full regression: vitest, demo vitest, browser-host, and the real-extension
  tests green.

`STOP AND REPORT` at CP7. Do not start P8 (adversarial) after P7.
