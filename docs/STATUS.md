# ResonantOS 2.0.0 Alpha Status

Verified snapshot: 2026-07-10. This document is the current status source of
truth for the repository. Update it only from the current worktree, deterministic
checks, GitHub issues, and [Project 2](https://github.com/orgs/ResonantOS/projects/2).

## Snapshot

| Fact | Verified value | Evidence |
| --- | --- | --- |
| Package | `resonantos-vnext` `2.0.0-alpha.0` | `package.json` |
| Extension | Manifest V3 `0.1.14`; Chrome 116 minimum | `browser-first/resonantos-side-panel-extension/manifest.json` |
| Node.js | `>=22.13.0` | `package.json` and `.nvmrc` |
| Alpha runtime | Chrome extension plus local Node.js bridge | `browser-first/resonantos-side-panel-extension/`, `browser-first/host/`, `run-bridge-minimal.mjs` |
| Development branch | `dev`; changes use a feature branch and a PR into `dev` | `AGENTS.md` |
| Release planning | GitHub issues organized in Project 2 | [Project 2](https://github.com/orgs/ResonantOS/projects/2) |
| Release gate | Open | [Alpha stabilization epic #209](https://github.com/ResonantOS/2.0.0-alpha/issues/209) |

## Runtime Components

- The unpacked extension provides the side panel, new-tab main workspace,
  content mediation, settings, and browser controls.
- `npm run browser-first:bridge` starts the local bridge. The launcher binds to
  loopback by default, creates session and capability-bootstrap tokens, and
  writes the generated extension config with mode `0600`.
- Provider, Agent Control, Living Archive, diagnostics, extension preferences,
  and governed add-on delegation are exposed through capability-gated bridge
  routes.
- User data defaults to `~/ResonantOS_User`; generated runtime state and secrets
  are not distribution artifacts.

Implementation status and proof requirements are recorded in the
[capability matrix](./reference/CAPABILITY_MATRIX.md). Stable user workflows are
in the [product guide](./product/PRODUCT_GUIDE.md).

## Verification

The snapshot was derived from the package metadata, extension manifest, bridge
launcher and services, workflow definitions, deterministic tests, and
`/tmp/resonantos-issues.json`. It does not copy historical test counts.

Validation for this documentation slice:

<!-- VALIDATION_SNAPSHOT -->
- `npm run test:docs` - passed on 2026-07-10.
- Focused bridge-auth, Provider Fabric, Agent Control policy/planner, Archive
  promotion, source-intake, and add-on delegation tests - passed on 2026-07-10.
- `npm run docs:check` - blocked on concurrent architecture cleanup: the ADR
  index and Alpha runtime boundary are not present yet, and the old module docs
  still contain current native-runtime claims.
- `npm run repo:hygiene` - blocked because the dated cleanup plan contains a
  founder-specific absolute path. The plan is scheduled for removal by the
  cleanup blueprint and is outside this worker's file ownership.

## Open Alpha Gates

The alpha is not release-ready while the Project 2 alpha gate remains open.
Current issue evidence includes:

- [#209](https://github.com/ResonantOS/2.0.0-alpha/issues/209): bridge,
  provider, and first-run reliability epic.
- [#200](https://github.com/ResonantOS/2.0.0-alpha/issues/200): capability
  token-map drift in the alternate production launcher.
- [#203](https://github.com/ResonantOS/2.0.0-alpha/issues/203): missing
  full-pipeline first-time setup smoke coverage.
- [#204](https://github.com/ResonantOS/2.0.0-alpha/issues/204): capability
  bootstrap failures need an operator-visible diagnostic.
- [#207](https://github.com/ResonantOS/2.0.0-alpha/issues/207): a newly added
  provider does not propagate into Provider Fabric routing.

An open issue is not proof that every deterministic check currently fails. It
is unresolved release evidence until the issue is closed or explicitly
dispositioned in Project 2.

## Out of Scope

- Tauri and Electron shells are historical or future work, not Alpha runtime.
- Native CEF hosts, Rust/Cargo builds, native packaging, signing, and updater
  work are excluded from the Chrome extension Alpha.
- Terminal and Audio2TOL workspaces are excluded from the Alpha distribution.

Future work belongs in the [roadmap](./ROADMAP.md), and the actual reviewer
delivery path is documented in
[Alpha Distribution](./release/ALPHA_DISTRIBUTION.md).
