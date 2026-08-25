# ADR-042: Add-on Trust-Tier Transitions

## Decision Metadata

- Decision status: Accepted
- Alpha applicability: Applies
- Superseded by: None
- Owner: Add-on SDK
- Decision date: 2026-08-25
- Alpha note: Trust tiers are labels on every installed add-on; the
  host enforces a transition matrix by combining `addOnProvenance.tier`
  and the manifest's `publisher`. The Alpha contract's
  `AddOnProvenanceTier` is four-valued (no separate `verified`
  tier), so the host maps them onto four host-enforced tiers:
  Personal (sideloaded-unverified + local), Verified
  (curated-signed), Approved (enterprise-signed + enterprise.*
  publisher), and System (bundled-core). A future "Developer" tier
  arrives when `AddOnProvenanceTier` is extended.
- Cross-reference: §23.9 of
  `docs/architecture/RESONANT_VSCODE_VSCODIUM_EXTENSION_REFERENCE_MODEL.md`;
  ADR-018 §6 (provenance); ADR-038 (`publisher` as the unit of trust);
  ADR-039 (publisher change triggers a new-permission diff).

## Decision

Every installed add-on carries a **trust tier**, derived from the
combination of `addOnProvenance.tier` and the manifest's `publisher`:

```
Trust Tier = match (manifest.provenance.tier, manifest.publisher):
                bundled-core                              => System
                enterprise-signed && startsWith("enterprise.") => Approved
                curated-signed | enterprise-signed (other) => Verified
                sideloaded-unverified                     => Personal
                (default)                                 => Personal
```

The four tiers form a strictly monotonic ordering:

```
Personal < Verified < Approved < System
```

When a user installs or updates an add-on, the host computes its
new tier and consults the **transition matrix** before applying the
new manifest:


The **transition matrix**:

| From → To   | Personal | Verified | Approved | System |
| ----------- | -------- | -------- | -------- | ------ |
| **Personal**| ok       | host-claim | deny   | deny   |
| **Verified**| host-claim | ok     | host-claim | deny |
| **Approved**| deny     | deny     | ok       | host-claim |
| **System**  | deny     | deny     | host-claim | ok   |

- `ok` — same tier; the existing grants carry over.
- `host-claim` — the user (or a host-side developer registry) actively
  declares the move; the host records a `TrustLevelChange` row in the
  audit ledger and runs ADR-039's permission diff before persisting
  the new manifest.
- `deny` — the host refuses to perform the transition automatically;
  the install lands as `Pending` and requires explicit host-side
  intervention (rare; primarily for personal → system).

The transition matrix is exported as a pure
`canTransitionBetweenTiers(from, to)` from
`packages/addon-sdk-testing/src/trust-tier.ts`. The host installer
calls it before flipping the registry row.

## Tiers and their meaning

1. **Personal** — the user authored the add-on or sideloaded it from
   an untrusted source. Publisher is `local`. Provenance is
   `sideloaded-unverified`. Grants are granted in the user's name and
   held under heightened scrutiny (the provider-fabric rules already
   require per-call audit).
2. **Verified** — a curated registry has signed the bundle.
   Publisher is one of a stable registry set (e.g. `directory.tld`)
   or a non-enterprise publisher whose bundle is `curated-signed`.
   Provenance is `curated-signed` (or `enterprise-signed` from a
   non-enterprise publisher). Grants unlock cross-addon hand-off
   through `agent-delegation`.
3. **Approved** — a domain-resonant registry has reviewed the bundle
   for safety. Publisher is an enterprise-reserved name (e.g.
   `enterprise.acme-corp`). Provenance is `enterprise-signed`. The
   `shell` capability becomes available on this tier and above.
4. **System** — the add-on ships inside the host binary and is
   treated as part of the host. Publisher is whatever the host
   presents (today `bundled-core`; never user-editable). Provenance
   is `bundled-core`. All capabilities are available.

## What is and isn't permitted

- Tier **promotion** is what the matrix gates. A Personal add-on
  cannot silently acquire Verified scope; a Verified add-on cannot
  silently elevate to Approved (would defeat the curated registry's
  review).
- Tier **demotion** within the matrix is always `deny` — the matrix
  above allows the down direction only as a one-step
  `host-claim` (e.g. a user marking a Verified add-on back to
  Personal during a registry outage). Anything more aggressive is
  `deny`.
- Cross-publisher updates (e.g. `local → directory.tld` with same
  `id`) ARE a tier transition under this ADR. ADR-039's
  `identity-publisher-changed` rule is what triggers the diff; this
  ADR is the rule that decides what tier the new manifest lands in.
