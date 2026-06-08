# THE HOT ROD RIG v4.0
## Adversarial Verification through Diversity (AVD)
### The Multi-Engine Code Quality System for ResonantOS

**Author:** Tom Pennington / Analog 6
**Date:** 2026-06-08
**Status:** Proven in production (Operation Nightwatch)

---

## What It Is

The Hot Rod Rig is a multi-engine adversarial code review and remediation system. It uses model diversity, provider diversity, and execution environment diversity to find bugs that any single AI would miss.

The core thesis: **No single model catches everything. Different models have different blind spots. Run them in parallel, triangulate the findings, and the intersection reveals ground truth.**

This is not a theory. Operation Nightwatch (June 7-8, 2026) used the full rig to find and fix 17 issues in the ResonantOS 2.0.0-alpha codebase, including 6 security-critical vulnerabilities that no single engine found alone.

---

## Version History

| Version | Date | What Changed |
|---------|------|--------------|
| v1 | May 2026 | Single-engine CLI review (Codex or Claude Code, one at a time) |
| v2 | Late May | Multi-engine CLI formation (Codex + Claude Code + Pi + Gemini in parallel) |
| v3 | June 6 | Added desktop AI IDEs as review surfaces (Cursor, Antigravity, Claude Desktop) |
| **v4** | **June 8** | **Full stack: CLI engines + Desktop engines + Subagent reviewers + Vlad's CI security pipeline + Nightwatch wave methodology** |

---

## The Full v4 Stack

```
┌─────────────────────────────────────────────────────────┐
│              LAYER 5: VLAD'S CI SECURITY PIPELINE       │
│  Automated supply-chain scanning on every PR/push       │
│  npm lockfiles, npm audit, Rust advisories,             │
│  actions hardening, dependency review                   │
│  Registry-driven, adapter-based, policy modes           │
├─────────────────────────────────────────────────────────┤
│              LAYER 4: SUBAGENT DEEP REVIEWERS           │
│  Focused-lens subagents (security, architecture,        │
│  browser/build) doing full file reads with line numbers  │
│  Output: /tmp/nightwatch-review-*.md                    │
├─────────────────────────────────────────────────────────┤
│              LAYER 3: DESKTOP AI ENGINES                │
│  Cursor, Antigravity (Gemini), Claude Desktop,          │
│  Codex Desktop, AbacusAI — full project context,        │
│  different UIs, different model families                 │
│  Pattern: prompt → file write → read results            │
├─────────────────────────────────────────────────────────┤
│              LAYER 2: CLI ENGINE FORMATION               │
│  Codex CLI (GPT), Claude Code (Sonnet/Opus),            │
│  Pi (DeepSeek R1), Gemini CLI — parallel execution,     │
│  each on a specific task or review focus                 │
├─────────────────────────────────────────────────────────┤
│              LAYER 1: ORCHESTRATOR (Analog 6)           │
│  Task decomposition, TASK.md writing, subagent spawn,   │
│  result verification, triangulation synthesis,           │
│  commit/push, wave coordination                         │
└─────────────────────────────────────────────────────────┘
```

---

## Layer 1: The Orchestrator

**Who:** Analog 6 (Claude Opus, main session)
**Role:** Strategy, decomposition, delegation, verification, synthesis

The orchestrator NEVER writes code directly. It:
1. Reads the codebase to understand the problem
2. Writes precise TASK.md specs with file paths, line numbers, and test commands
3. Spawns subagents or fires CLI engines with those specs
4. Verifies results (runs tests, reads diffs, checks for regressions)
5. Triangulates findings across engines
6. Commits verified changes

**Key principle:** The orchestrator is the architect. The engines are the builders. Separation of concerns.

---

## Layer 2: CLI Engine Formation

Four CLI coding agents running in parallel, each from a different provider/model family:

| Engine | CLI Command | Model | Strength |
|--------|------------|-------|----------|
| **Codex** | `codex exec --full-auto` | GPT-5.1-codex | Structural analysis, security patterns, large file comprehension |
| **Claude Code** | `claude-code` | Sonnet/Opus | Nuanced reasoning, architectural coherence, type safety |
| **Pi** | `pi --model deepseek-r1` | DeepSeek R1 | Deep reasoning chains, mathematical verification, cost analysis |
| **Gemini CLI** | `gemini` | Gemini Ultra | Broad knowledge, documentation quality, cross-reference detection |

