# PROVISIONAL PATENT APPLICATION

**Title:** SINGLE-ENTITY AI CODING SYSTEM WITH VERIFIED PERSONA MASKS, TAG-PARTITIONED MEMORY BIAS, AND STATE-MACHINE-GOVERNED DEVELOPMENT LIFECYCLE

**Filing Date:** [To Be Inserted Upon USPTO Filing]  
**Application Type:** Provisional Patent Application  
**Applicant:** [Applicant Name and Address]  
**Inventor(s):** Thomas Earl Pennington Jr.

---

## FIELD OF THE INVENTION

The present invention relates to artificial intelligence systems for software development, and more particularly to a desktop coding environment that deploys a single AI entity that adopts role-specific persona masks with formally verified capability boundaries, uses tag-partitioned vector memory whose retrieval is biased by the active persona, and enforces a state-machine-governed development lifecycle that prevents automated agents from skipping validation stages.

---

## BACKGROUND

### 1. Problems with Multi-Agent AI Coding Systems

The predominant architecture for AI-assisted software development deploys multiple independent AI agent processes — one per role (coder, reviewer, security auditor, documentation generator). This architecture has the following limitations:

**1.1 Inter-Process Communication Overhead**  
Each agent is a separate process. They communicate via inter-process communication (IPC) — serialization, queuing, deserialization. For tasks where an agent's output immediately feeds another agent's input, this overhead is purely latency with no benefit.

**1.2 Context Duplication**  
Each agent receives its own copy of the project context. The security reviewer receives the same full context as the backend coder, but must re-index it from scratch. There is no mechanism for cross-agent situational awareness — when the backend coder discovers an architectural constraint, the security reviewer has no knowledge of that discovery unless it is explicitly serialized and re-transmitted.

**1.3 No Global Memory**  
Multi-agent systems do not provide a shared memory store accessible from all agents. The security reviewer cannot see what the backend coder learned about the codebase ten minutes ago. Each agent operates in isolation.

**1.4 No Lifecycle Enforcement**  
Existing AI coding tools (Cursor, GitHub Copilot, Aider, Claude Code, Devin) do not enforce that code passes through defined quality stages before being presented to the user. An agent can proceed from a raw specification directly to generating production code without a review step, a security pass, or a documentation check. The user receives the output and must perform their own quality assurance.

**1.5 No Formally Verified Agent Capabilities**  
Agent role boundaries in existing systems are defined by natural language prompts ("You are a security expert. Review the following code."). Prompt-based capability specification is probabilistic — the agent may deviate from its specified role. No existing system provides mathematical proof of what an agent role can and cannot do.

---

## SUMMARY OF THE INVENTION

The present invention provides a software development system comprising a single AI entity — herein called the Guardian — that cycles through role-specific persona masks to perform the functions of multiple specialized agents, while maintaining a single shared memory store whose retrieval is biased toward the active persona's domain, and enforcing a state-machine-governed development lifecycle that requires code artifacts to progress through validated stages before delivery.

The key architectural insight is: **one entity wearing verified persona masks beats an army of agents**. The Guardian is not a scheduler dispatching tasks to separate agent processes; it is the agent, adopting each role in sequence with verified capability boundaries and globally aware memory.

---

## DETAILED DESCRIPTION

### 2. System Architecture Overview

The invention comprises five major components:

1. **Guardian Core** — The single AI entity that executes all coding, reviewing, and orchestration tasks
2. **Persona Mask Engine** — The mechanism by which Guardian adopts role-specific system prompts, memory biases, and tool access scopes
3. **Tag-Partitioned Memory Store** — The shared vector database whose retrieval is weighted by the active persona's domain tags
4. **Craft Method State Machine** — The lifecycle enforcement system that governs code artifact states
5. **CRABS Permission Engine** — The attribute-based permission system whose grants auto-derive from project state

### 3. Guardian Core — The Single-Entity Architecture

In the preferred embodiment, the Guardian is implemented as a FastAPI (Python) process running as a sidecar to a Tauri (Rust) desktop shell. The Guardian maintains one continuous context — it is never terminated and restarted between persona switches. A persona switch is accomplished by:

a) Changing the system prompt injected into the LLM provider call  
b) Applying a memory retrieval bias weight shift  
c) Updating the tool access scope list  
d) Loading any persona-specific constraint rules

No new process is spawned. No IPC occurs. The state change is a sub-millisecond operation (system prompt swap + memory query weight update).

