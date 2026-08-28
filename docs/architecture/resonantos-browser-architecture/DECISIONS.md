# ResonantOS Browser Architecture — Decision Register (Q&A)

Open questions that gate a checkpoint. Each entry states the question, the
options with tradeoffs, a recommendation, and the checkpoint it blocks. Decisions
close in the checkpoint ADR; until then they are tracked here, not re-litigated in
code reviews.

---

## D-1 — Is `primary-agent` the orchestration slot, or do we add an `orchestrator` alias? — RESOLVED

- **Status:** Resolved (2026-08-27) — permanent occupation. Encoded in
  [ADR-053](../ADR-053-browser-first-multi-harness-architecture.md).
- **Outcome:** `primary-agent` remains the stable slot id and is **permanently
  occupied by Augmentor**. Its role is system-wide AI orchestration. No `orchestrator`
  alias. Harness Providers may execute and internally orchestrate their own work, but
  cannot claim, replace, alias, or displace the `primary-agent` role.
- **Original options:**
  1. Keep `primary-agent`; document its *role* as orchestration. **← chosen and strengthened to permanent occupation**
  2. Add a compatible `orchestrator` alias; deprecate `primary-agent` later.
  3. Rename to `orchestrator` mechanically.
- **Rationale:** Augmentor is fused (ADR-051); a replaceable orchestration slot would
  let a harness displace the system orchestration layer.

## D-2 — Rename `Strategist`/`Augmentor`/`primary-agent` mechanically, or alias? — RESOLVED

- **Status:** Resolved (2026-08-27) — Option 1. Encoded in
  [ADR-053](../ADR-053-browser-first-multi-harness-architecture.md).
- **Outcome:** "Augmentor" is the canonical name of the **fused** orchestration harness.
  `strategist` remains the shell section id (`CoreSectionId: "strategist"`); no module
  rename, no re-export shims. Naming continuity only; not an authority claim.
- **Original options:**
  1. Ratify "Augmentor"; keep `strategist` as the shell section id. **← chosen**
  2. Rename `src/modules/strategist/` → `augmentor/` with re-export shims.
- **Rationale:** the section id `strategist` is a shell rail; Augmentor is the fused
  harness name. No rename, no shims.

## D-3 — Self-contained bearer tokens, or bridge-resolved handles?

- **Gates:** CP-1 (authority types), CP-2 (enforcement).
- **Context:** Doc 08: "Prefer handles resolved by the bridge over self-contained
  tokens exposed to add-on code." The current hardening (`bridge-attributed-token.mjs`)
  mints HMAC caller-attributed tokens — self-contained, per-bridge-process.
- **Options:**
  1. Keep self-contained HMAC tokens as the transport, add a host-side `grantHandle`
     indirection so clients pass opaque handles and the bridge resolves them.
  2. Move fully to opaque handles; tokens become internal-only and never cross the
     add-on boundary.
- **Recommendation:** Option 2 for new CP-2 routes (envelope carries `grantHandle`);
  retain the HMAC tokens as the *internal* mint behind the handle for compatibility
  during migration. This satisfies "non-exportable to UI storage" and keeps the
  existing hardening as a foundation, not a throwaway.
- **Tradeoff:** option 2 adds a bridge round-trip/resolve step; option 1 risks the
  very "reusable grant material" exposure doc 08 prohibits.

## D-4 — Extend the Phase 3.5 caller-attributed tokens, or replace with the full model?

- **Gates:** CP-1, CP-2.
- **Context:** `bridge-grants-store.mjs` is per-caller/capability, in-memory,
  per-bridge-process. The target (docs 07–08) is a principal chain + task-scoped
  temporal grant with cascade revocation and audit correlation.
- **Options:**
  1. Extend in place: add `taskId`/`delegationId`/`principal` fields and cascade
     revocation onto the existing store.
  2. Keep the store as the transport primitive; build the richer `AuthorityGrant`
     model in `src/sdk/authority/` and have the store consume it.
- **Recommendation:** Option 2. The store already documents its own lifetime as
  per-process/per-boot; the richer grant needs persistence and lineage that belong
  in Core, not in an in-memory token store. Do not delete the store; it becomes the
  runtime materializer behind `grantHandle`.
- **Risk to flag:** option 1 couples durable authority to a per-boot in-memory store
  and will fight CP-7 (restart reconstruction) and CP-8 (revoke-on-entry).

## D-5 — Where does the package physically live? — RESOLVED

- **Status:** Resolved (2026-08-27) — Option 1.
- **Outcome:** canonical copy is `docs/architecture/resonantos-browser-architecture/`.
  The top-level `resonantos-browser-architecture-package/` duplicate was folded into
  the canonical location and deleted. `CHECKLISTS.md` (review checklists) and
  `CHECKPOINTS.md` (checkpoint specification) are distinct documents and both remain.
- **Original options:**
  1. Canonical = `docs/architecture/resonantos-browser-architecture/`; delete the
     top-level duplicate after this planning pass is folded in. **← chosen**
  2. Keep both, top-level as the authoring copy, in-repo as the published copy.
