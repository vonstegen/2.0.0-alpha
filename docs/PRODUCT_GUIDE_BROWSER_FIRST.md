# ResonantOS Browser-First Product Guide

Last updated: 2026-06-01

This is the human-readable guide to the current ResonantOS direction, what is already working, what is experimental, and what still needs to be built.

For implementation rules, read the ADRs. For day-to-day product understanding, start here.

## 1. What ResonantOS Is

ResonantOS is becoming a browser-first AI operating layer.

The product goal is not a dashboard that opens a browser. The goal is closer to a Comet-style browser: the web page, the AI assistant, memory, add-ons, provider routing, and task monitor all live in one browser application.

The current browser-first app is built around:

- a Chromium-family native browser host
- a ResonantOS browser extension layer
- a main AI workspace shown on new tabs
- an Augmentor side panel shown beside normal web pages
- a local bridge that connects browser UI to provider routing, memory, add-ons, and host services
- Phantom Wallet loaded in the same browser profile, with wallet actions kept human-only

The user-facing idea is simple:

- Open ResonantOS.
- Start from the main AI workspace.
- Ask Augmentor questions or give it goals.
- When a task needs the web, Augmentor can move into controlled browser mode.
- The human remains in control of sensitive actions such as wallet approval, login, payment, public posting, and signing.
- Useful page evidence, research trails, and task reports can be saved into the Living Archive for later AI memory.

## 2. Product Philosophy

ResonantOS is designed around sovereignty, modularity, and human-AI collaboration.

The system should:

- give the human a central place to work with AI
- avoid lock-in by allowing replaceable chat, memory, browser, and add-on components
- make AI actions visible, auditable, and interruptible
- route model use through user-defined cost, capability, and fallback policies
- keep credentials, wallet actions, and trusted memory writes behind explicit boundaries
- let community add-ons extend the system without becoming implicitly trusted core agents

The direction is aligned with Augmentatism and Cosmodestiny, but the software should remain usable by people who want a general modular AI browser.

## 3. Current App Shape

The current product direction is the browser-first app on branch `browser-first-preview`.

The old Tauri/desktop vNext codebase is still valuable as a feature reservoir and reference, but the active product path is:

```text
ResonantOS Browser
+-- Native Chromium-family browser host
+-- Browser tabs and address bar
+-- ResonantOS extension
|   +-- Main workspace / new tab app
|   +-- Augmentor side panel
|   +-- Content script for active-page observation/action
|   +-- Background service worker for browser mediation
+-- Local host bridge
|   +-- provider fabric
|   +-- Living Archive operations
|   +-- add-on/delegation operations
|   +-- audited browser job records
+-- User data root
    +-- provider secrets
    +-- browser profile
    +-- Living Archive memory
    +-- add-on state
    +-- logs/audit artifacts
```

Important distinction:

- The browser host is the app.
- The side panel is one ResonantOS surface inside the app.
- The main workspace is the full-screen AI surface shown on new tabs.
- External Chrome/Brave control is not the product path.
- Tauri WebView and Electron browser experiments are research history, not the target architecture.

## 4. Main User Surfaces

### Main Workspace

The main workspace is the default starting point. It is similar in role to the Perplexity or Comet home workspace.

It should be used when the user wants:

- a full AI chat interface
- a new conversation
- a project-oriented thinking space
- access to workspace modules such as Hermes, OpenCode, Living Archive, Add-ons, Artifacts, and Settings
- a clean place to ask Augmentor to search, reason, delegate, or take controlled browser action

Current capabilities:

- opens as the browser new-tab workspace
- starts a fresh main chat on ordinary new-window/no-hash launch
- supports model selection, thinking depth, context meter, page/context tools, and send controls
- supports message actions such as copy, fork, edit, regenerate, save/intake, and delete
- supports keyboard editing: Enter to send, Shift+Enter for newline, Command/Ctrl+A/C/X/V/Z
- includes a left rail for navigation, projects, pinned items, recent chats, add-ons, and settings
- can open Hermes, OpenCode, Living Archive, Add-ons, Artifacts, Settings, and browser job monitor workspaces

Current UX direction:

- keep the main workspace clean and low-text
- show the most important human action first
- move advanced detail into expandable sections or Settings
- avoid making every workspace look like a settings page