The Guardian maintains global situational awareness across all persona activations. When the Backend Coder Mask discovers that the authentication module uses a deprecated API, that knowledge persists in the tag-partitioned memory store and is accessible (at lower weight) when the Security Reviewer Mask is subsequently activated.

### 4. Persona Mask Engine

A persona mask is a structured data object comprising:

```
PersonaMask {
  id: string                      // e.g., "backend_coder", "security_reviewer"
  system_prompt: string           // Role-specific LLM system instruction
  memory_tags: string[]           // Tags whose memories receive 3× retrieval weight
  tool_scope: string[]            // Which tools this persona may invoke
  capability_proof: Lean4Proof    // Formal proof of capability boundaries
  state_permissions: StateList    // Which SCU states this persona may modify
}
```

In the preferred embodiment, the following persona masks are defined:

**Coder Masks:**
- Backend Coder — Python, Node.js, Go, Rust server-side code
- Frontend Coder — React, Next.js, TypeScript client-side code
- Schema Coder — SQL, ORM, database migration code

**Reviewer Masks:**
- Backend Reviewer — Logic, correctness, performance review
- Security Reviewer — Vulnerability, injection, exposure review
- Docs Reviewer — Documentation completeness, accuracy review
- Silent Fallback Detector — Identifies silent fallback patterns that mask errors

**Orchestrator Mask:**
- Task decomposition, persona selection, merge decision-making

**Persona switching protocol:**
1. Guardian completes current work unit under active mask
2. Orchestrator Mask is activated
3. Orchestrator determines next required mask based on SCU state machine
4. Target mask is activated: system prompt replaced, memory bias updated, tool scope updated
5. Activation completes in <1 millisecond (no process spawn, no IPC)

### 5. Tag-Partitioned Memory Store with Persona Bias

The memory store is a vector database (SQLite with sqlite-vec in desktop mode; PostgreSQL with pgvector in team mode) containing tagged memory records.

**Memory record structure:**
```
MemoryRecord {
  content: string             // The stored information
  embedding: float[]          // Vector embedding (StarCoder2 for code; BGE-large for text)
  tags: string[]              // Domain tags, e.g., ["#backend", "#auth", "#security"]
  timestamp: datetime         // When this memory was created
  persona_source: string      // Which persona created this memory
  scope: MemoryScope          // EPHEMERAL | MIDTERM | LONGTERM
}
```

**Persona bias retrieval algorithm:**

When a persona mask is active, memory retrieval is performed as follows:

```
function retrieve_memories(query, active_persona, k=10):
    base_scores = vector_similarity_search(query, all_memories)
    
    for each memory record:
        if memory.tags ∩ active_persona.memory_tags ≠ ∅:
            adjusted_score = base_score × 3.0  // 3× boost for persona-relevant tags
        else:
            adjusted_score = base_score × 1.0  // No penalty; cross-domain always accessible
    
    return top_k(adjusted_score_sorted_records, k)
```

This design achieves two properties simultaneously:
- **Persona focus**: When the Security Reviewer Mask is active, security-tagged memories rank 3× higher, producing a security-focused context without duplicating the memory store
- **Cross-domain awareness**: The Security Reviewer can still access backend-tagged memories at 1× weight — it knows what the Backend Coder discovered, at lower priority

**Memory scope management:**
- EPHEMERAL: Session-lifetime, cleared on Guardian restart
- MIDTERM: Project-lifetime, persists across sessions, decays after configurable period
- LONGTERM: Permanent, manually curated, cross-project knowledge

### 6. Craft Method State Machine — Speed-Governed Development Lifecycle

The Craft Method defines a five-state machine for coding artifacts (Software Coding Units, or SCUs):

```
RAW → TYPED → REFINED → PROPOSED → RESOLVED
```

**State definitions:**

| State | Meaning | What Must Happen to Advance |
|-------|---------|----------------------------|
| RAW | Initial intent captured, no code written | Intent parsed, requirements extracted, persona masks assigned |
| TYPED | First code draft exists | Code compiles/parses; no syntax errors; meets stated interface |
| REFINED | Code passes review | At least one reviewer mask has evaluated; findings resolved or accepted |
| PROPOSED | Ready for human review | All automated checks pass; diff is clean; documentation present |
| RESOLVED | Human approved or system auto-approved | Human approval OR confidence score ≥ threshold |

**State machine enforcement:**

The Craft Method enforces that no artifact may skip a state transition:
- An artifact CANNOT move from RAW to REFINED without passing through TYPED
- An artifact CANNOT move from TYPED to PROPOSED without passing through REFINED
- A reviewer mask CANNOT mark an artifact PROPOSED if any BLOCKER-severity finding is unresolved

