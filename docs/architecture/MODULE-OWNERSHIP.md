# Module Ownership

Last updated: 2026-06-22

## Purpose

This document is the current contributor-facing ownership contract for the browser-first ResonantOS product branch. Use it when adding a module, moving behavior out of `App.tsx`, changing shared state, or touching host/IPC boundaries.

Related context:

- `docs/architecture/ADR-002-modular-codebase.md`
- `docs/architecture/ADR-003-engineering-standards.md`
- `docs/architecture/MODULE_MAP.md`
- `docs/architecture/VNEXT_SYSTEM_DIAGRAM.md`

## Ownership Table

| Path | Owns | Reads | Writes / Mutates | Boundary Notes |
| --- | --- | --- | --- | --- |
| `src/modules/addons/` | Add-on catalog, manifest details, grant controls, add-on setup panels, and add-on-specific workspace entry points. | Add-on manifests, capability grants, provider/memory availability, host status payloads. | Add-on install/grant mutations through controllers and host-mediated routes. | Keep add-on lifecycle policy here or in `src/sdk/addons/`; do not push add-on mutation logic into `App.tsx`. |
| `src/modules/archive/` | Living Archive workspace, search, intake, review, promotion, source registry, import, diagnostics, and archive action center. | Memory-provider broker results, archive runtime status, source scan/review queues, trusted wiki/search/read payloads. | Archive intake/review/promotion commands through `controller.ts` and browser-first memory host routes. | Living Archive remains the default `memory-system` add-on; replacement memory providers must not be bypassed by local archive UI. |
| `src/modules/browser/` | Browser workspace surface and browser add-on presentation inside the React shell. | Browser capability/grant state and browser runtime status. | Workspace UI state only; browser page actions belong to browser-first extension controllers. | Browser automation and page mutation are host/extension concerns, not React module concerns. |
| `src/modules/chat/` | Strategist/Augmentor chat rail, messages, composer, thread controls, context memory panel, archive intake handoff, and provider turn orchestration. | `ResonantShellState`, provider routing, context memory state, archive context, active agent/thread state. | Conversation threads, compact memory edits, chat runs, archive-intake captures, and local composer/dictation state through chat controllers. | Provider calls stay behind `src/core/provider-service.ts` and host/provider boundaries; chat does not own provider credential storage. |
| `src/modules/compute/` | Compute Fabric workspace preview and compute fabric controller/model surfaces. | Compute/runtime fabric state and provider/runtime descriptions. | Compute fabric view/controller state. | Runtime execution policy remains a host/add-on boundary; this module is not a privileged runner. |
| `src/modules/delegation/` | Delegation Monitor workspace for task workspaces, result review, verification review, and explicit start controls. | Delegation task summaries, results, verification artifacts, selected workspace state. | Task selection and host-mediated delegation start/finalization actions. | Augmentor manages delegation intent; this module supervises task workspace state and reviews outcomes. |
| `src/modules/hermes/` | Hermes add-on workspace status and dashboard surface. | Hermes runtime/add-on status, grants, dashboard availability. | UI-only Hermes start/open requests through host-mediated add-on routes. | Hermes execution remains optional add-on host work, not shell core behavior. |
| `src/modules/obsidian/` | Obsidian-compatible workspace, vault tree, markdown editor/preview, metadata panel, and vault index panel. | Selected vault state, note listings, note content, backlinks, frontmatter/tags. | Audited note edits through host-mediated Obsidian/notes commands when enabled. | Filesystem access must stay behind host commands and explicit grants. |
| `src/modules/opencode/` | OpenCode add-on workspace, runtime status, connection controls, and embedded UI frame. | OpenCode runtime status, scoped workspace path, grants. | Host-mediated OpenCode launch/connect/disconnect actions. | OpenCode remains optional and must not become a shell dependency. |
| `src/modules/overview/` | Home/workbench overview surface, service snapshots, and workspace framing. | Shell route, high-level service status, active workspace summaries. | Navigation intent and UI-only selections. | Planned migration target is the Home / Apps launcher from `docs/product/UX-001-resonantos-app-shell.md`. |
| `src/modules/paperclip/` | Paperclip optional organizational-runtime workspace and connector status. | Paperclip endpoint status, grants, company/agent/issue summaries. | Host-mediated local endpoint connection and delegation handoff controls. | Public default catalog must not expose development-only Paperclip until a future add-on release approves it. |
| `src/modules/recovery/` | Recovery dashboard, recovery mode/session controller, and recovery route promotion workflow. | Recovery runtime snapshot, recovery session state, route candidates. | Recovery mode/session state and bounded host-mediated recovery actions. | Recovery tools must stay inside documented allowlists and audited host routes. |
| `src/modules/settings/` | Settings workspace, provider profiles, provider diagnostics, memory settings, browser/add-on/privacy/advanced sections. | Runtime state, provider profiles, bridge/provider health, memory source settings, archived chats/projects. | Provider profile updates, workload strategy updates, memory settings writes, and UI preferences through controllers/host routes. | Provider secrets must not become browser-only source-of-truth state. |
| `src/modules/shell/` | Shell boot/hydration controller, selectors, top-level slot resolution, replacement-slot gates, and shell-derived view state. | Persisted shell state, bundled/sideloaded manifests, runtime snapshots, UI preferences. | Shell state hydration, shell selectors, system slot decisions, and first-run recommended add-on activation. | Cross-module reads should route through shell selectors or `src/core/`; module-specific mutation should stay in each module controller. |
| `src/modules/strategist/` | Strategist identity/channel workspace and Strategist thread/channel controller. | Agent/channel/thread state and active strategist context. | Strategist channel/thread management state. | Chat message execution remains in `src/modules/chat/`; strategist owns identity/channel organization. |

