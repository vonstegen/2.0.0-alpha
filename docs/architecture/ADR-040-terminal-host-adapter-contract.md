# ADR-040: Terminal Host Adapter Contract

## Decision Metadata

- Decision status: Deferred
- Alpha applicability: Deferred
- Superseded by: None
- Owner: Add-on SDK
- Decision date: 2026-10-02
- Alpha note: Terminal workspaces and terminal add-ons are explicitly out of
  Alpha scope ([ALPHA_RUNTIME_BOUNDARY.md](ALPHA_RUNTIME_BOUNDARY.md)). This ADR
  defines the contract for future terminal-host work; it adds no Alpha runtime,
  build, or validation component.

## Context

A design session (`chatgpt-chat-sessions/20261002-chatgpt-chat-session.md`)
proposed treating an external terminal (iTerm2, Ghostty, WezTerm, kitty, Apple
Terminal) as a replaceable host for harness add-ons (Pi, OMP, Codex, Claude
Code, Gemini, Hermes), with DAR as an optional event-consumer add-on.

[ADR-039](ADR-039-harness-addon-category-swappable-default-agent.md) already
covers the harness half: `runtimeType: "harness"` with
`harnessRuntime.variant: "cli" | "provider"`, naming pi.dev, Claude Code,
OpenCode, and Codex as `cli` harnesses. The
[reconciliation note](TERMINAL-HOST-RECONCILIATION.md) established that the only
genuinely new runtime concept is the terminal host itself. Two unused hooks
already exist for it: `DelegationTargetRuntime = "terminal-service"` and
`AddOnEmbeddedWorkspaceMode = "terminal"`.

This ADR defines the terminal host contract and its session/event model.

## Decision

### Terminal is a replaceable host; ROS is the authority

The terminal does terminal things; ROS does resource, authority, session, and
lifecycle things. A harness sees a PTY/shell environment and never learns which
terminal host is attached. Adapters are small, reviewed, and declared through
`TerminalHostAdapterContract` — the terminal mirror of
`AddOnAgentRuntimeAdapterContract`.

### Three entry modes, one session contract

A `RosTerminalSession` has one contract but three ways to enter it:

| Mode       | Trigger                                              | Result          |
| ---------- | ---------------------------------------------------- | --------------- |
| `create`   | ROS launches the terminal (`Pi → Open in Terminal`)  | managed session |
| `adopt`    | User already has a terminal and runs `ros attach`    | adopted session |
| `detached` | An ordinary session ROS observes but has not adopted | unattached      |

The lifecycle is `created | adopted | attached | running | detached | terminated`.
**Both entry states must converge on the same `attached` contract** so a harness
cannot tell who launched the terminal (the TH-3D equivalence requirement).

ROS does **not** auto-attach every terminal: adoption is explicit for both
security and usability.

### No secrets in launch commands

ROS never constructs a command string containing credentials. It launches a
bootstrap (`ros-session attach <id>`) that asks the broker for the authorized
runtime environment, so secrets stay out of the terminal command line and
process arguments.

### Session status indicator

The bootstrap also injects `ROS_SESSION_ID` into the scoped environment so a
shell prompt can render a `[ROS]` marker when the session is attached. The
adapter mirrors live attach/detach/terminate state through terminal-native user
variables (e.g., iTerm2 `user.rosSession`), so the terminal status bar stays
accurate without a long-lived token in the environment.

### Bidirectional, but screen-scraping is not primary

Two event families, kept separate:

- **Harness runtime events** (primary) — `harness.session.created`,
  `harness.user.message`, `harness.tool.called`, `harness.artifact.created`,
  `harness.session.completed`, etc., published by a cooperative harness.
- **Terminal telemetry** (supplemental) — `terminal.command.started`,
  `terminal.command.ended` (with exit status), `terminal.cwd.changed`,
  `terminal.session.terminated`, observed at the terminal boundary
  (iTerm2 `PromptMonitor`, WezTerm/kitty events).

Screen streaming is available for observation/debugging only, never as the
provenance source.

### DAR is an optional event consumer

DAR subscribes to `RosTerminalEventEnvelope` and persists typed
`DelegationArtifactType` artifacts through `archiveIntegration`. It owns neither
the terminal nor the harness. Removal of DAR must not affect Pi (the Add-on
Independence Principle, already expressible via
`RevocationBehavior = "degrade" | "hide-surface"`).

### DAR provenance fidelity

Each session carries a `ProvenanceFidelity` — the highest fidelity DAR can
record for it, determined by what the harness actually emits:

| Fidelity      | Source                                                              | DAR records                                                                                     |
| ------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `structured`  | Cooperative harness publishes `HarnessRuntimeEvent`                 | Tool calls, artifacts, user/assistant messages, resource access — full CSRO provenance          |
| `telemetry`   | Stock CLI (Codex, Gemini, Claude Code, OMP) emits no harness events | Command boundaries, cwd changes, exit status, session lifecycle — from `TerminalTelemetryEvent` |
| `observation` | Terminal host has no feedback channel                               | Screen-stream/debug only; no provenance                                                         |

The boundary is explicit:

- **Full DAR provenance requires a cooperative harness.** A harness is
  cooperative when it (or a thin ROS wrapper) publishes `HarnessRuntimeEvent`.
- **A wrapping adapter may upgrade `telemetry` → `structured` for a specific
  CLI**, but that is per-harness work and is never assumed by DAR or the contract.
