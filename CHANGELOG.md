# Changelog

All notable changes to this project are documented here.

The format is inspired by [Keep a Changelog](https://keepachangelog.com/), and
this project adheres to [Semantic Versioning](https://semver.org/) once a stable
release is published.

## [0.1.0] — 2026-06-02

This is the initial public source preview of ResonantOS vNext. The active
product direction is **browser-first** (per ADR-037). The older Tauri desktop
shell is retained as a feature reservoir.

### Added

#### Browser-First App (primary product path)

- **Browser agent control layer** — Augmentor can read page context, click
  visible controls by text, type into editable fields, submit search-like
  fields, and scroll pages through content-script mediation
  ([`589c6bd`](https://github.com/ResonantOS/2.0.0-alpha/commit/589c6bd)).
- **Durable browser job monitor** — tracks running browser tasks with pause,
  continue, and replay capabilities
  ([`adc3bfb`](https://github.com/ResonantOS/2.0.0-alpha/commit/adc3bfb),
  [`19d5488`](https://github.com/ResonantOS/2.0.0-alpha/commit/19d5488)).
- **Browser task consent boundary** — scoped consent with history manager;
  sensitive actions (wallet, login, payment, posting, signing) require explicit
  human approval
  ([`94d200c`](https://github.com/ResonantOS/2.0.0-alpha/commit/94d200c),
  [`037ae53`](https://github.com/ResonantOS/2.0.0-alpha/commit/037ae53),
  [`255239f`](https://github.com/ResonantOS/2.0.0-alpha/commit/255239f)).
- **Browser agent control overlay** — persistent on-page overlay showing agent
  state, progress, and stop/resume controls
  ([`1630106`](https://github.com/ResonantOS/2.0.0-alpha/commit/1630106),
  [`77484a1`](https://github.com/ResonantOS/2.0.0-alpha/commit/77484a1),
  [`256f3fd`](https://github.com/ResonantOS/2.0.0-alpha/commit/256f3fd)).
- **Browser chat workspace** — main workspace with chat composer, conversation
  threads, and agent switching
  ([`5cf785e`](https://github.com/ResonantOS/2.0.0-alpha/commit/5cf785e),
  [`b418024`](https://github.com/ResonantOS/2.0.0-alpha/commit/b418024)).
- **Hermes dashboard workspace** — embedded within the browser app
  ([`46347bf`](https://github.com/ResonantOS/2.0.0-alpha/commit/46347bf),
  [`3f278a1`](https://github.com/ResonantOS/2.0.0-alpha/commit/3f278a1)).
- **Browser app install & keyboard shortcuts**
  ([`8e34722`](https://github.com/ResonantOS/2.0.0-alpha/commit/8e34722)).
- **Browser-first bridge boundary** — Mediated IPC between the extension side
  panel and local host services
  ([`4d6cad9`](https://github.com/ResonantOS/2.0.0-alpha/commit/4d6cad9)).

#### Living Archive

- **Single file intake** — import files into the Living Archive with content
  hashing and deduplication
  ([`1d0b89a`](https://github.com/ResonantOS/2.0.0-alpha/commit/1d0b89a)).
- **Source snapshots & version recording** — content-addressed storage with
  integrity verification before reuse
  ([`7950500`](https://github.com/ResonantOS/2.0.0-alpha/commit/7950500),
  [`987bfcf`](https://github.com/ResonantOS/2.0.0-alpha/commit/987bfcf)).
- **Move import with audit trail** — directory-safe move imports, partial
  rollback with preserved source files, preflight fingerprinting, and full
  rollback failure reporting
  ([`28f4009`](https://github.com/ResonantOS/2.0.0-alpha/commit/28f4009)
  through [`b17bb21`](https://github.com/ResonantOS/2.0.0-alpha/commit/b17bb21)).
- **Artifact review queue** — browser captures are routed through a review
  handoff before promotion to memory
  ([`a839d39`](https://github.com/ResonantOS/2.0.0-alpha/commit/a839d39),
  [`cc8be6d`](https://github.com/ResonantOS/2.0.0-alpha/commit/cc8be6d),
  [`28eb8f0`](https://github.com/ResonantOS/2.0.0-alpha/commit/28eb8f0)).
- **Memory workspace DOM helpers** — extract side panel DOM contract and memory
  workspace infrastructure
  ([`151d585`](https://github.com/ResonantOS/2.0.0-alpha/commit/151d585),
  [`8b51ffb`](https://github.com/ResonantOS/2.0.0-alpha/commit/8b51ffb),
  [`4b11168`](https://github.com/ResonantOS/2.0.0-alpha/commit/4b11168)).

#### Add-on SDK & Architecture

- **Typed public contracts** — interfaces for add-ons, providers, capabilities,
  channels, workspaces, and shell state (`src/core/contracts.ts`).
- **Provider fabric** — routing, cost estimation, and fallback policies for
  MiniMax, OpenAI, OpenAI-compatible, and local LLM providers
  (`src/core/defaults.ts`, `src/core/policies.ts`).
- **Add-on registry & validation** — manifest validation, capability grants,
  and registry helpers (`src/sdk/addons/`).
- **Resonant Engineer** — kernel-owned caretaker agent for setup, repair,
  provider configuration, and recovery (`src/core/defaults.ts`).
- **MCP bridge examples** — Living Archive memory-service and MCP bridge
  (`examples/`).

#### Infrastructure

- Vite + React 19 + TypeScript dev environment.
- Vitest test runner with jsdom and Playwright support.
- Tauri 2 desktop shell (legacy, pinned Rust 1.94.1).
- GitHub Actions alpha-build workflow.

### Changed

- Product direction shifted from **desktop-first** (Tauri) to **browser-first**
  (Chromium-native) per ADR-037.
- Provider defaults updated to MiniMax M3 model family
  ([`50d804f`](https://github.com/ResonantOS/2.0.0-alpha/commit/50d804f)).
- Side panel architecture extracted into modular controllers: composer, chat
  turn, message actions, tab context, control planning, step execution, and
  reporting services.

### Fixed

- Browser chat composer keyboard shortcuts
  ([`59847bf`](https://github.com/ResonantOS/2.0.0-alpha/commit/59847bf),
  [`fd637b4`](https://github.com/ResonantOS/2.0.0-alpha/commit/fd637b4)).
- Browser chat clipboard handling and status dock
  ([`eb181e9`](https://github.com/ResonantOS/2.0.0-alpha/commit/eb181e9)).
- Agent control overlay debounce timing
  ([`cdcad4b`](https://github.com/ResonantOS/2.0.0-alpha/commit/cdcad4b)).
- Rail navigation workspace state
  ([`a42b816`](https://github.com/ResonantOS/2.0.0-alpha/commit/a42b816)).
- Source intake self-test reporting
  ([`5e6d87a`](https://github.com/ResonantOS/2.0.0-alpha/commit/5e6d87a)).
- Browser-first side panel control routing
  ([`2069221`](https://github.com/ResonantOS/2.0.0-alpha/commit/2069221)).

### Known Issues

- Linux x86_64 (Haswell) native Tauri packaging is blocked by a rustc LLVM
  compiler ICE when compiling the GTK dependency path. Workaround: use Rust
  `1.94.1` or GitHub CI artifacts.
- Vite reports a large chunk warning during production build (cosmetic).
- macOS builds are unsigned — Gatekeeper warnings expected.

---

The format of this changelog is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
