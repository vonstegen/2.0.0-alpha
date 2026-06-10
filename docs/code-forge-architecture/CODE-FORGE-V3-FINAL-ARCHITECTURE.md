# CODE FORGE v3 — FINAL ARCHITECTURE

**Panel Date:** 2026-06-02
**Panel Type:** HYPER Linus Panel — 11 world-class experts, final consolidation
**Status:** DEFINITIVE — This supersedes v1 and v2. No further panels.
**Inputs:** Codexify, CyberAlchemy (269 modules), Arcanum/Craft Method, Z7Lab Review Agents, CRABS Protocol, Hermes Agent (177K★), Crush/OpenCode, Plandex (15K★), Emdash (YC W26), cc-switch (89K★), Codegraph (38K★)

---

## 1. Executive Summary

Code Forge is a desktop coding environment built on a single architectural insight: **one entity wearing verified persona masks beats an army of agents**. A Guardian process — a FastAPI/Python sidecar inside a Tauri desktop shell — decomposes coding tasks, switches persona masks to execute them (backend coder, security reviewer, docs reviewer), and uses tag-partitioned memory for cross-domain awareness without context duplication. What makes it different from Cursor, Windsurf, Claude Code, Codex CLI, or Emdash: (1) the persona model eliminates multi-process overhead while preserving genuine perspective shifts via Z7Lab reviewer specifications, (2) CyberAlchemy's Lean 4 proofs formally verify what each persona can and cannot do — not policy files, mathematical proofs, (3) Arcanum's Craft Method provides a speed-governed development lifecycle (raw→typed→refined→proposed→resolved) that prevents agents from skipping validation steps, and (4) CRABS protocol gives attribute-based state machines where permissions auto-derive from project state, not static RBAC. The result is a coding environment where the AI doesn't just write code — it writes, reviews, verifies, and governs code with provable safety guarantees, shipping as a single downloadable binary.

---

## 2. The Stack

```
LAYER 0 — DESKTOP SHELL
  Tauri 2.x (Rust) — single binary, ~15MB, auto-updater
  Monaco Editor (VS Code engine) — code editing, LSP, syntax highlighting
  React + TypeScript frontend — panels, activity view, memory explorer
  WHY: Guillermo Rauch — "Ship a URL or a binary. Tauri is the binary answer.
       Electron is 200MB of Chromium. Tauri is 15MB."
  WHY: Bret Victor — "The editor and the running program must be the same surface.
       Monaco gives us the editor. Tauri gives us the surface."

LAYER 1 — GUARDIAN CORE (Single Entity)
  FastAPI (Python 3.12+) — Tauri sidecar process, port 8888
  Persona Engine — mask loading, switching, memory bias, tool scoping
  Campaign Manager — multi-step task decomposition and execution
  Git Worktree Manager — isolated workspaces per coding task
  LLM Provider Router — multi-model (OpenAI, Anthropic, DeepSeek, Groq, local)
  WHY: Linus Torvalds — "One process. One address space. Shared memory.
       The multi-process agent design was a distributed systems problem
       nobody needed to solve."
  WHY: John Carmack — "The latency budget for persona switching is zero.
       It's a system prompt swap and a memory query bias change.
       No IPC, no serialization, no process spawn. Sub-millisecond."

LAYER 2 — PERSONA MASKS
  Coder Masks: Backend (Python/Node/Go/Rust), Frontend (React/Next.js/TS), Schema (SQL/ORM)
  Reviewer Masks: Backend, Security, Silent Fallback, Docs, Frontend, Solidity (Z7Lab specs)
  Orchestrator Mask: task planning, mask selection, merge decisions
  Format: YAML persona definitions with JSON Schema validation
  WHY: Amjad Masad — "Replit's agent isn't 10 agents. It's one agent with
       different prompts for different phases. Chris's persona model is the
       same insight, made explicit and formal."
  WHY: Anthropic Applied Research — "Claude Code is one model with tool-use
       patterns that shift based on task phase. The persona mask is that pattern
       made configurable and verifiable."

LAYER 3 — MEMORY + STATE
  Tag-Partitioned Memory — SQLite + sqlite-vec (desktop) / PostgreSQL (team)
  Vector Embeddings — StarCoder2 for code, BGE-large for natural language
  Three-tier: ephemeral (session), midterm (project), longterm (cross-project)
  Tag bias: active persona's tags weighted 3× in retrieval, cross-domain at 1×
  CRABS State Machines — attribute-based permissions derived from project state
  WHY: Harrison Chase — "LangChain's memory is the weakest part of every chain.
       Tag-partitioned retrieval with persona bias is genuinely novel — it's
       contextual RAG without the R being random."
  WHY: Tobi Lütke — "Shopify's internal tools learned: memory that doesn't
       partition by role creates noise. Memory that hard-silos by role loses
       cross-cutting insights. Tags with bias is the right middle."

LAYER 4 — GOVERNANCE + VERIFICATION
  Arcanum Craft Method — SCU decomposition, recursive ledger, speed governor
  CyberAlchemy Proofs — AgenticFrame, SafetyBounds, DruidPermissions (Phase 2)
  CRABS Attribute Machines — state-driven permission grants with crypto proofs
  Z7Lab Findings Synthesizer — severity-ranked merge of reviewer outputs
  WHY: Nous Research — "Hermes Agent learned the hard way: self-improving agents
       without safety bounds are a liability. CyberAlchemy's Lean 4 proofs are
       the safety bound Hermes never had."
  WHY: Dane Sherburn — "Emdash runs 27 agents in parallel. The governance
       overhead is enormous. A speed governor that prevents agents from
       skipping steps would have saved us months of debugging."

LAYER 5 — DEVELOPER EXPERIENCE
  Activity Panel — live persona state, progress, diffs-in-flight
  Review Findings Panel — severity-ranked issues with inline code links
  Memory Explorer — browse tagged memories, see retrieval bias
  Campaign Timeline — visual task decomposition and progress
  Terminal Integration — embedded terminal with Guardian awareness
  WHY: Bret Victor — "If you can't see the state of the system while
       changing it, you're programming by faith. The activity panel
       must show exactly which persona is active and what it sees."
  WHY: Charm Team — "OpenCode's TUI proves developers want terminal-native
       tools. But a TUI alone caps your information density. Tauri lets you
       have the terminal AND rich panels."
```