- **DAR must not fail on low-fidelity sessions.** It records whatever the
  session produces and annotates artifacts with the achieved fidelity. DAR is
  installed and subscribed independently; its absence never affects the harness.

## Rules

- A terminal host adapter is declared via `TerminalHostAdapterContract`; it is a
  `local-service` add-on with `embeddedWorkspace.mode = "terminal"`.
- Spawn is fixed-root and gated, mirroring ADR-039's `cli` harness controls:
  `fixed-install-root` discovery (never ambient `PATH`), scoped env allowlist,
  `explicit-enable` execution gate.
- A terminal host add-on requires a `terminal-host` capability grant (added to
  `Capability` and `ADDON_CAPABILITIES`).
- Provider secrets remain session-only and cross only as a scoped env allowlist.
- The contract must be validated through a headless terminal-host fixture (an
  in-memory adapter) before any real terminal is integrated.

## Authorization model

The terminal host reuses the existing token machinery; only one new token type
is introduced.

### Existing tokens, reused

- **Per-addon bearer + admin tokens** (P6 precedent: `workspaceAddonBearerTokens`
  / `workspaceAddonAdminTokens`). The terminal host adapter daemon is a
  `local-service` add-on and authenticates to the broker with its own
  operator-pinned bearer, granted `terminal-host`. The admin token stays
  host-side and is used only for out-of-band revocation.
- **Action token** (`dsh-action-token` lease via `credentials.acquire`).
  Provider calls made on the harness's behalf use a short-lived action token,
  never a raw provider key in the terminal.
- **Scoped capability grants** (`CapabilityGrant`). The daemon's `terminal-host`
  grant is scope- and revocation-bound exactly like any other add-on grant.

### New: session bootstrap token

The `ros-session attach <id>` bootstrapper runs _inside the terminal_, so the
only credential that crosses the terminal command line is a short-lived,
single-use, session-scoped token (`SessionBootstrapGrant`). It is:

- **audience-bound** to one `ros-session-<id>`;
- **single-use** (claim then discard);
- **narrow** — it may only fetch the authorized runtime environment (scoped
  env, project, cwd, provider profile) and launch the harness; it cannot mint
  authority, read the add-on bearer/admin tokens, or grant capabilities.

ROS mints this token when the user selects `Pi → Open in Terminal` (Mode A) or
runs `ros attach` (Mode B). No long-lived token ever appears in a command
string or shell history.

### Harness

The harness (Pi/OMP/Codex/…) self-authenticates per ADR-039's `cli` variant.
Provider credentials remain session-only and cross only as a scoped env
allowlist; the harness never receives the adapter's bearer or admin token, and
the adapter never receives the harness's provider key.

## Interfaces

Concrete types live in
[`src/core/terminal-host-contract.ts`](../../src/core/terminal-host-contract.ts):

- `TERMINAL_HOST_CONTRACT_VERSION`
- `TerminalHostAdapterId`, `TerminalHostAdapterCapability`
- `TerminalHostOperation`, `TerminalHostTransport`
- `TerminalHostAdapterContract`
- `TerminalSessionEntryMode`, `RosTerminalSessionState`, `RosTerminalSession`,
  `ProvenanceFidelity`
- `TerminalTelemetryEvent`, `HarnessRuntimeEvent`,
  `RosTerminalEventSource`, `RosTerminalEventEnvelope`
- `TerminalHostErrorCode`, `TERMINAL_HOST_PUBLIC_ERROR_MESSAGES`
- `SessionBootstrapGrant`

## Consequences

- Pi/OMP/Codex/Claude Code/Gemini/Hermes become harness cards over one terminal
  infrastructure instead of each owning a terminal implementation.
- The terminal choice (iTerm2 ↔ Ghostty ↔ WezTerm ↔ Apple Terminal) is
  independent of the harness choice.
- DAR gains a structured provenance boundary at the session/event level.
- Stock CLIs (Codex, Gemini, Claude Code) that do not emit harness events are
  recordable only at terminal-telemetry fidelity; full DAR provenance requires
  a cooperative harness or a wrapping adapter.
- iTerm2 is the reference adapter (richest API), but the contract must also run
  unchanged against Ghostty (TH-6 equivalence).

## Migration

1. (This ADR) Define the contract types. **Done.**
2. ✅ Add `terminal-host` to `Capability` and `ADDON_CAPABILITIES`. The SDK
   validator consumes `ADDON_CAPABILITIES`, so no separate validator entry is
   required.
3. ✅ Add a headless in-memory terminal-host fixture and contract tests (vitest):
   `examples/sdk-demo/terminal-host/in-memory-host.ts` and
   `examples/sdk-demo/tests/terminal-host-contract.test.ts`.
4. Build the iTerm2 reference adapter as a `local-service` add-on.
5. Prove ROS ↔ iTerm2 connection (create/adopt/attach/terminate) without Pi.
6. Attach Pi as a `cli` harness (ADR-039) and prove the end-to-end session.
7. Build the Ghostty adapter and prove harness equivalence (Pi + iTerm2 and
   Pi + Ghostty both PASS with no harness change).

## Sources

- `chatgpt-chat-sessions/20261002-chatgpt-chat-session.md`
- [ADR-039](ADR-039-harness-addon-category-swappable-default-agent.md)
- [Reconciliation note](TERMINAL-HOST-RECONCILIATION.md)
- [Operation split note](TERMINAL-HOST-OPERATION-SPLIT.md)
- [Alpha Runtime Boundary](ALPHA_RUNTIME_BOUNDARY.md)