### Augmentor Side Panel

The side panel is the compact AI surface used while browsing normal web pages.

It should be used when the user wants:

- page-aware help while reading or working on a site
- AI-controlled web tasks without losing the page
- quick save-to-memory actions
- current-site status and browser job monitoring

Current capabilities:

- Augmentor chat in the browser side panel
- same core composer controls as the main workspace
- active-page read and summary actions
- save page, save selection, save summary, and save research trail to Living Archive intake
- current-site permission controls
- browser job monitor and action timeline
- Agent Control approval cards
- compact status for provider/model readiness

Design rule:

- The side panel must not replace the webpage.
- The side panel should remain beside the page while Augmentor reads, clicks, types, scrolls, or reports progress.

### Browser Page Overlay

When Augmentor is actively controlling a webpage, the page shows a Matrix-style green activity overlay.

The overlay exists to make AI control obvious to the human.

Current capabilities:

- full-session visual control state, not just a flash per step
- in-page action toast showing states such as reading, clicking, typing, screenshotting, or working
- visible target highlight when Augmentor clicks or types
- stop affordance for human interruption

Design rule:

- The overlay should make AI control visible and understandable without blocking normal human reading more than necessary.

## 5. Augmentor

Augmentor is the default primary AI interface.

It is not just a text chatbot. In ResonantOS it should be able to:

- reason with the user
- use browser tools
- delegate to approved add-ons
- save evidence into memory intake
- use provider routing and fallback policy
- explain blockers and next actions
- stay within safety and permission boundaries

Current capabilities:

- chat in main workspace
- chat in side panel
- Markdown rendering
- model/depth selection
- provider-routed replies through the local bridge
- natural browser-task routing into Agent Control Mode
- natural delegation routing for Hermes/OpenCode-style tasks
- browser/news prompts can route to mediated search instead of claiming no internet access
- provider prompt contract tells Augmentor it has ResonantOS browser and delegation capabilities

Important rule:

- Augmentor orchestrates through ResonantOS capabilities. It does not get raw browser, wallet, file, credential, or provider access.

## 6. Provider Fabric And Model Routing

Provider routing is centralized. Add-ons and chat surfaces declare requirements; ResonantOS decides the route.

The user should be able to configure providers based on:

- quality
- speed
- cost
- subscription availability
- local runtime availability
- task type
- fallback preference

Current provider concepts:

- provider accounts/profiles
- model profiles
- workload strategies
- fallback chains
- provider health state
- local or remote runtime nodes
- hard-stop behavior when required routes are unavailable

Current provider implementation highlights:

- shared provider credentials live in the user secrets root, not in UI code
- MiniMax M3 is the current primary fast chat route
- OpenAI GPT routes can be used as fallback or higher-capability routes when configured
- local models can be represented as runtime nodes
- manual model selection stays strict: if the user chooses a model directly, ResonantOS should not silently replace it unless the user selected automatic routing
- automatic routing can try the configured strategy chain and fall back when a provider fails

Known operational note:

- Provider availability depends on account state. For example, a configured OpenAI route may still fail if quota is exhausted. The UI should continue improving the distinction between `configured`, `healthy`, `quota-limited`, and `unavailable`.

## 7. Agent Control Mode

Agent Control Mode is the browser automation layer inspired by Comet-style AI browsing.

The intent is not to let the model freely operate the browser. The intent is a governed loop:

```text
observe page
decide next safe action
validate action
execute typed browser tool
observe again
verify result
continue, block, or ask the human
```

Current trigger paths:

- `/control <goal>`
- natural browser-task prompts such as "find news", "go to this site", "search Amazon", "find a booking slot", or "summarize this page"
- explicit browser commands such as `/browser read`, `/browser forms`, `/browser click`, `/browser type`, and `/browser scroll`

Current browser tools:

- read active page
- open URL
- search
- inspect forms
- list readable tabs
- switch controlled tab
- click visible safe controls by text or stable ref
- type into editable fields by label or stable ref
- scroll up, down, top, or bottom
- wait and re-observe

Current safety behavior:

