# SDK-DEMO-003 — P6 revocation-mechanism decision (AVIS → OMP)

This settles the open question from your P6 plan. Proceed with P6 using the
decisions below.

## 1. Revocation mechanism: (B) — host-administered, in-memory, with a separate admin token

Use (B): the add-on upstream exposes a host-only admin path on its loopback
origin that flips an in-memory deny flag; the host calls it to revoke
(instant). **Critical correction** — the add-on's sandboxed iframe is
same-origin with the add-on's own upstream, so a bare `/admin/deny` route would
be reachable by the add-on's *own UI*. Therefore:

- Gate the admin path with a **separate host-admin token**
  (e.g. `--counter-admin-token=<value>`), operator-pinned on the server.
- Hand that admin token to the **host only** (bridge config/launcher) — **never
  deliver it to the add-on iframe**.
- The **capability token** (host-minted, delivered via bootstrap, sent as
  `Authorization: Bearer`) and the **admin token** (operator-pinned, host-only,
  gates `/admin/deny`) must be **distinct values and distinct channels**.

The admin path is the host's revocation signal, not part of the add-on's
capability surface.

## 2. Symmetry: apply to BOTH Echo and Counter

The roadmap requires demonstrating denial/revocation for **Echo's `network`
grant**, not just Counter. Echo is currently bearer-agnostic (no auth on
`/api/echo/message`); P6 must make Echo capability-gated the same way (bearer
for mutating routes + host-admin deny path). Otherwise the deny/revoke proof
exists only for Counter and CP6 is not closed.

## 3. Document the demo-vs-production gap (do not over-claim)

(B) keeps the enforcement point at the add-on's *own server* (bearer) with the
host flipping a deny flag out-of-band. That is fine for the demo but is **not**
the clean host-aligned production model (host mediates the mutating request and
enforces at the endpoint guard). Record this as a known limitation in the R&D
notes / architecture map — same honesty bar as the CP3/CP4 self-grant
disclosure — so it is not mistaken for the final architecture.

## 4. Update the capability-review note

Update `addon-capability-review.js`'s `CAPABILITY_CONTRACT_NOTE`: after P6,
workspace add-on `grantedCapabilities` come from the host registry snapshot,
not `grantPresets`. The "per-route tokens" wording is misleading for workspace
add-ons — rewrite it.

## 5. Acceptance (unchanged, re-stated)

- 403 denial is a **real host-policy** result (not a hard-coded 403).
- Revocation **actually breaks** the formerly-working operation (real
  extension + real bridge + real upstream, not a mock).
- Echo's grant cannot authorize Counter and vice versa (per-add-on, audience-bound).

`STOP AND REPORT` at CP6. Do not start P7.