---

## 3. What We Take From Each Input

### From Codexify (Chris Millan — Resonant-Jones/codexify-core)
| Component | Take? | Rationale |
|-----------|-------|-----------|
| FastAPI Guardian sidecar | ✅ **Fork + strip** | Core backend — remove Docker deps, keep API structure, port 8888 |
| React + Vite + TypeScript frontend | ✅ **Fork + rebuild** | Component architecture, but rebuilt for Tauri IPC instead of HTTP |
| SSE streaming from durable outbox | ✅ **Keep** | Reliable event delivery for activity panel updates |
| Three-tier memory (ephemeral/midterm/longterm) | ✅ **Keep + extend** | Add tag partitioning per persona on top of tiers |
| Plugin architecture (manifest-based) | ✅ **Keep** | Dynamic persona discovery — personas are plugins |
| Multi-provider LLM routing | ✅ **Keep** | Different personas can prefer different models |
| **Persona Architecture (Global Role + Masks)** | ✅ **CORE INSIGHT** | The architectural foundation. One entity, tagged memory, biased retrieval. |
| PostgreSQL + Redis + Neo4j | ❌ **Drop for MVP** | SQLite for desktop. Postgres for team mode (Phase 3). Redis eliminated by persona model. Neo4j deferred. |
| Docker Compose (10+ containers) | ❌ **Drop** | Single Tauri binary. No containers. |
| FAISS/ChromaDB | ❌ **Replace** | sqlite-vec is simpler, embedded, no external process |

### From CyberAlchemy (Vlad / Dylon La Rue — 269 modules, 2,334 theorems)
| Component | Phase | Rationale |
|-----------|-------|-----------|
| **AgenticFrame** | Phase 2 (weeks 5-8) | Formal capability declarations for each persona mask |
| **SafetyBounds** | Phase 2 | Proven limits on persona behavior — reviewer CANNOT write |
| **DruidPermissions** | Phase 2 | Capability-based access proofs for tool scoping |
| **DruidSprite + SpriteDispatch** | Phase 2 | Lightweight dispatch for concurrent persona LLM calls |
| **DecisionKernel** | Phase 2 | Orchestrator mask: formally optimal task decomposition |
| **AgenticRank** | Phase 2 | When multiple personas could handle a task, pick the best |
| **MetaCognition** | Phase 3 | Self-improving persona definitions within proven bounds |
| **SleepConsolidation** | Phase 2 | Context compaction between persona switches |
| **TopologicalFirewall** | Phase 2 | Prove reviewer personas can't reach external endpoints |
| **PostQuantumSecurity** | Phase 3 | Quantum-resistant credential storage for team mode |
| **CognitiveSecurity** | Phase 3 | Prompt injection defense with proven bounds |
| Remaining ~255 modules | Research | Mathematical foundations consumed implicitly by above |

**Linus Torvalds:** "269 modules, 2,334 theorems, zero sorry. That's the most impressive part — they actually proved it all. Most 'formally verified' projects are 80% sorry and 20% theorem."

### From Arcanum / Craft Method (Vlad — cyberAlchemyAI/Arcanum)
| Component | Take? | Rationale |
|-----------|-------|-----------|
| **SCU (Smallest Coherent Unit)** decomposition | ✅ **Core** | Optimal task decomposition for LLM work based on PCRA properties — Orchestrator mask uses this |
| **Recursive Ledger** (YAML-backed nested contexts) | ✅ **Core** | Campaign state tracking — each campaign is a ledger with artifacts, lifecycle, blockers |
| **Speed Governor** (raw→typed→refined→proposed→resolved) | ✅ **Core** | Prevents coding personas from skipping review. Agents CANNOT jump from raw to resolved. |
| **Three-tier epistemic model** (Formulae→Transmutations→Arcana) | ✅ **Adapt** | Maps to: deterministic tools → persona-bounded tasks → autonomous orchestration |
| **8 responsibility lanes** | ⚠️ **Simplify** | Collapse to 4 for MVP: tech, qa, governance, operations. Expand later. |
| **Experiment harness** (artifact-local validation) | ✅ **Keep** | Each persona's output validated in isolation before merge |
| **Bootstrap installer** (`tools/bootstrap_arcanum.sh`) | ✅ **Keep** | Arcanum Craft Method installs into any repo — Code Forge projects get it automatically |
| Sigils (reusable capabilities) | Phase 2 | Map to persona skill definitions |
| Spells (composed workflows) | Phase 2 | Map to campaign templates |

**Dane Sherburn:** "The speed governor is the single feature I wish Emdash had on day one. We had agents submitting PRs that skipped test phases because nothing stopped them. Arcanum's lifecycle enforcement is exactly right."

### From Z7Lab (code-review-agents — 6 instruction sets)
| Component | Take? | Rationale |
|-----------|-------|-----------|
| **Backend Reviewer** instruction set | ✅ **Persona mask system prompt** | Python/Flask/FastAPI/Django, Node.js, Go, Rust review |
| **Security Reviewer** instruction set | ✅ **Persona mask system prompt** | Auth flows, injection, SSRF, secrets, CORS, rate limiting |
| **Silent Fallback Detector** instruction set | ✅ **Persona mask system prompt** | Most underrated reviewer — catches swallowed exceptions, optional chaining abuse |
| **Docs Reviewer** instruction set | ✅ **Persona mask system prompt** | README quality, Diátaxis structure, staleness via git history, PII detection |
| **Frontend Reviewer** instruction set | Phase 2 persona | React, Next.js, TypeScript, accessibility |
| **Solidity Reviewer** instruction set | Phase 2 persona (conditional) | Smart contract security — only loads for Web3 projects |
| Severity-ranked findings format | ✅ **Findings Synthesizer input format** | All reviewers output same schema for unified findings panel |