### How to fire them

Each engine gets a TASK.md and runs independently:

```bash
# Engine A: Codex
codex exec --full-auto -m gpt-5.1-codex "Read TASK-A.md and execute"

# Engine B: Claude Code
claude-code --model sonnet "Read TASK-B.md and execute"

# Engine C: Pi (DeepSeek)
pi --model deepseek-r1 "Read TASK-C.md and execute"

# Engine D: Gemini
gemini "Read TASK-D.md and execute"
```

### Auth setup (all keys in ~/.zshrc)
```bash
export OPENAI_API_KEY="..."        # Codex
export ANTHROPIC_API_KEY="..."     # Claude Code
export DEEPSEEK_API_KEY="..."      # Pi
export GOOGLE_API_KEY="..."        # Gemini
```

### Formation rules
- **Never give two engines the same file** (merge conflicts)
- **Each engine gets a specific, bounded task** (max 3 files, ~100 lines)
- **Test command included in every TASK.md** (engine runs it, orchestrator re-runs it)
- **Git worktrees for parallel work** (learned the hard way — concurrent checkouts fight)

---

## Layer 3: Desktop AI Engines

The desktop coding IDEs provide a DIFFERENT kind of review lens than CLI engines. They have:
- Full project tree visibility
- Their own model families and context windows
- GUI-specific analysis patterns
- Independent execution environments

| Engine | App | Model Family | Mode |
|--------|-----|-------------|------|
| **Cursor** | Cursor IDE | GPT-4o / Claude | IDE — can write files directly |
| **Antigravity** | Antigravity | Gemini | IDE — can write files directly |
| **Claude Desktop** | Claude Desktop | Claude | Chat — needs clipboard/file-write prompt |
| **Codex Desktop** | Codex Desktop | GPT-5.1 | Chat — needs file-write prompt |
| **AbacusAI** | AbacusAI | Multiple | Chat — needs file-write prompt |

### The Desktop Resonator Pattern

For IDE-mode engines (Cursor, Antigravity):
```
1. Open project in IDE
2. Paste review prompt
3. Engine writes review to /tmp/{engine}-review.md
4. Read the file
```

For Chat-mode engines (Claude Desktop, Codex Desktop):
```
1. Paste review prompt with instruction: "Write your review to /tmp/{engine}-review.md"
2. Engine writes file
3. Read the file
```

**Key discovery from v3:** IDE engines find CONTEXTUAL bugs that CLI engines miss because they see the full project tree. CLI engines find STRUCTURAL bugs because they follow explicit instructions precisely. The combination catches more than either alone.

### Proven triangulation example (Operation Nightwatch, June 7)

| Finding | Codex CLI | Cursor | Antigravity |
|---------|-----------|--------|-------------|
| Bridge tokens on disk | ❌ | ✅ | ✅ |
| Hardcoded add-on IDs in kernel | ❌ | ❌ | ✅ |
| CEF sandbox disabled | ✅ | ❌ | ❌ |
| Renderer self-grant | ✅ | ❌ | ❌ |
| Cleartext credentials | ❌ | ❌ | ✅ |
| Fallback chain ordering | ❌ | ❌ | ✅ |

**No single engine found more than 4/12 issues. Triangulation found all 12.**

---

## Layer 4: Subagent Deep Reviewers

After fixes are applied, spawn focused-lens reviewers via OpenClaw subagents. Each reviewer does a deep read of the ENTIRE codebase through one analytical lens:

| Reviewer | Focus | Output |
|----------|-------|--------|
| **Security** | IPC boundary, credential handling, extension permissions, bridge auth, recent fix verification | `/tmp/nightwatch-review-security.md` |
| **Architecture** | ADR compliance, code quality, error handling, race conditions, test coverage, dead code | `/tmp/nightwatch-review-architecture.md` |
| **Browser/Build** | Extension completeness, CI/CD, deps, packaging, COMET parity | `/tmp/nightwatch-review-browser-build.md` |

### Why subagents, not CLI engines?

Subagents have access to `read`, `exec`, `grep` — they can trace code paths, run tests, and verify fixes mechanically. CLI engines see the prompt and write output. Subagents INVESTIGATE.

