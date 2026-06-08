# ResonantOS 2.0.0-alpha — Team Status Report
## June 8, 2026

---

## TL;DR

**ResonantOS 2.0.0-alpha is a working desktop + browser app.** 167K lines of code, 229 commits, 440 tests passing, 37 architecture decision records. The core is solid. The security has been hardened. It's ready for community alpha testing.

---

## What Is ResonantOS?

A desktop AI operating system. Not a chatbot. Not a dashboard. An actual OS-like shell where AI assistants, tools, memory, and the web all live together — owned by the user, not a cloud service.

Three ways to run it:
1. **Browser-first** (primary) — Chromium app with ResonantOS as a side panel extension
2. **Tauri desktop** — Native macOS/Linux/Windows app (most mature, all features)
3. **Electron** — For wallet/extension support (Phantom, etc.)

---

## The Numbers

| Metric | Count |
|--------|-------|
| Total lines of code | 167,000 |
| Commits | 229 |
| Frontend tests (vitest) | 296 passing |
| Rust tests (cargo) | 144 passing |
| Architecture Decision Records | 37 |
| React modules | 17 |
| Rust host services | 19 |
| Test files | 150 |
| GitHub issues created | 141 |
| Issues closed | 85 |
| Issues open | 56 (4 P0, 25 P1, 21 P2, 6 P3) |

---

## Who Built This

### Core Team

**Manolo Remiddi** — Lead architect and primary developer. 205 of 229 commits. Built the entire foundation: Tauri shell, React UI, Rust host services, Living Archive, provider fabric, add-on SDK, delegation fabric, recovery mode, browser-first architecture, chat rail, context compaction, and the Augmentor chat interface. Wrote all 37 ADRs. The architecture is his.

**Tom Pennington (Dr. Tom)** — Product vision, direction, and hands-on development. 24 commits. Defined the product direction (browser-first, not dashboard), the no-lock-in kernel philosophy (ADR-026), the Hot Rod Rig methodology, and drives all strategic decisions. Built the Resonant Context SDK and key browser-first features.

### Contributors

**Vlad (vrondelli)** — Security pipeline design and implementation. Built a registry-driven CI security control plane: check registry, runner CLI, and lockfile adapter. Also produced a comprehensive QA-SECURITY-REPORT with line-by-line Rust source audit. PR guide ready for his work to merge.

**Analog 6 (AI agent)** — Orchestration, code review, security hardening, documentation. Operation Nightwatch (June 7-8): 20 commits, 17 security/correctness fixes, 3 deep-read code reviews, Hot Rod Rig v4 documentation.

### Community Contributors & Influences

**Victor** — CRABS state machines. His question ("Can source-code knowledge enable config/user-data manipulation?") inspired the red team security methodology.

**Evans (Frumu/Tandem)** — Authority layer concept for governed agent execution.