**Anthropic Applied Research:** "The instruction sets are surprisingly well-calibrated. The Silent Fallback Detector in particular catches a class of bugs that most AI coding tools completely miss — the bug that doesn't crash, it just silently returns wrong data."

### From CRABS Protocol (Vlad — two PDFs)
| Component | Take? | Rationale |
|-----------|-------|-----------|
| **"Attributes are state" thesis** | ✅ **Core principle** | Permissions derived from project state, not static roles. Reviewer earns merge permission when review score crosses threshold. |
| **Attribute-Based State Machines** | ✅ **Phase 2** | Resource lifecycle: IDLE→LOCKED→MODIFIED→VERIFIED→IDLE with rollback |
| **Threshold triggers** | ✅ **Phase 2** | State-driven auto-promotion: review passes threshold → auto-approve merge |
| **Key versioning** (ABE keys from state version) | Phase 3 | Auto-invalidate permissions on attribute change — for team mode |
| **Dual privacy modes** (auditable / privacy-preserving) | Phase 3 | Mode A for open-source, Mode B for enterprise |
| **OT/CRDT hybrid types** | Phase 3 | Collaborative editing for team mode |
| **Post-quantum signatures** (Dilithium, Falcon) | Phase 3+ | Future-proof — integrates with CyberAlchemy PostQuantumSecurity |

**Harrison Chase:** "CRABS is the most interesting protocol in this stack. Attribute-based state machines where permissions auto-derive from project state solves a problem every agent framework punts on: how do you give an agent the right permissions at the right time without a human manually configuring RBAC? CRABS says: don't configure permissions. Derive them from reality."

### From Hermes Agent (177K★ — Nous Research)
| Pattern | Adopt? | How |
|---------|--------|-----|
| **Skill creation from experience** | ✅ **Phase 2** | Personas learn new skills from successful task completions, stored as skill definitions |
| **Honcho user modeling** | ✅ **Phase 2** | Guardian learns developer preferences: code style, framework choices, review tolerance |
| **Multi-platform gateway** | ❌ **Skip** | Code Forge is desktop-first. Gateway is over-engineering for a coding tool. |
| **6 terminal backends** | ❌ **Skip** | Tauri embeds one terminal. Don't need six. |
| **Subagent spawning** | ✅ **Adapted** | Concurrent LLM calls with persona masks = our version of subagents. Simpler. |
| **Trajectory generation for training** | ✅ **Phase 3** | Record persona task completions as training data for fine-tuning |
| **Cron scheduler** | ❌ **Skip** | Code Forge is interactive. Scheduled tasks are a different product. |

**Nous Research:** "Hermes Agent's most valuable feature isn't the agent — it's the skill creation loop. An agent that completes a novel task and automatically generates a reusable skill from the experience compounds its capabilities exponentially. Code Forge should steal this aggressively."

### From Crush/OpenCode (Charmbracelet — Go TUI)
| Pattern | Adopt? | How |
|---------|--------|-----|
| **LSP-enhanced context** | ✅ **Core** | Guardian connects to the project's LSP server for type-aware code understanding |
| **MCP extensibility** | ✅ **Phase 2** | Expose Guardian capabilities as MCP tools; consume external MCP servers |
| **Mid-session model switching** | ✅ **Core** | Different personas naturally use different models — model switching is persona switching |
| **Bubble Tea TUI patterns** | ❌ **Skip** | Tauri gives us richer UI. TUI patterns don't translate. |
| **Go performance** | ❌ **Skip** | Python is fine for orchestration. LLM API latency dominates, not runtime speed. |

**Charm Team:** "OpenCode's LSP integration is the feature that separates toy coding agents from real ones. Without LSP, the agent is working with text. With LSP, the agent is working with semantics — types, references, definitions, diagnostics. Code Forge MUST have this from day one."

**John Carmack:** "The Charm team is right about LSP. But I'll go further: the LSP connection should be persistent across persona switches. When the backend coder writes a function and the security reviewer examines it, the reviewer should see the same LSP diagnostics, type information, and reference graph. One LSP connection, shared across masks."

### From Plandex (15K★)
| Pattern | Adopt? | How |
|---------|--------|-----|
| **2M token context via streaming** | ✅ **Adapted** | Tag-partitioned memory achieves selective context without 2M token windows |
| **Diff review sandbox** | ✅ **Core** | All persona code changes go through diff review before merge — user sees and approves |
| **Full version control for plans** | ✅ **Core** | Campaigns (plans) are git-tracked in the recursive ledger. Full history. |
| **Tree-sitter project maps** | ✅ **Core** | Structural project understanding for Orchestrator mask task decomposition |
| **Configurable autonomy levels** | ✅ **Core** | User sets autonomy per persona: full-auto, review-before-commit, manual-approve-each-step |

**Tobi Lütke:** "Plandex's configurable autonomy is table stakes. Nobody ships an AI coding tool in 2026 without letting the user dial trust up or down. Code Forge should have three levels: supervised (approve everything), standard (approve commits), autonomous (approve campaigns)."

### From Emdash (YC W26 — Dane Sherburn)
| Pattern | Adopt? | How |
|---------|--------|-----|
| **Parallel agents in git worktrees** | ✅ **Core (already in v2)** | Each coding persona gets its own worktree. Isolation preserved. |
| **27-agent orchestration** | ⚠️ **Lesson learned** | Emdash proves parallelism works. But 27 agents = 27 processes = governance nightmare. Persona model avoids this. |
| **Ticket→agent→diff→PR→CI→merge pipeline** | ✅ **Core** | Campaign lifecycle: ticket → decompose → code (persona masks) → review (reviewer masks) → PR → CI hook → merge |
| **SSH remote dev** | Phase 3 | Remote Guardian for cloud dev environments |
| **ADE (Agent Development Environment) concept** | ✅ **Philosophy** | Code Forge IS an ADE. The term is useful for positioning. |