This enforcement is implemented as a hard gate in the Guardian Core — the LLM provider call for the next pipeline step is not issued until the current state's requirements are met. The AI cannot "decide" to skip the review step; the code path simply does not exist.

**SCU decomposition:**

Before coding begins, the Orchestrator Mask decomposes the user's request into a set of SCUs — minimally-scoped work items. Each SCU has:
- A well-defined deliverable (a file, a function, a database migration)
- A set of personas required to process it
- A state machine instance

SCUs are executed in dependency order (or in parallel when no dependency exists), each proceeding through the five states before the next dependent SCU begins.

### 7. CRABS Protocol — Attribute-Based State-Derived Permissions

CRABS (Capability-Role Attribute-Based State machine) replaces static role-based access control (RBAC) with permissions that automatically derive from the current project state.

**Problem with static RBAC:**  
In static RBAC, a persona mask has a fixed permission set regardless of context. The Security Reviewer always has the same permissions whether reviewing a greenfield project or a production hot-patch. Context matters; static permissions cannot encode it.

**CRABS solution:**  
Permissions are defined as logical rules over project attributes. When project attributes change (a file is committed, a test passes, a review cycle completes), permissions are automatically recomputed.

Example CRABS rule:
```
GRANT(SecurityReviewer, WRITE_PRODUCTION_CONFIG) 
  IF project.security_scan_passed = TRUE
  AND project.pending_review_count = 0
  AND project.last_security_scan_age < 24h
```

In this example, the Security Reviewer persona may not write to production configuration files unless: (1) the automated security scan has passed, (2) no outstanding reviews exist, and (3) the security scan is recent. These conditions are evaluated dynamically; the permission is granted or revoked as project state evolves.

CRABS state machines are implemented as a deterministic finite automaton where:
- States correspond to project lifecycle stages
- Transitions are triggered by verifiable events (test pass, commit, review approval)
- Permissions are output functions of the current state

### 8. Formally Verified Persona Capability Boundaries

In the preferred embodiment, each persona mask includes a capability proof — a formal mathematical proof (using the Lean 4 theorem prover) that specifies exactly what the persona can and cannot do.

**Proof structure:**

```lean4
-- Example: Backend Coder Mask capability proof
theorem backend_coder_cannot_approve_security_review :
  ∀ (action : Action) (mask : PersonaMask),
    mask.id = "backend_coder" →
    action.type = ApproveSecurityReview →
    ¬ can_execute mask action := by
  intro action mask h_mask h_action
  simp [can_execute, backend_coder_capabilities, h_mask, h_action]
```

These proofs are loaded at Guardian startup and verified by the Lean 4 runtime before any persona activation. If a proof fails verification (e.g., due to a configuration change that violated the proven invariant), the persona activation is blocked and the error is surfaced to the user.

This provides a property that no prompt-based AI safety system can provide: **mathematical certainty** that a given persona will not perform a disallowed action, independent of the LLM provider's output.

### 9. Worktree-per-Task Isolation

For parallel coding tasks, the invention provides git worktree isolation:
- Each SCU assigned to a coding persona receives a copy-on-write git worktree
- The persona codes in its isolated worktree without affecting the main branch
- Upon REFINED state, the diff is extracted from the worktree
- The Orchestrator Mask merges diffs from parallel SCUs before proposing to the user
- Destructive actions within a worktree have no effect on the production codebase

### 10. Desktop Shell Integration

In the preferred embodiment, the Guardian is packaged as a Tauri (Rust) desktop application:
- A single binary (~15MB) requires no runtime installation
- The Monaco editor (VS Code engine) provides code editing with LSP support
- React + TypeScript frontend panels display: active persona, activity stream, pending findings, campaign timeline, memory explorer
- The Guardian sidecar communicates with the frontend via Tauri IPC

---

## CLAIMS

1. A computer-implemented system for artificial-intelligence-assisted software development, comprising:
   a) a single AI entity (Guardian) that maintains a persistent context across multiple role activations;
   b) a persona mask engine that activates role-specific configurations comprising a system prompt, a memory tag list, a tool access scope, and a state permission set;
   c) wherein persona switching is accomplished by updating said configuration without spawning a new process, creating a new connection, or performing inter-process communication;
   d) a tag-partitioned vector memory store accessible from all persona mask activations;
   e) wherein memory retrieval assigns a first retrieval weight multiplier (≥2×) to memory records whose tags intersect with the active persona's memory tag list, and a second lower retrieval weight multiplier to other memory records;
   f) wherein cross-domain memory records remain retrievable from all persona activations at said second lower weight.