- A failed tier transition does not delete the installed manifest;
  the registry row carries the prior manifest in a "quarantined"
  state and the host surfaces an actionable error.

## What `canTransitionBetweenTiers` returns

```ts
type TrustTransitionDecision =
  | { kind: "same-tier" }
  | { kind: "host-claim"; reason: string }
  | { kind: "deny"; reason: string };

function canTransitionBetweenTiers(
  from: TrustTier,
  to: TrustTier,
): TrustTransitionDecision;
```

The function is pure and exports the full matrix above. The host
installer uses its verdict to decide whether to persist the new
manifest (`same-tier` / `host-claim`) or hold it back (`deny`).

## Wire and registry changes

1. **`packages/addon-sdk-testing/src/trust-tier.ts`** (new): pure
   module exporting `TrustTier`,
   `getTrustTierFromManifest(manifest)`, and
   `canTransitionBetweenTiers(from, to)`. Imports only contracts
   and ADR-018's `provenance` shape.

2. **`packages/addon-sdk-testing/src/index.ts`**: re-export the
   public surface (TrustTier union, both functions).

3. **`browser-first/host/addon-installer.mjs`**: before persisting a
   new manifest, fetch the registry row; compute old and new tier;
   call `canTransitionBetweenTiers`; if `deny`, refuse the install
   with an actionable error and keep the prior manifest as
   "quarantined".

4. **`browser-first/host/bridge-audit-ledger.mjs`**: every
   `TrustLevelChange` row records `{from, to, at, callerId,
   deltaKind: "same-tier" | "host-claim" | "deny"}`. The
   `deltaKind` is informational even on `same-tier` so a future
   audit can replay transitions.

5. **`run-bridge-minimal.mjs`**: doesn't change; trust transitions
   are enforced inside the installer. The minimal launcher still
   contributes a "boot from tier=Personal" preset so freshly
   installed add-ons start at Personal regardless of the launcher
   itself.

## Cross-cutting

- **ADR-038** requires `publisher`; without it, this ADR's
  classification of local vs registry add-ons isn't possible.
- **ADR-039** is the gate on transition: when a tier transition
  crosses a manifest delta (e.g. tier elevated + capability added),
  the install lands as `Pending` until both gates clear.
- **ADR-041** is the runtime enforcement: a tier elevation that
  crosses an isolation boundary (e.g. Personal → System, where the
  new tier can use `shell` or `filesystem` system-wide) requires a
  worker-thread rebind in addition to the matrix verdict.

## Open work (delegated to follow-up ADRs)

- **Registry service** (ADR-023 follow-up): `publisher` attestation
  for Verified and above tiers. Today the launcher trusts the
  `provenance` field on the manifest; a registry would sign the
  publisher-identity and the launcher would verify.
- **Bundle signing format** (ADR for `.rxp`, §23.12): the package
  format ADR specifies how `provenance.signed` is checked.
- **Personal → System**: this transition is `deny` per the matrix,
  but a future ADR may permit it for migration tooling.
- **Add a fifth tier (Developer)**: if a future contract revision
  extends `AddOnProvenanceTier` with a `verified-by-author` value,
  the matrix grows by one row and one column. The ADR is structured
  to absorb that change without invalidating tests.

## Rules

- The transition function MUST be pure. No I/O, no Date.now().
- The transition function MUST return the same verdict across runs.
- The transition function MUST NOT require the host at runtime.
- The host MUST refuse to apply a `deny`-verdict transition.
- The host MUST log every transition verdict in the audit ledger
  regardless of outcome.
- Tier **System** add-ons MUST NOT be user-editable (the registry
  rejects writes that name a System publisher as user-controllable).
- Tier **Personal** add-ons MUST carry `publisher: "local"`.

## Validation

- `canTransitionBetweenTiers` returns the same matrix above across
  every (from, to) pair; tested with an exhaustive 4×4 table.
- `getTrustTierFromManifest` is tested with curated pairs:
  - `publisher:"local"` + `sideloaded-unverified` → Personal
  - `publisher:"directory.tld"` + `curated-signed` → Verified
  - `publisher:"enterprise.acme-corp"` + `enterprise-signed` → Approved
  - `tier:"bundled-core"` → System (any publisher)
- Unknown combinations resolve to Personal (sideloaded-unverified
  is the conservative default).
- vitest: every prior test stays green. A new
  `packages/addon-sdk-testing/test/trust-tier.test.ts` exercises
  the matrix.

Out of scope (delegated to ADR-038 / 039 / 041):
- `publisher` registry attestation.
- New-permission review on tier-changing updates.
- Runtime isolation rebind.