- wallet connect/sign/network switch is blocked from automation
- login and credential entry is blocked
- payment, checkout, purchase, transfer, mint, claim, and bridge actions are blocked
- public submission requires approval
- non-search form submission requires approval
- ambiguous repeated labels are rejected until Augmentor retargets with an exact ref
- no-change actions trigger reread, retry evidence, or blocker guidance instead of pretending success
- completion is blocked when the latest mutation did not visibly change page state

Current monitor behavior:

- durable browser jobs are stored
- active, queued, paused, blocked, approval, failed, cancelled, and completed states are represented
- browser jobs have page locks so conflicting tasks do not mutate the same page at the same time
- jobs preserve step history, action details, blocker evidence, target evidence, timing, retry evidence, and next-human-action guidance
- job reports can be saved into Living Archive intake

## 8. Browser And Wallet

The browser-first app exists because ResonantOS needs a real browser surface.

Current browser capabilities:

- native Chromium-family browser host
- normal human browsing: address bar, tabs, navigation, clicking, typing, scrolling
- ResonantOS extension pinned by default
- Phantom Wallet extension loaded/pinned when available in the local profile
- local profile under the ResonantOS user data root
- deterministic browser-first launch and desktop verification scripts

Wallet posture:

- Phantom must live in the same browser profile as the human's browsing session.
- Augmentor can detect wallet-provider presence and page-visible wallet/governance controls.
- Augmentor cannot connect, sign, reveal seed/private key material, vote, transfer, bridge, mint, claim, submit transactions, or approve wallet actions.
- DAO workflows are read-only planning/audit helpers until the human acts.

Current wallet/DAO commands:

- `/wallet status`
- `/dao <goal>`
- `/wallet audit`
- `/dao audit <goal>`

These commands save evidence and guidance only. They do not perform wallet actions.

## 9. Living Archive / LLM Wiki

The Living Archive is the default memory-system add-on and follows the LLM Wiki pattern.

The core idea:

- Raw sources are preserved.
- AI-generated markdown wiki pages are created and maintained separately.
- A schema tells the AI how to structure the wiki.
- The wiki compounds over time instead of rediscovering knowledge from raw files on every query.

Current memory architecture:

```text
ResonantOS_User/Memory
+-- Human Knowledge
+-- External Knowledge
+-- AI Memory
|   +-- wiki
|       +-- AGENTS.md
|       +-- index.md
|       +-- log.md
|       +-- generated wiki pages
+-- REVIEW
|   +-- requests
|   +-- artifacts
|   +-- verifications
+-- intake/source artifacts
```

Memory domains:

- Human Knowledge: user-owned identity, notes, thinking, personal knowledge
- External Knowledge: research, business documents, meeting transcripts, third-party material
- AI Memory: AI-curated wiki pages, synthesis, system memory, and trusted generated knowledge
- Mixed Library: staging state for folders/vaults that contain mixed material

Current capabilities:

- connect folders or Obsidian vaults
- copy-on-import by default
- guarded move-on-import with preflight, confirmation, audit, and rollback
- source scanning and supported-file detection
- source versioning and immutable snapshots
- raw intake artifact creation
- review request queue
- draft wiki-update artifact creation
- deterministic and optional provider-backed ingest writing
- verifier gate before promotion
- section-aware markdown merge on promotion
- index and log maintenance
- wiki health/lint checks
- duplicate index detection
- review queue UI with inspect-source, draft, verify, revise, promote, and restore flows
- MCP/local memory service path for external agents
- third-party memory-provider contract test path

Important boundary:

- Add-ons may read scoped archive views and write raw intake when granted.
- Add-ons do not write trusted wiki pages directly.
- Trusted wiki memory is written only through the controlled draft, verify, promote path.

Human workload principle:

- The human should not be forced to approve every routine memory update.
- Routine verification can be handled by a Strategist-owned verifier model.
- Human review is reserved for high-risk, doctrine-sensitive, ambiguous, low-confidence, destructive, or escalated cases.

Obsidian:

- Obsidian is optional.
- If installed as an add-on, it can be used as a human-friendly way to manage markdown sources and the vault.
- Non-Obsidian folders should use Obsidian-compatible markdown conventions where practical.

## 10. Workspaces

Workspaces are the central areas inside the main browser workspace.

Current workspace families:

