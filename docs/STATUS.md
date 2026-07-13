# ResonantOS 2.0.0 Alpha Status

This document is the current status source of truth for the repository. Update
it only from the current worktree, deterministic checks, GitHub issues, and
[Project 2](https://github.com/orgs/ResonantOS/projects/2).

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

## Verification Contract

Run `npm run verify:alpha` before relying on this status for a release or pull
request decision. The command executes:

<!-- VALIDATION_SNAPSHOT -->
- documentation, reachability, repository-hygiene, and build checks;
- application, browser-first, browser-host, Living Archive, health, and
  engineer-runner suites; and
- strict security certification, where every enabled check must pass and
  skipped, warning, or failing results reject the candidate, plus the committed
  release-scope audit.

The active runtime-hardening checks use production-derived spawn records with
source anchors. A runtime surface that has no records, or a record that cannot
be scored, cannot be reported as a clean certification result.

Runtime discovery is fixed-root and canonical: ambient `PATH`, arbitrary
Hermes profile roots, and arbitrary OpenCode command paths are not executable
sources. Windows OpenCode requires a direct `.exe`. The alpha host currently
supports only the canonical
`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` for folder
picking, invoked directly with the command shell disabled; `.cmd` and `.bat`
shims are unsupported. Explorer open/reveal actions are likewise fixed to
`C:\Windows`. Non-`C:` Windows system roots are an explicit compatibility
limitation and are not inferred from ambient `SystemRoot` or `WINDIR`.

This cleanup removed obsolete tracked documents. Every retained documentation
asset is linked from the canonical documentation graph or is an explicit
runtime/GitHub consumer. The disposition ledger records run evidence; it is not
repository authority and does not override the current repository, GitHub
issues, or Project 2.

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