**Dane Sherburn:** "Emdash ran 27 agents in parallel because we needed parallelism. Code Forge's persona model gets the same parallelism with concurrent LLM calls — fewer processes, same throughput. I wish we'd thought of this. The governance overhead of 27 separate agents was our biggest operational cost."

---

## 4. What Makes This Different

**Engineering truth from 11 experts. Not marketing.**

### 4.1 The Persona Model (vs. Multi-Agent)

Every competitor — Emdash, Hermes, Plandex — runs separate agent processes. Code Forge runs one entity with masks. This isn't a semantic distinction. The engineering consequences are:

- **Zero IPC overhead.** No JSON Schema contracts between agents. No message passing. No serialization. Persona switching is a system prompt swap + memory bias change. Sub-millisecond.
- **Cross-domain awareness.** When the security reviewer examines code, it has access to the backend coder's memories of *why* the code was written that way. In a multi-agent system, the reviewer only sees the code. In Code Forge, the reviewer sees the code AND the intent.
- **No context duplication.** Multi-agent systems load project context into each agent's context window separately. Code Forge loads it once. For a 50K-token project context, that's 50K × N savings where N is the number of agents.

**Linus Torvalds:** "The multi-agent design is a distributed systems problem that nobody actually needs to solve. You're not building a cluster. You're building a tool that talks to an API. One process. Shared memory. Done."

### 4.2 The Speed Governor (vs. Yolo Agents)

Every AI coding tool has the same failure mode: the agent skips steps. It goes from "understand the task" directly to "submit PR" without review, testing, or validation. Arcanum's speed governor makes this architecturally impossible:

```
raw → typed → refined → proposed → resolved
```

A coding persona CANNOT produce a `resolved` artifact without the artifact passing through `typed` (structure validated), `refined` (reviewed), and `proposed` (approved). The Orchestrator mask enforces this. The recursive ledger tracks it. The UI shows it.

**John Carmack:** "This is the difference between a demo and shipping software. Demos skip steps because nobody's watching. Shipping software has a pipeline that prevents skipping because eventually someone IS watching and the bug is in production."

### 4.3 Formal Verification of Persona Capabilities (Phase 2)

No other coding tool has this. CyberAlchemy's 2,334 machine-verified Lean 4 theorems provide:

- **AgenticFrame:** Mathematical proof of what each persona CAN do
- **SafetyBounds:** Mathematical proof of what each persona CANNOT do
- **DruidPermissions:** Capability-based access proofs — not policy files, proofs

When the Security Reviewer persona says "I cannot write files," that's not a policy declaration enforced by a permissions check. That's a mathematical theorem proven in Lean 4 with zero `sorry`. The capability boundary is formally verified.

**Nous Research:** "Hermes Agent's self-improvement loop is powerful but dangerous. We've had agents modify their own tool definitions in unexpected ways. CyberAlchemy's safety bounds would have prevented every one of those incidents. This is the missing piece for any self-improving agent."

### 4.4 CRABS: Permissions From Reality (Phase 2)

Static RBAC is the default for every coding tool: configure who can merge, who can approve, who can deploy. CRABS inverts this: permissions derive from project state.

- Review score crosses 85% → auto-approve merge permission
- 3 reviewers agree → unlock deploy gate
- Test coverage drops below threshold → revoke autonomous commit permission

This means Code Forge's trust system adapts to reality. A coding persona that produces good code earns more autonomy. A persona that produces code that fails review loses autonomy. Automatically.

**Harrison Chase:** "This is the agent governance model everyone talks about but nobody builds. Static permissions don't work for agents because the right permission depends on what just happened. CRABS makes permissions dynamic and state-derived."

### 4.5 The Silent Fallback Detector

Every AI coding tool has code review. None have a dedicated detector for the most dangerous class of AI-generated bugs: silent failures.

- Optional chaining (`?.`) hiding null pointer bugs instead of surfacing them
- Default values masking missing data instead of erroring
- Swallowed exceptions that catch everything and return an empty response
- `|| []` / `?? {}` that silently substitutes empty data for failed lookups

These bugs don't crash. They don't throw errors. They pass all tests. They silently corrupt data or return wrong results. Z7Lab's Silent Fallback Detector is a dedicated persona mask that hunts exclusively for this class of bug.

**Anthropic Applied Research:** "In our internal testing of Claude Code, silent fallback bugs account for approximately 40% of user-reported issues that pass CI. They're the number one class of bug that AI coding tools generate and AI code reviewers miss — because the code 'works.' A dedicated detector for this pattern is genuinely novel."

### 4.6 What cc-switch and Codegraph Tell Us

These aren't competitors. They're indicators of what developers actually want:

- **cc-switch (89K★):** A meta-wrapper for ALL coding agents. Developers don't want one agent — they want to switch between agents. Code Forge's persona model IS this: switching between specialist masks within one tool.
- **Codegraph (38K★):** A pre-indexed code knowledge graph. Developers want their agent to understand project structure BEFORE it starts coding. Code Forge's tree-sitter project maps + LSP integration + tag-partitioned memory provides this natively.

---

## 5. The 30-Day MVP

### What Ships on Day 30 That Nobody Else Has

A desktop app where you describe a multi-component code change and watch a single AI entity decompose it, code each component in isolated git worktrees wearing specialist persona masks, review its own work with genuine perspective shifts (Z7Lab reviewer personas with different system prompts, tool scopes, and memory biases), auto-fix review findings through a governed iteration loop (max 3 cycles), and present a clean unified diff with a severity-ranked findings report — all with tag-partitioned memory that gives the security reviewer cross-domain access to why the backend coder made each decision.

