# Terminal Host Operation Split — Reconciliation Note (F2)

- Status: **Decision** (candidate amendment to ADR-040; folds into the contract,
  not a new ADR)
- Source of truth: `src/core/terminal-host-contract.ts`,
  `docs/architecture/ADR-040-terminal-host-adapter-contract.md`,
  `examples/sdk-demo/terminal-host/iterm2/adapter.py`
- Resolves finding: **F2** — "5 of 9 contract operations don't map to iTerm2"

## Problem

`TerminalHostOperation` (terminal-host-contract.ts:44-53) lists **nine** verbs:

```
createSession   adoptSession   attachSession   detachSession   terminateSession
listSessions    getSessionState sendInput       launchBootstrap
```

Two of the three implementations ship a **different subset**, so the drivers are
not actually substitutable:

| Implementation            | `supportedOperations` declares                                   | Missing vs. the union |
| ------------------------- | ---------------------------------------------------------------- | --------------------- |
| iTerm2 adapter (`adapter.py`) | `launchBootstrap`, `createSession`, `sendInput`, `terminateSession` | `adoptSession`, `attachSession`, `detachSession`, `listSessions`, `getSessionState` |
| In-memory host (`in-memory-host.ts`) | `createSession`, `adoptSession`, `attachSession`, `detachSession`, `terminateSession`, `listSessions`, `getSessionState` | `sendInput`, `launchBootstrap` |

Neither is a superset. The iTerm2 Python API has no `adopt`/`attach`/`detach`
calls — those verbs are **ROS session-model transitions**, not terminal-API
calls. The in-memory host implements them because it *is* the session model for
tests. Conflating the two layers makes the Phase 2 replaceability test a
tautology and guarantees Ghostty (TH-6) inherits the same mismatch.

## Decision

**Split the nine verbs into two interfaces.** Keep all nine verbs in the
vocabulary; reclassify which layer owns each one.

### 1. `TerminalHostOperation` — the adapter surface (4 verbs)

What a *terminal* actually does. Every host (iTerm2, Ghostty, WezTerm, kitty)
implements exactly these four; nothing else is required of a terminal adapter:

```
createSession    — open a tab/window with no bootstrap command
launchBootstrap  — open a tab + run the bootstrap command (Pi → Open in Terminal)
sendInput        — write text to a session
terminateSession — close the session
```

`TerminalHostAdapterContract.supportedOperations` may only ever list these four.
This is the **only** surface a Ghostty adapter must satisfy (TH-6).

### 2. `RosSessionOperation` — the ROS session-manager surface (5 verbs)

What *ROS* does to its own `RosTerminalSession` model, independent of which
terminal is attached. These are implemented by a ROS session manager (not yet
built), never by a terminal adapter:

```
adoptSession    — record an existing host session as ROS-owned (entryMode: adopt)
attachSession   — associate a harness add-on + project + provider with a session
detachSession   — disassociate the harness
listSessions    — enumerate ROS's session model
getSessionState — read ROS's session state (reconciled against terminal telemetry)
```

The lifecycle `created | adopted | attached | running | detached | terminated`
stays ROS-owned — exactly what makes the host replaceable: the terminal only
ever sees the four adapter verbs, and the state machine is identical regardless
of host.

## Why not the alternatives

- **Lower to 3 primitives (`spawn`/`sendInput`/`terminate`).** Loses the
  `createSession` vs. `launchBootstrap` distinction (bare tab vs. tab-that-runs-a-
  command), which is load-bearing for the `create` vs. `adopt` entry modes in
  ADR-040. Rejected.
- **Keep all 9 on the adapter.** Forces every terminal to reimplement ROS's
  session bookkeeping. iTerm2 can't; Ghostty won't. Rejected.

## Verb-by-verb mapping

| Verb               | Owner | Semantics                                                       | iTerm2 mechanism                        | Ghostty mechanism                |
| ------------------ | ----- | --------------------------------------------------------------- | --------------------------------------- | -------------------------------- |
| `createSession`    | Adapter | Open a bare tab; emit `terminal.session.started`             | `create_window`/`create_tab`             | native window/tab create        |
| `launchBootstrap`  | Adapter | Open a tab + run bootstrap; return `SessionBootstrapGrant`       | `create_window` + `async_send_text`      | native create + send            |
| `sendInput`        | Adapter | Write text; emit `terminal.command.started`/`ended`           | `async_send_text`                        | native send                     |
| `terminateSession` | Adapter | Close the session; emit `terminal.session.terminated`          | `async_close`                            | native close                    |
| `adoptSession`     | ROS     | Record an observed session as owned (`entryMode: adopt`)         | *no adapter call* — uses discovery below | same                             |
| `attachSession`    | ROS     | Bind harness + project + provider                                | *no adapter call*                        | same                             |
| `detachSession`    | ROS     | Unbind harness                                                   | *no adapter call*                        | same                             |
| `listSessions`     | ROS     | Enumerate ROS's model (not the host's live tabs)                 | *no adapter call*                        | same                             |
| `getSessionState`  | ROS     | Read ROS's model, reconciled by terminal telemetry               | *no adapter call*                        | same                             |

## Adopt-flow discovery (the one nuance)

`adoptSession` is ROS-side, but ROS must first **find** the operator-created
session it is adopting. Discovery uses the terminal's `list-sessions` *capability*
(a distinct axis — `TerminalHostAdapterCapability`, terminal-host-contract.ts:30)
plus the feedback channel (`event-stream`), **not** an `adopt` adapter operation.

Consequence: a host that cannot enumerate its own sessions (a Level-1 host such
as Apple Terminal) cannot support adopt, and simply **does not declare
`list-sessions`** — adoption degrades gracefully for that host. This matches the
existing Level-1/Level-3 capability comment (terminal-host-contract.ts:20-23).

## Impact

1. `src/core/terminal-host-contract.ts` — narrow `TerminalHostOperation` to the
   four adapter verbs; add `RosSessionOperation` (five verbs). Both unions may
   keep a shared `TerminalHostVerb` superset if a single list is convenient, but
   `supportedOperations` references only the adapter set.
2. `examples/sdk-demo/terminal-host/in-memory-host.ts` — `IN_MEMORY_ADAPTER.
   supportedOperations` drops `adoptSession`/`attachSession`/`detachSession`/
   `listSessions`/`getSessionState`. Those five remain on the host's *own* method
   surface (`attach`/`run`/`detach`/`get`/`list`) as the session-manager fixture
   it doubles as for tests — not as `supportedOperations`.
3. `examples/sdk-demo/tests/terminal-host-live.test.ts` — `iterm2Factory()`
   already lists exactly the four adapter verbs; no change. The replaceability
   assertion becomes: *both drivers expose the same four-verb adapter surface*.
4. Ghostty adapter (TH-6) — implements the same four verbs; zero work on the five
   ROS verbs.

## Follow-up tasks (code, gated before Ghostty)

- [ ] Split the union in `terminal-host-contract.ts` (add `RosSessionOperation`).
- [ ] Correct `in-memory-host.ts` `IN_MEMORY_ADAPTER.supportedOperations`.
- [ ] Add a guard test: any `TerminalHostAdapterContract.supportedOperations`
      value must be one of the four adapter verbs (fails the build for future
      hosts that re-conflate the layers).
- [ ] Fold this note's "Decision" into ADR-040 under a new
      `### Adapter operations vs. ROS session operations` subsection.
