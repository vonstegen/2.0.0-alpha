# Terminal Host ↔ Pi-Native — Track Reconciliation (Working Note)

- Status: **Working note** (groundwork for a decision; not an ADR yet)
- Source branches: `r-and-d/terminal-host-current-dev` (ADR-040),
  `feature/pi-testing-phase` (ADR-041–044)
- Resolves: the fork between two parallel, partially-built answers to "how does a
  harness run in a terminal under ROS authority?"

## Purpose

Two build tracks have produced **two divergent models** for the same problem. Both
are green and both are incomplete. They must be reconciled before either is treated
as canonical, or the project will ship two competing session/terminal stacks.

## The two tracks

| Axis | Terminal-host (ADR-040) | Pi-native (ADR-041–044) |
| --- | --- | --- |
| Branch | `r-and-d/terminal-host-current-dev` | `feature/pi-testing-phase` |
| Where the harness runs | **External app** (iTerm2/Ghostty/WezTerm/kitty) | **Pseudo-TTY owned by the bridge**, raw ANSI streamed to the browser over SSE |
| Adapter surface | 4-op `TerminalHostAdapterContract` (`terminal-host-contract.ts`) | `startSession()` on a native session service |
| Session model | `RosTerminalSession` state machine (created/adopted/attached/running/detached/terminated) | parallel `pi-native-session` (no shared state machine) |
| Resources (project/files) | **not built** (`grantedCapabilities` declared only) | resource projection — ADR-043 |
| Skills | **not built** | skills projection — ADR-044 |
| Credential delivery | **not built** (`SessionBootstrapGrant` minted, never consumed) | plan-only credential adapter |
| Env scoping | `ADAPTER_ENV_ALLOWLIST = ["PATH","HOME"]` | `buildSessionEnvironment` (general allowlist + host-owned credential name) |
| Events | structured `HarnessRuntimeEvent` + `TerminalTelemetryEvent` (`RosTerminalEventEnvelope`) | raw ANSI over SSE (≈ `observation` fidelity) |

## What is genuinely shared (the seam)

The **resource/skills/credential projection is terminal-agnostic**. It produces the
*authorized session environment* — project root, files, skills, credential env name,
granted capabilities — without caring whether the harness renders in iTerm2 or in the
browser. This is the natural meeting point, and it is the exact "authorized runtime
environment" that ADR-040's `ros-session attach` is supposed to fetch.

Seam files (all exist **only in `pi-phase2`**, absent from the terminal-host branch):

- `browser-first/host/harness-resource-projection.mjs` — `createHarnessResourceProjection` (L141), `deriveProjectionOperations` (L108)
- `browser-first/host/harness-skills-projection.mjs` — `createHarnessSkillsProjection` (L341), `isSkillEligible` (L200), `buildSkillCatalogFromManifests` (L290)
- `browser-first/host/harness-session-environment.mjs` — `buildSessionEnvironment` (L15), `redactEnvironment` (L40)
- `browser-first/host/pi-native-credential-adapter.mjs` — `createPiNativeCredentialAdapter` (L28), `redactLaunchPlan` (L151)
- `packages/addon-sdk/src/harness-resources.ts` — the ADR-042 request contract; **absent from the terminal-host branch**

So the "shared seam" is not a single helper — it is an **entire SDK layer (ADR-041–044)**
that currently lives only on the pi-phase2 branch.

## The fundamental fork

There are **two different answers to "where does the TUI render?"** and they are a
product decision, not a technical one:

1. **External terminal** (ADR-040): the terminal is a separate, replaceable app; ROS
   never renders the TUI, it only observes events. The adapter is the integration point.
2. **Embedded browser terminal** (pi-native `pi-native-tui-host-service.mjs:82`): the
   terminal is a pseudo-TTY inside the bridge; ANSI streams to the browser over SSE
   (`/pi-native/tui-session/events`), keystrokes return over `input`/`resize` routes.

These can **coexist as two surfaces** ("Open in Terminal" vs "Open in browser") for the
same harness — or one is canonical and the other is folded in. Until that is decided,
both tracks are "correct but partial," and the resource/skills/credential seam is
duplicated nowhere yet (it's only built on the pi-native side).

## Reconciliation proposal

1. **Canonicalize the "authorized session environment" seam.** The projection + env +
   credential layer (ADR-041–044) answers *what the harness gets* and is
   terminal-agnostic. Promote it to the shared layer both tracks consume.
2. **The terminal-host contract (ADR-040) answers *where the harness runs*** (external
   app via the 4-op adapter). Its `ros-session attach` bootstrap should consume the
   shared env seam — i.e. the grant is exchanged for a projected env, not just returned.
3. **The pi-native TUI (SSE) is a third surface** (embedded). Decide whether it is a
   peer surface to the external terminal or superseded by it.
4. **Unify the session model.** `RosTerminalSession` should be the authority record;
   the pi-native session service should write to it, not maintain a parallel session
   concept.
5. **Bring the raw-ANSI path into the structured-event world.** The pi-native SSE stream
   is `observation` fidelity; it should either be annotated as such or upgraded via a
   cooperative-harness wrapper (ADR-040 §"DAR provenance fidelity").

## Key decisions (each needs an owner + eventual ADR)

1. **External vs embedded terminal** — or both as surfaces. This is the fork.
2. **Where the seam lives** — merge ADR-041–044 + `harness-resources.ts` into the shared
   branch, or keep pi-phase2 as the authority and pull it in.
3. **Session model unification** — `RosTerminalSession` as the single record.

## Follow-up tasks (order matters)

1. Merge/carry over ADR-041–044 (`harness-resources.ts`, projections, session-env,
   credential adapter) to the terminal-host branch.
2. Implement the 5 ROS verbs (`ROS_SESSION_OPERATIONS`) as the session manager, using
   the shared env seam.
3. Implement `ros-session attach`: consume the `SessionBootstrapGrant` → build the
   projected session env → return it (never argv/env, never raw secrets).
4. Wire `launchBootstrap` to deliver the projected env into the external terminal, not
   just echo the grant.
5. Resolve the TUI-surface question and act on it.
6. Then TH-6 (Pi attach) and the end-to-end "adopted iTerm2 + Pi uses memory/skills/
   credentials" proof become testable.
