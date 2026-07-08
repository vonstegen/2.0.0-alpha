# Community Hub (`addon.community-hub`)

A **public community hub** ResonantOS add-on: members check in to see community
**events** (RSVP + live attendance), claim community **tasks**, and share
lightweight **presence**. Shared state lives in a custom **serverless backend +
managed DB**; each member runs the add-on locally and reaches the backend through
their local bridge.

> Supersedes [ResonantOS/2.0.0-alpha#238](https://github.com/ResonantOS/2.0.0-alpha/issues/238)
> (Plane-backed team task board).

## This is a spec-driven plugin

Work here follows **constitution → spec → plan → tasks → implementation**.

| Doc | Purpose |
|---|---|
| [`constitution.md`](./constitution.md) | Non-negotiable governing rules (highest authority) |
| [`spec.md`](./spec.md) | The specification + acceptance criteria |
| [`plan.md`](./plan.md) | Technical plan + milestone/task breakdown derived from the spec |
| [`CLAUDE.md`](./CLAUDE.md) | Operating guide for Claude / agents in this dir |

Start with the constitution, then the spec, then the plan. Do not implement
anything that a merged spec section does not authorize.

## Design in one breath

- **Public read, authenticated write** (lightweight OAuth/magic-link — no anonymous writes).
- **Extension → local bridge → public API** (never the extension directly; MV3 CSP).
- **Serverless + managed DB**, **polling** sync (localhost can't receive webhooks).
- Capability-gated per Add-on SDK (ADR-018); tasks map to `GoalWorkspace` so agents can act.

## Status

**M0 complete** — scaffold (constitution, spec, plan, CLAUDE.md) + draft manifest
`examples/addons/community-hub.json` passing `validateAddOnManifest` (zero issues).
Next: **M1 — backend read path** (see `plan.md`). Milestones in `spec.md` §10.