Nobody else has the combination of: persona-based perspective shifts + cross-domain memory + governed fix loops + silent fallback detection.

### Week 1: Guardian Desktop (Days 1-7)

| Day | Task | Deliverable |
|-----|------|-------------|
| 1-2 | Fork Codexify Guardian, strip Docker/Redis/Neo4j, add SQLite backend | Guardian runs standalone with SQLite |
| 3-4 | Tauri shell: Monaco editor + file tree + terminal panel | Desktop app opens, edits files, has terminal |
| 5 | Guardian as Tauri sidecar + IPC (invoke protocol) | Frontend talks to Guardian |
| 6 | LSP bridge — Guardian connects to project's language server | Type-aware code understanding from day one |
| 7 | Single LLM chat in sidebar with file context + tree-sitter project map | User can chat with an LLM that understands project structure |

**Exit criteria:** Desktop app opens a project. Monaco editor works. Terminal works. Chat understands project structure via tree-sitter + LSP. Working product on Day 7.

**Carmack's latency budget:** App launch to first chat response: <3 seconds. File open to LSP-aware context: <500ms.

### Week 2: The Shapeshifter (Days 8-14)

| Day | Task | Deliverable |
|-----|------|-------------|
| 8-9 | Persona Engine: mask definitions (YAML, JSON Schema validated), loading, switching | Validated persona definition format |
| 10 | Tag-Partitioned Memory: extend Codexify memory with persona tags, sqlite-vec embeddings | Memories stored/retrieved with tag bias |
| 11 | Orchestrator Mask: SCU decomposition (Arcanum), task planning, mask selection | Guardian decomposes multi-step tasks |
| 12 | Backend Coder Mask: first coding persona (Python/Node.js) | Guardian writes code as backend specialist |
| 13 | Git worktree manager: create, isolate, merge, cleanup | Each coding task gets isolated workspace |
| 14 | Speed governor: raw→typed→refined→proposed→resolved lifecycle tracking | Coding persona cannot skip review phase |

**Exit criteria:** User describes a code change. Guardian decomposes via SCU. Switches to Backend Coder mask. Writes code in isolated worktree. Speed governor prevents skipping review. Day 14: single-agent coding with governance.

### Week 3: Review + Fix Loop (Days 15-21)

| Day | Task | Deliverable |
|-----|------|-------------|
| 15 | Z7Lab Backend Reviewer persona mask | Backend review with severity-ranked findings |
| 16 | Z7Lab Security Reviewer persona mask | Security review catches auth/injection/SSRF |
| 17 | Z7Lab Silent Fallback Detector persona mask | Catches optional chaining abuse, swallowed exceptions |
| 18 | Z7Lab Docs Reviewer persona mask | README quality, staleness, PII detection |
| 19 | Concurrent persona execution: parallel LLM calls with different masks | Multiple reviews run simultaneously |
| 20 | Findings Synthesizer: merge outputs, severity ranking, pass/fail gate | Unified findings report |
| 21 | Fix Loop: route findings back to coding masks, max 3 iterations, governed by speed governor | Auto-fix cycle: code→review→fix→re-review |

**Exit criteria:** Full pipeline works. User describes multi-component change. Guardian codes with persona masks (concurrent worktrees), reviews with 4 Z7Lab personas (concurrent LLM calls), auto-fixes issues through governed loop, presents clean diff + findings report. Day 21: the shapeshifter pipeline.

### Week 4: Memory + Ship (Days 22-30)

| Day | Task | Deliverable |
|-----|------|-------------|
| 22-23 | Three-tier memory port from Codexify + persona tag integration | Cross-session memory with tag-biased retrieval |
| 24 | Project context engine: per-repo conventions, architecture decisions, saved in midterm memory | Guardian learns project patterns |
| 25 | Activity Panel UI: live persona state, progress, mask queue, diffs-in-flight | Developer sees what Guardian is doing |
| 26 | Review Findings Panel UI: severity-ranked issues with inline code links | Developer reviews findings visually |
| 27 | Diff review sandbox: user inspects and approves changes before commit | Plandex-style diff approval |
| 28 | Configurable autonomy: supervised / standard / autonomous modes | User dials trust up or down |
| 29 | GitHub PR generation with intent + changes + findings summary | Auto-generated PRs |
| 30 | Packaging (Tauri build), README, quickstart guide, 3-step install | Downloadable binary ships |

**Exit criteria:** Ship. Binary downloads. 5-minute install. Cross-session memory. PR generation. Configurable autonomy. Activity + findings UI. Day 30: product.

### MVP Explicitly Excludes

| Feature | Why Deferred | Phase |
|---------|-------------|-------|
| CyberAlchemy Lean 4 proofs | Requires Lean 4 toolchain integration | Phase 2 (weeks 5-8) |
| CRABS attribute-based permissions | Needs stable persona model first | Phase 2 (weeks 9-12) |
| Arcanum sigils/spells | Map to persona skills — need persona format stabilized | Phase 2 |
| Skill creation from experience (Hermes) | Need task completion telemetry first | Phase 2 |
| MCP extensibility | Expose Guardian as MCP server | Phase 2 |
| User modeling (Honcho) | Need usage data | Phase 2 |
| MetaCognition self-improvement | Safety review required | Phase 3 |
| Team/multi-user mode | Single-developer first | Phase 3 |
| SSH remote dev | Desktop-first | Phase 3 |
| Frontend Reviewer persona | Backend + Security + Silent Fallback + Docs cover highest value | Phase 2 |
| Solidity Reviewer persona | Conditional on Web3 project detection | Phase 2 |
| Recursive ledger full implementation | Simplified version for MVP campaigns | Phase 2 |

---

