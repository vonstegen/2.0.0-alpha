# CLAUDE.md — Community Hub add-on

Guidance for Claude / agents working in `addons/resonant-community-hub/`.
This is a **spec-driven** plugin: read the governing docs before touching code.

## What this is

A **public community hub** ResonantOS add-on: members check in to see community
events, claim community tasks, and share presence. Shared state lives in a custom
**serverless backend + managed DB**; the add-on is the local client. Supersedes
issue #238 (Plane task board).

## Read these first, in order

1. [`constitution.md`](./constitution.md) — non-negotiable rules. **It overrides everything, including this file and the spec.**
2. [`spec.md`](./spec.md) — the feature specification and acceptance criteria.
3. Then `plan.md` and tasks (added as milestones start).

## Spec-driven workflow (mandatory)

**constitution → spec → plan → tasks → implementation.**
Do not write implementation code that isn't authorized by a merged section of
`spec.md`. If reality forces a deviation, **amend the spec** (and the constitution
if an article is affected) in the same change — never work around them silently.

## Hard constraints (quick reference — see constitution for the full text)

- **Extension never calls the public API directly.** All traffic goes through the
  local bridge / `local-service` host (MV3 CSP allows only `'self'` + localhost).
- **Public read, authenticated write.** No anonymous writes; lightweight
  OAuth/magic-link identity.
- **Capability-gated (ADR-018).** Manifest must pass `assertValidAddOnManifest()`;
  tools only require requested capabilities.
- **Polling, not push.** The localhost bridge cannot receive webhooks; never design
  for server→client push as a dependency.
- **Serverless + managed DB.** No VPS baseline.
- **Moderation + rate limiting ship in v1**, not later.
- **No community data into trusted Living Archive pages** — intake boundaries only.
- **Agent writes are approval-gated** (`requiresHumanApproval: true`).

## Where things live (parent repo)

- Add-on SDK: `src/sdk/addons/` (`contracts.ts`, `validation.ts`, `registry.ts`, `surface-routing.ts`)
- SDK spec: `docs/architecture/ADR-018-addon-sdk-v0.md`
- PM primitive to map tasks onto: `src/core/goal-workspace.ts`, `src/core/contracts.ts`
- Local-service add-on to mirror: `addons/resonant-browser-host/`
- Bridge outbound-fetch precedent: `browser-first/host/provider-bridge-service.mjs`
- Manifest examples: `public/addons/obsidian.json`, `examples/addons/reference-memory.json`
- Manifest catalog + index: `public/addons/`, `public/addons/index.json`

## Planned layout of this dir

```
addons/resonant-community-hub/
  constitution.md      # governing rules (highest authority)
  spec.md              # the specification
  CLAUDE.md            # this file
  README.md            # short overview / pointer
  plan.md              # (M0+) technical plan derived from spec
  backend/             # (M1+) serverless functions + DB schema/migrations
  src/                 # (M3+) local-service host (bridge proxy) + shared logic
  test/                # node --test suites
  package.json         # @resonantos/resonant-community-hub (added at M1)
```
The manifest itself lives in the parent catalog: `examples/addons/community-hub.json`
(draft) → `public/addons/community-hub.json` (curated).

## Conventions

- ES modules (`"type": "module"`), `.mjs` for host code — match `addons/resonant-browser-host/`.
- Tests: `node --test test/*.test.mjs`.
- Manifest changes must keep `public-manifests.test.ts`-style validation green.
- Secrets/tokens never committed; use host-vault/user-config scopes.

## Definition of done (per feature)

A feature is done only when its acceptance criteria in `spec.md` §9 are
demonstrably met and its deterministic checks pass.
