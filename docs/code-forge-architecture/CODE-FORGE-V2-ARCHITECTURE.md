# CODE FORGE v2 — Reconvened Linus Panel Architecture

**Panel Date:** 2026-06-02
**Panel Type:** Reconvened 7-architect panel with 3 new inputs
**Subject:** Integration of Chris's Persona Architecture + CyberAlchemy Verification + Z7Lab Review Agents into Code Forge

---

## The One Thing That Changes Everything

**The orchestrator isn't a scheduler — it's a mind with masks.**

Chris's persona insight collapses the entire multi-runtime agent architecture into a single entity (Guardian) wearing different masks. This isn't a simplification — it's a *paradigm shift*. The v1 Code Forge design had separate agent runtimes, separate sandboxes, separate processes for each coding/review agent. Chris's model says: one entity, global memory, tagged retrieval, persona masks.

Combined with CyberAlchemy's formal verification, this means: **the orchestrator doesn't dispatch tasks to separate agents — it *becomes* each agent in turn, with verified capability masks and tag-partitioned memory, while retaining global situational awareness.**

The compound insight: Guardian (one entity) + CyberAlchemy (verified masks/capabilities) + Z7Lab (review personas with tagged memory) = a **formally verified shapeshifter** that can code as a backend specialist, review as a security expert, and orchestrate as an architect — all with proven guarantees about what each mask can and cannot do, and with memory that is biased-per-persona but globally accessible when needed.