## 6. The Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         RESONANT CODE FORGE v3 — SYSTEM ARCHITECTURE                 │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  ┌─── TAURI DESKTOP SHELL (Layer 0) ──────────────────────────────────────────────┐ │
│  │                                                                                 │ │
│  │  ┌─────────────┐ ┌──────────────┐ ┌─────────────┐ ┌───────────┐ ┌───────────┐ │ │
│  │  │   Monaco    │ │  Activity    │ │  Findings   │ │  Memory   │ │  Campaign │ │ │
│  │  │   Editor    │ │  Panel       │ │  Panel      │ │  Explorer │ │  Timeline │ │ │
│  │  │   + LSP     │ │  (personas)  │ │  (Z7Lab)    │ │  (tags)   │ │  (ledger) │ │ │
│  │  └──────┬──────┘ └──────┬───────┘ └──────┬──────┘ └─────┬─────┘ └─────┬─────┘ │ │
│  │         │               │                │              │              │        │ │
│  │         └───────────────┴────────────────┴──────────────┴──────────────┘        │ │
│  │                                    │ Tauri IPC (invoke)                          │ │
│  └────────────────────────────────────┼────────────────────────────────────────────┘ │
│                                       │                                              │
│  ┌─── GUARDIAN CORE (Layer 1) ────────┼────────────────────────────────────────────┐ │
│  │                                    ▼                                             │ │
│  │  ┌────────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │                      PERSONA ENGINE (Layer 2)                              │  │ │
│  │  │                                                                            │  │ │
│  │  │  ORCHESTRATOR          CODERS                    REVIEWERS (Z7Lab)         │  │ │
│  │  │  ┌──────────┐   ┌──────────┐ ┌────────┐   ┌──────────┐ ┌──────────┐      │  │ │
│  │  │  │ Planner  │   │ Backend  │ │Frontend│   │ Backend  │ │ Security │      │  │ │
│  │  │  │ SCU      │   │ Coder    │ │ Coder  │   │ Reviewer │ │ Reviewer │      │  │ │
│  │  │  │ Decomp   │   └──────────┘ └────────┘   └──────────┘ └──────────┘      │  │ │
│  │  │  └──────────┘   ┌──────────┐               ┌──────────┐ ┌──────────┐      │  │ │
│  │  │                 │ Schema   │               │ Silent   │ │ Docs     │      │  │ │
│  │  │                 │ Coder    │               │ Fallback │ │ Reviewer │      │  │ │
│  │  │                 └──────────┘               └──────────┘ └──────────┘      │  │ │
│  │  │                                                                            │  │ │
│  │  │  Each mask = system prompt + tag bias + tool scope + model preference      │  │ │
│  │  │  Switching = prompt swap + memory re-bias (~0ms, no IPC)                   │  │ │
│  │  └────────────────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                                  │ │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────────────────────┐  │ │
│  │  │ LLM Router │ │ Git        │ │ Campaign   │ │ Speed Governor               │  │ │
│  │  │ (multi-    │ │ Worktree   │ │ Manager    │ │ raw→typed→refined→           │  │ │
│  │  │  provider) │ │ Manager    │ │ (Arcanum   │ │ proposed→resolved            │  │ │
│  │  │            │ │            │ │  Ledger)   │ │ (NO SKIPPING)                │  │ │
│  │  └────────────┘ └────────────┘ └────────────┘ └──────────────────────────────┘  │ │
│  │                                                                                  │ │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────────────────────┐  │ │
│  │  │ LSP Bridge │ │ Tree-sitter│ │ Findings   │ │ PR Generator                 │  │ │
│  │  │ (shared    │ │ Project    │ │ Synthesizer│ │ (GitHub/GitLab)              │  │ │
│  │  │  across    │ │ Map        │ │ (severity  │ │                              │  │ │
│  │  │  masks)    │ │            │ │  merge)    │ │                              │  │ │
│  │  └────────────┘ └────────────┘ └────────────┘ └──────────────────────────────┘  │ │
│  └──────────────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                              │
│  ┌─── MEMORY + STATE (Layer 3) ───────┼────────────────────────────────────────────┐ │
│  │                                    ▼                                             │ │
│  │  ┌─────────────────────────────────────────────────────────────────────────────┐ │ │
│  │  │                 TAG-PARTITIONED MEMORY STORE                                │ │ │
│  │  │                                                                             │ │ │
│  │  │  Tags: #orchestrator #backend #frontend #schema #security #review           │ │ │
│  │  │        #resilience #docs #project:{repo} #task:{id} #session:{id}          │ │ │
│  │  │                                                                             │ │ │
│  │  │  Retrieval: active persona primary tags 3× weight                           │ │ │
│  │  │             active persona secondary tags 1.5× weight                       │ │ │
│  │  │             all other tags 1× weight (accessible, not blocked)              │ │ │
│  │  │             #project:* always included regardless of persona                │ │ │
│  │  │                                                                             │ │ │
│  │  │  Three-tier: EPHEMERAL (session) │ MIDTERM (project) │ LONGTERM (global)    │ │ │
│  │  └─────────────────────────────────────────────────────────────────────────────┘ │ │
│  │                                                                                  │ │
│  │  ┌──────────────┐  ┌────────────────┐  ┌──────────────────────────────────────┐ │ │
│  │  │ SQLite       │  │ sqlite-vec     │  │ Git Repository                       │ │ │
│  │  │ (state +     │  │ (StarCoder2    │  │ (main + worktrees per coding task)   │ │ │
│  │  │  memory +    │  │  code embed +  │  │                                      │ │ │
│  │  │  campaigns)  │  │  BGE-large NL) │  │                                      │ │ │
│  │  └──────────────┘  └────────────────┘  └──────────────────────────────────────┘ │ │
│  └──────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  ┌─── GOVERNANCE (Layer 4) — Phase 2+ ─────────────────────────────────────────────┐ │
│  │                                                                                  │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────────┐   │ │
│  │  │ CyberAlchemy     │  │ CRABS Attribute  │  │ Arcanum Full                 │   │ │
│  │  │ AgenticFrame     │  │ State Machines   │  │ Recursive Ledger +           │   │ │
│  │  │ SafetyBounds     │  │ (permissions     │  │ Sigils/Spells +              │   │ │
│  │  │ DruidPermissions │  │  from state)     │  │ Experiment Harness           │   │ │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────────────────┘   │ │
│  └──────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────┘

