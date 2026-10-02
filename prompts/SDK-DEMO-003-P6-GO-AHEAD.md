# SDK-DEMO-003 — Phase 3 go-ahead (AVIS → OMP)

CP4 is **verified and closed** (AVIS re-ran the Counter real-extension test 1/1
twice, demo 22/22; the stale-config fix resolved the false-green). Proceed to
Phase 3 — **P6 Capabilities**, the security-critical milestone.

## Phase 3 — P6 Capabilities (gate CP6)

Replace the `grantPresets`-derived placeholder with the **host-owned grant
model**, and prove the full lifecycle against the actual host:

1. **Host-owned grants, not author-declared presets.** Wire the host-owned
   registry into the workspace add-on path: `registry.install(manifest,
   { enabled })` on discovery, then `registry.setGrants(addonId, grants,
   { consent: true })` so the bootstrap `capabilityTokens` reflect what the
   HOST granted — never the manifest's `grantPresets`. Remove the
   grantPresets-derived fallback in `main-workspace.js` (the `P6 GATE` comment
   marks the exact spot).
   - If `harness-registry` is harness-adapter-specific and doesn't fit a
     `local-service` add-on cleanly, say so explicitly and use/extend the
     closest existing host-owned mechanism — do NOT invent a second registry
     and do NOT fall back to reading the manifest's own grants.

2. **Full lifecycle proof** (each step against the real host, not a mock):
   - **Request** — `requestedCapabilities` authored `granted: false`.
   - **Consent** — grant requires `consent: true`; no consent → no grant.
   - **Grant** — an approved grant is delivered to the add-on bootstrap.
   - **Enforcement** — a granted capability works; a **denied** capability
     fails closed with **403** (real host policy, not a hard-coded 403).
   - **Revocation** — revoke the grant, and the formerly-working operation
     now fails.

3. **Per-add-on, audience-bound credentials.** Echo's grant must not authorize
   Counter and vice versa (the P4 isolation proof must still hold under the
   host-owned model). No shared token.

4. **Real-extension evidence.** The 403/denial and revoke-then-fail must be
   exercised against the real unpacked extension + real bridge + real upstream,
   not only in unit tests.

## Hard rules (unchanged)

- No self-granted capabilities. No second registry/manifest/capability system.
  No manifest-controlled command execution. No `process.env` spread. No token
  in HTML/URL (postMessage with pinned `targetOrigin` only). Hermes/OpenCode/
  Living Archive behavior unchanged.

## Standing reminders

1. Real-extension tests are on `test:sdk-demo:extension` / `node --test` (not
   the default `test:browser-first` run) — invoke explicitly, keep green.
2. Keep Echo/Counter upstreams tolerant of an empty envelope so an un-granted
   add-on degrades cleanly instead of bypassing authorization.

`STOP AND REPORT` at CP6 with the same evidence discipline. Do not start P7
(SDK Guide) after P6 — stop.