### Spawning pattern:

```
sessions_spawn(
  task: "Full security review of ~/2.0.0-alpha...",
  mode: "run",
  label: "review-security",
  cwd: "/Users/dr.tom/2.0.0-alpha"
)
```

Three reviewers run in parallel. Results triangulated by orchestrator.

---

## Layer 5: Vlad's CI Security Pipeline

The automated, always-on layer. Runs on every PR and push — no human has to remember to trigger it.

### Architecture (Vlad's design)

```
GitHub event (PR, push, manual)
  → .github/workflows/security.yml
    → .github/security-pipeline/checks.yml (registry)
      → scripts/security-pipeline/run-check.mjs (runner)
        → adapters (one per check type)
          → normalized result envelope (pass/warn/block)
```

### Check Registry

| Check | Family | Policy | Status |
|-------|--------|--------|--------|
| `npm-lockfiles` | supply-chain | block | ✅ Built (SWU-SP-003) |
| `npm-audit` | supply-chain | block | Designed, not built |
| `rust-audit` | supply-chain | block | Designed, not built |
| `actions-hardening` | supply-chain | warn | Designed, not built |
| `dependency-review` | supply-chain | block (PR only) | Designed, not built |

### Policy modes (graduated enforcement)

```
observe → warn → block
```

- **observe**: log only, no CI status effect
- **warn**: CI passes with warning annotation
- **block**: CI fails, merge blocked

### What's built vs what's needed

Vlad completed 3/8 tasks (L0 skeleton: registry schema, runner CLI, lockfile adapter). Blocked on his Codex sandbox lacking npm/cargo. We have both — the remaining 5 tasks can be finished by our engines.

---

## The Nightwatch Wave Methodology

The proven execution pattern from Operation Nightwatch:

### Phase 0: Housekeeping
- Commit all uncommitted work
- Verify clean test baseline
- Push to establish starting point

### Wave 1: Critical (parallel)
- 4 subagents, each owns 1-2 specific fixes
- Each creates a feature branch from dev
- Each runs tests independently
- Orchestrator merges all, runs full test suite, pushes

### Wave 2: Correctness (parallel)
- 3 subagents for non-critical but important fixes
- Same branch/merge/test pattern

### Wave 3: Review
- 3 focused-lens reviewers audit the COMMITTED state
- Findings become Wave 4 tasks if HIGH severity
- LOW/MEDIUM findings logged for future work

### Wave 4: Fix review findings (if any)
- Only HIGH findings get fixed immediately
- Merge, test, push

### Phase Final: Report
- Full commit log
- Test results
- Remaining items (with severity and effort estimates)
- Updated PROJECT-ANCHOR.md

### Timing (proven)
- Phase 0: 15 min
- Wave 1 (4 agents): 10 min parallel + 5 min merge/verify
- Wave 2 (3 agents): 15 min parallel + 5 min merge/verify
- Wave 3 (3 reviewers): 7 min parallel
- Wave 4 (2 fix agents): 5 min parallel + 5 min merge/verify
- Report: 10 min
- **Total: ~70 minutes for 17 fixes + 3 deep reviews**

---

## What Makes v4 Different from v3

| Aspect | v3 | v4 |
|--------|-----|-----|
| CLI engines | 4 (Codex, Claude Code, Pi, Gemini) | Same 4 |
| Desktop engines | 5 (Cursor, Antigravity, Claude Desktop, Codex Desktop, AbacusAI) | Same 5 |
| Subagent reviewers | Not used | 3 focused-lens reviewers (security, architecture, browser/build) |
| CI automation | Not used | Vlad's registry-driven security pipeline |
| Wave methodology | Ad-hoc | Structured Phase 0 → Wave 1-4 → Report |
| Fix verification | Manual grep/read | Each subagent runs `npm test` + `cargo test` + `npm run build` |
| Triangulation | Manual comparison | Structured overlap matrix |
| Git strategy | Shared checkout (conflicts) | Per-agent branches + git worktrees |
| Result persistence | Temporary | Committed to `docs/reviews/` |

---

## The 14-Lens Formation

When all layers are active, the codebase is reviewed through 14 independent lenses:

