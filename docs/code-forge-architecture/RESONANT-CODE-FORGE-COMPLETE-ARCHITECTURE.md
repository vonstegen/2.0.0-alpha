# RESONANT CODE FORGE — Complete Architecture Document

**Version:** 1.0  
**Date:** 2026-06-03  
**Status:** Definitive Reference  
**Audience:** Engineers, founders, investors, non-technical team members  
**Sources:** 4 Linus Panel iterations (v1, v2, v3/final v2), 16 codebases, 11 expert panelists

---

## Table of Contents

1. [Part 1: What Is Code Forge?](#part-1-what-is-code-forge)
2. [Part 2: The Code Swarm — How It Works](#part-2-the-code-swarm--how-it-works)
3. [Part 3: The Architecture](#part-3-the-architecture)
4. [Part 4: The Three Orchestration Altitudes](#part-4-the-three-orchestration-altitudes)
5. [Part 5: Memory Architecture](#part-5-memory-architecture)
6. [Part 6: The Methodology — Promptnomicon](#part-6-the-methodology--promptnomicon)
7. [Part 7: Build vs. Integrate](#part-7-build-vs-integrate)
8. [Part 8: The 30-Day MVP](#part-8-the-30-day-mvp)
9. [Part 9: What Makes This Different](#part-9-what-makes-this-different)
10. [Part 10: The Panel Record](#part-10-the-panel-record)
11. [Part 11: All Panelist Verdicts (Final)](#part-11-all-panelist-verdicts-final)
12. [Part 12: Risks and Bets](#part-12-risks-and-bets)
13. [Part 13: Complete Codebase Inventory](#part-13-complete-codebase-inventory)
14. [Appendix A: Glossary](#appendix-a-glossary)
15. [Appendix B: Technology Stack Reference](#appendix-b-technology-stack-reference)

---

# Part 1: What Is Code Forge?

> **Plain English:** Code Forge is a desktop application that writes, reviews, and fixes code using a single AI brain that wears different "hats" — one minute it's a backend coder, the next it's a security reviewer, then a documentation checker. Unlike tools that run a dozen separate AI agents (expensive, slow, hard to coordinate), Code Forge uses one entity that switches roles instantly while remembering everything from every role. It's like having one brilliant developer who is also a security expert, a code reviewer, and a documentation specialist — and who never forgets context when switching between those roles.

## The One-Paragraph Pitch

Code Forge is a desktop coding environment built on a single architectural insight: **one entity wearing verified persona masks beats an army of agents**. A Guardian process — a FastAPI/Python sidecar inside a Tauri desktop shell — decomposes coding tasks, switches persona masks to execute them (backend coder, security reviewer, docs reviewer), and uses tag-partitioned memory for cross-domain awareness without context duplication. What makes it different from Cursor, Windsurf, Claude Code, Codex CLI, or Emdash: (1) the persona model eliminates multi-process overhead while preserving genuine perspective shifts via Z7Lab reviewer specifications, (2) CyberAlchemy's Lean 4 proofs formally verify what each persona can and cannot do — not policy files, mathematical proofs, (3) Arcanum's Craft Method provides a speed-governed development lifecycle that prevents agents from skipping validation steps, and (4) CRABS protocol gives attribute-based state machines where permissions auto-derive from project state, not static configuration.

## The Kitchen Analogy

For anyone who's ever watched a professional kitchen:

| Kitchen | Code Forge | What It Does |
|---------|-----------|--------------|
| **Head Chef** | **Guardian** | One person who runs the entire kitchen. Tastes everything, coordinates timing, makes final calls. Guardian is the single AI entity that orchestrates all coding work. |
| **Stations** (grill, pastry, sauté) | **Persona Masks** | The head chef doesn't hire separate people for each station — they move between stations, wearing the right apron and using the right tools for each. Guardian switches persona masks: Backend Coder, Security Reviewer, Docs Reviewer, etc. |
| **Recipe Books** | **Skillsbot** | 167 structured skill packs that walk agents through specific tasks page by page, like a recipe book that tells you "do this step, check this, now move to the next page." |
| **Health Inspector** | **Tandem** | The authority that says "you can't serve that dish until it passes inspection." Tandem provides runtime governance — approval gates, audit trails, tenant-aware sessions. The model doesn't get to decide what it's allowed to do. |
| **Quality Checklist** | **Craft Method** | The five-stage lifecycle (raw→typed→refined→proposed→resolved) that ensures no dish leaves the kitchen without being properly prepared, tasted, plated, and approved. No skipping steps. |
| **The Menu / Order System** | **Campaign-Runner** | Takes a customer's order ("I want the tasting menu") and breaks it into individual dishes, assigns them to stations, tracks progress, and ensures everything comes out at the right time. |

---

# Part 2: The Code Swarm — How It Works

> **Plain English:** When you ask Code Forge to build something, it breaks your request into small pieces, writes code for each piece in separate workspaces, then reviews its own work from multiple perspectives (security, quality, documentation), fixes any issues found, and presents you with a clean set of changes to approve. The whole process is governed — no step can be skipped, and you can see exactly what the AI is doing at every moment.

## The Full Pipeline

```
┌──────────────────────────────────────────────────────────────────────┐
│                    CODE FORGE PIPELINE                                │
│                                                                      │
│  USER: "Add OAuth2 login with Google"                                │
│         │                                                            │
│         ▼                                                            │
│  ┌─────────────────────┐                                             │
│  │   ORCHESTRATOR MASK │  1. Understand intent                       │
│  │   (Planning)        │  2. Decompose into SCUs                     │
│  │                     │  3. Select persona masks                    │
│  │                     │  4. Create isolated worktrees               │
│  └──────────┬──────────┘                                             │
│             │                                                        │
│    ┌────────┼────────┐    PARALLEL CODING PHASE                      │
│    ▼        ▼        ▼    (concurrent LLM calls)                     │
│  ┌──────┐ ┌──────┐ ┌──────┐                                         │
│  │Back- │ │Front-│ │Schema│  Each persona writes code                │
│  │end   │ │end   │ │Coder │  in its own git worktree                 │
│  │Coder │ │Coder │ │Mask  │  Speed governor: raw→typed→refined       │
│  │Mask  │ │Mask  │ │      │                                          │
│  └──┬───┘ └──┬───┘ └──┬───┘                                         │
│     └────────┼────────┘                                              │
│              ▼                                                       │
│  ┌─────────────────────┐                                             │
│  │   ORCHESTRATOR MASK │  Merge worktrees into unified diff          │
│  │   (Integration)     │                                             │
│  └──────────┬──────────┘                                             │
│             │                                                        │
│    ┌────────┼────────┬──────────┐  REVIEW SWARM PHASE                │
│    ▼        ▼        ▼          ▼  (concurrent, read-only)           │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                                │
│  │Back- │ │Secur-│ │Silent│ │Docs  │                                 │
│  │end   │ │ity   │ │Fall- │ │Revie-│                                 │
│  │Revie-│ │Revie-│ │back  │ │wer   │                                 │
│  │wer   │ │wer   │ │Detect│ │Mask  │                                 │
│  └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘                                │
│     └────────┼────────┴────────┘                                     │
│              ▼                                                       │
│  ┌─────────────────────┐                                             │
│  │  FINDINGS SYNTHESIZE│  Merge all reviews, rank by severity        │
│  │  (severity-ranked)  │                                             │
│  └──────────┬──────────┘                                             │
│             │                                                        │
│        ┌────┴────┐                                                   │
│        ▼         ▼                                                   │
│     ┌──────┐  ┌──────────────┐                                       │
│     │ PASS │  │ FAIL         │                                       │
│     │      │  │ → Fix Loop   │  Route findings back to coding masks  │
│     └──┬───┘  │   (max 3)    │  Speed governor still enforced        │
│        │      └──────┬───────┘                                       │
│        │             │                                               │
│        └──────┬──────┘                                               │
│               ▼                                                      │
│  ┌─────────────────────┐                                             │
│  │  DIFF REVIEW +      │  User inspects changes                     │
│  │  PR GENERATION      │  Approve, edit, or reject                  │
│  └─────────────────────┘                                             │
└──────────────────────────────────────────────────────────────────────┘
```

## Step-by-Step Walkthrough: "Add OAuth2 Login with Google"

### Step 1: Orchestrator Mask — Decomposition

Guardian activates the Orchestrator persona mask. It reads the project's structure via tree-sitter project maps and LSP, then decomposes the request using SCU (Smallest Coherent Unit) decomposition from the Arcanum Craft Method:

| SCU # | Task | Persona | Worktree |
|-------|------|---------|----------|
| 1 | Add Google OAuth2 backend routes + token validation | Backend Coder | `worktree-oauth-backend` |
| 2 | Add login button + OAuth redirect handler in frontend | Frontend Coder | `worktree-oauth-frontend` |
| 3 | Add `users.oauth_provider` + `users.oauth_id` columns, migration | Schema Coder | `worktree-oauth-schema` |

Each SCU is a PCRA unit — has clear **P**urpose, **C**ontext, **R**equirements, and **A**cceptance criteria.

### Step 2: Parallel Coding Phase

Guardian spawns concurrent LLM calls, each with a different persona mask's system prompt:

- **Backend Coder Mask** → calls an LLM (e.g., Claude Sonnet) with the backend-specialist system prompt. Writes `routes/auth.py`, `services/oauth.py`. Memories tagged `#backend #auth`.
- **Frontend Coder Mask** → calls an LLM (e.g., GPT-4.1) with the frontend-specialist system prompt. Writes `components/LoginButton.tsx`, `hooks/useAuth.ts`. Memories tagged `#frontend #auth`.
- **Schema Coder Mask** → calls an LLM (e.g., DeepSeek Coder) with the schema-specialist system prompt. Writes `migrations/003_add_oauth.sql`. Memories tagged `#schema #auth`.

Each persona writes code in its own isolated git worktree. The speed governor ensures each artifact passes through `raw` → `typed` → `refined` before proceeding.

### Step 3: Merge and Review

The Orchestrator mask merges all worktrees into a unified diff. Then Guardian switches to reviewer personas — four concurrent, read-only LLM calls:

- **Backend Reviewer**: Checks route structure, error handling, middleware ordering
- **Security Reviewer**: Traces OAuth flow end-to-end — token validation, PKCE, state parameter, CORS, redirect URI validation
- **Silent Fallback Detector**: Catches `?.` chains hiding null auth tokens, swallowed exceptions in token exchange, `|| {}` masking failed user lookups
- **Docs Reviewer**: Checks if `README.md` mentions the new OAuth setup, env var documentation for `GOOGLE_CLIENT_ID`

**Cross-domain awareness in action:** The security reviewer sees *why* the backend coder chose a particular token validation approach (it's in the shared memory, tagged `#backend #auth`). In a multi-agent system, the security reviewer would only see the code, not the intent.

### Step 4: Fix Loop

The Findings Synthesizer merges all review outputs:

| Severity | Finding | Source |
|----------|---------|--------|
| 🔴 Critical | OAuth state parameter not validated — CSRF vulnerability | Security Reviewer |
| 🟡 High | Token exchange error caught and returns `{}` — masks auth failures | Silent Fallback Detector |
| 🟢 Low | Missing `GOOGLE_CLIENT_SECRET` in `.env.example` | Docs Reviewer |

Findings route back to the appropriate coding persona. The Backend Coder mask fixes the CSRF issue and the error handling. Speed governor enforced — fixes go through `raw` → `typed` → `refined` again. Maximum 3 fix iterations.

### Step 5: Ship

After review pass, Code Forge presents:
- Clean unified diff for user approval
- Severity-ranked findings report (what was found and fixed)
- Auto-generated PR with intent summary, changes, and review evidence

## How the Persona Model Makes It a Shapeshifter, Not an Army

The key insight — articulated by Chris Millan and validated by all 11 panelists — is that Code Forge is **not** multiple agents coordinating. It is **one entity** that changes perspective.

```
MULTI-AGENT (what competitors do):            PERSONA MODEL (Code Forge):

┌─────────┐  ┌─────────┐  ┌─────────┐        ┌─────────────────────────┐
│ Agent 1  │  │ Agent 2  │  │ Agent 3  │        │      GUARDIAN           │
│ Backend  │  │ Security │  │ Docs     │        │                         │
│ Coder    │  │ Reviewer │  │ Reviewer │        │  [mask: Backend Coder]  │
│          │  │          │  │          │        │  [mask: Security Rev.]  │
│ OWN      │  │ OWN      │  │ OWN      │        │  [mask: Docs Reviewer]  │
│ CONTEXT  │  │ CONTEXT  │  │ CONTEXT  │        │                         │
│ WINDOW   │  │ WINDOW   │  │ WINDOW   │        │  ONE SHARED MEMORY      │
│          │  │          │  │          │        │  Tag-biased retrieval    │
│ IPC ◄────┤  ├────► IPC │  │ IPC      │        │  Cross-domain access    │
└─────────┘  └─────────┘  └─────────┘        └─────────────────────────┘

3 processes, 3 context windows,               1 process, 1 memory store,
JSON Schema contracts, message passing,       mask switching in ~0ms,
duplicated project context                    no IPC, no duplication
```

> **Linus Torvalds:** "One process. One address space. Shared memory. The multi-process agent design was a distributed systems problem nobody needed to solve."

> **Chris Millan (Codexify):** "It's just a tag, nothing exotic. The persona's primary tags get weighted higher in retrieval. Cross-domain access isn't blocked — it's just not biased toward. The elegance is that the security reviewer naturally gravitates toward security-tagged memories but can access backend memories when tracing an auth flow through the codebase."

---

# Part 3: The Architecture

> **Plain English:** Code Forge is built in six layers, from the user-facing desktop app at the top to the governance and verification system at the bottom. Each layer has a specific job. The desktop shell shows you what's happening. The Guardian core runs the AI. Persona masks give it different specialist perspectives. Memory stores everything with smart tagging. The review system catches bugs. And the governance layer ensures the AI can't skip steps or exceed its authority.

## The 6-Layer Stack

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          RESONANT CODE FORGE — 6-LAYER STACK                    │
│                                                                                 │
│  L6 ┌───────────────────────────────────────────────────────────────────────┐   │
│     │  DESKTOP SHELL (resonantos-vnext)                                     │   │
│     │  Tauri 2.x + React/TS + Monaco Editor                                │   │
│     │  Activity Panel │ Findings Panel │ Memory Explorer │ Campaign Timeline│   │
│     └────────────────────────────────────┬──────────────────────────────────┘   │
│                                          │ Tauri IPC (invoke)                   │
│  L5 ┌────────────────────────────────────┼──────────────────────────────────┐   │
│     │  REVIEW & VERIFICATION             │                                  │   │
│     │  Skillsbot (167 packs, 118 OWASP) │ CyberAlchemy Oracle (Phase 2)   │   │
│     │  Z7Lab Reviewers │ Findings Synth │ Diff Sandbox                     │   │
│     └────────────────────────────────────┼──────────────────────────────────┘   │
│                                          │                                      │
│  L4 ┌────────────────────────────────────┼──────────────────────────────────┐   │
│     │  EXECUTION                         │                                  │   │
│     │  Git Worktrees │ Docker Sandboxes │ agent-sudo                       │   │
│     │  LSP Bridge (shared) │ Tree-sitter Project Maps                      │   │
│     └────────────────────────────────────┼──────────────────────────────────┘   │
│                                          │                                      │
│  L3 ┌────────────────────────────────────┼──────────────────────────────────┐   │
│     │  ORCHESTRATION — GUARDIAN CORE     │                                  │   │
│     │  Persona Engine │ LLM Router │ Campaign Manager                      │   │
│     │  Tag-Partitioned Memory │ Speed Governor                              │   │
│     └────────────────────────────────────┼──────────────────────────────────┘   │
│                                          │                                      │
│  L2 ┌────────────────────────────────────┼──────────────────────────────────┐   │
│     │  ROUTING & DISPATCH (Personal Dispatcher)                             │   │
│     │  Skill-based intent matching │ Dispatch queue │ 64 CMD skills         │   │
│     │  10 plugins │ MCP server │ Macro/trigger/chain system                 │   │
│     └────────────────────────────────────┼──────────────────────────────────┘   │
│                                          │                                      │
│  L1 ┌────────────────────────────────────┼──────────────────────────────────┐   │
│     │  GOVERNED RUNTIME (Tandem 0.5)     │                                  │   │
│     │  Runtime authority projection │ Approval gates                        │   │
│     │  Tenant-aware sessions │ Tool ledger │ Audit trails                   │   │
│     └───────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Governed Runtime — Tandem 0.5

> **Plain English:** Tandem is the safety net. It ensures the AI can't do anything consequential without permission. It's not an AI — it's a runtime engine that controls what the AI is allowed to do, tracks everything it does, and requires human approval for anything irreversible. Think of it as the compliance department for AI agents.

### What It Does

Tandem provides **runtime authority projection** — the model is not the access-control perimeter. The runtime is. This is a fundamental architectural distinction: most AI coding tools let the model decide what it can do (via system prompts). Tandem says the model's opinion about its permissions is irrelevant — the runtime enforces boundaries regardless.

### Core Capabilities

| Capability | Description | Codebase |
|-----------|-------------|----------|
| **Approval Gates** | Runs halt before consequential actions. Three outcomes: approve, rework, cancel. | `frumu-ai/tandem` — Rust workspace, `run.rs` |
| **Tenant-Aware Sessions** | Every session carries tenant context. Multi-user isolation is architectural, not bolted on. | `frumu-ai/tandem` — `session.rs` |
| **Tool Ledger** | Every tool invocation recorded: what was called, with what arguments, what happened. Immutable audit trail. | `frumu-ai/tandem` — `ledger.rs` |
| **Audit Trails** | Approval decisions, policy denials, protected records. EU AI Act compliance-capable. | `frumu-ai/tandem` — `audit.rs` |
| **Permissioned Memory** | Vector-backed retrieval with tenant partitioning and knowledge spaces. | `frumu-ai/tandem` — `memory.rs` |
| **MCP Tool Governance** | Connector tools scoped per workflow step — a tool available in step 1 may not be available in step 3. | `frumu-ai/tandem` — `mcp.rs` |

### How It Connects

Tandem runs as a sidecar to the Code Forge process. Guardian communicates with Tandem via a Python SDK (`tandem-client`) over HTTP/SSE to `localhost:39731`. Tandem binds to `127.0.0.1` only — no network exposure.

```
Guardian Core (port 8888)
    │
    ├── Tool invocation
    │         │
    │         ▼
    │   Tandem Engine (port 39731)
    │         │
    │         ├── Check: Is this tool call permitted?
    │         ├── Check: Does this need human approval?
    │         ├── Log to tool ledger
    │         └── Return: APPROVED / NEEDS_APPROVAL / DENIED
    │
    └── Continue or halt based on Tandem's verdict
```

### What Tandem Owns vs. What It Doesn't

| Tandem Owns | Tandem Does NOT Own |
|------------|---------------------|
| Task state (blackboards) | Channel I/O (Discord, etc.) |
| Workflow orchestration | Tool execution |
| Checkpoints and replay | LLM API calls |
| Run history and events | Memory files (MEMORY.md) |
| Session-scoped vector memory | SSH to fleet machines |

> **Evans (Tandem creator):** Tandem should be used as "the runtime authority projection layer — the thing that makes the difference between 'the model says it should have permission' and 'the runtime proves it has permission.'"

---

## Layer 2: Routing & Dispatch — Personal Dispatcher

> **Plain English:** The Dispatcher is the traffic controller. When you tell Code Forge what you want to do, the Dispatcher figures out which skill, tool, or workflow should handle it. It understands natural language ("review the backend for security issues") and routes to the right handler. It also manages a work queue so tasks don't get lost.

### Architecture

The Personal Dispatcher is a FastAPI backend (port 5170) with an MCP server (port 5171). It has two execution paths:

1. **`POST /api/chat`** — Natural language input → LLM routes to the right skill
2. **`POST /api/command`** — Structured CLI commands → parsed directly, no LLM needed

Both paths share the same audit, memory, eval logging, and guardrail pipeline.

### Skill-Based Intent Matching

The Dispatcher loads **64 CMD skill files** from `skills/` at startup. Each skill has YAML frontmatter defining its name, description, action, and parameters. The registry generates a single `run` tool schema with structured parameters and enum constraints — no hardcoded routing table.

Skills are organized into 10 groups:

| Group | Count | Purpose |
|-------|-------|---------|
| `calendar/` | 3 | Event scheduling |
| `infrastructure/` | 2 | Service management |
| `knowledge/` | 11 | KB search, chat, RAG |
| `macro/` | 7 | Automation chains |
| `memory/` | 3 | Observation storage/recall |
| `pipeline/` | 3 | Build/deploy pipelines |
| `project/` | 2 | Project context |
| `queue/` | 16 | Task queue management |
| `routing/` | 5 | Meta-routing |
| `trigger/` | 12 | Event-driven automation |

### Dispatch Queue

Tasks flow through a governed lifecycle:

```
captured → planning → ready → active → done
```

Each stage has specific requirements. A task cannot move to `active` without all required fields populated. The queue tracks tasks across sessions with types (dev, research, review, calendar, planning, general).

### The 10 Plugins

| Plugin | Purpose | Codebase |
|--------|---------|----------|
| `sandbox_claude` | Claude Code sandbox execution | `personal-dispatcher/app/plugins/sandbox_claude/` |
| `sandbox_codex` | Codex CLI sandbox execution | `personal-dispatcher/app/plugins/sandbox_codex/` |
| `sandbox_vm` | VM-based sandboxed execution | `personal-dispatcher/app/plugins/sandbox_vm/` |
| `sandbox` | Generic sandbox orchestration | `personal-dispatcher/app/plugins/sandbox/` |
| `review` | Code review orchestration (Z7Lab integration) | `personal-dispatcher/app/plugins/review/` |
| `deliberation_bot` | Multi-agent deliberation sessions | `personal-dispatcher/app/plugins/deliberation_bot/` |
| `skillsbot` | Skillsbot MCP bridge | `personal-dispatcher/app/plugins/skillsbot/` |
| `markdownkb` | Markdown knowledge base RAG | `personal-dispatcher/app/plugins/markdownkb/` |
| `venice_catalog` | Venice AI model catalog | `personal-dispatcher/app/plugins/venice_catalog/` |
| `example` | Plugin template | `personal-dispatcher/app/plugins/example/` |

### MCP Server & Redaction Layer

The MCP server (port 5181) exposes all dispatcher skills as MCP tools. External agents (Claude Code, Codex CLI, Cursor) can invoke Dispatcher skills via standard MCP protocol. A redaction layer strips sensitive information before returning results to external clients.

---

## Layer 3: Orchestration — Guardian (THE BUILD)

> **Plain English:** Guardian is the brain of Code Forge. It's a single AI entity that can wear different "hats" (called persona masks) to act as different specialists. When it wears the Backend Coder hat, it thinks like a backend developer. When it switches to the Security Reviewer hat, it thinks like a security expert — but it still remembers everything the backend coder just did. This "one brain, many hats" approach is what makes Code Forge fundamentally different from every competitor.

### The Persona Engine

The Persona Engine is the core innovation. It manages:

1. **Mask definitions** — Each persona is defined in YAML with a system prompt, memory tag biases, tool scope, and model preference
2. **Mask switching** — Switching is a system prompt swap + memory bias change. Sub-millisecond. No IPC, no process spawn.
3. **Concurrent execution** — For parallel work, Guardian spawns concurrent LLM API calls, each with a different persona mask's system prompt

```yaml
# Example: Security Reviewer Persona Definition
persona:
  id: security-reviewer
  name: "Security Reviewer"
  source: z7lab/security-reviewer.md

  system_prompt: |
    [Full Z7Lab Security Reviewer instruction set]
    You trace auth flows end-to-end. You check injection vectors.
    You verify CORS, rate limiting, secrets management.

  memory:
    primary_tags: ["#security", "#review"]
    secondary_tags: ["#auth", "#injection", "#cors", "#secrets"]

  tools:
    read: ["**/*"]        # Full read access
    write: []             # No write access — reviewer CANNOT write
    exec: []              # No exec access
    network: []           # No network access

  model:
    preference: "reasoning"  # Use best reasoning model
```

### Tag-Partitioned Memory with Biased Retrieval

This is the memory architecture that every panelist called "genuinely novel" (Harrison Chase's words).

```
GUARDIAN'S GLOBAL MEMORY STORE
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

RETRIEVAL RULES:
  Active persona's primary tags:   3× weight in relevance scoring
  Active persona's secondary tags: 1.5× weight
  All other tags:                  1× weight (accessible, NOT blocked)
  #project:* tags:                 ALWAYS included regardless of persona
```

The elegance: the security reviewer naturally gravitates toward security-tagged memories. But when tracing an auth flow, it can access `#backend` memories at full weight via explicit cross-domain query. No silos. No barriers. Just weighted retrieval.

> **Harrison Chase (LangChain):** "Tag-partitioned memory with persona bias is the most interesting memory architecture I've seen outside of research papers. Cross-domain access without hard silos is exactly right."

### Cross-Domain Awareness

This is the engineering consequence of the persona model that competitors cannot match:

When the Security Reviewer examines the OAuth code, it has access to the Backend Coder's memories of *why* the code was written that way — the reasoning, the alternatives considered, the tradeoffs made. In a multi-agent system, the reviewer only sees the code. In Code Forge, the reviewer sees the code AND the intent.

> **Amjad Masad (Replit):** "Replit's agent isn't 10 agents. It's one agent with different prompts for different phases. Chris's persona model is the same insight, made explicit and formal."

### LLM Router (Multi-Provider)

Different personas benefit from different models:

| Persona Type | Model Preference | Rationale |
|-------------|-----------------|-----------|
| Orchestrator | Best reasoning (Claude Opus, GPT-4.1) | Task decomposition needs strong reasoning |
| Backend Coder | Coding-optimized (Claude Sonnet, DeepSeek Coder) | Code generation quality |
| Security Reviewer | Strong reasoning (Claude Opus, GPT-4.1) | Security analysis needs deep reasoning |
| Docs Reviewer | Fast model (GPT-4.1 Mini, Haiku) | Documentation review is less demanding |

The LLM Router supports OpenAI, Anthropic, DeepSeek, Groq, and local models (Ollama). Each persona mask can specify its preferred model, and the router handles provider-specific API differences.

**Codebase:** Guardian core lives in `Resonant-Jones/codexify-core` — FastAPI sidecar, port 8888. The Persona Engine, LLM Router, and Campaign Manager are the primary components.

---

## Layer 4: Execution

> **Plain English:** This is where code actually gets written and run. Each coding task gets its own isolated workspace (like separate folders that can't interfere with each other). The AI understands your code's structure through language server integration, and a project map tells it what's where before it starts working.

### Parallel Git Worktrees

Each coding persona operates in its own git worktree — a lightweight, isolated copy of the repository. Changes in one worktree don't affect another until explicitly merged.

```
main repo/
├── .git/
├── worktree-oauth-backend/    ← Backend Coder writes here
├── worktree-oauth-frontend/   ← Frontend Coder writes here
└── worktree-oauth-schema/     ← Schema Coder writes here
```

After all coding personas complete, the Orchestrator mask merges worktrees into a unified diff. Conflicts trigger a merge persona that resolves them with cross-domain memory context.

> **Dane Sherburn (Emdash):** "Git worktree isolation is proven correct — we validated this at scale."

### Docker Sandboxes (Z7Lab: codex-sandbox, claude-code-sandbox)

For execution safety, coding agents run inside Docker containers from the `codeswarm` repository:

| Container | Purpose | Codebase |
|-----------|---------|----------|
| `codex-sandbox` | Codex CLI in Docker with resource limits | `codeswarm/` |
| `claude-code-sandbox` | Claude Code in Docker with project isolation | `codeswarm/` |

Containers provide kernel-level isolation — the agent can only access what's mounted. Resource limits (CPU, memory, GPU) are configurable per project via presets.

### agent-sudo (Scoped Privilege Escalation)

When a persona needs elevated access (e.g., installing a system dependency), `agent-sudo` provides scoped, audited privilege escalation. Every elevation is logged to Tandem's tool ledger.

### LSP Bridge (Shared Across Persona Switches)

The LSP (Language Server Protocol) connection is persistent across persona switches. When the Backend Coder writes a function and the Security Reviewer examines it, the reviewer sees the same LSP diagnostics, type information, and reference graph.

> **John Carmack:** "The LSP connection should be persistent across persona switches. When the backend coder writes a function and the security reviewer examines it, the reviewer should see the same LSP diagnostics, type information, and reference graph. One LSP connection, shared across masks."

> **Charm Team (OpenCode):** "OpenCode's LSP integration is the feature that separates toy coding agents from real ones. Without LSP, the agent is working with text. With LSP, the agent is working with semantics."

### Tree-Sitter Project Maps

Before any coding begins, tree-sitter generates a structural project map — file types, function signatures, class hierarchies, import graphs. The Orchestrator mask uses this for intelligent task decomposition.

**Codebase:** Git worktree manager is built new for Code Forge. Docker sandboxes come from `codeswarm/`. LSP bridge is built new. Tree-sitter integration follows patterns from Plandex (15K★).

---

## Layer 5: Review & Verification

> **Plain English:** After code is written, it goes through a rigorous review process. 167 skill packs guide reviewers through structured checklists. Four specialized reviewers examine the code from different angles — backend quality, security vulnerabilities, silent bugs that don't crash but produce wrong results, and documentation. A synthesizer merges all findings and ranks them by severity. In Phase 2, a formal verification system (CyberAlchemy) will mathematically prove what each reviewer can and cannot do.

### Skillsbot MCP Walking Protocol

Skillsbot is the review knowledge base. It hosts **167 skill packs** across four kinds, serving them to agents page-by-page via an MCP walking protocol.

**Why walking instead of dumping?** A 500-line review checklist dumped into context wastes tokens. Skillsbot serves pages on demand — the agent holds a lightweight catalog (~1-2K tokens) and only pays for pages it actually walks. That's a **20-25× context reduction** compared to loading all skills upfront.

```
Agent: "start_walk: security-reviewer"
  ↓
Skillsbot: Page 1/12 — "Check authentication flows..."
  ↓
Agent: [performs check, adds to report]
Agent: "continue_walk"
  ↓
Skillsbot: Page 2/12 — "Check injection vectors..."
  ↓
... continues through all pages ...
  ↓
Agent: Final report with marker-anchored observations
```

### The 4 Skill Kinds

| Kind | Contract | Output |
|------|----------|--------|
| **Reviewers** | Walk project page-by-page, report observations | Marker-anchored findings report |
| **Implementers** | Modify project, build/restructure components | Change report (what changed, why) |
| **Planners** | Produce exploratory plans before refactor/feature | Item list for coding agent engagement |
| **Profilers** | Map structural surface (tech stack, attack surface) | Shared ground truth for downstream skills |

### 167 Skill Packs by Category

| Category | Packs | Examples |
|----------|-------|---------|
| `owasp/` | **118** | Authentication, XSS prevention, CORS, CSRF, injection, deserialization, Docker security, Django security, JWT security, Kubernetes hardening, and 108 more |
| `security/` | 8 | Attack surface, trust boundaries, credential management |
| `code-structure/` | 6 | Module organization, dependency graphs |
| `code-hygiene/` | 5 | Dead code, naming conventions, complexity |
| `quality/` | 5 | Test coverage, error handling patterns |
| `reliability/` | 4 | Resilience, fallback detection |
| `docs/` | 4 | README quality, API docs, Diátaxis structure |
| `planning/` | 4 | Architecture planning, refactor planning |
| `discovery/` | 3 | Project profiling, tech stack mapping |
| `ui/` | 3 | Accessibility, component patterns |
| `integration/` | 2 | API contract validation |
| `llm/` | 2 | Prompt engineering, context management |
| `build-deploy/` | 1 | CI/CD pipeline review |
| `evolution/` | 1 | Codebase evolution tracking |
| `git/` | 1 | Git workflow review |

**Codebase:** `skills-bot/` — Python package with registry, HTTP API (port 5180), MCP server (port 5181), CLI.

### CyberAlchemy Oracle (Phase 2 — Lean 4 Formal Verification)

CyberAlchemy provides 269 modules with 2,334 machine-verified Lean 4 theorems. For Code Forge, 14 modules (5.2%) are directly applicable — but those 14 are what make the persona model formally verifiable rather than policy-based.

**Phase 2 Integration (Weeks 5-8):**

| Module | Purpose in Code Forge |
|--------|----------------------|
| **AgenticFrame** | Formal capability declarations for each persona mask — what it CAN do |
| **SafetyBounds** | Formal limits on persona behavior — what it CANNOT do (proven, not declared) |
| **DruidPermissions** | Capability-based access proofs for tool scoping |
| **DruidSprite + SpriteDispatch** | Lightweight dispatch for concurrent persona LLM calls |
| **DecisionKernel** | Formally optimal task decomposition for the Orchestrator mask |
| **AgenticRank** | Optimal persona selection when multiple could handle a task |

> **Linus Torvalds:** "269 modules, 2,334 theorems, zero sorry. That's the most impressive part — they actually proved it all. Most 'formally verified' projects are 80% sorry and 20% theorem."

### Diff Sandbox (Speculative Execution)

Before any code change is committed, it goes through a diff review sandbox — the user inspects and approves changes. This is Code Forge's equivalent of a pull request review, happening before the PR is even created.

### Findings Synthesizer with Severity Ranking

The Findings Synthesizer merges outputs from all reviewer personas into a unified, severity-ranked report:

```
FINDINGS REPORT — OAuth2 Implementation
═══════════════════════════════════════

🔴 CRITICAL (1)
  [SEC-001] OAuth state parameter not validated
    File: routes/auth.py:47
    Source: Security Reviewer
    Impact: CSRF attack vector — attacker can forge auth callbacks

🟡 HIGH (1)
  [RES-001] Token exchange error returns empty dict
    File: services/oauth.py:23
    Source: Silent Fallback Detector
    Impact: Failed auth silently succeeds with empty user object

🟢 LOW (1)
  [DOC-001] Missing GOOGLE_CLIENT_SECRET in .env.example
    File: .env.example
    Source: Docs Reviewer
    Impact: New developers won't know to set this variable

VERDICT: FAIL — 1 critical finding requires fix before merge
```

---

## Layer 6: Desktop Shell — resonantos-vnext

> **Plain English:** This is what you see and interact with — the desktop application itself. It's a native app (not a website in a browser window) that runs on Mac, Windows, and Linux. It has a code editor, panels showing what the AI is doing, a review findings panel, a memory browser, and more. It's built to be extended with add-ons, like a phone with apps.

### Technical Stack

- **Tauri 2.x** — Rust-based desktop framework. Ships as a single binary (~15MB), vs Electron's ~200MB.
- **React + TypeScript** — 117 source files across 16 modules
- **24 Rust service files** — IPC handlers, persistence, sideload commands
- **32 ADRs** (Architecture Decision Records) — documenting every significant design choice

> **Guillermo Rauch (Vercel):** "Ship a URL or a binary. Tauri is the binary answer. Electron is 200MB of Chromium. Tauri is 15MB."

### The 16 Modules

| Module | Purpose |
|--------|---------|
| `chat` | AI conversation interface (Augmentor Chat) |
| `compute` | Compute fabric management |
| `delegation` | Task delegation to coding agents |
| `terminal` | Embedded terminal with Guardian awareness |
| `browser` | Resonant Browser (CamoFox-based) |
| `archive` | Living Archive memory domains |
| `addons` | Add-on discovery, installation, management |
| `settings` | Configuration UI |
| `shell` | Desktop shell frame, window management |
| `overview` | System overview dashboard |
| `recovery` | Recovery ladder for failure states |
| `hermes` | Hermes Agent integration |
| `obsidian` | Obsidian workspace addon |
| `opencode` | OpenCode TUI addon |
| `paperclip` | Organizational runtime addon |
| `strategist` | Strategic planning interface |

### Key UI Panels for Code Forge

| Panel | What It Shows |
|-------|--------------|
| **Activity Panel** | Live persona state, progress through SCU tasks, which mask is active, diffs-in-flight |
| **Review Findings Panel** | Severity-ranked issues with inline code links, filter by reviewer persona |
| **Memory Explorer** | Browse tagged memories, see retrieval bias per persona, inspect cross-domain access |
| **Campaign Timeline** | Visual task decomposition, progress through speed governor stages, dependencies |

### Browser-First Extension Architecture

resonantos-vnext uses an add-on SDK with manifest-based registration, explicit capability grants, and a shared/private provider model. Add-ons are sideloaded and validated against JSON Schema-based manifests.

### guardian-mobile (React Native)

A mobile companion app for Guardian — view activity, approve changes, review findings on the go. Built with React Native (Expo).

**Codebase:** `resonantos-vnext/` — Tauri + React/TS desktop app. `guardian-mobile/` — React Native mobile app.

---

# Part 4: The Three Orchestration Altitudes

> **Plain English:** Code Forge has three systems working at different "altitudes" to manage work. Campaign-Runner works at the strategic level — breaking big projects into multi-step plans. Craft Speed Governor works at the quality level — making sure no individual step cuts corners. The Dispatcher works at the tactical level — routing each individual request to the right handler in real time. A task flows down through all three: Campaign-Runner plans it, Dispatcher routes it, Craft ensures it's done right.

## The Three Systems

```
ALTITUDE MAP:

30,000 ft  ┌─────────────────────────────────────┐
  STRATEGIC │  CAMPAIGN-RUNNER                     │
            │  "Build OAuth2 for the whole app"    │
            │  Multi-step project planning         │
            │  SCU decomposition                   │
            │  Dependency graphs                   │
            └──────────────┬──────────────────────┘
                           │ breaks into steps
                           ▼
10,000 ft  ┌─────────────────────────────────────┐
  QUALITY   │  CRAFT SPEED GOVERNOR                │
            │  "This step must go through all 5    │
            │   quality stages before it's done"   │
            │  raw → typed → refined →             │
            │  proposed → resolved                 │
            └──────────────┬──────────────────────┘
                           │ enforces quality per step
                           ▼
Ground      ┌─────────────────────────────────────┐
  TACTICAL  │  DISPATCHER                          │
            │  "Route this specific code review    │
            │   to the security-reviewer skill"    │
            │  Real-time intent matching           │
            │  Skill routing                       │
            └─────────────────────────────────────┘
```

## Campaign-Runner (Strategic: Multi-Step Project Planning)

Campaign-Runner takes a high-level goal ("Add OAuth2 login with Google, GitHub, and email/password") and produces a structured execution plan:

```
CAMPAIGN: oauth-implementation
├── Phase 1: Schema
│   ├── SCU-1: Add users.oauth_provider column     [ready]
│   ├── SCU-2: Add users.oauth_id column           [ready]
│   └── SCU-3: Create migration file               [depends: SCU-1, SCU-2]
├── Phase 2: Backend
│   ├── SCU-4: Google OAuth route + token handler   [depends: Phase 1]
│   ├── SCU-5: GitHub OAuth route + token handler   [depends: Phase 1]
│   └── SCU-6: Email/password auth route            [depends: Phase 1]
├── Phase 3: Frontend
│   ├── SCU-7: Login page with provider buttons     [depends: Phase 2]
│   └── SCU-8: Auth state management + token store  [depends: Phase 2]
└── Phase 4: Review + Ship
    ├── SCU-9: Full security review                 [depends: Phase 3]
    └── SCU-10: Docs update + PR generation         [depends: SCU-9]
```

Campaign-Runner uses SCU (Smallest Coherent Unit) decomposition from Arcanum. Each SCU has PCRA properties: Purpose, Context, Requirements, Acceptance criteria. Campaigns are tracked in a recursive ledger — YAML-backed nested contexts with full version control via git.

**Codebase:** `Campaign-Runner/` — Python package (`codex_runner`). Deterministic audit-to-campaign execution runner with schema-validated planning.

## Craft Speed Governor (Quality: No Skipping Steps)

The Craft Method (from Arcanum) enforces a five-stage lifecycle on every artifact:

```
raw → typed → refined → proposed → resolved

│       │        │          │          │
│       │        │          │          └── Done. Merged. Shipped.
│       │        │          └── Approved by reviewer. Ready to ship.
│       │        └── Reviewed. Findings addressed. Quality bar met.
│       └── Structure validated. Compiles. Tests pass.
└── First draft. Code written. No validation yet.
```

**The critical constraint:** A coding persona CANNOT produce a `resolved` artifact without the artifact passing through every intermediate stage. The Orchestrator mask enforces this. The recursive ledger tracks it. The UI shows it.

This prevents the #1 failure mode of AI coding tools: the agent skipping directly from "understand the task" to "submit PR" without review, testing, or validation.

> **Dane Sherburn (Emdash):** "The speed governor is the single feature I wish Emdash had on day one. We had agents submitting PRs that skipped test phases because nothing stopped them. Arcanum's lifecycle enforcement is exactly right."

> **John Carmack:** "This is the difference between a demo and shipping software. Demos skip steps because nobody's watching. Shipping software has a pipeline that prevents skipping because eventually someone IS watching and the bug is in production."

**Codebase:** `cyberAlchemyAI/Arcanum` — Craft Method, SCU decomposition, recursive ledger, speed governor. Bootstrap installer at `tools/bootstrap_arcanum.sh`.

## Dispatcher (Tactical: Real-Time Routing)

The Personal Dispatcher handles real-time routing of individual requests to the appropriate handler. When Guardian needs to invoke a specific skill, the Dispatcher matches intent to capability and routes execution.

```
Guardian: "Review backend code for security issues"
    │
    ▼
Dispatcher intent matching:
    domain: review
    action: run
    options: --project myapp --reviewer security-reviewer
    │
    ▼
SkillRouter → review plugin → Skillsbot MCP → start_walk: security-reviewer
```

The Dispatcher's queue system tracks tasks across the three altitudes:

| Queue Stage | Altitude | What Happens |
|-------------|----------|-------------|
| `captured` | Strategic | Campaign-Runner has identified this task |
| `planning` | Strategic | SCU decomposition in progress |
| `ready` | Quality | Speed governor lifecycle begins |
| `active` | Tactical | Dispatcher routing execution |
| `done` | — | Artifact resolved, evidence recorded |

## How a Task Flows Through All Three

```
USER: "Add OAuth2 login"
  │
  ▼
CAMPAIGN-RUNNER (Strategic)
  ├── Decomposes into 10 SCUs across 4 phases
  ├── Identifies dependencies
  └── Creates campaign in recursive ledger
  │
  ▼ (each SCU flows down)
CRAFT SPEED GOVERNOR (Quality)
  ├── SCU starts at "raw"
  ├── Coding persona writes code → "typed" (compiles, tests pass)
  ├── Reviewer personas examine → "refined" (findings addressed)
  ├── User approves → "proposed"
  └── Merged → "resolved"
  │
  ▼ (at each stage, individual operations are routed)
DISPATCHER (Tactical)
  ├── Routes "write backend OAuth route" → Backend Coder mask
  ├── Routes "review for security" → Security Reviewer mask via Skillsbot
  ├── Routes "update docs" → Docs Reviewer mask
  └── Routes "generate PR" → PR Generator
```

> **Carmack:** "Three clean altitudes. Strategic, quality, tactical. Each does one thing and doesn't leak into the others. This is correct separation of concerns."

> **Sherburn:** "The speed governor sitting between strategic planning and tactical execution is exactly where it needs to be. Plans change. Execution varies. But the quality bar never moves."

---

# Part 5: Memory Architecture

> **Plain English:** Code Forge's memory works like a four-story filing cabinet. The top floor (Working Memory) holds what the AI is thinking about right now — it's fast but temporary. The second floor (Persona Memory) stores tagged memories organized by which specialist role created them. The third floor (Episodic Memory) keeps records of past coding sessions, decisions made, and project conventions. The bottom floor (Archival Memory) stores everything permanently — patterns learned across all projects over months and years. Information flows down from working memory to archives over time.

## The 4-Tier Memory System

```
┌─────────────────────────────────────────────────────────┐
│  TIER 1: WORKING MEMORY (Session-Scoped)                │
│                                                         │
│  What: Current task context, active persona state,      │
│        in-flight code changes, recent LLM responses     │
│  Lifetime: Current session only                         │
│  Tech: In-process state (Python dicts + SQLite)         │
│  Maps to: Codexify's ephemeral tier                     │
│  Size: ~50K-200K tokens (context window)                │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Active persona: security-reviewer                 │   │
│  │ Current task: SCU-4 (OAuth route review)          │   │
│  │ Findings so far: [SEC-001, SEC-002]              │   │
│  │ Active worktree: worktree-oauth-backend           │   │
│  └──────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│  TIER 2: PERSONA MEMORY (Tag-Partitioned)               │
│                                                         │
│  What: Tagged memories organized by persona role        │
│  Lifetime: Project-scoped (persists across sessions)    │
│  Tech: SQLite + sqlite-vec (tag-biased vector search)   │
│  Maps to: Chris's tag-partitioned architecture          │
│  Tags: #backend #frontend #security #docs #orchestrator │
│         #project:{name} #task:{id}                      │
│                                                         │
│  Retrieval bias:                                        │
│    Active persona primary tags:   3× weight             │
│    Active persona secondary tags: 1.5× weight           │
│    All other tags:                1× weight              │
│    #project:* tags:               Always included        │
│                                                         │
│  Embeddings: StarCoder2 for code, BGE-large for NL      │
├─────────────────────────────────────────────────────────┤
│  TIER 3: EPISODIC MEMORY (Project-Scoped)               │
│                                                         │
│  What: Past session records, decisions, conventions,    │
│        project-specific patterns learned over time      │
│  Lifetime: Per-project, indefinite                      │
│  Tech: SQLite (midterm tier from Codexify) +            │
│        Dispatcher recall system                         │
│  Maps to: Codexify's midterm tier + MemoryOS concepts   │
│                                                         │
│  Examples:                                              │
│  - "This project uses snake_case for Python files"     │
│  - "Auth module was refactored on 2026-05-15"          │
│  - "Team prefers explicit error types over exceptions"  │
├─────────────────────────────────────────────────────────┤
│  TIER 4: ARCHIVAL MEMORY (Global, Cross-Project)        │
│                                                         │
│  What: Patterns, skills, and knowledge from all         │
│        projects — the AI's accumulated expertise        │
│  Lifetime: Indefinite, across all projects              │
│  Tech: SQLite + Codexify longterm tier + LCM            │
│        (Lossless Context Management)                    │
│  Maps to: Codexify's longterm tier + MemoryOS archival  │
│                                                         │
│  Examples:                                              │
│  - "OAuth2 PKCE is always better than implicit flow"   │
│  - "FastAPI dependency injection pattern for auth"     │
│  - "React hook composition for state management"       │
└─────────────────────────────────────────────────────────┘
```

## How Each Tier Maps to a Codebase

| Tier | Primary Codebase | Supporting Codebases | Key Technology |
|------|-----------------|---------------------|----------------|
| T1: Working | `codexify-core` (ephemeral tier) | — | In-process Python state |
| T2: Persona | `codexify-core` (memory + tags) | Chris's tag architecture | SQLite + sqlite-vec |
| T3: Episodic | `codexify-core` (midterm tier) | `personal-dispatcher` (recall), `MemoryOS` | SQLite + embeddings |
| T4: Archival | `codexify-core` (longterm tier) | LCM (`@martian-engineering/lossless-claw`), `MemoryOS` | SQLite + DAG summaries |

## Write Path: How Memories Flow Downward

```
EVENT: Security reviewer finds CSRF vulnerability in OAuth code

  ▼
T1 (Working): Stored as active finding in current session
  │
  │ Session ends or task completes
  ▼
T2 (Persona): Tagged #security #review #project:myapp #task:oauth
              Biased retrieval ensures security reviewer sees this
              first next time, but backend coder can access it too
  │
  │ Project milestone or periodic consolidation
  ▼
T3 (Episodic): "OAuth implementation in myapp needed CSRF
                state parameter fix — reviewed 2026-06-01"
  │
  │ Pattern detected across projects
  ▼
T4 (Archival): "OAuth implementations commonly miss state
                parameter validation — always check for CSRF
                in OAuth callback handlers"
```

## Tier Promotion and Demotion

| Transition | Trigger | What Happens |
|-----------|---------|--------------|
| T1 → T2 | Task completion | Working memory artifacts tagged and persisted |
| T2 → T3 | Session end / milestone | Persona memories consolidated into episodic records |
| T3 → T4 | Pattern detection | Episodic memories generalized into cross-project knowledge |
| T4 → T2 | Project context load | Archival knowledge pulled into persona-scoped retrieval |
| T2 → T1 | Persona activation | Tag-biased retrieval loads relevant memories into working context |

> **Harrison Chase (LangChain):** "LangChain's memory is the weakest part of every chain. Tag-partitioned retrieval with persona bias is genuinely novel — it's contextual RAG without the R being random."

> **Tobi Lütke (Shopify):** "Shopify's internal tools learned: memory that doesn't partition by role creates noise. Memory that hard-silos by role loses cross-cutting insights. Tags with bias is the right middle."

---

# Part 6: The Methodology — Promptnomicon

> **Plain English:** The Promptnomicon is Code Forge's rulebook. Every agent follows the same discipline: define what you're doing, write a spec, execute the work, create a receipt proving what happened, then check that everything still matches. The key principle is "no uncited claim treated as true" — the AI can't just say "it works," it has to prove it. These rules are enforced mechanically through Skillsbot templates, Craft stages, and Tandem's audit system — not by hoping the AI follows instructions.

## The Core Loop

```
Prompt → Task → Spec → Execution → Receipt → Drift Review
  │        │       │        │          │          │
  │        │       │        │          │          └── Do docs still match reality?
  │        │       │        │          └── Durable record: what was attempted,
  │        │       │        │              what happened, what remains uncertain
  │        │       │        └── Bounded implementation: smallest coherent change
  │        │       └── Evidence-bound analysis: what must be true before/during/after
  │        └── Scoped, bounded unit of work with acceptance criteria
  └── Mode-tagged prompt: planning (no file mutation) or implementation (bounded changes)
```

Each stage produces a **durable artifact**. No stage claims the authority of a later stage. A plan is not an implementation. An implementation is not a proof.

## Evidence-Bounded Reasoning

**The Problem:** AI agents invent APIs, files, components, or "probably true" architecture.

**The Promptnomicon Solution:** Restrict reasoning to supplied evidence. Forbid external facts unless explicitly allowed. Require citations for reasoning steps.

**The Principle:** *"No uncited implementation claim may be treated as true."*

In practice, this means:
- If the AI says "this API endpoint exists," it must cite the source file
- If the AI says "this test passes," it must show test output
- If the AI says "this is secure," it must reference a specific security check
- Speculation is allowed but must be labeled as such

## Receipts as Honesty Artifacts

A receipt is **not** "success." A receipt is **honesty**. It records:

1. The environment the work was done in
2. The steps taken
3. The observed result
4. The evidence supporting the result
5. The limits and uncertainties

Receipts prevent the #2 failure mode of AI coding (after skipping steps): claiming success without proof. The receipt format from `The-Promptnomicon/receipts/template.md` is used across all Code Forge operations.

## Proof Surfaces Before Promises

**The Problem:** Teams claim "done" based on code changes rather than demonstrated behavior.

**The Promptnomicon Solution:** Proof surface must exist before the promise. "The test passes" beats "the code looks correct." "The API returns 200" beats "the route is defined."

## How It's Enforced Mechanically

The Promptnomicon is not a document agents read and hopefully follow. It's enforced through three mechanical systems:

| Enforcement Layer | What It Enforces | How |
|-------------------|-----------------|-----|
| **Skillsbot Templates** | Structured review workflows, receipt generation | Walking protocol forces page-by-page evidence collection |
| **Craft Speed Governor** | Stage transitions require artifacts | Can't move from `typed` to `refined` without review evidence |
| **Tandem Audit** | Tool invocations logged, approval gates for consequential actions | Immutable audit trail proves what actually happened |

**Codebase:** `The-Promptnomicon/` — 8 templates, methodology docs, ADR prompts, validation checklists, receipt templates. The discipline is embedded in Skillsbot skills and Craft stage definitions.

---

# Part 7: Build vs. Integrate

> **Plain English:** Code Forge doesn't build everything from scratch. Of the ~20 major components needed, only 4 require significant new engineering. Everything else already exists across 16 repositories built by the team. The job is assembly and integration, not invention.

## Complete Component Table

| Component | Status | Source Codebase | Notes |
|-----------|--------|----------------|-------|
| **Persona Engine** | 🔨 **BUILD** | New (based on Codexify patterns) | Core innovation. Mask loading, switching, memory bias, tool scoping |
| **LSP Bridge** | 🔨 **BUILD** | New (informed by OpenCode patterns) | Persistent LSP shared across persona switches |
| **Git Worktree Manager** | 🔨 **BUILD** | New (informed by Emdash patterns) | Create, isolate, merge, cleanup worktrees per task |
| **Diff Sandbox** | 🔨 **BUILD** | New (informed by Plandex patterns) | Speculative execution, user review before commit |
| Guardian FastAPI Core | 🔗 **INTEGRATE** | `Resonant-Jones/codexify-core` | Fork + strip Docker/Redis/Neo4j, add SQLite |
| React + TypeScript Frontend | 🔗 **INTEGRATE** | `Resonant-Jones/codexify-core` | Rebuild for Tauri IPC instead of HTTP |
| SSE Streaming (Durable Outbox) | 🔗 **INTEGRATE** | `Resonant-Jones/codexify-core` | Reliable event delivery for activity panel |
| Three-Tier Memory | 🔗 **INTEGRATE** | `Resonant-Jones/codexify-core` | Add tag partitioning on top of existing tiers |
| Plugin Architecture | 🔗 **INTEGRATE** | `Resonant-Jones/codexify-core` | Personas are plugins |
| Multi-Provider LLM Router | 🔗 **INTEGRATE** | `Resonant-Jones/codexify-core` | Already supports OpenAI, Anthropic, DeepSeek, Groq |
| Tauri Desktop Shell | 🔗 **INTEGRATE** | `resonantos-vnext` | 117 TS/TSX files, 24 Rust files, 16 modules |
| Skillsbot Review Skills | 🔗 **INTEGRATE** | `skills-bot` | 167 packs, MCP walking protocol |
| Z7Lab Reviewer Specs | 🔗 **INTEGRATE** | Z7Lab `code-review-agents` | 6 instruction sets → persona mask system prompts |
| Campaign-Runner | 🔗 **INTEGRATE** | `Campaign-Runner` | SCU decomposition, schema-validated planning |
| Speed Governor (Craft Method) | 🔗 **INTEGRATE** | `cyberAlchemyAI/Arcanum` | 5-stage lifecycle enforcement |
| CRABS Protocol | 🔗 **INTEGRATE** | Vlad's CRABS PDFs | Attribute-based state machines (Phase 2) |
| Docker Sandboxes | 🔗 **INTEGRATE** | `codeswarm` | codex-sandbox, claude-code-sandbox |
| Dispatcher | 🔗 **INTEGRATE** | `personal-dispatcher` | 64 CMD skills, 10 plugins, MCP server |
| Tandem Runtime | 🔗 **INTEGRATE** | `frumu-ai/tandem` | Approval gates, audit trails, tenant sessions |
| Promptnomicon Templates | 🔗 **INTEGRATE** | `The-Promptnomicon` | 8 templates, methodology enforcement |
| Tree-Sitter Project Maps | 🌉 **BRIDGE** | Plandex patterns | Adapt existing tree-sitter tooling |
| MemoryOS Concepts | 🌉 **BRIDGE** | `MemoryOS` (open-source research) | Inform T3/T4 memory tier design |
| guardian-mobile | 🌉 **BRIDGE** | `guardian-mobile` | React Native companion (Phase 2) |
| CyberAlchemy Proofs | ⏳ **DEFER** | CyberAlchemy (269 modules) | Phase 2: AgenticFrame, SafetyBounds |
| Hermes Skill Learning | ⏳ **DEFER** | Nous Research patterns | Phase 2: Personas learn from completions |
| MCP Extensibility | ⏳ **DEFER** | Standard protocol | Phase 2: Expose Guardian as MCP server |
| Team/Multi-User Mode | ⏳ **DEFER** | — | Phase 3: PostgreSQL, user-scoped personas |

### Status Legend

| Status | Meaning | Count |
|--------|---------|-------|
| 🔨 **BUILD** | Significant new engineering required | **4** |
| 🔗 **INTEGRATE** | Exists in a team codebase, needs assembly | **17** |
| 🌉 **BRIDGE** | External patterns to adapt | **3** |
| ⏳ **DEFER** | Not MVP, scheduled for later phases | **4** |

### Why Only 4 Things Need to Be Built

The persona model is the architectural epiphany that makes this possible. In the v1 multi-agent design, building the system required: agent runtimes (custom), inter-process communication (custom), agent lifecycle management (custom), agent contract specifications (custom), multi-process sandboxing (custom), and context synchronization between agents (custom). The persona model collapses all of that into one new component (the Persona Engine) plus three supporting mechanisms (LSP bridge, worktree manager, diff sandbox).

Everything else — the desktop shell, the review skills, the campaign planner, the speed governor, the runtime governance, the methodology — already exists across 16 repositories.

---

# Part 8: The 30-Day MVP

> **Plain English:** In 30 days, Code Forge ships a downloadable desktop app. Week 1 builds the foundation (desktop app + basic chat). Week 2 adds the shapeshifter (persona switching + coding). Week 3 adds the review swarm (four reviewers + fix loop). Week 4 adds memory and polish. What ships on Day 30 is something no competitor has: persona-based perspective shifts + cross-domain memory + governed fix loops + silent fallback detection.

## What Ships on Day 30 That Nobody Else Has

A desktop app where you describe a multi-component code change and watch a single AI entity:

1. **Decompose** it into SCUs (Smallest Coherent Units)
2. **Code** each component in isolated git worktrees wearing specialist persona masks
3. **Review** its own work with genuine perspective shifts (Z7Lab reviewer personas with different system prompts, tool scopes, and memory biases)
4. **Auto-fix** review findings through a governed iteration loop (max 3 cycles)
5. **Present** a clean unified diff with a severity-ranked findings report

All with tag-partitioned memory that gives the security reviewer cross-domain access to why the backend coder made each decision.

## Week 1: Guardian Desktop (Days 1-7)

| Day | Task | Deliverable |
|-----|------|-------------|
| 1-2 | Fork Codexify Guardian, strip Docker/Redis/Neo4j, add SQLite backend | Guardian runs standalone with SQLite |
| 3-4 | Tauri shell: Monaco editor + file tree + terminal panel | Desktop app opens, edits files, has terminal |
| 5 | Guardian as Tauri sidecar + IPC (invoke protocol) | Frontend talks to Guardian |
| 6 | LSP bridge — Guardian connects to project's language server | Type-aware code understanding from day one |
| 7 | Single LLM chat in sidebar with file context + tree-sitter project map | User can chat with an LLM that understands project structure |

**Exit criteria:** Desktop app opens a project. Monaco editor works. Terminal works. Chat understands project structure via tree-sitter + LSP. Working product on Day 7.

**Carmack's latency budget:** App launch to first chat response: <3 seconds. File open to LSP-aware context: <500ms.

## Week 2: The Shapeshifter (Days 8-14)

| Day | Task | Deliverable |
|-----|------|-------------|
| 8-9 | Persona Engine: mask definitions (YAML, JSON Schema validated), loading, switching | Validated persona definition format |
| 10 | Tag-Partitioned Memory: extend Codexify memory with persona tags, sqlite-vec | Memories stored/retrieved with tag bias |
| 11 | Orchestrator Mask: SCU decomposition (Arcanum), task planning, mask selection | Guardian decomposes multi-step tasks |
| 12 | Backend Coder Mask: first coding persona (Python/Node.js) | Guardian writes code as backend specialist |
| 13 | Git worktree manager: create, isolate, merge, cleanup | Each coding task gets isolated workspace |
| 14 | Speed governor: raw→typed→refined→proposed→resolved lifecycle tracking | Coding persona cannot skip review phase |

**Exit criteria:** User describes a code change. Guardian decomposes via SCU. Switches to Backend Coder mask. Writes code in isolated worktree. Speed governor prevents skipping review. Single-agent coding with governance on Day 14.

## Week 3: Review + Fix Loop (Days 15-21)

| Day | Task | Deliverable |
|-----|------|-------------|
| 15 | Z7Lab Backend Reviewer persona mask | Backend review with severity-ranked findings |
| 16 | Z7Lab Security Reviewer persona mask | Security review catches auth/injection/SSRF |
| 17 | Z7Lab Silent Fallback Detector persona mask | Catches optional chaining abuse, swallowed exceptions |
| 18 | Z7Lab Docs Reviewer persona mask | README quality, staleness, PII detection |
| 19 | Concurrent persona execution: parallel LLM calls with different masks | Multiple reviews run simultaneously |
| 20 | Findings Synthesizer: merge outputs, severity ranking, pass/fail gate | Unified findings report |
| 21 | Fix Loop: route findings back to coding masks, max 3 iterations | Auto-fix cycle: code→review→fix→re-review |

**Exit criteria:** Full pipeline works. User describes multi-component change → Guardian codes with persona masks (concurrent worktrees) → reviews with 4 Z7Lab personas (concurrent LLM calls) → auto-fixes issues → presents clean diff + findings report. The shapeshifter pipeline on Day 21.

## Week 4: Memory + Ship (Days 22-30)

| Day | Task | Deliverable |
|-----|------|-------------|
| 22-23 | Three-tier memory port from Codexify + persona tag integration | Cross-session memory with tag-biased retrieval |
| 24 | Project context engine: per-repo conventions, architecture decisions | Guardian learns project patterns |
| 25 | Activity Panel UI: live persona state, progress, mask queue, diffs-in-flight | Developer sees what Guardian is doing |
| 26 | Review Findings Panel UI: severity-ranked issues with inline code links | Developer reviews findings visually |
| 27 | Diff review sandbox: user inspects and approves changes before commit | Plandex-style diff approval |
| 28 | Configurable autonomy: supervised / standard / autonomous modes | User dials trust up or down |
| 29 | GitHub PR generation with intent + changes + findings summary | Auto-generated PRs |
| 30 | Packaging (Tauri build), README, quickstart guide, 3-step install | Downloadable binary ships |

**Exit criteria:** Ship. Binary downloads. 5-minute install. Cross-session memory. PR generation. Configurable autonomy. Activity + findings UI. Product on Day 30.

## What's Explicitly Excluded (and When It Moves To)

| Feature | Phase | Why Deferred |
|---------|-------|-------------|
| CyberAlchemy Lean 4 proofs | Phase 2 (weeks 5-8) | Requires Lean 4 toolchain integration |
| CRABS attribute-based permissions | Phase 2 (weeks 9-12) | Needs stable persona model first |
| Arcanum sigils/spells | Phase 2 | Map to persona skills — need format stabilized |
| Skill creation from experience (Hermes pattern) | Phase 2 | Need task completion telemetry first |
| MCP extensibility (Guardian as MCP server) | Phase 2 | Core must be stable first |
| User modeling (Honcho) | Phase 2 | Need usage data first |
| Frontend Reviewer persona | Phase 2 | Backend + Security + Silent Fallback + Docs cover highest value |
| Solidity Reviewer persona | Phase 2 (conditional) | Only for Web3 projects |
| MetaCognition self-improvement | Phase 3 | Safety review required |
| Team/multi-user mode | Phase 3 | Single-developer first |
| SSH remote dev | Phase 3 | Desktop-first |
| Cloud hosted version | Phase 3 | Tauri desktop ships first |

---

# Part 9: What Makes This Different

> **Plain English:** Five engineering facts separate Code Forge from every competitor. No other coding tool has formal mathematical verification of what its AI can do. No other has runtime authority (where the platform, not the AI, controls permissions). No other has cross-domain memory where the security reviewer sees the coder's reasoning. No other has a speed governor that mechanically prevents skipping quality steps. And no other has 167 structured skill packs with 118 OWASP security checklists.

## 5 Engineering Facts

### Fact 1: Formal Verification (CyberAlchemy — Phase 2)

When the Security Reviewer persona says "I cannot write files," that's not a policy declaration enforced by a permissions check. It's a mathematical theorem proven in Lean 4 with zero `sorry`. CyberAlchemy provides 2,334 machine-verified theorems across 269 modules.

No other coding tool has this. Not Cursor, not Claude Code, not Codex CLI. The closest is Hermes Agent's capability system, which is policy-based, not proof-based.

> **Nous Research:** "Hermes Agent's self-improvement loop is powerful but dangerous. We've had agents modify their own tool definitions in unexpected ways. CyberAlchemy's safety bounds would have prevented every one of those incidents."

### Fact 2: Runtime Authority (Tandem)

Every other coding tool lets the AI model decide what it can do — system prompts define permissions, and if the model ignores them, nothing stops it. Tandem inverts this: the runtime owns authority. The model's opinion about its permissions is irrelevant.

Approval gates mean consequential actions (file writes, PR submissions, deployment triggers) halt until a human approves. The tool ledger records every action. The audit trail is immutable.

### Fact 3: Cross-Domain Memory (Tag-Partitioned)

When Code Forge's security reviewer examines code, it sees:
- The code itself (like every tool)
- The coder's reasoning for WHY the code was written that way (unique to Code Forge)
- Related security patterns from other projects (archival memory)
- The specific project conventions (episodic memory)

In multi-agent systems (Emdash, Hermes), each agent has its own isolated context. The security reviewer only sees the code, not the intent. Code Forge's shared memory with tag-biased retrieval provides cross-domain awareness without context duplication.

### Fact 4: Speed Governor (Craft Method)

The five-stage lifecycle (`raw→typed→refined→proposed→resolved`) mechanically prevents agents from skipping steps. This isn't a guideline — it's enforced by the Orchestrator mask and tracked in the recursive ledger.

Every competitor has this failure mode. Every AI coding tool demo shows the agent going from "understand task" directly to "submit PR." In production, that produces bugs, security vulnerabilities, and documentation drift.

### Fact 5: Skill Scale (Skillsbot)

167 structured skill packs including 118 OWASP security checklists. Each skill walks an agent through a structured review page by page, producing marker-anchored findings. The walking protocol provides a 20-25× context reduction compared to loading full checklists.

No competitor has this breadth of structured review knowledge. Most rely on generic system prompts.

## Competitive Comparison

| Feature | Code Forge | Cursor | Windsurf | Claude Code | Codex CLI | Emdash | Hermes Agent |
|---------|-----------|--------|----------|-------------|-----------|--------|-------------|
| **Architecture** | One entity, persona masks | Single agent | Single agent | Single agent | Single agent | 27 multi-agents | Multi-agent |
| **Cross-domain memory** | ✅ Tag-biased, shared | ❌ Single context | ❌ Single context | ❌ Single context | ❌ Single context | ❌ Agent-isolated | ❌ Agent-isolated |
| **Formal verification** | ✅ Phase 2 (Lean 4) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Runtime authority** | ✅ Tandem | ❌ | ❌ | Partial (permissions) | Partial (sandbox) | ❌ | ❌ |
| **Speed governor** | ✅ Craft Method | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Structured review skills** | 167 packs (118 OWASP) | ❌ | ❌ | ❌ | ❌ | ❌ | Hermes skills |
| **Silent fallback detection** | ✅ Dedicated detector | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Multi-model per task** | ✅ Per-persona model | ❌ Fixed model | ✅ Model switching | ❌ Fixed model | ❌ Fixed model | ❌ Fixed model | ✅ Multi-model |
| **Git worktree isolation** | ✅ Per-task worktrees | ❌ | ❌ | ❌ | ❌ | ✅ Per-agent | ❌ |
| **Desktop native** | ✅ Tauri (~15MB) | ✅ Electron (~200MB) | ✅ Electron | ❌ CLI | ❌ CLI | ❌ Cloud | ❌ CLI |
| **Open source** | ✅ Planned | ❌ | ❌ | ❌ | ✅ CLI open | ❌ | ✅ |

---

# Part 10: The Panel Record

> **Plain English:** Code Forge's architecture was developed through four rounds of expert review. Each round brought new inputs and refined the design. The panels weren't rubber stamps — they found real problems and caused fundamental architectural changes. The biggest change: v2's panel convinced the team to abandon the multi-agent design entirely and adopt the persona model.

## Panel v1: Strategic Fork + Graft (7 Architects)

### Inputs Available
- Codexify (Chris Millan's codebase — FastAPI Guardian, React frontend, 3-tier memory)
- Z7Lab code-review-agents (6 reviewer instruction sets)
- Competitive landscape (Cursor, Windsurf, Claude Code, Codex CLI)

### What the Panel Concluded
- **Architecture:** Multi-agent runtime. Separate Python subprocess per coding/review agent.
- **Key decision:** "Strategic Fork + Graft" — fork Codexify as the foundation, graft Z7Lab reviewers as subprocess agents.
- **Panel grade:** B+/A- average.
- **Primary concerns:** IPC complexity between 10+ agent processes, undefined agent contract spec, frontend architecture underspecified.

### Key Quote
> **Systems Architect:** "The multi-agent runtime works but introduces distributed systems complexity that may not be necessary for a desktop tool."

## Panel v2: You Don't Build an Army, You Build a Shapeshifter (7 Architects, Reconvened)

### Inputs Available
- Everything from v1
- Chris Millan's Persona Architecture (global role + persona masks + tag-partitioned memory)
- CyberAlchemy (269 modules, 2,334 Lean 4 theorems)
- Z7Lab reviewer specs reconsidered as persona masks instead of subprocess agents

### What the Panel Concluded
- **Architecture:** Persona model. One Guardian entity with switchable masks. **Complete paradigm shift from v1.**
- **Key decision:** "You don't build an army. You build a shapeshifter."
- **Panel grade:** A/A- average (up from B+/A-).
- **Critical change:** Eliminated the Agent Contract Spec, multi-process runtime, IPC layer, and process lifecycle management from v1. Replaced with Persona Engine + tag-partitioned memory.

### How It Evolved
This was the fundamental architectural epiphany. Chris's insight that one entity with tagged memory and biased retrieval could replace 10+ separate agent processes collapsed the entire design complexity. Combined with CyberAlchemy's formal verification, it meant persona capabilities could be proven, not just declared.

### Key Quotes
> **AI/ML Architect (upgraded to A+):** "The persona model is the single best architectural decision in this entire project. It matches how large language models actually work — they're not separate agents, they're one model with different prompts."

> **Integration Architect:** "The elimination of the Agent Contract Spec is the biggest win. In v1, I flagged undefined IPC protocols as the #1 integration risk. The persona model eliminates IPC entirely."

## Panel v3: Don't Rebuild, Assemble (11 Experts with Full Competitive Landscape)

### Inputs Available
- Everything from v1 and v2
- Arcanum/Craft Method (SCU decomposition, speed governor, recursive ledger)
- CRABS Protocol (attribute-based state machines, permissions from state)
- Hermes Agent (177K★ — skill creation, Honcho user modeling)
- Crush/OpenCode (Charmbracelet — LSP integration, MCP extensibility)
- Plandex (15K★ — diff review, tree-sitter maps, configurable autonomy)
- Emdash (YC W26 — 27 parallel agents, git worktrees, speed governor validation)
- cc-switch (89K★ — meta-wrapper for coding agents)
- Codegraph (38K★ — pre-indexed code knowledge graph)

### What the Panel Concluded
- **Architecture:** Confirmed persona model from v2. Added three orchestration altitudes, speed governor, CRABS integration roadmap.
- **Key decision:** "Don't rebuild. Assemble." Only 4 components need building; everything else integrates from 16 existing repos.
- **Panel grade:** A- average (11 panelists, highest rigor).

### How It Evolved
The panel expanded from 7 architects to 11 world-class experts (adding Linus Torvalds, John Carmack, Guillermo Rauch, Tobi Lütke, Amjad Masad, Harrison Chase, Nous Research, Charm Team, Dane Sherburn, Anthropic Applied Research, Bret Victor). The competitive landscape analysis (Hermes 177K★, cc-switch 89K★, Codegraph 38K★, Emdash YC W26) validated the persona model — every competitor either uses multi-agent (expensive, complex) or single-agent-single-prompt (limited).

### Key Quotes
> **Linus Torvalds:** "One process. One address space. Shared memory. The multi-process agent design was a distributed systems problem nobody needed to solve."

> **Dane Sherburn (Emdash):** "The persona model achieves the same parallelism we get from 27 agents with dramatically less operational overhead. I wish we'd thought of this."

## Final v2 Panel: The Definitive Architecture (11 Experts with All 16 Repos)

### Inputs Available
- Everything from v1, v2, v3
- Complete codebase inventory: all 16 repositories with file counts, module maps, tech stacks
- resonantos-vnext (117 TS/TSX files, 24 Rust files, 32 ADRs, 16 modules)
- Skillsbot (167 packs, 118 OWASP, MCP walking protocol with 20-25× context reduction)
- Personal Dispatcher (64 CMD skills, 10 plugins, MCP server)
- Tandem integration contract (sidecar architecture, approval gates)
- The Promptnomicon (methodology enforcement: receipts, drift review, evidence-bounded reasoning)
- Campaign-Runner (SCU decomposition, schema-validated planning)

### What the Panel Concluded
- **Architecture:** Definitive 6-layer stack. Three orchestration altitudes. resonantos-vnext IS the desktop shell. 167 skill packs integrated via MCP. Tandem as L1 runtime governance.
- **Key decision:** This is the build plan. No further panels. Begin Week 1, Day 1.
- **Panel grade:** A- average (see Part 11 for individual grades).

### Key Quotes
> **Anthropic Applied Research:** "The Silent Fallback Detector addresses the single largest class of AI-generated bugs in our internal testing. In our testing of Claude Code, silent fallback bugs account for approximately 40% of user-reported issues that pass CI."

> **Bret Victor:** "'Direct manipulation' means the developer should be able to intervene at any point in the pipeline — pause the security reviewer, redirect the backend coder, override the orchestrator's decomposition — not just watch."

---

# Part 11: All Panelist Verdicts (Final)

| # | Panelist | Grade | Key Strength | Key Concern |
|---|---------|-------|-------------|-------------|
| 1 | **Linus Torvalds** | **A** | Architecture correctness — one process, shared memory, persona model | Python sidecar as permanent dependency. "If this succeeds, rewrite hot paths in Rust." |
| 2 | **John Carmack** | **A** | Latency budget achievable — persona switching ~0ms, LSP <50ms | API rate limits may limit concurrent persona calls. "Design for degraded parallelism." |
| 3 | **Guillermo Rauch** (Vercel) | **A-** | DX story compelling — one entity wearing hats matches pair programming mental model | No cloud story. "Every successful dev tool in 2026 has a hosted version." |
| 4 | **Tobi Lütke** (Shopify) | **A-** | Pragmatic scope, realistic MVP | Team size assumption. "30-day timeline assumes 3-4 senior engineers." |
| 5 | **Amjad Masad** (Replit) | **A-** | Persona model validated — matches Replit Agent's internal approach | Single-user architecture may calcify. "Don't let single-user design become permanent." |
| 6 | **Harrison Chase** (LangChain) | **A** | Memory architecture genuinely novel — tag-partitioned with persona bias | Tag taxonomy governance. "If tags proliferate without governance, retrieval degrades." |
| 7 | **Nous Research Team** | **A-** | Safety bounds essential for self-improving agents | MVP lacks formal proofs. "Ship output validation as hard gate in MVP." |
| 8 | **Charm Team** (OpenCode) | **B+** | LSP integration from day one is correct | No CLI mode. "Half of developers live in the terminal." |
| 9 | **Dane Sherburn** (Emdash) | **A** | Speed governor is the missing feature in agent-based coding | Fix loop iteration count. "If it hasn't converged in 2, it won't in 3. Default to max 2." |
| 10 | **Anthropic Applied Research** | **A** | Silent Fallback Detector genuinely novel — catches 40% of CI-passing bugs | Cost observability. "3-4 different models per pipeline = non-trivial cost tracking." |
| 11 | **Bret Victor** | **B+** | Activity Panel showing persona state is necessary | Still a batch pipeline. "True direct manipulation lets the user edit alongside the persona." |

### Panel Average: **A-**

### Grade Distribution

| Grade | Count | Panelists |
|-------|-------|-----------|
| A | 4 | Torvalds, Carmack, Chase, Sherburn |
| A- | 4 | Rauch, Lütke, Masad, Nous Research |
| B+ | 2 | Charm Team, Victor |
| A (special) | 1 | Anthropic Applied Research |

---

# Part 12: Risks and Bets

> **Plain English:** Every project makes bets. Code Forge makes three: (1) that Tandem's runtime governance is the right foundation, (2) that one entity with persona masks beats separate agents, and (3) that 16 different codebases can actually be integrated into one product. Each bet could fail. Here's what would kill the project, and how to mitigate each risk.

## The Three Bets

### Bet 1: Tandem as Foundation

**The bet:** Runtime authority projection (the runtime controls what the AI can do, not the AI itself) is the right governance model for a coding tool.

**Why it's a bet:** Most coding tools give the AI maximum autonomy and rely on sandboxing (Docker, chroot) for safety. Tandem inverts this — consequential actions require explicit approval. This adds friction. If developers find the approval gates too slow or intrusive, they'll disable governance and use Cursor instead.

**Mitigation:** Configurable autonomy levels (supervised/standard/autonomous). Developers earn trust: start supervised, graduate to autonomous as the tool proves itself. CRABS (Phase 2) makes this automatic — permissions derive from demonstrated quality, not static configuration.

### Bet 2: Persona Model vs. Multi-Agent

**The bet:** One entity with persona masks produces better results than separate agent processes.

**Why it's a bet:** The persona model has a theoretical weakness — one context window shared across all masks. If the context fills up during a complex pipeline run, later personas (reviewers) operate with degraded context. Multi-agent systems avoid this by giving each agent its own context window.

**Mitigation:** (1) CyberAlchemy's SleepConsolidation for intelligent context compaction between persona switches. (2) Tag-biased eviction: when compacting, preserve memories tagged with the upcoming persona's primary tags. (3) Use 200K+ context models for orchestration (Claude, Gemini). (4) Hierarchical summarization: full details for recent persona, summaries for earlier personas.

### Bet 3: Integration of 16 Codebases

**The bet:** 16 different repositories built by different people (Chris 8, Vlad 3+protocol, Z7Lab 4, Evans 1) can be assembled into one coherent product.

**Why it's a bet:** Integration is where most software projects die. Different coding styles, different assumptions, different APIs. Chris's Codexify was built for Docker Compose with PostgreSQL and Redis. resonantos-vnext is a Tauri shell. Skillsbot is a standalone Python service. Making them talk to each other is the real engineering challenge — harder than building any single component.

**Mitigation:** (1) Tauri IPC standardizes Guardian-to-UI communication. (2) MCP standardizes Guardian-to-Skillsbot communication. (3) HTTP/SSE standardizes Guardian-to-Tandem communication. (4) The Persona Engine is the only true integration point — everything else connects through standard protocols.

## Kill Risks with Mitigations

### Risk 1: The Python Sidecar Problem

**Probability:** Medium | **Severity:** High

Code Forge ships as a Tauri binary + Python sidecar. Users need Python 3.12+ installed. Two processes to manage. Packaging for Windows/Linux/macOS with Python is notoriously painful.

Every friction point in installation loses users exponentially. Cursor ships as one binary. If Code Forge requires "install Python, then pip install, then run the app," it loses regardless of architectural superiority.

**Mitigation:** PyInstaller/Nuitka to bundle Guardian as a single executable inside the Tauri package. Long-term: rewrite Guardian core in Rust and compile into Tauri directly.

> **Linus Torvalds:** "Python as a permanent dependency for a desktop app is technical debt."

### Risk 2: Context Window Pressure Under Rapid Persona Switching

**Probability:** Medium | **Severity:** Medium

One entity = one context window. A pipeline run through Orchestrator → 3 Coders → 4 Reviewers → Fix Loop generates enormous context. If the window fills mid-pipeline, reviewers get degraded context — exactly when quality matters most.

The persona model's advantage (cross-domain awareness) becomes its weakness if shared context can't hold enough cross-domain information.

**Mitigation:** Tag-biased eviction, SleepConsolidation, hierarchical summarization, 200K+ context models.

### Risk 3: The Team of One Problem

**Probability:** High | **Severity:** Critical

The 30-day MVP requires: Tauri + Rust shell, React + TS UI (5 panels), FastAPI + Python backend, Persona Engine, Tag-Partitioned Memory, Git Worktree Manager, LSP Bridge, Tree-sitter integration, Z7Lab persona definitions, Findings Synthesizer, Speed Governor, Campaign Manager, LLM Router, PR Generator, and packaging for 3 platforms.

For 1-2 people: 6 months. For 3-4 senior engineers: 30 days. The architecture is right but execution is everything.

**Mitigation:** (1) Ruthlessly cut MVP scope — ship Week 2 as alpha, add reviewers in Week 4-6. (2) Use Claude Code / Codex CLI to build Code Forge (Code Forge building Code Forge). (3) Open-source early, recruit from cc-switch (89K★) and Codegraph (38K★) communities.

> **Tobi Lütke:** "If this is 1-2 people, double the timeline."

---

# Part 13: Complete Codebase Inventory

> **Plain English:** Code Forge draws from 16 repositories built by 4 contributors. Here's every repo, who built it, what it does, and what Code Forge takes from it.

## By Team Member

### Chris Millan — 8 Repositories

| # | Repository | Purpose | What Code Forge Takes | Status |
|---|-----------|---------|----------------------|--------|
| 1 | **codexify-core** | FastAPI Guardian sidecar + React frontend + 3-tier memory + multi-provider LLM routing + plugin architecture | Fork as Guardian Core. Strip Docker/Redis/Neo4j. Add SQLite. Keep SSE streaming, memory tiers, plugin arch, LLM router. **The persona architecture — global role + masks + tag-partitioned memory — is the core insight.** | Active, private repo |
| 2 | **personal-dispatcher** | FastAPI intent router + 64 CMD skills + 10 plugins + MCP server + dispatch queue + macro/trigger/chain system | L2 Routing & Dispatch layer. Skill-based intent matching, queue lifecycle (captured→planning→ready→active→done), review plugin for Z7Lab integration, sandbox plugins for Codex/Claude. | Active, running at port 5170/5171 |
| 3 | **skills-bot (Skillsbot)** | 167 skill packs (118 OWASP) + MCP walking protocol + HTTP API + CLI | L5 Review & Verification. Walking protocol serves skill pages on demand (20-25× context reduction vs full dump). 4 skill kinds: reviewers, implementers, planners, profilers. | Active, running at port 5180/5181 |
| 4 | **Campaign-Runner** | Deterministic audit-to-campaign execution runner | Strategic orchestration altitude. SCU decomposition, schema-validated planning, provider-agnostic execution. | Active, private alpha |
| 5 | **resonantos-vnext** | Tauri 2.x + React/TS desktop shell | L6 Desktop Shell. 117 TS/TSX files, 24 Rust files, 32 ADRs, 16 modules. Add-on SDK, capability model, Living Archive memory bridge. | Active, public source preview |
| 6 | **codeswarm** | Docker sandboxes for Codex CLI + Claude Code | L4 Execution. codex-sandbox and claude-code-sandbox with resource limits, system isolation, local model support. | Active |
| 7 | **guardian-mobile** | React Native mobile companion | Mobile activity view, approval, review findings. Phase 2. | Active, early |
| 8 | **The-Promptnomicon** | Methodology guide + templates + receipts + validation checklists | L6 Methodology enforcement. 8 templates, core loop (Prompt→Task→Spec→Execution→Receipt→Drift Review), evidence-bounded reasoning, receipt artifacts. | Active, public repo |

### Vlad / Dylon La Rue — 3 Repositories + CRABS Protocol

| # | Repository | Purpose | What Code Forge Takes | Status |
|---|-----------|---------|----------------------|--------|
| 9 | **CyberAlchemy** (LaRue + InfoPhys libraries) | 269 modules, 2,334 Lean 4 theorems, zero `sorry` | Phase 2: AgenticFrame (persona capability declarations), SafetyBounds (proven limits), DruidPermissions (capability proofs), DruidSprite/SpriteDispatch (concurrent persona dispatch), DecisionKernel (optimal decomposition), AgenticRank (persona selection). 14 of 269 modules directly applicable. | Active, research + production |
| 10 | **Arcanum** (cyberAlchemyAI/Arcanum) | Craft Method, SCU decomposition, recursive ledger, speed governor, sigils/spells | Quality orchestration altitude. 5-stage lifecycle (raw→typed→refined→proposed→resolved), SCU properties (PCRA), recursive ledger for campaign state, experiment harness, bootstrap installer. | Active |
| 11 | **CRABS Protocol** (2 PDFs) | Attribute-based state machines, permissions from state, threshold triggers | Phase 2: "Attributes are state" — permissions derive from project state, not static RBAC. Auto-promotion when review score crosses threshold. Key versioning, dual privacy modes (auditable/privacy-preserving). | Research, Phase 2+ |

### Z7Lab — 4 Assets (code-review-agents)

| # | Repository | Purpose | What Code Forge Takes | Status |
|---|-----------|---------|----------------------|--------|
| 12 | **Backend Reviewer** | Python/Flask/FastAPI/Django, Node.js, Go, Rust code review instruction set | Persona mask system prompt for Backend Reviewer. Tags: `#backend #review #patterns`. | Active |
| 13 | **Security Reviewer** | Auth flows, injection, SSRF, secrets, CORS, rate limiting review instruction set | Persona mask system prompt for Security Reviewer. Tags: `#security #review #auth`. | Active |
| 14 | **Silent Fallback Detector** | Swallowed exceptions, optional chaining abuse, default masking detection | Persona mask system prompt for Silent Fallback Detector. Tags: `#resilience #review #error-handling`. **Most novel reviewer** — catches bugs that don't crash. | Active |
| 15 | **Docs Reviewer** | README quality, Diátaxis structure, staleness via git history, PII detection | Persona mask system prompt for Docs Reviewer. Tags: `#docs #review #readme`. | Active |

### Evans (tacshade) — 1 Repository

| # | Repository | Purpose | What Code Forge Takes | Status |
|---|-----------|---------|----------------------|--------|
| 16 | **Tandem** (frumu-ai/tandem) | Rust runtime engine with approval gates, audit trails, tenant-aware sessions, tool ledger, MCP governance | L1 Governed Runtime. Runtime authority projection — the model is not the access-control perimeter. Sidecar at port 39731, Python SDK client. | Active, v0.5 |

### External References (Not Team Codebases — Patterns Only)

| Source | What Code Forge Learns From It |
|--------|-------------------------------|
| **MemoryOS** (open-source research) | Hierarchical memory architecture concepts inform T3/T4 tier design |
| **Hermes Agent** (Nous Research, 177K★) | Skill creation from experience pattern (Phase 2) |
| **OpenCode/Crush** (Charmbracelet) | LSP integration patterns, MCP extensibility |
| **Plandex** (15K★) | Diff review sandbox, tree-sitter maps, configurable autonomy |
| **Emdash** (YC W26) | Git worktree isolation validation, parallel agent lessons |
| **cc-switch** (89K★) | Market signal: developers want to switch between specialist modes |
| **Codegraph** (38K★) | Market signal: developers want pre-indexed project understanding |

---

# Appendix A: Glossary

| Term | Definition |
|------|-----------|
| **Guardian** | The single AI entity at the core of Code Forge. A FastAPI/Python process that wears persona masks to act as different specialists. Named after the concept of a guardian process in operating systems. |
| **Persona Mask** | A configuration applied to Guardian that changes its behavior: system prompt, memory tag bias, tool scope, and model preference. Switching masks is sub-millisecond — no process creation, no IPC. |
| **SCU (Smallest Coherent Unit)** | The atomic unit of work in Arcanum's Craft Method. Each SCU has PCRA properties: Purpose, Context, Requirements, Acceptance criteria. Campaigns decompose into SCUs. |
| **Speed Governor** | The 5-stage lifecycle enforcement from Arcanum: raw→typed→refined→proposed→resolved. Mechanically prevents skipping quality stages. Artifacts cannot advance without meeting stage criteria. |
| **Tag-Partitioned Memory** | Memory architecture where all memories carry tags (#backend, #security, etc.) and retrieval is biased by the active persona's tag weights. Cross-domain access is allowed but not biased toward. |
| **Walking Protocol** | Skillsbot's method of serving skill content page by page via MCP, rather than dumping entire checklists into context. Provides 20-25× context reduction. |
| **Campaign** | A multi-step project plan managed by Campaign-Runner. Decomposes into phases, each containing SCUs with dependencies. Tracked in a recursive ledger with full version control. |
| **Recursive Ledger** | YAML-backed nested contexts from Arcanum that track campaign state: artifacts, lifecycle stage, blockers, dependencies. Version-controlled via git. |
| **Findings Synthesizer** | Component that merges outputs from multiple reviewer personas into a unified, severity-ranked report with pass/fail gates. |
| **Silent Fallback** | A class of bug where code doesn't crash or throw errors but silently produces wrong results. Includes: optional chaining hiding nulls, default values masking missing data, swallowed exceptions, empty-collection substitutions. |
| **CRABS** | Capability-Resource Attribute-Based State machines. A protocol where permissions derive from project state rather than static RBAC configuration. Phase 2+ integration. |
| **AgenticFrame** | CyberAlchemy module providing formal (Lean 4) capability declarations for each persona mask — mathematical proof of what the mask CAN do. |
| **SafetyBounds** | CyberAlchemy module providing formal (Lean 4) limits on persona behavior — mathematical proof of what the mask CANNOT do. Zero `sorry`. |
| **DruidPermissions** | CyberAlchemy module providing capability-based access proofs for tool scoping — fine-grained, formally verified permission system. |
| **SleepConsolidation** | CyberAlchemy module for memory consolidation during idle periods or between persona switches. Manages context window pressure. |
| **Tandem** | Rust-based runtime engine providing authority projection, approval gates, audit trails, and tenant-aware sessions. The model is not the access-control perimeter — the runtime is. |
| **Tauri** | Rust-based desktop application framework. Ships as a ~15MB binary (vs Electron's ~200MB). Used for Code Forge's desktop shell. |
| **Monaco** | The code editor engine from VS Code. Provides syntax highlighting, IntelliSense, LSP integration. Embedded in the Tauri shell. |
| **LSP Bridge** | Persistent Language Server Protocol connection shared across all persona switches. Provides type-aware code understanding (types, references, definitions, diagnostics). |
| **Worktree** | A git feature that creates lightweight, isolated copies of a repository. Each coding persona operates in its own worktree. Changes don't interfere until explicitly merged. |
| **Diff Sandbox** | Speculative execution environment where code changes are reviewed before being committed. The user inspects and approves diffs before they become permanent. |
| **Promptnomicon** | The methodology that governs all Code Forge operations. Core loop: Prompt→Task→Spec→Execution→Receipt→Drift Review. Key principle: "No uncited implementation claim may be treated as true." |
| **Receipt** | A durable artifact recording what was attempted, what happened, and what remains uncertain. Not "success" — honesty. Records environment, steps, observations, evidence, and limits. |
| **Context Reduction** | The ratio of tokens saved by Skillsbot's walking protocol vs. dumping full skill content. 20-25× means loading 1-2K tokens of catalog instead of 70-100K tokens of full skills. |
| **Configurable Autonomy** | Three trust levels: supervised (approve everything), standard (approve commits), autonomous (approve campaigns). Users dial trust up or down per persona. |
| **PCRA** | Properties of a well-formed SCU: Purpose, Context, Requirements, Acceptance criteria. |
| **MCP** | Model Context Protocol — a standard for connecting AI models to external tools and data sources. Skillsbot and the Dispatcher both expose MCP endpoints. |
| **Sigil** | (Arcanum) A reusable agent capability contract. Maps to persona skill definitions in Phase 2. |
| **Spell** | (Arcanum) A composed workflow of multiple sigils. Maps to campaign templates in Phase 2. |

---

# Appendix B: Technology Stack Reference

| Technology | Version | Purpose | Layer |
|-----------|---------|---------|-------|
| **Tauri** | 2.x | Desktop application framework (Rust + webview) | L6: Desktop Shell |
| **React** | 18+ | UI component framework | L6: Desktop Shell |
| **TypeScript** | 5.x | Type-safe frontend development | L6: Desktop Shell |
| **Monaco Editor** | Latest (VS Code engine) | Code editing, syntax highlighting, IntelliSense | L6: Desktop Shell |
| **Rust** | Stable (2024+) | Tauri backend, IPC handlers, Tandem engine | L6: Shell, L1: Runtime |
| **FastAPI** | 0.100+ | Guardian Core HTTP API (Python sidecar) | L3: Orchestration |
| **Python** | 3.12+ | Guardian Core, Dispatcher, Skillsbot, Campaign-Runner | L2-L5 |
| **SQLite** | 3.45+ | Local state, memory storage, campaign ledger | L3: Memory, L4: State |
| **sqlite-vec** | 0.1+ | Vector embeddings for tag-biased semantic search | L3: Memory |
| **StarCoder2** | Latest | Code embedding model for semantic code search | L3: Memory |
| **BGE-large** | Latest | Natural language embedding model | L3: Memory |
| **PostgreSQL** | 16+ | Team mode database (Phase 3) | L3: Memory (future) |
| **tree-sitter** | Latest | Incremental parsing for project structure maps | L4: Execution |
| **Git** | 2.40+ | Worktree management, version control | L4: Execution |
| **Docker** | 24+ | Sandbox containers (codex-sandbox, claude-code-sandbox) | L4: Execution |
| **LSP** | 3.17 (protocol) | Language server integration for type-aware context | L4: Execution |
| **Lean 4** | Latest | Formal verification (CyberAlchemy proofs, Phase 2) | L5: Verification |
| **MCP** | 1.0 (protocol) | Tool integration protocol (Skillsbot, Dispatcher, external tools) | L2, L5 |
| **JSON Schema** | Draft 2020-12 | Persona definition validation, skill frontmatter, campaign schemas | L3, L5 |
| **YAML** | 1.2 | Persona mask definitions, Arcanum ledger entries | L3, L4 |
| **SSE** | Standard | Server-Sent Events for real-time activity panel updates | L3→L6 |
| **React Native** | Latest (Expo) | guardian-mobile companion app | Mobile |
| **PyInstaller/Nuitka** | Latest | Bundling Python sidecar into single executable | Packaging |

### Model Providers Supported

| Provider | Models | Used By |
|----------|--------|---------|
| **Anthropic** | Claude Opus 4, Sonnet 4, Haiku | Orchestrator mask (Opus), Coding masks (Sonnet) |
| **OpenAI** | GPT-4.1, GPT-4.1 Mini | Coding masks, Docs Reviewer |
| **DeepSeek** | DeepSeek Coder V3, R1 | Coding masks (cost-effective) |
| **Groq** | Various | Fast inference for lightweight tasks |
| **xAI** | Grok 4 | Alternative reasoning model |
| **Google** | Gemini Ultra | Large context (200K+) for orchestration |
| **Local (Ollama)** | Various | Offline operation, embedding generation |

---

*This document is the definitive reference for Resonant Code Forge. It supersedes all prior panel outputs, architecture documents, and design notes. The architecture described here was validated by 11 world-class experts across 4 panel iterations. The next action is execution: Begin Week 1, Day 1.*

**Document:** `RESONANT-CODE-FORGE-COMPLETE-ARCHITECTURE.md`  
**Written:** 2026-06-03  
**Sources:** `CODE-FORGE-V2-ARCHITECTURE.md`, `CODE-FORGE-V3-FINAL-ARCHITECTURE.md`, `personal-dispatcher/`, `skills-bot/`, `resonantos-vnext/`, `tandem/`, `The-Promptnomicon/`, `Campaign-Runner/`, `codeswarm/`, `guardian-mobile/`, `MemoryOS/`, `analog6/reports/arcanum-vs-tandem-review.md`, live file system analysis