- **Rationale:** one canonical location; ADR-052 already points there; `validate-docs.mjs`
  requires reachability from the docs graph. Option 2 guarantees drift (was already
  visible: README differed, ROADMAP/CHECKLISTS missing in the top-level copy).

## D-6 — How aggressive is Ground-0 quarantine of "optional executable memory"?

- **Gates:** CP-8.
- **Context:** Doc 09/10: Ground-0 quarantines "hooks, scripts, generated
  instructions, provider plug-ins, or harness checkpoints until revalidated" while
  preserving identity/audit/continuity read-only. "Preserving history does not mean
  replaying code."
- **Options:**
  1. Quarantine-by-default: all optional executable state disabled on entry; explicit
     accept/replace/leave-disabled per item on exit.
  2. Tiered quarantine: disable high-risk (hooks/scripts/external sends) but allow
     read-only harness checkpoints to persist until a health check fails.
- **Recommendation:** Option 1. Matches the doc-10 exit criteria ("explicitly
  accepted, replaced, or left disabled") and avoids any pre-recovery executable
  authority surviving. Tiering can be added later as an optimization, not the default.
- **Tradeoff:** option 1 has a heavier re-enable cost; option 2 risks the exact
  "history-as-executable" confusion the non-negotiables forbid.

## D-7 — Does CP-6 make ADR-032 Compute Fabric an Alpha requirement?

- **Gates:** CP-6.
- **Context:** Doc 13: "Do not make ADR-032 an Alpha requirement merely because its
  types support the target." Doc 11: "The Resource Governor should consume the
  Compute Fabric, not duplicate node execution."
- **Options:**
  1. Governor consumes compute *types* (`src/core/compute-fabric.ts`) for
     job-level budgets, but leaves node enrollment/execution deferred.
  2. Land the full ADR-032 compute path before CP-6.
- **Recommendation:** Option 1. Budgets/leases for browser/workspace/provider
  resources are Alpha-scope; compute-node execution is deferred and documented as a
  known limitation. Governor consumes the existing `ComputeJob`/`ComputeNode` shapes,
  does not re-implement them.

## D-8 — Which provider is the "structurally different" third reference?

- **Gates:** CP-5 (exit gate: three provider shapes).
- **Context:** Doc 05 names OpenClaw as the validation target; `public/addons/openclaw.json`
  already exists.
- **Options:**
  1. OpenClaw (already manifest-footprinted).
  2. A minimal synthetic provider built only to stress the contract.
- **Recommendation:** Option 1, with option 2 as a fallback if OpenClaw's runtime
  cannot expose child operations (doc 05 containment rule). Confirm OpenClaw can be
  sandboxed before CP-5 commits to it.

## D-9 — How do we reconcile `addon.augmentor-chat` with the fused Augmentor? — RESOLVED

- **Gates:** CP-3 (extension classes + slot assignment); CP-8 (Ground-0 vault-reload).

- **Status:** Resolved (2026-08-28) — Option 1. Encoded in
  [ADR-053](../ADR-053-browser-first-multi-harness-architecture.md).
- **Outcome:** `addon.augmentor-chat` severs its two roles: it drops `primary-agent`
  from its `systemSlots` and provides only `chat-interface`. The fused Augmentor
  harness is permanent Core (always on, not manifest-expressed); the chat UI remains
  a replaceable surface per ADR-026. **Landed (2026-08-28):** `public/addons/augmentor-chat.json`
  now provides only `chat-interface`; `src/sdk/addons/validation.ts` rejects any add-on
  claim of `primary-agent` (`system-slot-reserved`). Ground-0 vault-reload (CP-8) loads
  the fused Augmentor directly, not a `primary-agent` add-on provider.
- **Context:** ADR-026 has `addon.augmentor-chat` provide **both** `primary-agent` and
  `chat-interface`. ADR-053 makes `primary-agent` permanently occupied by the fused
  Augmentor (not an add-on). The add-on's two roles must be severed: the orchestration
  harness is permanent Core; the chat UI remains a replaceable surface.
- **Original options:**
  1. Sever the slots in place: `addon.augmentor-chat` drops `primary-agent` from its
     `systemSlots` and provides only `chat-interface`. The fused Augmentor harness is
     Core, always on, not manifest-expressed.
  2. Retire the add-on: deprecate `addon.augmentor-chat`; the fused Augmentor ships its
     own minimal console; a distinct chat add-on provides the full `chat-interface`.
  3. Manifest-class split: keep one `augmentor-chat` manifest as chat-interface-only,
     and express the fused harness as a Core-owned non-addon component.
- **Rationale:** Option 1. Drop `primary-agent` from the add-on's `systemSlots`;
  keep `chat-interface` replaceable per ADR-026. Matches ADR-051's "integrated harness …
  not a plug-in" and ADR-053's permanent-slot rule; least disruption.
- **Tradeoff:** option 2 is cleaner conceptually but removes the bundled default chat
  add-on ADR-026 promises; option 3 avoids a manifest rename but still requires the
  slot split at validation time.
