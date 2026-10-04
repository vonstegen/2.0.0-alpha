# Terminal Host — Step 2: Session Manager + `ros-session attach` — OMP Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before acting.**

Step 1 (carry-over, ADR-041–046) is complete and green. This is the first
**build** step (not carry-over): the ROS session manager (the 5 ROS verbs from
the F2 split) and the `ros-session attach` bootstrap that turns a
`SessionBootstrapGrant` into a projected session environment.

---

## 0. Authority (read first)

- `docs/architecture/TERMINAL-HOST-OPERATION-SPLIT.md` — the 5 ROS verbs (law).
- `docs/architecture/ADR-040-terminal-host-adapter-contract.md` — `SessionBootstrapGrant`
  (single-use, audience-bound), "Authorization model", "No secrets in launch commands".
- `examples/sdk-demo/terminal-host/in-memory-host.ts` — the state machine to **port**
  (`TERMINAL_SESSION_TRANSITIONS`, `RosTerminalSession` shape, transition rules).
- `docs/architecture/ADR-042`…`ADR-044` (carried) — the projection/env seam.
- `browser-first/host/harness-session-environment.mjs` — `buildSessionEnvironment`.

---

## 1. Hard rules

1. **F2 split is law.** The 5 verbs are ROS-side; never put them on a terminal adapter.
2. **No secrets in argv/env/logs.** The projected env is the only credential path.
3. **The grant is single-use.** Consume it once, then reject any replay.
4. **No terminal IO in the session manager.** It owns `RosTerminalSession` records only.
5. **No regression.** Core 735/735, demo 103/103, browser-first stays green.

---

## 2. Phase A — ROS session manager (5 verbs) · gate CP-S2A

New file `browser-first/host/terminal-host-session-manager.mjs` (ROS-side).

1. Port the state machine from `in-memory-host.ts` (`TERMINAL_SESSION_TRANSITIONS`,
   `initialStateForEntryMode`, `assertValidSessionTransition`) and the
   `RosTerminalSession` record shape.
2. Implement, with the same transition rules:
   - `createSession({ id, entryMode, provenanceFidelity })` → state `created`/`adopted`
   - `adoptSession({ id, hostSessionId })` → record an existing terminal session as
     owned (`entryMode: adopt`, state `adopted`)
   - `attachSession(id, { harness, project, providerProfileId })` → bind harness
     (state `attached`, set `attachedAt`)
   - `detachSession(id, reason)` → unbind (state `detached`, set `detachedReason`)
   - `listSessions()` → enumerate ROS sessions
   - `getSessionState(id)` → read one session
   - `terminateSession(id)` → state `terminated`, set `terminatedAt`
3. Add a `onTerminalTelemetry(event)` hook (or accept a subscription) so a
   `terminal.session.terminated` event marks the matching ROS session `terminated`.

**CP-S2A gate:** a new `browser-first/test/terminal-host-session-manager.test.mjs`
exercises adopt→attach→detach→list→state + telemetry-driven termination; the
in-memory fixture/contract tests remain unchanged (they may re-export or wrap this
manager, but must not break).

`STOP AND REPORT` here.

---

## 3. Phase B — grant tracking + `ros-session attach` · gate CP-S2B

### 3a. Track minted grants

Extend the bridge (`browser-first/host/terminal-host-service.mjs`) so every
`mintSessionBootstrapGrant` result is recorded: `sessionId → { token, purpose,
issuedAt, expiresAt, consumed: false }`. Add a `consumeGrant({ sessionId, token })`
that returns the grant only if it is known, unexpired, unconsumed, and
`token` matches `sessionId` (audience-bound); otherwise reject; and mark it
`consumed` on success (single-use).

### 3b. Broker endpoint

Add `POST /terminal-host/session/attach` (mirror the `POST /addons/grants`
precedent in `harness-host-service.mjs`). It:

1. Reads `{ sessionId, token }`.
2. Calls `consumeGrant` — reject on unknown/expired/replayed/wrong-session.
3. Returns the **projected session env**, built from `buildSessionEnvironment`
   + the resource/skills projection (ADR-043/044) + the credential adapter for the
   session's bound `providerProfileId`. Never returns a raw secret; return the env
   object (names + values) only to the requesting shell.

### 3c. `ros-session` CLI

Provide a thin `ros-session` entry (a small `.mjs` or shell script) that the
bootstrap command can invoke: it POSTs the grant to `/terminal-host/session/attach`
and exports the returned env into the current shell (`export NAME=value`), without
ever printing the secret value to stdout or logs.

**CP-S2B gate:** a test proves (a) a valid grant returns a projected env,
(b) a replayed / expired / wrong-session / unknown grant is rejected, (c) no secret
appears in argv or logs.

`STOP AND REPORT` here.

---

## 4. Commands

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npx tsc --noEmit
npx vitest run                                                  # core (735)
npx vitest run --config examples/sdk-demo/vitest.config.ts       # demo (103)
node --experimental-strip-types --test \
  browser-first/test/terminal-host-session-manager.test.mjs
```

---

## 5. Verification discipline + STOP AND REPORT

Never trust a green number you did not produce yourself. Re-run; paste summary +
last ~20 lines. Commit per phase (`feat(terminal-host):` / `test(terminal-host):`).
Never push to `dev`/`main`/`upstream`. Report test counts named by label.

After CP-S2B clears, **steps 2 + 3 are done** — report that, then pause: step 4
(`launchBootstrap` env wiring) is gated on the still-unmade external-vs-embedded
decision, so it is out of scope here.