**Chris (Resonant-Jones)** — Persona model pattern (Codexify/Whoosh'd broker), context broker concept, KV cache persistence design.

**Z7Lab** — Structured reviewer persona specifications with checklists.

**Safi Shamsi** — Graphify knowledge graph tool for codebase structural analysis.

---

## What's Built and Working

### Core Shell
- Three-zone layout: left app launcher rail, central workspace, right AI chat rail
- Workspace switching between all modules
- Responsive design with mobile breakpoints
- Theme support (dark mode)
- Persistent state across sessions

### Augmentor Chat (Default AI Interface)
- Multi-thread chat with history
- Markdown rendering
- Message actions: copy, fork, edit, regenerate, delete, save to archive
- Context budget tracking with compaction
- Provider switching from composer
- Model and thinking depth selection
- Voice input affordance
- Works in both side panel and main workspace

### Living Archive (Default Memory System)
- SQLite-backed document archive
- Full-text search + semantic search
- Document intake with review queue
- Semantic lint and repair
- Background maintenance cycles
- Source folder scanning and auto-ingest
- MCP bridge for external tool integration
- AI memory service with domain-scoped retrieval

### Provider Fabric
- Multi-provider routing (MiniMax, OpenAI, local models)
- Fallback chains with configurable ordering
- Cost posture system (free-local, subscription, emergency-only)
- Credential validation in route selection
- Provider diagnostics and smoke testing
- Execution adapters for different provider APIs

### Add-on SDK v0
- Manifest-based add-on registration
- Capability grants with explicit user approval
- System slots: chat-interface, memory-system (replaceable defaults)
- Sideloading for development
- First-run setup flow

### Browser-First (ADR-037)
- CEF-based native browser host (ResonantOS Browser.app)
- MV3 side panel extension
- Bridge server with authenticated token delivery
- Agent browser control: read page, click, type, scroll, submit
- Approval gates for wallet/payment/credential actions
- Phantom wallet integration
- DAO workflow planning (read-only, human approval required)
- Email/calendar draft packets with Gmail/GCal handoff
- Resonant Context SDK (viewport awareness, dwell tracking, event collection)

### Delegation Fabric
- Task packet creation with structured specs
- Task workspace isolation
- Result verification and audit trail
- Delegation monitor UI

### Recovery Mode
- Bounded repair loop
- Route candidate probing
- Engineer agent for setup/repair
- Independent from chat add-on

### Additional Modules
- **Obsidian** — Read-only vault bridge with clean-room notes, search, tags, wikilinks, backlinks
- **OpenCode** — Optional coding add-on host (detects/launches opencode sessions)
- **Paperclip** — Organizational runtime add-on (loopback endpoint, issue mapping)
- **Hermes** — Communication channel add-on (330 lines, functional)
- **Browser** — CDP-based sessions (URL, screenshot, read page, close)
- **Compute** — Local runtime status, passive diagnostics
- **Terminal** — Embedded terminal workspace
- **Audio2TOL** — Audio pipeline workspace
- **Settings** — Provider config, diagnostics, add-on management

---

## Security Hardening (Operation Nightwatch, June 7-8)

17 security and correctness fixes applied in one night:

### Critical (Fixed)
1. **Codex sandbox bypass removed** — Was shelling out with `--dangerously-bypass-approvals-and-sandbox`
2. **Renderer can't self-grant capabilities** — `save_runtime_state` now filters security fields
3. **Bridge tokens off disk** — Capability tokens delivered via authenticated endpoint only
4. **Real CSP set** — Was `"csp": null` (no policy at all)
5. **CEF sandbox enforced** — Was disabled in production C++ code
6. **Credentials vaulted** — Renderer stores opaque markers, not raw API keys

### Correctness (Fixed)
7. Route resolver validates credentials before selecting provider
8. Fallback chains reordered (local is last resort, not before cloud)
9. Cost posture wired into routing (was cosmetic only)
10. Archive preflight race condition fixed
11. Browser webview errors logged (were silently swallowed)

### Architecture (Fixed)
12. Kernel types no longer hardcode add-on names (dynamic section IDs)
13. CI exercises browser-first test suite
14. CI packages browser-first extension as artifact
15. Obsidian read commands gated by capabilities
16. Extension background.js validates message sender
17. Credential validation in fallback chains

### Verified By
Three independent code reviewers (security, architecture, browser/build) — 1,054 lines of analysis in `docs/reviews/`.

---

## What's Open (56 Issues)

### P0 — Blocks Release (4 issues)
| # | Issue | Status |
|---|-------|--------|
| 86 | Vitest CVE upgrade | ✅ Code done, issue needs closing |
| 87 | Bridge token split | ✅ Code done, issue needs closing |
| 92 | New tab opens main workspace | Open |
| 121 | macOS Developer ID signing | Open (needs Apple Dev account) |

**Note:** #86 and #87 were fixed in Operation Nightwatch but the GitHub issues haven't been closed yet.

### P1 — Important (25 issues)
Includes: browser-first/desktop build path separation, test coverage gaps, add-on lifecycle improvements, Electron host parity, provider credential rotation, and various UX refinements.

### P2 — Nice to Have (21 issues)
Includes: wallet/DAO acceptance tests, Hermes deepening, Obsidian write improvements, delegation failure recovery, shell navigation edge cases.

### P3 — Future (6 issues)
Includes: Resonant Notes clean-room workspace, email/calendar full connectors, recursive MAS runtime, compute fabric scaling.

### From Review (Not Yet Filed as Issues)
10 additional items identified by the Nightwatch review:
- audioCapture permission should be dynamic
- Capability token TTL/expiry needed
- npm audit step in CI (Vlad's pipeline covers this)
- electron-host tests in CI
- App.tsx extract ~600 lines to hook
- contracts.ts type splitting to modules
- Keychain integration for API keys
- Sideload path restriction
- ADR-026 migration comments
- Vite chunk size warning

---

## Architecture Overview (Simple Version)

```
┌──────────────────────────────────────────────────┐
│              ResonantOS Shell                     │
│  (React UI — 17 modules, 52K lines TypeScript)   │
├──────────────────────────────────────────────────┤
│              Core Services                        │
│  Chat, Archive, Provider, Delegation, Recovery    │
│  Add-on SDK, Compute, Memory, Browser, Terminal   │
├──────────────────────────────────────────────────┤
│              Rust Host (Tauri)                    │
│  19 services, 29K lines Rust                      │
│  IPC boundary, state management, capability gates │
├──────────────────────────────────────────────────┤
│              Host Surfaces                        │
│  Tauri (native) | Electron (wallet) | Browser-First (Chromium) │
└──────────────────────────────────────────────────┘
```

**Key principle:** ResonantOS is NOT an OpenClaw dashboard. OpenClaw is one possible add-on. The kernel is minimal: shell, engineer agent, add-on registry, provider fabric, secure state, audit log. Everything else (chat, memory, browser, tools) is a replaceable add-on.

---

## The Hot Rod Rig (How We Work)

Our quality assurance system: **14 independent AI lenses reviewing code in parallel.**

5 layers:
1. **Orchestrator** — Strategy, task decomposition, verification
2. **CLI Engines** — Codex, Claude Code, Pi/DeepSeek, Gemini (parallel execution)
3. **Desktop Engines** — Cursor, Antigravity, Claude Desktop (full project context)
4. **Subagent Reviewers** — Security, Architecture, Browser/Build (deep-read investigation)
5. **CI Security Pipeline** — Vlad's automated supply-chain scanning

Proven result: Found and fixed 17 issues in one night. No single engine found more than 4/12 issues alone. Triangulation found all of them.

Full documentation: `docs/THE-HOT-ROD-RIG-V4.md`

---

## What's Next

### Immediate (This Week)
1. Close GitHub issues #86 and #87 (already fixed in code)
2. Fix #92 (new tab workspace default)
3. Merge Vlad's security pipeline PR (guide ready at `docs/VLAD-PR-GUIDE.md`)
4. Finish remaining 5 security pipeline adapters (npm-audit, rust-audit, actions-hardening, security.yml, dependency-review)

### Before Community Alpha Release
5. macOS Developer ID signing (#121)
6. Address the 10 review findings (audioCapture, token TTL, etc.)
7. Run full Hot Rod Rig review on final state
8. Tag v2.0.0-alpha release

### After Alpha
9. App.tsx refactor (extract useArchiveWorkspaceState hook)
10. contracts.ts type splitting to module directories
11. Keychain integration for API keys
12. Full COMET parity (port remaining Tauri features to browser-first)
13. Cross-platform packaging (Linux, Windows)

---

## Key Documents

| Document | Location | What It Is |
|----------|----------|-----------|
| README | `README.md` | Project overview and setup |
| Contributing | `CONTRIBUTING.md` | How to contribute |
| Changelog | `CHANGELOG.md` | What's changed |
| Project Status | `docs/PROJECT_STATUS.md` | Detailed technical status |
| Feature Inventory | `docs/FEATURE_INVENTORY_2026-05-26.md` | Complete feature list |
| Hot Rod Rig v4 | `docs/THE-HOT-ROD-RIG-V4.md` | QA methodology |
| Security Reviews | `docs/reviews/` | Three independent code audits |
| Red Team Report | `SECURITY-RED-TEAM-REPORT.md` | Attack surface analysis |
| Vlad's PR Guide | `docs/VLAD-PR-GUIDE.md` | How to merge security pipeline |
| Architecture | `docs/architecture/ADR-*.md` | 37 architecture decisions |

---

## Discussion Points for Today

1. **P0 #92 (new tab default)** — Who picks this up?
2. **P0 #121 (macOS signing)** — Do we have an Apple Developer account?
3. **Vlad's PR** — Review and merge his security pipeline?
4. **Alpha distribution** — Who gets access first? Discord community? Invite-only?
5. **Three-shell convergence** — Tauri/Electron/Browser-First: what's the timeline to consolidate?
6. **Cross-platform** — Linux and Windows builds: priority or defer?

---

*Generated by the Hot Rod Rig v4 — 14-lens adversarial verification system.*
*Full commit history and review artifacts in the repository.*