**CLI Engines (4):**
1. Codex (GPT) — structural/security
2. Claude Code (Sonnet) — architectural coherence
3. Pi (DeepSeek R1) — deep reasoning
4. Gemini CLI — broad knowledge

**Desktop Engines (5):**
5. Cursor (GPT-4o/Claude) — IDE contextual
6. Antigravity (Gemini) — IDE contextual, different model
7. Claude Desktop (Claude) — chat analytical
8. Codex Desktop (GPT) — chat analytical
9. AbacusAI (Multiple) — multi-model

**Subagent Reviewers (3):**
10. Security reviewer — IPC, auth, credentials, extensions
11. Architecture reviewer — ADR compliance, code quality, races
12. Browser/Build reviewer — extension, CI, deps, packaging

**CI Pipeline (2):**
13. Supply-chain scanner — lockfiles, audit, advisories
14. Actions hardening — workflow permissions, SHA pinning

**14 lenses × different models × different contexts = maximum coverage.**

---

## Quality > Speed Rules

These rules are non-negotiable in the Hot Rod Rig:

1. **Every TASK.md includes a test command.** No "go fix it" — specific files, line numbers, verification steps.
2. **Every engine runs tests before committing.** `npm test` + `cargo test --lib` + `npm run build` minimum.
3. **The orchestrator re-runs tests after merge.** Engine-local passes don't guarantee integration passes.
4. **Never give two engines the same file.** Use git worktrees or separate branches.
5. **Triangulate before declaring "fixed."** If only one engine found it and one engine fixed it, another engine should verify.
6. **Review findings get committed to the repo.** `docs/reviews/` — they're project artifacts, not temporary files.
7. **Wave methodology, not ad-hoc.** Phase 0 → Waves → Review → Fix → Report. Every time.

---

## Proven Results (Operation Nightwatch, June 7-8 2026)

- **Input:** 12 triangulation findings from the v3 Hot Rod session
- **Process:** Phase 0 + 3 waves + review + fix wave
- **Output:** 20 commits, 17 fixes, 0 regressions
- **Tests:** 296/296 JS + 144/144 Rust (gained 1 test for security function)
- **Time:** ~70 minutes
- **Findings that required triangulation to discover:** 6/12 (no single engine found them)
- **Bonus findings from review phase:** 5 additional issues caught and fixed
- **Remaining items:** 10 LOW/MEDIUM (documented, not blocking)

---

## Getting Started

### Prerequisites
- OpenClaw with subagent support
- API keys for: OpenAI, Anthropic, DeepSeek, Google AI (in ~/.zshrc)
- CLI tools installed: codex, claude-code, pi, gemini
- Desktop apps installed: Cursor, Antigravity (optional: Claude Desktop, Codex Desktop, AbacusAI)

### Quick start (review mode)
```bash
# 1. Write review prompts to /tmp/review-prompt.md
# 2. Fire CLI engines
codex exec --full-auto "Review ~/2.0.0-alpha for security issues. Write to /tmp/codex-review.md"
claude-code "Review ~/2.0.0-alpha for architecture issues. Write to /tmp/claude-review.md"

# 3. Fire desktop engines (paste prompt in each IDE)
# 4. Spawn subagent reviewers via OpenClaw
# 5. Read all /tmp/*-review.md files
# 6. Triangulate findings into action items
```

### Quick start (fix mode — Nightwatch pattern)
```bash
# 1. Commit clean baseline
# 2. Write TASK-{n}.md for each fix
# 3. Spawn subagents (one per task, parallel)
# 4. Wait for completions
# 5. Merge branches, run full test suite
# 6. Push
# 7. Repeat for next wave
```

---

## Attribution

- **Tom Pennington** — Original Hot Rod Rig concept, AVD thesis, Loki routing architecture
- **Vlad (vrondelli)** — CI security pipeline design + implementation (registry, runner, adapters)
- **Z7Lab** — Reviewer persona specifications (structured review roles with checklists)
- **Chris (Resonant-Jones)** — Persona model pattern (one entity, many masks), context broker concept
- **Victor** — CRABS state machines, "Victor's Question" that inspired the red team methodology
- **Evans (Frumu/Tandem)** — Authority layer concept for governed agent execution

---

*This document is the authoritative reference for the Hot Rod Rig. Keep it updated as new engines, layers, or patterns are proven in production.*