- Main Chat: full-page Augmentor conversation
- Browser Jobs: active and historical Agent Control tasks
- Living Archive: memory source, intake, review, promotion, and search flows
- Add-ons: installed/available add-ons, capability status, draft packets, and handoffs
- Hermes: hosted Hermes dashboard/workspace and delegation status
- OpenCode: coding workspace/delegation target
- Artifacts: saved browser evidence, memory intake, reports, and previews
- Settings: profile, providers, memory, browser control, add-ons, appearance, security, diagnostics

Workspace design rule:

- The central column should show the selected tool clearly.
- If Hermes is open, the Hermes dashboard should fill the central workspace.
- Augmentor can remain available in the side panel or main workspace depending on context.

## 11. Projects, Chats, And History

The main workspace left rail is becoming the user's navigation layer.

Current capabilities:

- new chat
- search
- pinned chats/items
- projects
- recent chats
- chat pin/unpin
- chat fork
- chat delete/archive
- project create
- project pin/unpin
- project rename/delete/archive
- drag/drop chats into and out of projects

Product meaning:

- Chats are conversations.
- Projects are folders/workspaces that can hold chats, artifacts, and code-related work.
- Pinned Add-ons are not projects and should be labeled separately.

UX direction:

- keep item names legible
- show row actions on hover
- keep actions close but not visually dominant
- make pin, fork, delete, and project movement discoverable without cluttering the rail

## 12. Delegation: Hermes And OpenCode

Augmentor should be able to delegate work without making delegated agents trusted core agents.

Current delegation model:

- Augmentor receives the user request.
- ResonantOS turns delegation into a governed packet.
- The target add-on receives bounded task context.
- The add-on returns status, artifacts, or blockers.
- Augmentor reports the result to the human.
- Artifacts can enter Living Archive intake, not trusted wiki memory directly.

Hermes current direction:

- Hermes workspace can open inside the central column.
- Natural prompts like "ask Hermes..." or `/hermes` can create delegation packets.
- Real Hermes execution is explicit opt-in.
- Hermes status includes CLI detection, grant state, dashboard state, task counts, and next action.

OpenCode current direction:

- OpenCode can be a coding delegation target.
- Work should be scoped to the repository/workspace boundary.
- Artifacts are reviewable.
- Real local execution is opt-in and capability-gated.

Important rule:

- Hermes, OpenCode, and future agents are add-ons. They do not bypass provider, memory, wallet, filesystem, or credential boundaries.

## 13. Add-on Platform

ResonantOS should be modular. The default Augmentor Chat and Living Archive should be replaceable.

Current add-on principles:

- add-ons declare capabilities
- ResonantOS grants and mediates access
- curated add-ons can have recommended grants but remain reviewable
- sideloaded add-ons are not trusted by default
- add-ons can expose UI workspaces, side panels, background tasks, agents, channels, or local services
- add-ons can write intake artifacts only when granted
- add-ons cannot write trusted memory or access raw credentials by default

Current add-on work:

- add-on workspace
- add-on status/cards
- capability chips
- Hermes and OpenCode add-on surfaces
- email/calendar draft-only add-on commands
- reference memory-provider add-on path

Known direction:

- The SDK should keep moving toward clear manifest contracts, typed capabilities, install/enable/disable lifecycle, and deterministic tests.

## 14. Settings

Settings should be the place where the user configures the system without reading internal architecture.

Current/target Settings sections:

- Profile: user details, display identity, default Augmentor name, system prompt
- Providers: provider accounts, model profiles, credentials, health checks
- Routing: primary/fallback model strategy, cost posture, workload strategy
- Memory: active memory add-on, Living Archive source folders/vaults, sync policy
- Browser Control: site permissions, task consent, safety policy
- Add-ons: installed add-ons, grants, status, workspace surfaces
- Skills/Plugins: available skills and tools Augmentor can call
- Chats/Projects: archive, restore, project management
- Security/Wallet: wallet boundaries, key/custody settings, future vault controls
- Diagnostics: bridge, browser, provider, memory, and add-on health
- Appearance: UI density, theme, text size, touch behavior
- About: version, branch/build info, docs links

UX rule:

- Settings should show the most important status and actions first.
- Advanced details should exist but not dominate the page.

## 15. Security And Trust Boundaries

ResonantOS must be designed as a security-conscious AI browser, not as an automation toy.