DATA FLOW — FULL PIPELINE:

  User describes change
        │
        ▼
  ORCHESTRATOR MASK ──► SCU Decomposition ──► Task Graph
        │
        ├──► BACKEND CODER MASK ──► [worktree-1] ──► code artifacts
        │         (speed governor: raw→typed→refined)
        ├──► FRONTEND CODER MASK ──► [worktree-2] ──► code artifacts
        │         (speed governor: raw→typed→refined)
        └──► SCHEMA CODER MASK ──► [worktree-3] ──► code artifacts
                  (speed governor: raw→typed→refined)
                            │
                            ▼
                  ORCHESTRATOR ──► Merge Worktrees ──► unified diff
                            │
              ┌─────────────┼─────────────┬──────────────┐
              ▼             ▼             ▼              ▼
        BACKEND        SECURITY      SILENT          DOCS
        REVIEWER       REVIEWER      FALLBACK        REVIEWER
        MASK           MASK          DETECTOR MASK    MASK
        (concurrent LLM calls — all read-only)
              │             │             │              │
              └─────────────┴─────────────┴──────────────┘
                            │
                            ▼
                  FINDINGS SYNTHESIZER ──► severity-ranked report
                            │
                      ┌─────┴──────┐
                      ▼            ▼
                   PASS         FAIL ──► Fix Loop (max 3)
                      │                      │
                      ▼                      ▼
                   PR Gen            Route findings back
                   + Diff            to coding masks
                   Review            (speed governor enforced)
