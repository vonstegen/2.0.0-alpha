# Community Hub — Constitution

> The constitution is the highest authority for this plugin. Every `spec.md`,
> `plan.md`, task, and pull request must comply with these articles. When a spec
> and this constitution disagree, **the constitution wins** — amend it explicitly
> (with rationale + version bump) rather than working around it.

- **Plugin:** `addon.community-hub` (Community Hub)
- **Repo path:** `addons/resonant-community-hub/`
- **Status:** Ratified 2026-07-07 · v1.0.0
- **Supersedes:** ResonantOS/2.0.0-alpha#238 (Plane-backed team task board)

---

## Article I — Local-first is preserved; only the community backend is hosted

ResonantOS remains local-first. The **only** hosted component is the public
Community backend (the shared source of truth). The add-on adds **no** local
persistence obligations beyond existing `chrome.storage`/file conventions.

- The `127.0.0.1` bridge is never the shared source of truth.
- The add-on must degrade gracefully to a read-only or offline state when the
  backend is unreachable (`revocationBehavior: degrade` where applicable).

## Article II — The extension never calls the public API directly

The MV3 CSP locks `connect-src` to `'self'` + `127.0.0.1`/`localhost`. Therefore:

- All Community API traffic is proxied through the **local bridge / `local-service`
  host** (`browser-first/host/` precedent: `provider-bridge-service.mjs`).
- The extension calls the bridge; the bridge calls the Community API. No exceptions.

## Article III — Capability-gated, per Add-on SDK (ADR-018)

- The manifest passes `assertValidAddOnManifest()` before the shell trusts it.
- Every privileged action requires an explicitly **requested** capability.
- Tools may only require capabilities the manifest requests; grant presets may
  only grant requested capabilities.
- Runtime code sits **behind** host-mediated service/UI contracts — never direct
  privileged access.

## Article IV — Public read, authenticated write

- **Reads are public:** anyone with the add-on can browse events, tasks, presence.
- **Writes require a lightweight identity:** RSVP, attendance check-in, task
  sign-up, and presence updates require one-time sign-in (OAuth: GitHub/Google,
  or magic-link). **No anonymous writes.**
- Identity is minimal: a stable member handle + display name. Attribution, not
  surveillance.

## Article V — Human-in-the-loop and safety boundaries

- Agent-initiated writes go through a **human-approval gate**
  (`requiresHumanApproval: true`). User-initiated writes are explicit user actions.
- Community data may be written to **archive intake boundaries only** — never
  directly into trusted Living Archive knowledge pages (ADR-018).
- Presence is **opt-in** and revocable; a member can clear presence at any time.

## Article VI — Serverless backend, managed DB, polling sync

- Backend is **serverless** (stateless functions) + a **managed DB**
  (e.g. Turso/libSQL or Neon Postgres). No hand-rolled VPS as the baseline.
- The API is stateless and versioned (`/v1/...`); breaking changes bump the version.
- **Sync is polling** (the localhost bridge cannot receive webhooks). No design may
  assume server push to a client. Server-Sent Events may be added later as an
  enhancement, never a dependency.

## Article VII — Moderation and abuse are first-class, not afterthoughts

Because the hub is public and writable:

- Every write endpoint is **rate-limited**.
- There is a **report / hide** path for events, tasks, and presence entries.
- Abuse controls ship in v1, not "later."

## Article VIII — Privacy and data minimization

- Collect the minimum PII to attribute an action (handle, display name, OAuth sub).
- No tracking, no selling, no third-party analytics on community members.
- Members can delete their account and associated writes (right to erasure).

## Article IX — Spec-driven workflow is mandatory

Order of authority and of work: **constitution → `spec.md` → `plan.md` →
tasks → implementation.** No implementation lands without a merged spec section
that authorizes it. Deviations require a spec amendment, not ad-hoc code.

## Article X — Testing and determinism

- The manifest must pass validation tests (mirror `public-manifests.test.ts`).
- Deterministic checks (schema validation, rate-limit logic, auth guards) are
  declared as add-on `scripts`/`hooks` and executed host-side (Logician workstream
  owns deterministic verification per ADR-018).
- No feature is "done" until its acceptance criteria in `spec.md` are demonstrably met.

---

## Non-negotiable non-goals (v1)

- No self-hosted VPS baseline (serverless only).
- No anonymous writes.
- No server→client push as a dependency (polling only).
- No writing community data into trusted AI Memory pages.
- No automated real-world actions (no auto-emailing attendees, no payments).

## Amendment procedure

1. Open a PR editing this file with a clear rationale.
2. Bump the version (semver: breaking article change = major).
3. Update any `spec.md`/`plan.md` sections the amendment affects in the same PR.