Current core boundaries:

- Provider secrets are stored under the user secrets root and should not be exposed to page JavaScript or add-ons.
- The bridge requires a session token and restricted CORS in preview mode.
- Production wallet/DAO readiness requires replacing the preview token bridge with native messaging, signed IPC, or equivalent authenticated browser-shell IPC.
- Add-ons get explicit capability grants.
- Browser actions use typed mediated tools.
- Wallet, payment, login, credential, signing, and public-submit actions are blocked or approval-gated.
- Living Archive trusted memory writes require draft, verification, and promotion.
- Browser evidence enters memory as intake first, not trusted knowledge.

Known pre-release security gate:

- The current local HTTP bridge/token design is acceptable for local internal preview, but not sufficient for public wallet/DAO release. The stronger path is native messaging, signed IPC, or an equivalent authenticated channel between the browser shell and trusted ResonantOS host services.

## 16. Current Known Limits

The app is not a final consumer product yet.

Known limits:

- Browser-first is the active product path but still preview-grade.
- Provider health UI still needs clearer live availability, quota, and fallback explanations.
- Full end-to-end AI browser tasks need more real-world scenario testing.
- Phantom is loaded/pinned, but wallet actions remain human-only and need more dApp fixture coverage before public release.
- Living Archive is architecturally complete for V1, but still needs real-data validation at scale and more UI simplification.
- Hermes/OpenCode production delegation is partly wired and needs deeper end-to-end operational testing.
- Add-on SDK needs more packaging, signing, registry, and third-party developer documentation.
- Settings is improving but still needs a cleaner hierarchy and lower information density.
- Touch-screen compatibility is a design requirement, but not every UI has been fully touch-audited.
- Some full test-suite runs may be affected by parallel fork work; release validation should be run from a clean worktree.

## 17. Detailed Feature List

### Browser-First Host

What it does:

- Runs ResonantOS as a browser app, not a web dashboard.
- Loads the ResonantOS extension and Phantom extension in the same profile.
- Provides normal browser interaction for the human.

Why it matters:

- Wallets, web apps, and AI control need one shared browser session.

Current status:

- Implemented as the browser-first preview host.
- Installed locally with `npm run browser-first:install`.
- Verified with browser-first launch and desktop verification scripts when run from a normal desktop environment.

### Main Workspace Chat

What it does:

- Provides a full-page AI workspace for starting conversations, asking questions, and launching browser/control/delegation work.

Why it matters:

- The user needs a strong central place to work with Augmentor, not only a narrow side panel.

Current status:

- Implemented and active on new tab/startup.
- Still being refined for Perplexity/Comet-level UX.

### Side Panel Chat

What it does:

- Keeps Augmentor next to the current web page.

Why it matters:

- The human can keep browsing while Augmentor reads, explains, saves, or acts on page context.

Current status:

- Implemented with page-aware tools and browser job monitor.

### Agent Control Mode

What it does:

- Lets Augmentor operate safe browser actions through a governed observe-act-verify loop.

Why it matters:

- This is the core "super AI browser" capability.

Current status:

- Implemented with overlays, durable jobs, approval gates, action validation, and tests.
- Needs ongoing real-site hardening.

### Provider Fabric

What it does:

- Routes AI requests through the right configured model/provider for each workload.

Why it matters:

- The best model is not always the right model; user cost, subscription, latency, and availability matter.

Current status:

- Implemented in browser-first host layer with MiniMax M3, OpenAI routes, local runtime concepts, auto/manual routing, and fallback logic.

### Living Archive

What it does:

- Turns raw sources into an AI-maintained markdown wiki through intake, draft, verify, and promote.

Why it matters:

- Knowledge compounds instead of being rediscovered from raw documents every time.

Current status:

- V1 architecture implemented.
- Needs more real-world validation and UI simplification.

### Projects And Chat History

What it does:

- Organizes chats and work into projects, pinned items, and recent history.

Why it matters:

- A browser AI workspace needs durable working context, not disposable chat tabs only.

Current status:

- Implemented basics: create, pin, fork, delete/archive, drag/drop.
- UX is still being refined.

### Hermes Delegation

What it does:

- Lets Augmentor delegate suitable work to Hermes as an add-on.

Why it matters:

- Long-running agentic work should be delegated while Augmentor stays the strategist and user-facing controller.

Current status:

- Partly implemented with governed packets, workspace, runtime status, and opt-in execution.
- Needs deeper production validation.

### OpenCode Delegation

What it does:

- Lets Augmentor delegate coding tasks to OpenCode as an add-on.

Why it matters:

- Coding work can be done by a specialized coding agent while Augmentor coordinates.

Current status:

- Partly implemented with scoped packets and artifact return.
- Needs deeper production validation.

### Add-on Platform

What it does:

- Allows community and internal modules to extend ResonantOS.

Why it matters:

- ResonantOS must be modular and replaceable, not locked to one vendor or one default AI tool.

Current status:

- Manifest/capability direction exists.
- Workspace/status surfaces exist.
- SDK needs more packaging, examples, signing, and developer-facing docs.

### Wallet / DAO Helpers

What it does:

- Reads wallet/DAO context and prepares safe instructions or audit artifacts.

Why it matters:

- Web3 work is high-risk and needs strict human approval boundaries.

Current status:

- Detection and read-only workflow helpers exist.
- Signing/voting/transaction automation is intentionally blocked.

### Email / Calendar Draft Connectors

What it does:

- Creates draft packets and handoff links for Gmail/Google Calendar.

Why it matters:

- Useful productivity actions can start in ResonantOS while final send/schedule remains human-reviewed.

Current status:

- Draft-only, human-handoff implemented.
- No automated sending or scheduling.

## 18. Next Implementation Backlog

This is the current recommended next-work list.

### 1. Stabilize Provider Health And Auto Routing

Goal:

- Make provider status obvious to the user.

Needed work:

- show `configured`, `healthy`, `quota-limited`, `credential-missing`, `network-failed`, and `unavailable`
- expose which model actually answered
- show when fallback happened and why
- keep manual model selection strict
- keep automatic routing cost-aware

### 2. Improve Comet-Level Agent Control

Goal:

- Make Augmentor feel like a capable AI browser operator, not a command parser.

Needed work:

- improve page understanding for complex sites
- strengthen natural language task planning
- improve multi-step research synthesis
- expand visible action timeline quality
- add more deterministic real-site fixtures
- keep wallet/payment/login boundaries strict

### 3. Finish Main Workspace UX

Goal:

- Make the full-page workspace feel like a polished AI app.

Needed work:

- refine left rail density, pin/fork/delete/project actions
- improve project workflows
- make main chat and side-panel chat share one source of truth
- improve empty states and onboarding
- add clearer follow-up suggestions and source/result cards

### 4. Harden Living Archive At Scale

Goal:

- Prove LLM Wiki memory with real user folders and large source sets.

Needed work:

- test against the full ResonantOS Base knowledge folder
- improve source classification and user explanations
- add better import progress and failure recovery
- improve review queue clarity
- add more attachment pipelines
- continue simplifying the default UI

### 5. Make Hermes Delegation Production-Useful

Goal:

- Let Augmentor reliably delegate to Hermes without the user managing the integration manually.

Needed work:

- real runtime detection and setup flow
- clear permission grant UI
- task lifecycle with logs, artifacts, status, cancel, retry
- better handoff result summaries
- stronger error recovery

### 6. Make OpenCode Delegation Production-Useful

Goal:

- Let Augmentor delegate coding tasks safely.

Needed work:

- workspace-scoped code permissions
- artifact and diff review
- safe execution boundaries
- status and result replay
- avoid raw shell access from chat

### 7. Finish Add-on SDK And Registry

Goal:

- Let other developers build add-ons without reverse-engineering the app.

Needed work:

- complete manifest reference
- example add-ons
- capability grant docs
- signing/provenance model
- sideload flow
- curated registry flow
- local service contract

### 8. Replace Preview Bridge Before Public Wallet Release

Goal:

- Remove the preview security weakness.

Needed work:

- native messaging, signed IPC, or equivalent authenticated browser-shell channel
- no unauthenticated localhost control plane
- stronger audit trail for privileged actions
- wallet/DAO release security review

### 9. Package And Cross-Platform Release

Goal:

- Make ResonantOS installable and testable on macOS, Windows, and Linux.

Needed work:

- clean build matrix
- signed/notarized macOS path
- Windows installer
- Linux packaging strategy
- deterministic launch verification
- CI gates from clean branches

## 19. Development Commands

Run browser-first development app:

```bash
npm run browser-first:dev
```

Install the local macOS app:

```bash
npm run browser-first:install
```

Verify installed browser-first app:

```bash
npm run browser-first:verify-installed
```

Run browser-first deterministic tests:

```bash
npm run test:browser-first
```

Run live browser control tests:

```bash
npm run test:browser-first-live
```

Run production build:

```bash
npm run build
```

Run native browser verification:

```bash
npm run browser-native:verify-live
```

Final desktop proof command:

```bash
npm run browser-first:prove-desktop
```

Note:

- Desktop verification commands must be run from a normal desktop session, not from a sandbox that blocks localhost/AppKit observation.
- Release validation should happen from a clean branch/worktree because parallel development forks can affect full-suite results.

## 20. Where To Look In The Code

Browser-first app:

- `browser-first/README.md`
- `browser-first/host/run-browser-first.mjs`
- `browser-first/host/bridge-server.mjs`
- `browser-first/resonantos-side-panel-extension/src/main-workspace.html`
- `browser-first/resonantos-side-panel-extension/src/main-workspace.js`
- `browser-first/resonantos-side-panel-extension/src/main-workspace.css`
- `browser-first/resonantos-side-panel-extension/src/side-panel.html`
- `browser-first/resonantos-side-panel-extension/src/side-panel.js`
- `browser-first/resonantos-side-panel-extension/src/side-panel.css`
- `browser-first/resonantos-side-panel-extension/src/content.js`
- `browser-first/resonantos-side-panel-extension/src/background.js`

Provider routing:

- `browser-first/host/provider-fabric-core.mjs`
- `browser-first/test/provider-fabric-core.test.mjs`
- `browser-first/test/chat-turn-controller.test.mjs`

Living Archive:

- `browser-first/host/memory-schema.mjs`
- `browser-first/host/memory-search.mjs`
- `browser-first/host/memory-ingest-writer.mjs`
- `browser-first/host/memory-ingest-draft.mjs`
- `browser-first/host/archive-review-policy.mjs`
- `browser-first/host/archive-promotion-policy.mjs`
- `browser-first/host/memory-wiki-health.mjs`
- `browser-first/host/memory-source-move.mjs`

Agent control and browser jobs:

- `browser-first/test/agent-control-runner.test.mjs`
- `browser-first/test/control-step-executor.test.mjs`
- `browser-first/test/browser-job-store.test.mjs`
- `browser-first/test/browser-job-scheduler.test.mjs`
- `browser-first/test/browser-page-actions.test.mjs`

Main workspace tests:

- `browser-first/test/main-workspace-rail.test.mjs`
- `browser-first/test/main-workspace-settings.test.mjs`
- `browser-first/test/main-workspace-memory.test.mjs`
- `browser-first/test/main-workspace-hermes.test.mjs`
- `browser-first/test/main-workspace-opencode.test.mjs`
- `browser-first/test/main-workspace-browser-jobs.test.mjs`

Architecture docs:

- `docs/architecture/ADR-037-browser-first-chromium-resonantos.md`
- `docs/architecture/ADR-026-minimal-kernel-replaceable-default-addons.md`
- `docs/architecture/ADR-027-living-archive-llm-wiki-compliance.md`
- `docs/architecture/ADR-005-provider-fabric-routing.md`
- `docs/architecture/ADR-006-addon-runtime-sdk.md`
- `docs/architecture/ADR-007-living-archive-boundaries.md`
- `docs/architecture/ADR-008-wallet-web3-security.md`

## 21. Documentation Rule Going Forward

When a feature changes, update the nearest source of truth in the same change:

- Product behavior or feature status: update this guide.
- Binding architecture decision: update or add an ADR.
- Browser-control capability parity: update `browser-first/COMET_PARITY_BACKLOG.md`.
- Release/validation checkpoint: update `docs/PROJECT_STATUS.md`.
- User-facing setup/run behavior: update `browser-first/README.md` or `browser-first/host/README.md`.

Do not let code, tests, and documentation drift apart. ResonantOS depends on the AI and future contributors understanding the real system that exists, not an outdated mental model.
