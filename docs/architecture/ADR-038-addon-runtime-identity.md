# ADR-038: Add-on Runtime Identity

## Decision Metadata

- Decision status: Accepted
- Alpha applicability: Applies
- Superseded by: ADR-054 (runtime identity extended to principal chain)
- Owner: Add-on SDK
- Decision date: 2026-08-25
- Alpha note: Adopted with a relaxed publisher constraint; the
  enforcement surfaces in the bridge dispatcher and the audit ledger
  land first; a future registry service can tighten publisher
  validation without breaking this contract.
- Cross-reference: ADR-018 §3, §4, §5; §23.3 of
  `docs/architecture/RESONANT_VSCODE_VSCODIUM_EXTENSION_REFERENCE_MODEL.md`.

## Decision

Every installed add-on in ResonantOS carries a **runtime identity**
that uniquely names the add-on across three orthogonal dimensions:

```
addon.<id>@<publisher>:<version>
```

- `id` is the add-on's manifest `id` field (already required by
  ADR-018).
- `publisher` is a new manifest field that names the entity which
  built the manifest. For locally-developed or sideloaded add-ons
  the publisher is the literal string `local`.
- `version` is the manifest `version` field (already required by
  ADR-018).

The triple is the **caller attribution key** at every privileged
bridge call. Today's `__extension__` / `dev-roundtrip` / `__anonymous__`
fallbacks are transitional. Once this ADR lands, the bridge grants
store mints per-identity tokens, and audit rows record
`callerId` as the full triple.

The triple is also the **idempotency key** for install, uninstall,
and update. The package manager (a follow-up ADR) treats two
manifests with the same `id@publisher` as the same install slot.

## Why

Three independent problems all need a stable identity for the same
artifact:

1. **Caller-attributed bridge authorization.** Privileged requests
   are attributable to the *extension identity* making the call, not
   to a launcher-shared caller id. Today's per-caller grant store
   mints tokens by short string (`hermes`, `dev-roundtrip`). The
   `addon.<id>@<publisher>` triple lets the store mint tokens whose
   payload binds the full identity, which means a future registry
   service can revoke a single addon's grant without touching other
   addons from the same publisher.

2. **Update safety.** A new-permission review (§23.10 of the
   reference doc; ADR-039 in this queue) compares the *same* identity
   across versions to detect capability creep. If the new manifest's
   `id@publisher` differs from the installed one, the user is
   installing a new add-on, not updating.

3. **Trust-level transitions.** Personal → Developer → Verified →
   Approved → System (ADR-040) all key off the publisher. The
   transition "this add-on moved from Personal to Verified" is a
   change to `publisher` (or a publisher-attribute sidecar), not to
   `id`.

Today's ad-hoc `addon.<id>` identifiers (ADR-018) are sufficient for
discovery and dispatch but not for any of these. A triple is the
smallest expansion that addresses all three.

## What the manifest looks like

The current `addon.deepseek-harness.json` becomes:

```json
{
  "id": "addon.deepseek-harness",
  "name": "DeepSeek Harness",
  "publisher": "local",
  "version": "0.1.0",
  ...
}
```

`publisher` is required and validated as:

- non-empty string;
- matches `^[a-z0-9][a-z0-9._-]{0,62}$` (DNS-label-like, no
  uppercase, no leading dot, max 63 chars);
- `local` is the only reserved value with special meaning (sideload
  / locally-developed); a future registry service may reserve
  others.

`id` is unchanged: `^addon\.[a-z][a-z0-9-]{1,62}$`.

The full identity triple is built at runtime as
`${id}@${publisher}:${version}`. The colon separates the version
because `publisher` and `id` are DNS-label-valid (no colons), so
`id@publisher:version` is unambiguously parseable.

## Wire and bridge changes

1. **`src/sdk/addons/validation.ts`**: require `publisher` in
   `validateAddOnManifest`. New error code: `publisher-missing` or
   `publisher-invalid-format`.

2. **`src/sdk/addons/contracts.ts`**: add `AddOnPublisher` to the
   manifest type. `publisher: string` (required, validated).

3. **`browser-first/host/bridge-grants-store.mjs`**: the `mintGrant`
   API already takes a `callerId` string. No change to the API;
   callers pass the full triple.

4. **`browser-first/host/bridge-audit-ledger.mjs`**: every row's
   `callerId` is the full triple. Today the ledger doesn't enforce
   this; this ADR's status is "Adopted" so the enforcement lands in
   the follow-up commit.

5. **`browser-first/host/addon-delegation-host-service.mjs`**
   (`/external-agent-runtime/delegate` handler): the
   `bridgeContext.callerId` resolved at request time becomes
   `<addon.id>@<publisher>:<version>` instead of
   `dev-roundtrip` / `__extension__`. The launcher's
   `minimalLauncherCallerGrants` mints grants for each
   *identity triple* it wants to allow.

6. **Minimal launcher change** (`run-bridge-minimal.mjs`):
   instead of `dev-roundtrip` the launcher mints grants for the
   identity triples of the addons it has installed in
   `examples/addons/`. The current dev caller id is preserved as a
   fallback for non-addon bridge calls (e.g. `/status`,
   `/memory/search`) which aren't addon-attributed.

## Cross-cutting

* **ADR-039** (new-permission review on update) keys off
  `id@publisher` as the update identity. Without this ADR,
  ADR-039 has nothing stable to compare.
* **ADR-040** (trust transitions) keys off `publisher`. Without
  this ADR, the trust field has nothing to attach to.
* **ADR-041** (isolation boundary) uses the full triple as the
  worker thread / process key. Two addons from the same publisher
  with different ids run in separate workers; two addons with
  the same `id@publisher` from different versions run in separate
  workers.

## Open work (delegated to follow-up ADRs)

* **Registry service**: a future ADR specifies how `publisher`
  attestation works. Today the launcher trusts whatever
  `publisher` is in the manifest. A registry would sign the
  publisher-identity and the launcher would verify.
* **Bridge grants for non-addon callers**: the current
  `dev-roundtrip` / `__anonymous__` callers still exist for
  routes that aren't addon-attributed (`/status`, `/memory/search`,
  etc.). Those stay as-is; this ADR is additive, not a breaking
  refactor.
* **Capability tokens for addon identity**: today the grants store
  mints HMAC tokens whose payload carries `callerId` and
  `capability`. A follow-up should extend the payload to carry
  the full identity triple, so revocation can target a specific
  add-on (not just a publisher).

## Rules

- `id` MUST be unique per publisher. Two add-ons from different
  publishers MAY share an `id`; the launcher scopes grants and
  audit rows by the full triple.
- `publisher` MUST NOT be empty.
- `version` follows semver in this ADR. The package format ADR
  (later) will pin this further.
- An add-on's `id@publisher` is its stable identity across
  versions. Renaming the add-on's `id` field is treated as an
  uninstall of the old id and an install of the new id.

## Validation

* `validateAddOnManifest` rejects manifests that lack
  `publisher`, or that have a `publisher` not matching the
  regex.
* `browser-first/test/addon-status-manifest-discovery.test.mjs`
  updated to include `publisher: "local"` in the base fixture
  used by every test case.
* `packages/addon-sdk-testing/test/cross-addon-manifests.test.ts`
  unchanged — its existing fixtures already include a `publisher`
  field for `addon.deepseek-harness` and `addon.recursive-mas`.
* vitest: 493/493 still passing.
* docs:check: clean.

Out of scope (delegated to ADR-039 / 040 / 041):
* New-permission diff on update.
* Trust-level transitions.
* Process / worker isolation.
* Registry service and publisher attestation.
