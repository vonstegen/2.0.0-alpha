# ADR-039: New-Permission Review on Update

## Decision Metadata

- Decision status: Accepted
- Alpha applicability: Applies
- Superseded by: None
- Owner: Add-on SDK
- Decision date: 2026-08-25
- Alpha note: Adopts capability-diff as the host-side guard for addon
  updates; the manifest delta is computed between the previously
  installed manifest (registry sidecar) and the new manifest. Personal
  add-ons (publisher="local") diff against their own prior version;
  trust-tier transitions (ADR-040) re-evaluate from scratch.
- Cross-reference: ADR-018 §4, §5; ADR-038; §23.10 of
  `docs/architecture/RESONANT_VSCODE_VSCODIUM_EXTENSION_REFERENCE_MODEL.md`.

## Decision

Every add-on update MUST pass through a **new-permission review** at
install / update time. The host compares the candidate manifest against
the previously installed manifest (matched by `id@publisher`) and
classifies each field-level delta into one of three buckets:

1. **No change** — identical; proceed.
2. **Soft change** — fields that affect metadata only (name,
   description, label, surface cosmetic edits). Auto-accepted; no
   user prompt; logged in the audit ledger.
3. **Hard change** — fields that affect identity, capabilities,
   isolation, trust, or executable behavior. The update is held in a
   *Pending* state and the user sees a review prompt that lists the
   changed fields before any new permission takes effect.

The diff is computed by a pure function
`diffAddOnManifest(prior, next)` exposed from
`packages/addon-sdk-testing/src/permission-diff.ts`. It returns a
`AddOnPermissionDelta` object that the registry store records next to
the installed manifest.

## Hard-change set

A field change is "hard" when any of the following are true:

- A new capability appears in `requestedCapabilities` that was not
  in the prior manifest (the candidate superset) — even if a prior
  capability was dropped.
- A capability's `scope` widens (`self` → `shared` → `system`;
  `intake-only` → `system`).
- A capability's `revocationBehavior` weakens
  (`hard-stop` → `degrade`).
- `runtimeType` changes.
- `runtimeIsolation.boundary` widens (e.g. `host-mediated-service` →
  `cooperative-thread`).
- `publisher` changes (the field that marks trust; this overlaps
  with ADR-040 but is enforced here for safety).
- `version` changes to a non-incrementing semver release (e.g. a
  downgrade or a major version bump that also requests new
  capabilities).

Any other delta (description, label, surface listing, tools,
grantPresets that re-use existing capabilities, etc.) is "soft" and
auto-accepted.

## Why

Capability creep on update is a well-studied abuse pattern: a benign
add-on ships a small update that adds `filesystem` or `shell` access,
and a user who already trusts v0.1 auto-approves the update. The
host's job is to surface the new capability at the moment of update,
with the same review prompt as a fresh install.

Three cross-references matter:

- **ADR-018 §4** says the manifest is a declaration of requested
  capabilities. We honor that by diffing *declared* capabilities,
  not granted ones — a user who hasn't granted `filesystem` yet
  shouldn't be silently upgraded into a position where they can.
- **ADR-038** provides the stable update identity
  (`id@publisher`); without it, a diff has no anchor.
- **§23.10 of the reference doc** calls this out explicitly: "When
  the manifest changes between versions, the host MUST surface a
  new-permission prompt that lists what changed before any
  privilege expansion takes effect."

## What diffs look like

```ts
import {
  diffAddOnManifest,
} from "@resonantos/addon-sdk-testing/permission-diff";

const prior = await registry.get("addon.deepseek-harness@local");
const next  = parseManifestFromBundle("addon.deepseek-harness-v0.2.0.json");

const delta = diffAddOnManifest(prior, next);
// {
//   hardChanges: [
//     {
//       path: "requestedCapabilities",
//       kind: "capability-added",
//       detail: {
//         capability: "filesystem",
//         scope: "system",
//         revocationBehavior: "hard-stop",
//       },
//     },
//   ],
//   softChanges: [
//     { path: "description", kind: "string-changed" },
//   ],
//   identityChanged: false,
// }
```

The host installer refuses to apply the update if `hardChanges`
is non-empty and the user has not approved the prompt. The prompt
lists:

- `requestedCapabilities`: each capability that was added, with
  its proposed scope and revocation behavior; each capability whose
  scope widened; each capability whose revocation behavior
  weakened.
- `runtimeType`: prior vs next.
- `runtimeIsolation.boundary`: prior vs next.
- `publisher`: prior vs next (with a "Trust tier changed" callout,
  delegated to ADR-040 for the tier labels).
- `version`: a downgrade or major bump gets a "Major version /
  downgrade" callout regardless of capability diffs.

## Wire and registry changes

1. **`packages/addon-sdk-testing/src/permission-diff.ts`** (new):
   pure `diffAddOnManifest(prior, next)` returning
   `AddOnPermissionDelta`. Imports only `AddOnManifest` from the
   shared contracts — no host dependencies.

2. **`packages/addon-sdk-testing/src/registry-store.ts`** (new):
   a tiny in-memory map keyed by `id@publisher` that records the
   installed manifest + the most recent delta. The launcher's
   installer consults the registry and calls `diffAddOnManifest`
   before flipping the *Pending* flag.

3. **`browser-first/host/addon-installer.mjs`**: before persisting
   the new manifest, fetch the registry row for
   `id@publisher`; if it exists, run `diffAddOnManifest`; if the
   delta's `hardChanges` are non-empty, the install lands as
   `Pending: true` in the registry and the user is shown the review.

4. **`browser-first/host/bridge-status.mjs`** (read-only): the
   `/status` route surfaces `pendingUpdates` so the dev panel can
   list them.

5. **`run-bridge-minimal.mjs`**: registers the registry store at
   boot; the existing fall-through to `dev-roundtrip` stays for
   non-addon callers.

## Cross-cutting

- **ADR-038** supplies the `id@publisher` anchor that makes a diff
  meaningful. Without it, two updates from the same publisher
  can't be distinguished.
- **ADR-040** owns the *tier transitions*: when the host detects a
  publisher change, ADR-040's transition rules determine whether
  the new tier allows the prior-version's grants to carry over.
- **ADR-041** owns isolation: changes to `runtimeIsolation.boundary`
  are hard-changes but the actual worker-thread rebuild is governed
  there.

## Open work (delegated to follow-up ADRs)

- **Cross-publisher pulls**: a Personal add-on upgraded to a
  Verified variant of the same `id` (publisher changes
  `local → verifying.acme`) gets the full new-install treatment
  per ADR-040, not just a hard-change prompt. This ADR catches the
  publisher change; ADR-040 governs the rule.
- **Capability-removal diffs**: removing a capability is currently
  "soft". A follow-up ADR may promote it to "hard" since the user
  may want to approve the removal as a deliberate act.
- **Bundled add-on updates**: add-ons shipped with the Alpha update
  with the host binary; their prior version is read from the host's
  manifest metadata, not the registry. Out of scope for Alpha;
  noted for the package-format ADR.

## Rules

- The diff function MUST be pure. No I/O, no Date.now(), no random
  ids.
- The diff function MUST be deterministic across runs.
- The diff function MUST NOT require the host at runtime; it is a
  pure module shipped from `packages/addon-sdk-testing`.
- The host MUST refuse to apply a hard-changed update without an
  explicit user approval row in the audit ledger.
- The host MUST log the delta's `hardChanges` length and ids in the
  audit ledger regardless of approval outcome.
- Identity-only changes (different `id`) are NOT a diff — they are
  a fresh install.

## Validation

- `diffAddOnManifest` has unit tests covering:
  - no-change returns empty arrays.
  - new capability added → `hardChanges` has
    `capability-added` entry.
  - capability scope widened → `capability-scope-widened`.
  - capability revocation weakened → `revocation-weakened`.
  - `description` change → only `softChanges`.
  - `version` downgrade → `identity-version-downgrade` is a hard
    change.
  - `publisher` change → `trust-publisher-changed` is a hard change.
- `validateAddOnManifest` unchanged. The diff sits on top of validated
  manifests.
- A new `packages/addon-sdk-testing/test/permission-diff.test.ts`
  exercises the diff with curated prior/next manifest pairs.
- vitest: every prior test stays green.

Out of scope (delegated to ADR-040 / 041):
- Trust-tier transition labels.
- Worker-thread rebinding on isolation change.