```

---

## 7. Each Panelist's Verdict

### 1. Linus Torvalds — **A**
> "One process. Shared memory. Tag-biased retrieval. This is the correct architecture. The persona model is what you should have designed from the start — the multi-agent v1 was a distributed systems problem nobody needed. My concern: the Python sidecar. FastAPI is fine for prototyping. If this succeeds, rewrite the hot paths in Rust and compile Guardian into the Tauri binary directly. Python as a permanent dependency for a desktop app is technical debt."

### 2. John Carmack — **A**
> "The latency budget is achievable. Persona switching: ~0ms. LSP query: <50ms. LLM API call: 1-5s (bottleneck, unavoidable). The architecture doesn't introduce unnecessary latency anywhere. The speed governor adds process overhead but prevents much more expensive rework. My concern: the concurrent LLM calls for parallel personas. You need to measure actual throughput — API rate limits, token queuing, provider throttling. The architecture assumes you can fire 4 concurrent LLM calls. In practice, you might be limited to 2. Design for degraded parallelism."

### 3. Guillermo Rauch (Vercel) — **A-**
> "Tauri is the right choice. Single binary, auto-updater, native performance. The DX story is compelling — one entity wearing hats is a mental model users already understand from pair programming. My concern: no cloud story. Every successful developer tool in 2026 has a hosted version. Tauri-only means you're competing with VS Code extensions that require zero install. Ship desktop, but plan cloud within 90 days."

### 4. Tobi Lütke (Shopify) — **A-**
> "Pragmatic architecture. The MVP scope is realistic for 30 days with a strong team. Configurable autonomy is essential. The tag-partitioned memory is the right tradeoff between isolation and awareness. My concern: the 30-day timeline assumes a team that can ship Tauri + FastAPI + persona engine + Z7Lab integrations simultaneously. That's 3-4 senior engineers minimum. If this is 1-2 people, double the timeline."

### 5. Amjad Masad (Replit) — **A-**
> "The persona model matches how we think about Replit Agent internally. One model, different phases, different prompts. Making it explicit and formal with YAML definitions and tag-biased memory is a genuine improvement over ad-hoc phase switching. My concern: collaborative editing. Code Forge is single-user in the MVP. The moment you add a second user, the persona model needs user-scoped instances. CRABS helps here but it's Phase 2. Don't let the single-user architecture calcify."

### 6. Harrison Chase (LangChain) — **A**
> "Tag-partitioned memory with persona bias is the most interesting memory architecture I've seen outside of research papers. Cross-domain access without hard silos is exactly right. CRABS attribute-based permissions are the governance model every agent framework needs. My concern: the tag taxonomy. If tags proliferate without governance (developers create custom tags ad hoc), retrieval quality degrades. Need a managed tag registry with clear naming conventions."

### 7. Nous Research Team — **A-**
> "The persona model is Hermes Agent's architecture taken to its logical conclusion. Self-improvement via skill creation (Phase 2) is the right call — you need stable personas before you let them evolve. CyberAlchemy's safety bounds are the missing piece every self-improving agent needs. My concern: without the CyberAlchemy proofs in the MVP, persona tool scoping is policy-based. A determined prompt injection could convince a coding persona to act outside its scope. Ship output validation as a hard gate in the MVP — don't wait for formal proofs."

### 8. Charm Team (Crush/OpenCode) — **B+**
> "LSP integration from day one is correct. Most coding agents skip this and it shows in output quality. The persistent LSP connection shared across persona switches is a smart detail. My concern: the Tauri shell is a bet on GUI. Half of developers live in the terminal. Code Forge should ship a CLI mode (guardian-cli) that provides the same persona pipeline without the desktop app. Not MVP, but don't architect it out."

### 9. Dane Sherburn (Emdash) — **A**
> "The speed governor is the feature I most wish Emdash had from day one. The persona model achieves the same parallelism we get from 27 agents with dramatically less operational overhead. Git worktree isolation is proven correct — we validated this at scale. My concern: the fix loop (max 3 iterations). In Emdash's experience, if a fix hasn't converged in 2 iterations, it won't converge in 3. Make the default max 2 and let users override. Wasting a third iteration costs time and tokens."

### 10. Anthropic Applied Research — **A**
> "The persona model maps cleanly to how Claude operates internally — different system prompts produce genuinely different analytical perspectives, not superficial variations. The Silent Fallback Detector addresses the single largest class of AI-generated bugs in our internal testing. Tag-partitioned memory is implementable with existing embedding infrastructure. My concern: model selection per persona. The Orchestrator needs a reasoning model. Coders need coding models. Reviewers need reasoning models. If you're calling 3-4 different models per pipeline run, provider API key management and cost tracking become non-trivial. Build cost observability into the MVP."

### 11. Bret Victor — **B+**
> "The Activity Panel showing persona state is necessary but not sufficient. 'Direct manipulation' means the developer should be able to intervene at any point in the pipeline — pause the security reviewer, redirect the backend coder, override the orchestrator's decomposition — not just watch. The diff review sandbox is a step toward this. My concern: the current design is still fundamentally a batch pipeline that the user watches and then approves. True direct manipulation would let the user edit the code alongside the persona, seeing the reviewer's findings appear in real-time as they type. That's Phase 2+ but it should be the north star, not an afterthought."

### Grade Summary

| Panelist | Grade | Key Strength | Key Concern |
|----------|-------|-------------|-------------|
| Linus Torvalds | **A** | Architecture correctness | Python as permanent dep |
| John Carmack | **A** | Latency budget achievable | API rate limit realism |
| Guillermo Rauch | **A-** | DX story compelling | No cloud story |
| Tobi Lütke | **A-** | Pragmatic scope | Team size assumption |
| Amjad Masad | **A-** | Persona model validated | Single-user calcification |
| Harrison Chase | **A** | Memory architecture novel | Tag taxonomy governance |
| Nous Research | **A-** | Safety bounds essential | MVP lacks formal proofs |
| Charm Team | **B+** | LSP integration correct | No CLI mode |
| Dane Sherburn | **A** | Speed governor critical | Fix loop iteration count |
| Anthropic Applied | **A** | Silent Fallback Detector novel | Cost observability needed |
| Bret Victor | **B+** | Direct manipulation north star | Still a batch pipeline |
| **Panel Average** | **A-** | | |

---

## 8. The Three Things That Could Kill This

### 1. The Python Sidecar Problem (Probability: Medium, Severity: High)

Code Forge ships as a Tauri binary + a Python sidecar process. This means:
- Users need Python 3.12+ installed (or bundled, adding ~50MB)
- Two processes to manage instead of one
- Crash recovery is more complex (Tauri alive, Python dead, or vice versa)
- Packaging for Windows/Linux/macOS with a Python dependency is notoriously painful

**Why it could kill this:** Every friction point in installation loses users exponentially. Cursor ships as one binary. VS Code ships as one binary. If Code Forge requires "install Python, then install pip packages, then run the app," it loses to one-click competitors regardless of architectural superiority.

**Mitigation:** PyInstaller/Nuitka to bundle Guardian as a single executable inside the Tauri package. Or: rewrite Guardian core in Rust and compile into Tauri directly (Linus's recommendation, Phase 3).

### 2. Context Window Pressure Under Rapid Persona Switching (Probability: Medium, Severity: Medium)

The persona model's Achilles heel: one entity means one context window. A pipeline run that involves Orchestrator → Backend Coder → Frontend Coder → Schema Coder → 4 Reviewers → Fix Loop generates enormous context. If the context window fills up mid-pipeline, the later personas (reviewers) operate with degraded context — exactly when quality matters most.

**Why it could kill this:** The persona model's advantage (cross-domain awareness) becomes its weakness if the shared context window can't hold enough cross-domain information. If reviewers can't see the coder's reasoning because it was compacted, the cross-domain advantage disappears and you're back to siloed multi-agent with extra steps.

**Mitigation:** (1) CyberAlchemy's SleepConsolidation for intelligent context compaction between persona switches. (2) Tag-biased eviction: when compacting, preserve memories tagged with the upcoming persona's primary tags. (3) Hierarchical summarization: full details for recent persona, summaries for earlier personas. (4) Use 200K+ context models for orchestration (Claude, Gemini).

### 3. The Team of One Problem (Probability: High, Severity: Critical)

The 30-day MVP requires: Tauri + Rust frontend shell, React + TypeScript UI (5 panels), FastAPI + Python backend (Guardian Core), Persona Engine, Tag-Partitioned Memory with sqlite-vec, Git Worktree Manager, LSP Bridge, Tree-sitter integration, Z7Lab persona definitions, Findings Synthesizer, Speed Governor, Campaign Manager, LLM Provider Router, PR Generator, and packaging for 3 platforms.

If this is 1-2 people, the 30-day timeline is fantasy. This is 90-120 days for a small team. For one person, it's 6 months.

**Why it could kill this:** Ambitious architectures die when they never ship. The perfect design that takes 6 months loses to the mediocre tool that ships in 6 weeks. Emdash shipped fast and iterated. Cursor shipped fast and iterated. The architecture is right but execution is everything.

**Mitigation:** (1) Ruthlessly cut MVP scope. Ship Week 2 (Guardian + one coder persona + worktrees) as an alpha. Add reviewers in Week 4-6. Add UI panels in Week 6-8. (2) Use Claude Code / Codex CLI to implement — Code Forge building Code Forge. (3) Open-source early and recruit contributors from the 89K cc-switch and 38K Codegraph communities who clearly want this.

---

*Panel adjourned. This is the definitive architecture. Build it.*

**Document:** CODE-FORGE-V3-FINAL-ARCHITECTURE.md
**Supersedes:** CODE-FORGE-V2-ARCHITECTURE.md, all prior panel outputs
**Next action:** Begin Week 1, Day 1. Fork Codexify. Strip Docker. Add SQLite. Ship.