This eliminates:
- Multi-process overhead and IPC complexity
- Context duplication (each "agent" was getting a redundant copy of project context)
- Agent-to-agent communication protocols (they're all the same entity)
- The entire "Agent Contract spec" from v1 Sprint 1 (no inter-process protocol needed)

And it introduces:
- True cross-domain awareness (the security reviewer *knows* what the backend coder just did — it's the same memory)
- Emergent capabilities from persona composition (combine backend + security masks for security-aware coding)
- Radical simplicity in the runtime layer

**This is the architectural epiphany: you don't build an army. You build a shapeshifter.**

---

## 1. Revised Architecture

### 1.1 From Multi-Agent Runtime to Persona Engine

**v1 Design (Superseded):**
```
Orchestrator Process
  ├── Backend Coder Process (subprocess)
  ├── Frontend Coder Process (subprocess)
  ├── Schema Coder Process (subprocess)
  ├── Backend Reviewer Process (subprocess)
  ├── Security Reviewer Process (subprocess)
  └── ... (10+ processes, IPC, lifecycle management)
```

**v2 Design (Persona Model):**
```
┌─────────────────────────────────────────────────────────────────────┐
│                    GUARDIAN (Single Entity)                          │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                 GLOBAL MEMORY STORE                           │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│  │
│  │  │ #backend │ │ #frontend│ │ #security│ │ #orchestrator    ││  │
│  │  │ tagged   │ │ tagged   │ │ tagged   │ │ tagged           ││  │
│  │  │ memories │ │ memories │ │ memories │ │ memories         ││  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│  │
│  │                                                               │  │
│  │  Cross-domain access: ANY persona can query ANY tag           │  │
│  │  Bias: Each persona's retrieval is weighted toward its tags   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                 PERSONA MASKS                                 │  │
│  │                                                               │  │
│  │  ┌─────────────┐  System prompt + tagged memory bias          │  │
│  │  │ Orchestrator│  + CyberAlchemy capability proof             │  │
│  │  │ Mask        │  + tool access scope                         │  │
│  │  └─────────────┘                                              │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │  │
│  │  │ Backend     │  │ Frontend    │  │ Schema      │          │  │
│  │  │ Coder Mask  │  │ Coder Mask  │  │ Coder Mask  │          │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘          │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │  │
│  │  │ Backend     │  │ Security    │  │ Silent      │          │  │
│  │  │ Reviewer    │  │ Reviewer    │  │ Fallback    │          │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘          │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │  │
│  │  │ Frontend    │  │ Docs        │  │ Solidity    │          │  │
│  │  │ Reviewer    │  │ Reviewer    │  │ Reviewer    │          │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              CYBERALCHEMY VERIFICATION LAYER                  │  │
│  │  AgenticFrame: defines what each mask CAN do                  │  │
│  │  SafetyBounds: defines what each mask CANNOT do               │  │
│  │  DruidPermissions: capability-based access proofs             │  │
│  │  MetaCognition: self-update with safety invariants            │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 How Persona Switching Works

When Guardian needs to act as a backend coder:

1. **Load mask:** Backend Coder system prompt activates
2. **Bias memory retrieval:** Tag filter weights `#backend` memories 3× higher in relevance scoring
3. **Scope tools:** Only git worktree write access for assigned task, linter access, test runner access
4. **Verify capability:** CyberAlchemy `AgenticFrame` confirms this mask has the `backend-coding` capability proof
5. **Execute:** Guardian operates with backend coder behavior, knowledge bias, and tool constraints
6. **Store results:** New memories tagged `#backend` + task-specific tags

When switching to security reviewer:

1. **Swap mask:** Security Reviewer system prompt replaces Backend Coder
2. **Re-bias memory:** `#security` memories weighted 3× higher, but `#backend` memories *remain accessible* (cross-domain)
3. **Restrict tools:** Read-only repo access. No write. No network. No exec.
4. **Verify:** `AgenticFrame` confirms `security-review` capability
5. **Execute:** Reviews with security expertise + awareness of what the backend coder just did (same entity, shared memory)
6. **Store findings:** Tagged `#security` + `#review` + task reference

### 1.3 What This Changes About Parallelism

**The question:** If it's one entity, can it still parallelize?

**The answer:** Yes, but differently.

- **v1 parallelism:** Multiple processes running simultaneously (true concurrency)
- **v2 parallelism:** Rapid sequential persona switching with shared context (cooperative multitasking) + *optional* LLM-level parallelism via concurrent API calls

In practice, for an LLM-based system, v1's "parallel subprocesses" were still bottlenecked by sequential LLM API calls unless you had multiple API keys or endpoints. The persona model makes this explicit and honest.

**For true parallelism when needed:** Guardian can spawn lightweight LLM calls with persona-specific system prompts as *concurrent API requests* to different model endpoints. The results flow back into the shared memory store. This is parallelism at the LLM call level, not the process level — simpler, cheaper, equally effective.

```
Guardian spawns concurrent requests:
  → LLM call 1 (Backend Coder mask + task context) → openai/gpt-4.1
  → LLM call 2 (Frontend Coder mask + task context) → anthropic/sonnet
  → LLM call 3 (Schema Coder mask + task context) → deepseek/coder-v3
  
Results merge into shared memory store.
Guardian (Orchestrator mask) synthesizes and integrates.
```

This preserves the worktree isolation model (each concurrent coding task still gets its own git worktree) while eliminating process management overhead.

### 1.4 What Gets Harder

The persona model introduces two challenges v1 didn't have:

1. **Context window pressure:** One entity means one context window. If Guardian is coding backend AND reviewing security, both sets of context compete for the same window. 
   - **Mitigation:** Tag-based retrieval is already a form of dynamic context management. Each persona mask loads only its relevant tagged memories, not everything. CyberAlchemy's `SleepConsolidation` module can be adapted for context compaction between persona switches.

2. **Accountability blur:** When the security reviewer finds a bug the backend coder introduced, who's "responsible"? In v1, it was clear (separate agents). In v2, it's the same entity reviewing its own work.
   - **Mitigation:** Persona switching enforces a *perspective shift*. The system prompt change creates genuine behavioral differentiation even within one entity. Enforced by `AgenticFrame` — the security reviewer mask literally cannot write code, only report findings. Memory tags create an audit trail of which persona produced which artifact.

---

## 2. Component Map v2 — What Changed

### Changed Components

| Component | v1 Design | v2 Design | Why Changed |
|-----------|-----------|-----------|-------------|
| **Agent Runtime** | Python subprocess per agent, capability-based access | **Persona Engine** — mask switching on single Guardian entity, CyberAlchemy-verified capabilities | Chris's insight: separate runtimes are unnecessary overhead when one entity can wear masks |
| **Agent Contract Spec** | JSON Schema protocol for inter-process communication | **Eliminated** — personas share memory directly, no IPC needed | Same entity, same memory, same process |
| **Swarm Orchestrator** | External coordinator dispatching to separate agent processes | **Guardian Orchestrator Mask** — one persona that plans, then Guardian switches masks to execute | Orchestrator IS Guardian, not a separate system talking to Guardian |
| **Review Gate** | 5 reviewer processes running in parallel | **5 reviewer personas** running as concurrent LLM calls with persona-specific system prompts | Z7Lab specs become persona definitions, not process configs |
| **Context Management** | Per-agent context windows (duplicated project context) | **Single shared context** with tag-biased retrieval per persona | Eliminates redundant context loading across agents |
| **Memory Architecture** | Three-tier (ephemeral/midterm/longterm) + project context | **Three-tier + tag-partitioned persona memory** — each persona's memories are tagged, retrieval biased but not siloed | Chris's insight: tags, not silos |
| **Security/Permissions** | Process-level sandboxing, per-process file access | **Persona-level capability proofs** via CyberAlchemy `AgenticFrame` + `DruidPermissions` + `SafetyBounds` | Formal verification replaces OS-level sandboxing for capability declarations |

### Unchanged Components

| Component | Status | Notes |
|-----------|--------|-------|
| **Tauri Shell** | ✅ Unchanged | Still the desktop container |
| **Monaco Editor** | ✅ Unchanged | Still the code editor |
| **Git Worktree Isolation** | ✅ Unchanged | Still the file isolation mechanism (one worktree per coding task) |
| **FastAPI Sidecar (Guardian Core)** | ✅ Unchanged | Guardian is still Python/FastAPI — now with added persona switching logic |
| **SQLite/Postgres duality** | ✅ Unchanged | Still SQLite for desktop, Postgres for team mode |
| **LLM Provider Router** | ✅ Unchanged | Multi-model routing still needed (different masks can prefer different models) |
| **Campaign System** | ✅ Unchanged | Campaigns still define multi-step work — masks execute the steps |
| **Findings Synthesizer** | ✅ Unchanged | Still merges review findings into severity-ranked reports |
| **PR Generation** | ✅ Unchanged | Still auto-generates PRs via GitHub/GitLab API |

### New Components (from v2 inputs)

| Component | Source | Purpose |
|-----------|--------|---------|
| **Persona Engine** | Chris's architecture | Mask management: load/swap system prompts, bias memory retrieval, scope tool access |
| **Tag Registry** | Chris's architecture | Defines persona tags, memory association rules, cross-domain access policies |
| **CyberAlchemy Gate** | CyberAlchemy | Lean 4 verified capability proofs for each persona mask |
| **MetaCognition Layer** | CyberAlchemy | Self-update with safety invariants — Guardian can refine its own masks within proven bounds |
| **Context Compactor** | CyberAlchemy (`SleepConsolidation`) | Compress context between persona switches to manage window pressure |

---

## 3. The 30-Day MVP — What Actually Ships

### Philosophy: Ship the shapeshifter, not the army.

The persona model makes the MVP *dramatically simpler* than v1. Instead of building multi-process agent runtimes, IPC protocols, and agent lifecycle management, we build one thing well: Guardian with masks.

### Week 1: Guardian Desktop (Days 1-7)

| # | Task | Effort | Deliverable |
|---|------|--------|-------------|
| 1.1 | Fork Codexify Guardian, strip Docker deps, add SQLite backend | 3 days | Guardian runs as standalone Python process with SQLite |
| 1.2 | Tauri shell with Monaco editor + file tree + terminal | 3 days | Desktop app opens, edits files, has terminal |
| 1.3 | Guardian as Tauri sidecar + basic IPC | 2 days | Frontend talks to Guardian via Tauri invoke |
| 1.4 | Single LLM chat in sidebar (no personas yet) | 1 day | User can chat with an LLM that sees open files |

**Exit criteria:** Desktop app opens a project, edits code in Monaco, chats with an LLM that has file context. *This is a working product on Day 7.*

### Week 2: The Shapeshifter (Days 8-14)

| # | Task | Effort | Deliverable |
|---|------|--------|-------------|
| 2.1 | **Persona Engine** — mask definitions (system prompt + tag bias + tool scope) | 2 days | JSON/YAML persona definition format |
| 2.2 | **Tag-Partitioned Memory** — extend Codexify's memory with persona tags | 2 days | Memories stored with tags, retrieval biased by active persona |
| 2.3 | **Orchestrator Mask** — task decomposition + mask-switching logic | 2 days | Guardian can plan a multi-step task and switch masks to execute steps |
| 2.4 | **Backend Coder Mask** — first coding persona (Python/Node.js) | 1 day | Guardian wearing Backend Coder mask can write code in a worktree |
| 2.5 | Git worktree management (create, merge, cleanup) | 1 day | Isolated workspaces per coding task |

**Exit criteria:** User describes a code change. Guardian (Orchestrator mask) decomposes it. Guardian switches to Backend Coder mask, writes code in an isolated worktree. User sees the diff. *Single-agent coding with persona switching works on Day 14.*

### Week 3: Review Personas + Fix Loop (Days 15-21)

| # | Task | Effort | Deliverable |
|---|------|--------|-------------|
| 3.1 | **Z7Lab Review Personas** — Backend, Security, Silent Fallback, Docs reviewers as persona masks | 2 days | 4 reviewer masks with Z7Lab instruction sets as system prompts |
| 3.2 | **Frontend Coder Mask** + **Schema Coder Mask** | 1 day | Two more coding personas |
| 3.3 | **Concurrent persona execution** — parallel LLM calls with different masks | 2 days | Multiple coding tasks or reviews run simultaneously via concurrent API calls |
| 3.4 | **Findings Synthesizer** — merge review outputs, severity ranking, pass/fail | 1 day | Structured review report from multiple reviewer personas |
| 3.5 | **Fix Loop** — route findings back to coding masks, max 3 iterations | 1 day | Auto-fix cycle: code → review → fix → re-review |
| 3.6 | **Activity Panel** — UI showing active persona, progress, live diffs | 1 day | Developer sees what Guardian is doing and as which persona |

**Exit criteria:** User describes a multi-component change. Guardian decomposes, codes with multiple persona masks (concurrent API calls), reviews with Z7Lab personas, auto-fixes issues, presents clean diff. *The full shapeshifter pipeline works on Day 21.*

### Week 4: Memory + Polish + Ship (Days 22-30)

| # | Task | Effort | Deliverable |
|---|------|--------|-------------|
| 4.1 | **Three-tier memory** port from Codexify + persona tag integration | 2 days | Cross-session memory with persona-biased retrieval |
| 4.2 | **Project context engine** — per-repo conventions, architecture decisions | 2 days | Guardian learns project patterns across sessions |
| 4.3 | **Vector search for code** (StarCoder embeddings + sqlite-vec) | 1 day | Semantic code search for context injection |
| 4.4 | **GitHub PR generation** | 1 day | Auto-generate PR with intent + changes + review findings |
| 4.5 | **Persona-level metrics** — token usage, success rates per mask | 1 day | Dashboard showing which personas cost what and succeed how often |
| 4.6 | **Packaging + docs** — Tauri build, README, quickstart guide | 2 days | Downloadable app + 3-step getting started |

**Exit criteria:** System remembers across sessions, uses project conventions, generates PRs, has basic observability. *Shippable product on Day 30.*

### MVP Explicitly Excludes

| Feature | Why Deferred | Phase |
|---------|-------------|-------|
| CyberAlchemy Lean 4 proofs | Verification layer requires Lean 4 toolchain integration — significant effort | Phase 2 |
| Formal capability proofs (AgenticFrame) | Need persona model stabilized first, then add proofs | Phase 2 |
| MetaCognition self-update | Self-modifying personas need safety review | Phase 3 |
| SleepConsolidation context compaction | Optimize after measuring actual context pressure | Phase 2 |
| Behavioral telemetry | Privacy review needed | Phase 2 |
| Skill marketplace | Need skill format + persona composition stabilized | Phase 3 |
| Team/multi-user mode | Single-developer first | Phase 3 |
| Solidity Reviewer persona | Only relevant for Web3 projects | Phase 2 (conditional) |
| Rust CLI | Python CLI wrapper sufficient for MVP | Phase 2 |
| Frontend Reviewer persona | Defer to Phase 2 — Backend + Security + Silent Fallback + Docs cover the highest-value review dimensions | Phase 2 |

### MVP Success Criteria

1. **Install < 5 min:** Download Tauri app, run, open project, working chat with code context
2. **Single task < 2 min:** Describe a code change, see Guardian decompose → code → review → diff
3. **Multi-task pipeline:** Describe a feature spanning backend + frontend + schema, Guardian handles with persona switching
4. **Review catches real issues:** Z7Lab reviewer personas find genuine problems (not noise) in generated code
5. **Cross-session memory:** Close app, reopen, Guardian remembers project context and past decisions
6. **Persona transparency:** User can see which persona is active, what it's doing, and switch/override

---

## 4. CyberAlchemy Integration Map

### Tier 1: Phase 1 Integration (MVP-Adjacent, Weeks 5-8)

These modules are directly applicable to the persona/coding IDE and should be integrated first after MVP ships.

| Module | Library | Purpose in Code Forge | Integration Point |
|--------|---------|----------------------|-------------------|
| **AgenticFrame** | LaRue | Defines what each persona mask CAN do — formal capability declarations | Persona Engine: each mask's capability set is an AgenticFrame instance |
| **SafetyBounds** | LaRue | Defines what each persona CANNOT do — proven safety invariants | Persona Engine: hard limits on mask behavior (reviewer can't write, coder can't exfiltrate) |
| **DruidPermissions** | InfoPhys | Capability-based access proofs — fine-grained permission system | Tool access scoping: each mask's file/network/exec permissions are DruidPermission proofs |
| **DruidSprite + SpriteDispatch** | InfoPhys | Lightweight agent dispatch within the Druid (Guardian) system | Concurrent persona execution: SpriteDispatch manages parallel LLM calls with different masks |
| **DecisionKernel** | InfoPhys | Formal decision-making with proven optimality bounds | Orchestrator mask: task decomposition and mask selection backed by decision theory |
| **AgenticRank** | InfoPhys | Ranking agent capabilities and selecting optimal persona for a task | Mask selection: when multiple personas could handle a task, AgenticRank picks the best fit |

### Tier 2: Phase 2 Integration (Weeks 9-16)

These modules add verification and governance depth after the core persona model is stable.

| Module | Library | Purpose in Code Forge | Integration Point |
|--------|---------|----------------------|-------------------|
| **MetaCognition** | InfoPhys | Platonic tiered self-update with safety invariants | Guardian self-improvement: refine persona definitions within proven bounds |
| **SleepConsolidation** | InfoPhys | Memory consolidation during idle periods | Context compaction: compress persona memories between sessions, reduce context pressure |
| **ConfigSheaf** | LaRue | Configuration management with topological consistency proofs | Persona configuration: prove that a set of persona definitions is internally consistent |
| **TopologicalFirewall** | LaRue | Network boundary enforcement with topological proofs | Agent network isolation: prove that reviewer personas cannot access external endpoints |
| **PostQuantumSecurity** | LaRue | Future-proof cryptographic primitives | Secret management: API keys, credentials stored with quantum-resistant encryption |
| **CognitiveSecurity** | LaRue | Protection against adversarial cognitive attacks | Prompt injection defense: proven bounds on what adversarial input can achieve |
| **ResonantMFA** | LaRue | Multi-factor authentication with resonance-based verification | User authentication for team mode |
| **UmbralCollapse** | InfoPhys | Graceful degradation under resource pressure | Context window management: proven fallback strategies when context exceeds limits |

### Tier 3: Phase 3+ Integration (Research-Adjacent)

These modules are intellectually fascinating but not directly applicable to a coding IDE. They may inform future features or remain in CyberAlchemy's research domain.

| Module | Library | Relevance | Verdict |
|--------|---------|-----------|---------|
| **KleinAlgebra / ProtorealManifold / CommutatorGap / MonsterInverse** | LaRue | Core algebraic foundations — underpin everything but are infrastructure, not features | **Research-only** — consumed implicitly by higher-level modules |
| **MassGap / YangMillsMassGap / ThermodynamicFriction** | LaRue | Physics dynamics — no coding IDE application | **Research-only** |
| **SpectralTriple / SpectralFiber / RiemannSolution / ZetaResonance** | LaRue | Spectral theory — pure mathematics | **Research-only** |
| **TopologicalDivergence / MayerVietoris / KleinBottle** | LaRue | Topology — no direct application | **Research-only** |
| **ObservationalAperture / ObserverAdapter / SensorySheaf** | LaRue | Observer theory — *potentially* relevant to viewport awareness in Phase 3+ | **Monitor** — may inform behavioral telemetry |
| **SharedLatentSpace** | LaRue | Shared representation spaces — could inform multi-persona memory | **Monitor** |
| **CyberneticLife / EmotionalSecurity / EmotionalLFunctions** | LaRue | Cybernetic systems — no IDE application | **Research-only** |
| **HolochainHash / DHTAlgebra / StochasticKeyRotation** | LaRue | Distributed systems — relevant if Code Forge goes P2P | **Phase 4+ (if P2P)** |
| **UnifiedSeedProtocol** | LaRue | Seed-based identity — relevant for team mode identity | **Phase 3+ (team mode)** |
| **ProtorealGame / OscillatingGame / TarskiEquilibrium** | InfoPhys | Game theory — *potentially* relevant for multi-user resource allocation | **Phase 3+ (team mode)** |
| **SavageProbability / GoldenAgents** | LaRue | Decision theory — subsumed by DecisionKernel for our purposes | **Research-only** (already consumed by DecisionKernel) |
| **ChronoHash** | InfoPhys | Chronometric cryptography — interesting for audit trails | **Phase 3+ (audit)** |
| **ZKPCR** | InfoPhys | Zero-knowledge proofs — relevant for verified skill marketplace | **Phase 3+ (marketplace)** |
| **PhotonicPropagation / Identity-Observer Duality / HoloGame** | LaRue | Recent research (last 3 days) — physics/philosophy | **Research-only** |
| **ResonantDomains** | LaRue | 7 sensory dimensions — *potentially* relevant to multi-modal IDE input | **Monitor** |
| **PlatonicLattice** | LaRue | Platonic solids from Klein algebra — pure mathematics | **Research-only** |
| **VeblenDruid** | InfoPhys | Druid variant with Veblen ordinals — advanced agent theory | **Research-only** |

### Integration Summary

| Tier | Module Count | Phase | Effort |
|------|-------------|-------|--------|
| **Tier 1 (Core)** | 6 modules | Phase 1 (post-MVP, weeks 5-8) | 2-3 weeks |
| **Tier 2 (Depth)** | 8 modules | Phase 2 (weeks 9-16) | 4-6 weeks |
| **Tier 3 (Research)** | ~30+ modules | Phase 3+ or research-only | Ongoing |
| **Total relevant to Code Forge** | 14 modules of 269 | — | — |

**Key insight:** Only **14 of 269 modules** (5.2%) are directly applicable to the coding IDE. But those 14 are *exactly* the ones that make the persona model formally verifiable rather than vibes-based. The other 255 modules are the mathematical foundation that *proves* those 14 work correctly — they're consumed implicitly, not integrated directly.

---

## 5. Z7Lab Review Agents in the Persona Model

### Answer: Yes, they are 6 personas of Guardian. Yes, they get their own memory tags.

Each Z7Lab reviewer specification becomes a **persona mask definition**:

```yaml
# Example: Security Reviewer Persona
persona:
  id: security-reviewer
  name: "Security Reviewer"
  source: z7lab/security-reviewer.md
  
  system_prompt: |
    [Full Z7Lab Security Reviewer instruction set]
    You trace auth flows end-to-end. You check injection vectors.
    You verify CORS, rate limiting, secrets management.
    You produce severity-ranked findings reports.
    
  memory_tags:
    primary: ["#security", "#review"]
    secondary: ["#auth", "#injection", "#cors", "#secrets"]
    
  memory_bias: 3.0  # Primary tags weighted 3× in retrieval
  cross_domain: true  # Can access any tag when explicitly requested
  
  tool_scope:
    read: ["**/*"]        # Full read access
    write: []             # No write access
    exec: []              # No exec access
    network: []           # No network access
    
  output_format:
    type: "findings_report"
    severity_levels: ["critical", "high", "medium", "low", "info"]
    
  model_preference: "reasoning"  # Use best reasoning model available
  
  cyberalchemy:
    frame: "SecurityReviewFrame"  # AgenticFrame proof (Phase 2)
    bounds: "ReviewerSafetyBounds"  # SafetyBounds proof (Phase 2)
```

### The 6 Z7Lab Personas

| Persona | Primary Tags | Model Tier | MVP? | Notes |
|---------|-------------|-----------|------|-------|
| **Backend Reviewer** | `#backend` `#review` `#patterns` | Reasoning | ✅ Yes | Python/Flask/FastAPI/Django, Node.js, Go, Rust |
| **Security Reviewer** | `#security` `#review` `#auth` | Reasoning | ✅ Yes | Auth flows, injection, SSRF, secrets, CORS |
| **Silent Fallback Detector** | `#resilience` `#review` `#error-handling` | Reasoning | ✅ Yes | Swallowed exceptions, optional chaining abuse, default masking |
| **Docs Reviewer** | `#docs` `#review` `#readme` | Fast | ✅ Yes | README quality, staleness, Diátaxis, PII |
| **Frontend Reviewer** | `#frontend` `#review` `#react` `#accessibility` | Reasoning | Phase 2 | React, Next.js, TypeScript SPAs |
| **Solidity Reviewer** | `#solidity` `#review` `#web3` | Specialized | Phase 2 | Smart contracts, reentrancy, gas/DoS |

### Memory Tag Architecture

```
GLOBAL MEMORY STORE
├── #orchestrator — task plans, decompositions, decisions
├── #backend — backend code patterns, API designs, framework knowledge  
├── #frontend — component patterns, state management, routing
├── #schema — database schemas, migrations, type definitions
├── #security — vulnerability patterns, auth implementations, threat models
├── #review — all review findings (cross-referenced with reviewer tag)
├── #resilience — error handling patterns, fallback strategies
├── #docs — documentation standards, README patterns
├── #project:{repo-name} — per-project context (conventions, architecture)
├── #task:{task-id} — per-task context (intent, progress, artifacts)
└── #session:{session-id} — ephemeral session context
```

**Retrieval rules:**
1. Active persona's primary tags: **3× weight** in relevance scoring
2. Active persona's secondary tags: **1.5× weight**
3. All other tags: **1× weight** (still accessible, not blocked)
4. `#project:*` tags: **always included** regardless of persona (project context is universal)
5. Cross-domain query: Persona can explicitly request memories from any tag at full weight

This is Chris's insight in action: "it's just a tag, nothing exotic." The elegance is that the security reviewer naturally gravitates toward security-tagged memories but can access backend memories when tracing an auth flow through the codebase. No silos. No barriers. Just weighted retrieval.

---

## 6. Updated System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    RESONANT CODE FORGE v2 — UNIFIED SYSTEM                    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                    TAURI DESKTOP SHELL                                  │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  ┌─────────────┐ │ │
│  │  │  Monaco       │  │  Activity    │  │  Review     │  │  Memory     │ │ │
│  │  │  Editor       │  │  Panel       │  │  Findings   │  │  Explorer   │ │ │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘  └──────┬──────┘ │ │
│  └─────────┼────────────────┼────────────────┼────────────────┼──────────┘ │
│            │    Tauri IPC   │                │                │             │
│            ▼                ▼                ▼                ▼             │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                    GUARDIAN CORE (Single Entity)                        │ │
│  │                                                                         │ │
│  │  ┌────────────────────────────────────────────────────────────────────┐ │ │
│  │  │                 PERSONA ENGINE                                     │ │ │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │ │ │
│  │  │  │Orchestrtr│ │Backend   │ │Frontend  │ │Schema    │  CODERS    │ │ │
│  │  │  │Mask      │ │Coder     │ │Coder     │ │Coder     │            │ │ │
│  │  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │ │ │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │ │ │
│  │  │  │Backend   │ │Security  │ │Silent    │ │Docs      │  REVIEWERS │ │ │
│  │  │  │Reviewer  │ │Reviewer  │ │Fallback  │ │Reviewer  │  (Z7Lab)   │ │ │
│  │  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │ │ │
│  │  └────────────────────────────────────────────────────────────────────┘ │ │
│  │                                                                         │ │
│  │  ┌────────────────────────────────────────────────────────────────────┐ │ │
│  │  │              TAG-PARTITIONED MEMORY                                │ │ │
│  │  │  #orchestrator  #backend  #frontend  #schema  #security           │ │ │
│  │  │  #review  #resilience  #docs  #project:{repo}  #task:{id}        │ │ │
│  │  │                                                                    │ │ │
│  │  │  Storage: SQLite (desktop) / PostgreSQL (team) + Vector (sqlite-vec)│ │ │
│  │  └────────────────────────────────────────────────────────────────────┘ │ │
│  │                                                                         │ │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌────────────────────┐  │ │
│  │  │ LLM       │  │ Git       │  │ Campaign  │  │ CyberAlchemy       │  │ │
│  │  │ Router    │  │ Worktree  │  │ Manager   │  │ Verification       │  │ │
│  │  │ (multi-   │  │ Manager   │  │           │  │ (Phase 2)          │  │ │
│  │  │  provider)│  │           │  │           │  │                    │  │ │
│  │  └───────────┘  └───────────┘  └───────────┘  └────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                    DATA LAYER                                           │ │
│  │  ┌────────────┐  ┌────────────────┐  ┌──────────────────────────────┐ │ │
│  │  │ SQLite/    │  │ Vector Store   │  │ Git Repository               │ │ │
│  │  │ PostgreSQL │  │ (sqlite-vec    │  │ (worktrees for isolation)    │ │ │
│  │  │ (state +   │  │  + StarCoder   │  │                              │ │ │
│  │  │  memory)   │  │  embeddings)   │  │                              │ │ │
│  │  └────────────┘  └────────────────┘  └──────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘

DATA FLOW (v2 — Persona Model):
  User ──► Tauri Shell ──► Guardian (Orchestrator Mask) ──► Task Decomposition
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              Guardian         Guardian         Guardian
              (Backend         (Frontend        (Schema
               Coder Mask)      Coder Mask)      Coder Mask)
              [worktree-1]     [worktree-2]     [worktree-3]
                    │               │               │
                    └───────────────┼───────────────┘
                                    ▼
                          Guardian (Orchestrator) ──► Merge Worktrees
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              Guardian         Guardian         Guardian
              (Backend         (Security        (Silent Fallback
               Reviewer Mask)   Reviewer Mask)   Detector Mask)
              [concurrent LLM calls — read-only]
                    │               │               │
                    └───────────────┼───────────────┘
                                    ▼
                          Findings Synthesizer ──► PASS/FAIL
                                    │
                              ┌─────┴─────┐
                              ▼           ▼
                           PR Gen    Fix Loop (max 3)
```

---

## 7. Panelist Updated Grades

### 1. The Systems Architect — **Grade: A** (was A-)

> **What improved:** The persona model eliminates the Python subprocess management problem I flagged in v1. No more process lifecycle, crash recovery, or IPC complexity. One entity, one process, multiple masks. The FastAPI sidecar concern remains but is now a simpler problem — one sidecar, not ten.
>
> **Remaining concern:** Context window pressure under rapid persona switching is the new scaling bottleneck. The architecture needs explicit benchmarks: how many persona switches per task before context degrades? What's the measured token cost of tag-biased retrieval vs. clean context?

### 2. The DevEx Lead — **Grade: A-** (was B+)

> **What improved:** The persona model creates a much better UX story. Instead of "10 opaque processes running," the user sees "Guardian is now acting as Security Reviewer." The mental model is intuitive — one assistant wearing different hats. Activity panel design is now straightforward: show the current mask, its progress, and the mask queue.
>
> **Remaining concern:** Persona switching needs to be *visible* to the user, not just logged. When Guardian switches from Backend Coder to Security Reviewer, the UI should visually indicate the perspective change. Without this, the user can't tell if findings come from fresh eyes or the same entity that wrote the code.

### 3. The Infrastructure Engineer — **Grade: A** (was A-)

> **What improved:** Dramatic simplification. One Python process instead of ten. SQLite + Tauri IPC replaces Redis entirely. The worktree isolation model is preserved (still correct) while everything above it gets simpler. Deployment is trivially a single Tauri binary + Python sidecar.
>
> **Remaining concern:** Team/server mode is still hand-waved, but the persona model actually makes it *harder* — in v1, you could scale by adding more agent processes. In v2, the single Guardian entity becomes the bottleneck. Team mode needs a "Guardian-per-user" model or a shared Guardian with user-scoped persona instances. This needs design before Phase 3.

### 4. The AI/ML Architect — **Grade: A+** (was A)

> **What improved:** The persona model is the single best architectural decision in this entire project. It matches how large language models actually work — they're not separate agents, they're one model with different prompts. The tag-biased retrieval is elegant and implementable with existing vector store infrastructure (just add a tag weight to the similarity score). The concurrent LLM calls for parallelism is the honest, correct approach.
>
> **Remaining concern:** Model selection per persona needs careful calibration. The Orchestrator mask needs the best reasoning model. Coding masks need coding-optimized models. Review masks need reasoning models. If all share one context, model switching per mask means either (a) maintaining separate conversations per model or (b) replaying context on each switch. Need to decide and benchmark.

### 5. The Security Architect — **Grade: A-** (was B+)

> **What improved:** CyberAlchemy's formal verification of persona capabilities (AgenticFrame + SafetyBounds + DruidPermissions) addresses my v1 concern about agent security. Instead of OS-level process sandboxing (which was always leaky for LLM agents), we get *proven capability bounds*. The security reviewer persona *mathematically cannot write files*. That's stronger than any process sandbox.
>
> **Remaining concern:** The formal verification is Phase 2. In the MVP, persona tool scoping is policy-based, not proof-based. An adversarial prompt injection could still convince Guardian-wearing-coder-mask to act outside its declared scope. The MVP needs at minimum: (1) output validation against declared tool scope (did the coder mask only write to its worktree?), (2) a diff audit before merge (does the diff contain only expected file types and paths?). These are v1 security measures that must ship in the MVP, not wait for CyberAlchemy proofs.

### 6. The Frontend Architect — **Grade: B+** (was B+, unchanged)

> **What improved:** The persona model simplifies the backend but doesn't directly change the frontend challenge. The Activity Panel UX is clearer now (show persona transitions), which is good.
>
> **Remaining concern:** Same as v1 — the IDE UI architecture is still underspecified. Panel layout, state management for concurrent persona updates, theming, editor integration patterns. The persona model makes the *backend* simpler but the *frontend* still needs a comprehensive UI architecture. I want to see a Figma mockup or at least a panel taxonomy before Sprint 2.

### 7. The Integration Architect — **Grade: A** (was A-)

> **What improved:** The elimination of the Agent Contract Spec is the biggest win. In v1, I flagged undefined IPC protocols as the #1 integration risk. The persona model eliminates IPC entirely — it's all in-process communication via mask switching and shared memory. The Z7Lab integration is also cleaner: markdown specs → persona definitions is a direct mapping with no protocol translation.
>
> **Remaining concern:** The persona definition format (YAML shown in §5) needs to be formally specified and versioned. This IS the new "agent contract" — just internal instead of external. If persona definitions are ad-hoc, every mask will behave inconsistently. Recommend: JSON Schema for persona definitions, validated on load, versioned with semver.

### Grade Summary

| Panelist | v1 Grade | v2 Grade | Delta |
|----------|----------|----------|-------|
| Systems Architect | A- | **A** | +½ |
| DevEx Lead | B+ | **A-** | +1 |
| Infrastructure Engineer | A- | **A** | +½ |
| AI/ML Architect | A | **A+** | +½ |
| Security Architect | B+ | **A-** | +1 |
| Frontend Architect | B+ | **B+** | — |
| Integration Architect | A- | **A** | +½ |
| **Panel Average** | **B+/A-** | **A/A-** | **+½ grade** |

---

## 8. Appendix: Persona Definition Schema (Draft)

```yaml
# Persona Definition Format v0.1
persona:
  id: string          # Unique identifier (kebab-case)
  name: string        # Human-readable name
  version: string     # Semver
  source: string      # Origin (e.g., "z7lab/security-reviewer.md")
  
  system_prompt: string  # Full system prompt for this persona
  
  memory:
    primary_tags: [string]    # Tags weighted 3× in retrieval
    secondary_tags: [string]  # Tags weighted 1.5× in retrieval
    cross_domain: boolean     # Can access any tag at 1× weight
    write_tags: [string]      # Tags applied to memories this persona creates
    
  tools:
    read: [glob]       # File read patterns allowed
    write: [glob]      # File write patterns allowed (empty = read-only)
    exec: [string]     # Commands allowed (empty = no exec)
    network: [string]  # Endpoints allowed (empty = no network)
    
  model:
    preference: string  # "reasoning" | "coding" | "fast"
    specific: string?   # Optional specific model override
    
  output:
    format: string      # "code" | "findings_report" | "plan" | "freeform"
    
  cyberalchemy:         # Phase 2+
    frame: string?      # AgenticFrame proof reference
    bounds: string?     # SafetyBounds proof reference
    permissions: string? # DruidPermissions proof reference
```

---

## 9. Appendix: Comparison — v1 vs v2 Architecture

| Dimension | v1 (Multi-Agent) | v2 (Persona Model) | Winner |
|-----------|-------------------|---------------------|--------|
| Runtime complexity | 10+ Python subprocesses | 1 Guardian + concurrent LLM calls | **v2** |
| IPC overhead | JSON Schema agent contracts | None (shared memory) | **v2** |
| Context efficiency | Duplicated project context per agent | Single shared context, tag-biased retrieval | **v2** |
| True parallelism | Process-level (limited by LLM API) | LLM call-level (same practical limit, less overhead) | **Tie** |
| Cross-domain awareness | Agents siloed, explicit messaging | Global awareness, biased retrieval | **v2** |
| Accountability | Clear (separate agents) | Blurred (same entity) — mitigated by mask + tag audit trail | **v1** (slight edge) |
| Security enforcement | OS-level sandboxing | Policy-based (MVP) → Formal proofs (Phase 2) | **v1** (MVP) / **v2** (Phase 2) |
| Implementation effort | ~12 weeks to multi-agent pipeline | ~4 weeks to persona pipeline | **v2** |
| Scalability (team mode) | Add more agent processes | Guardian-per-user or shared Guardian with user scoping | **v1** (slight edge) |
| Debuggability | Multiple processes to inspect | Single process, clear mask transitions | **v2** |

**Overall:** v2 wins 7 of 10 dimensions. The two areas where v1 has an edge (accountability, team scalability) are addressable with audit trails and Phase 3 architecture work. The implementation effort savings alone (12 weeks → 4 weeks) justify the switch.

---

*Panel reconvened and adjourned. The shapeshifter architecture is the path forward. Build Guardian with masks, not an army of agents.*

**Document hash:** SHA-256 of content at time of panel adjournment
**Next review:** After MVP ship (Day 30) — reconvene panel for Phase 2 planning