## State And Data Flow

Use this flow as the default ownership rule:

1. `src/App.tsx` composes the shell, owns top-level React wiring, and calls `commitReadyState` for persisted `ResonantShellState` updates.
2. `src/modules/shell/` owns boot, hydration, replacement-slot resolution, and derived shell selectors.
3. Domain modules under `src/modules/*` own their feature UI, local controllers, local selectors, tests, and domain-specific mutation orchestration.
4. Cross-module contracts, durable app state shapes, provider routing, memory-provider interfaces, and policy helpers live in `src/core/`.
5. Browser-first extension state and browser automation state live under `browser-first/resonantos-side-panel-extension/src/lib/` and should not be mirrored into React modules unless a narrow view model is needed.
6. Host calls cross through `browser-first/host/` route services or add-on host packages. UI modules should call controllers or host clients, not read or write privileged filesystem/process state directly.

Dependency rule:

- UI modules may depend on `src/core/`, `src/modules/shell/` selectors, and narrow props/callbacks from `App.tsx`.
- Feature modules should not import another feature module's controller as a shortcut. If two modules need the same contract, move the contract or pure helper to `src/core/` or a shared SDK package.
- New shared state must name one owner. If ownership is unclear, add a short architecture note or ADR before implementation.

## Host And IPC Boundary

The active browser-first branch does not contain `src-tauri/src/`; `src-tauri/src/` is not present in this checkout. If a future shell reintroduces a Rust/Tauri host, this document must add the concrete service modules and privileged IPC commands before that PR is merged.

Current host and IPC-like boundaries:

| Path | Boundary |
| --- | --- |
| `browser-first/host/bridge-server.mjs` | Loopback bridge authentication, JSON route registration, generated side-panel bridge config, and bridge auth self-tests. |
| `browser-first/host/*-host-service.mjs` | Route service ownership for provider, memory, archive review, Agent Control, add-on delegation, extension prefs, and browser diagnostics. |
| `browser-first/host/provider-fabric-core.mjs` | Browser-first provider routing and route selection model used by host services. |
| `browser-first/host/memory-*.mjs` | Living Archive memory source settings, ingest, move, versioning, wiki health/lint/search, and host-mediated memory operations. |
| `browser-first/resonantos-side-panel-extension/src/lib/bridge-client.js` | Authenticated extension-to-host bridge calls. |
| `browser-first/resonantos-side-panel-extension/src/lib/*controller*.js` | Browser-side command, chat, control, page action, rendering, and job state controllers. |
| `addons/resonant-browser-host/` | Browser host add-on package, host tests, and browser-host integration surface. |

Host-boundary rules:

- Provider credentials, filesystem access, browser process launch, archive promotion, memory source movement, and privileged add-on lifecycle actions must stay behind host-mediated routes.
- Browser extension controllers may hold session/UI state but must not become the source of truth for secrets or privileged host state.
- New host routes need a named owner service, capability requirement, and focused host or browser-first test.

## Pull Request Checklist Hook

When a PR adds a module, moves ownership between modules, changes a host route, or moves behavior out of `App.tsx`, the PR must answer:

- Which `src/modules/*` path owns the behavior after this change?
- Does a shared contract belong in `src/core/` instead of another feature module?
- Did any module start importing another module's controller or private helper?
- Did a host/IPC route, capability, provider, filesystem, or browser automation boundary change?
- Does this file need an update alongside the code change?

For module additions, this document must be updated in the same PR. The focused check is:

```bash
node --test --test-concurrency=1 scripts/module-ownership-doc.test.mjs
```

## Drift Handling

- If `App.tsx` gains substantial domain mutation logic, treat that as architecture drift and open a follow-up issue or move the logic into the owning module controller.
- If a module grows large enough to mix rendering, state mutation, host access, and policy, split it by concern before adding another feature to it.
- If a legacy architecture document disagrees with this file, prefer this file for current branch ownership and update the older document when touching the same area.

