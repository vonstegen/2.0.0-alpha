# Terminal Host — Surface Decision: External-First, Embedded Deferred

**Status:** Working note (not ADR-status). Records an operator decision that
resolves the external-vs-embedded fork named in
`TERMINAL-HOST-PI-NATIVE-RECONCILIATION.md` and gates Step 4 of the carry-over
plan.

**Date:** 2026-10-04.

---

## The fork

Where does the terminal/TUI render?

1. **External terminal (ADR-040).** The operator starts iTerm2 / Ghostty /
   WezTerm / kitty; ROS adopts that session and runs Pi inside it. The
   terminal-host track — 4-op adapter, `RosTerminalSession`, bridge service,
   `SessionBootstrapGrant`, `ros-session attach` — is the implementation.
2. **Embedded browser TUI (ADR-041–046, "pi-native").** The bridge owns a PTY
   and streams it to a browser panel over SSE. The env seam (projection,
   credential, skills) is terminal-agnostic and shared by both tracks, but the
   TUI *host* services are separate and were deliberately deferred.

Everything downstream — env delivery, session model, Pi attach — is shaped by
this choice.

---

## Decision

**External-first. The embedded browser TUI is a deferred peer surface, not a
prerequisite.**

- Step 4 (`launchBootstrap` env wiring) is scoped to the external terminal
  path only.
- Step 5 (TH-6, Pi attach) is likewise external-first.
- The embedded TUI is recorded below as a later track and is **out of scope**
  for the current Step 4 / Step 5 work.

## Rationale

1. **It is the story the operator has been describing** — "start iTerm2, then
   ROS connects, Pi uses ROS-granted credentials/memory/skills" — i.e. the
   ADR-040 "Open in Terminal" flow.
2. **Shortest distance to a real end-to-end test.** iTerm2 + Ghostty adapters
   are already built and green (Phases 1/1.5/2); the Linux/VIGIL kitty/WezTerm
   prompt already exists. Step 4 is a scoped wiring change, not a greenfield
   build.
3. **Choosing external does not foreclose embedded.** The ADR-041–046 seam is
   terminal-agnostic by construction; nothing in Step 3/4 is redone to add the
   embedded surface later.

---

## Embedded browser TUI — deferred track (for later)

When picked up, the embedded track will need:

- `browser-first/host/pi-native-session-service.mjs` — parallel session model
  (reconciliation point 4: fold into `RosTerminalSession` as the single
  authority).
- `browser-first/host/pi-native-tui-host-service.mjs` — bridge-owned PTY.
- `browser-first/host/pi-process-launcher.mjs` — process launch for the PTY.
- `browser-first/host/grok-native-*.mjs`,
  `browser-first/host/opencode-session-host-service.mjs` — deferred harness
  hosts.
- Raw-ANSI-over-SSE transport, and reconciliation point 5 (bring raw ANSI into
  the structured `terminal.*` event world as observation fidelity).

These files remain uncarried on `r-and-d/terminal-host-current-dev` by design.

---

## Consequence for Step 4

`launchBootstrap` delivers the projected env **into the adopted external
terminal** by composing a `ros-session attach` invocation (token via 0600
file, `eval` of the returned exports) — see
`prompts/TERMINAL-HOST-STEP4-EXTERNAL-ENV-WIRING-PROMPT.md`.