2. The system of claim 1, further comprising a state machine governing code artifact lifecycle, wherein code artifacts must progress through a defined sequence of states including at minimum a first draft state, a reviewed state, and a proposed state, and wherein transition to a subsequent state is blocked until requirements of the current state are satisfied.

3. The system of claim 2, wherein blocked state transition is enforced by withholding the LLM provider call for the subsequent pipeline step until the current state requirements are verified by a deterministic check.

4. The system of claim 1, wherein each persona mask comprises a formal capability proof expressed in a type-theoretic proof language, and wherein persona activation is conditioned on successful runtime verification of said capability proof.

5. The system of claim 4, wherein said formal capability proof specifies at least one action that the persona is prohibited from taking, and wherein the prohibition is enforced by a deterministic mechanism independent of the LLM provider's output.

6. The system of claim 1, further comprising an attribute-based permission engine wherein permissions granted to a persona mask are computed dynamically from current project state attributes, and wherein changes to project state attributes automatically recompute permission grants and revocations without administrator intervention.

7. The system of claim 6, wherein a permission grant rule comprises a logical predicate over one or more project state attributes, and wherein the permission is granted if and only if the predicate evaluates to true under current project state.

8. The system of claim 1, further comprising a worktree isolation mechanism wherein each concurrent coding task is assigned a copy-on-write version control worktree, persona coding operations are confined to the assigned worktree, and only the resulting diff is extracted upon task completion without modifying the main codebase.

9. The system of claim 1, wherein the Guardian is packaged as a single executable binary comprising the AI entity sidecar process, a code editing surface, and a user interface for displaying active persona state, pending findings, and task progress.

10. A method for AI-assisted software development comprising:
    a) receiving a software development request from a user;
    b) decomposing the request into minimally-scoped work units each associated with a target deliverable;
    c) for each work unit, activating a coding persona mask on a single persistent AI entity, generating code in an isolated version control workspace, and recording the result in a tag-partitioned memory store with tags corresponding to the coding persona's domain;
    d) upon completion of coding phase, activating one or more reviewer persona masks on the same persistent AI entity, wherein each reviewer persona retrieves memories with a retrieval weight bias favoring said reviewer persona's domain tags;
    e) enforcing that the code artifact advances from a draft state to a reviewed state to a proposed state only upon satisfaction of defined quality criteria at each state;
    f) presenting the proposed code artifact to a user for approval.

11. The method of claim 10, wherein activating a different persona mask comprises updating a system prompt injected into an LLM provider call and updating retrieval weight multipliers applied to the memory store, without spawning a new process.

12. The method of claim 10, wherein the reviewer persona mask activation provides cross-domain awareness of discoveries made during coding persona activation by accessing coding-phase memory records at a lower retrieval weight than reviewer-domain records.

13. A computer-readable medium storing executable instructions that, when executed, implement an AI coding environment wherein:
    a) a single AI entity processes both code generation tasks and code review tasks by adopting role-specific persona configurations;
    b) a shared memory store persists knowledge across persona activations, with retrieval biased toward the active persona's domain;
    c) code artifacts are subject to a machine-enforced state machine requiring passage through quality checkpoints before delivery to a user;
    d) each persona configuration includes a formally verified specification of its permitted and prohibited actions.

---

## ABSTRACT

A software development system and method in which a single AI entity (the Guardian) performs the functions of multiple specialized AI agents by adopting verified persona masks. Each persona mask comprises a role-specific system prompt, a set of domain tags that bias memory retrieval, and a formally verified capability specification. The single-entity architecture eliminates inter-process communication overhead and provides global situational awareness across all persona activations. A tag-partitioned vector memory store assigns a multiplied retrieval weight (≥2×) to memory records matching the active persona's domain tags while keeping cross-domain records accessible at a lower weight. A five-state machine (raw→typed→refined→proposed→resolved) enforces that code artifacts pass through defined quality stages, with state transitions blocked by deterministic checks rather than AI judgment. Persona capability boundaries are specified as formal proofs in a theorem-prover language (Lean 4), providing mathematical guarantees about permitted and prohibited actions. The system is packaged as a single desktop binary.

---

*Prepared by: Analog 6 — ResonantOS*  
*Source documents: CODE-FORGE-V3-FINAL-ARCHITECTURE.md, CODE-FORGE-V2-ARCHITECTURE.md, RESONANT-CODE-FORGE-COMPLETE-ARCHITECTURE.md*  
*Date: June 9, 2026*
