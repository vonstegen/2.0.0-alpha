# Terminal Host — XH5: "Open in Terminal" Launch Action — OMP Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before acting.**

XH4 surfaces terminals as a tabbed "Terminal" entry under Add-on Surfaces
with a live connection badge. The entry is gated by install + enable + the
`terminal-host` capability grant + a live bridge projection. The next
user-facing piece is the launch affordance: an operator selects a harness
agent (Pi, then later OpenCode / Codex / Hermes) and chooses
**"Open in Terminal"**, and ResonantOS opens the right terminal-host with
the real harness binary running and the project/skill/memory envelope
projected. This prompt builds that affordance and the bridge-bootstrap
behind it.

---

## 0. Recorded decisions + invariants

Decision: the launch action is a **single, host-driven action** that fires
when the operator selects "Open in Terminal" from a harness agent. It is
not a chat command and not a settings toggle. The action is responsible
for: (a) guaranteeing the bridge is up, (b) guaranteeing the requested
harness agent + the terminal-host add-on are installed + enabled +
authorized, and (c) dispatching the launch through the existing policy
path (`composeInvocation` → `launchBootstrap({ commandSuffix })`).

Invariants (non-negotiable):

1. The launch path uses the reviewed harness policy (`pi-v1`, etc.) via
   `composeInvocation` — never a hand-rolled `pi`/`opencode`/`codex` shell
   command, never an ambient-PATH lookup, never an inline prompt.
2. The prompt is delivered via a **0600 prompt file** at a validated
   absolute path; the prompt content never appears in argv, env, logs,
   or bus events.
3. The terminal-host service status route (`GET /terminal-host/status`)
   stays non-secret; the new launch route must too (shape-walker enforced).
4. The bridge-bootstrap path is **fail-closed**: missing host binary,
   refused grant, missing capability, or missing bridge process = a typed
   error surfaced to the operator, never a half-launched terminal.
5. The launch action is observable: `terminal.session.started` and
   `terminal.command.started` fire; the long-lived harness process keeps
   running; the badge in the Terminal dock entry transitions
   `Not installed → Disconnected → Connected`.
6. No token, credential, path (other than the public `pi` executable path
   and the validated prompt-file path which are public by construction),
   or env value may appear in any surface, status, or launch payload.
7. No merge of `feature/pi-testing-phase`; no push to `dev`/`main`/`upstream`;
   do not push until AVIS audits.

---

## 1. Authority — read first

- `src/modules/terminal/TerminalDockEntry.tsx` — current tab strip + connection badge
  (from XH4d commit `6b903292`).
- `src/modules/terminal/useTerminalHostStatus.ts` — 5s poll of
  `GET /terminal-host/status`; live badge source.
- `src/core/web-transport.ts` — `terminal_host_status` route (loopback,
  `addon-runtime-control` cap).
- `browser-first/host/terminal-host-service.mjs` —
  `createTerminalHostService`, `launchBootstrap`, `buildProjectedSessionEnv`,
  synchronous snapshot `{ alive, driveId, adapterId, sessions }`.
- `browser-first/host/harness-host-service.mjs` — `GET /terminal-host/status`
  (XH4c). Will gain `POST /terminal-host/launch` in this prompt.
- `browser-first/host/agent-adapters/external-cli-terminal.mjs` —
  `invoke()` → policy → `launchBootstrap`.
- `browser-first/host/harness-policies/pi.mjs` — `composeInvocation`
  produces `pi <exec> @<file>` / `pi <exec> '<quoted>'`.
- `packages/addon-sdk/src/surface-routing.ts` —
  `createAddOnSurfaceDockRoutes` + `groupSurfaceDockRoutesBySection` gate.
- `public/addons/terminal-host-{ghostty,iterm2}.json` — terminal-host
  manifests with `grantPresets[].id:"ghostty-terminal-host"` /
  `"iterm2-terminal-host"` for the `terminal-host` capability.
- `src/App.tsx` — loadState hook, harnessProjection, dock + nav-items
  wiring (XH4d).

---

## 2. Hard rules

1. Do NOT hand-roll a `pi`/`opencode`/`codex`/`hermes` command anywhere.
   Always go through the harness policy's `composeInvocation`.
2. Do NOT pass the prompt content inline. Always write it to a 0600 file
   at a validated absolute path and reference the path.
3. Do NOT relax the `addon-runtime-control` capability check on the new
   launch route. Loopback + cap = required.
4. Do NOT include tokens / credentials / env values in the launch route
   response or the new bridge-bootstrap telemetry.
5. Do NOT regress any XH4 gate. The new launch route must coexist with
   `GET /terminal-host/status`.

---

## 3. Phase XH5a — launch route + bridge bootstrap · gate CP-XH5a

1. Add `POST /terminal-host/launch` to `harness-host-service.mjs`:
   - **Loopback-only** transport (mirror `terminal-host/status`).
   - Requires `addon-runtime-control` capability (401/403 on missing).
   - Request body shape:
     `{ agentId: "pi" | "opencode" | "codex" | "hermes",
       terminalAddonId: "addon.resonant-terminal-ghostty" |
                        "addon.resonant-terminal-iterm2",
       promptPath: string /* absolute, 0600, exists */,
       options?: { memoryAccess?, env?, commandSuffix? } }`.
   - Behavior:
     a. Validate `promptPath` is absolute, file exists, mode is `0o600`
        (reject otherwise with a typed error — never read content).
     b. Resolve the harness executable via `piCommand()` (or the matching
        policy resolver for the other agents).
     c. Call `composeInvocation({ executable, promptPath })` from the
        agent's policy module.
     d. Call `launchBootstrap({ commandSuffix: invocation, …options })`
        so the projected env (memory/skills/project/credential) is wired.
     e. Persist a record of the launch in the terminal-host service
        sessions (so `/terminal-host/status` reflects it).
     f. Return a non-secret receipt `{ launchId, agentId, terminalAddonId,
        executablePath, promptPath, startedAt }`.

2. Add a **bridge-bootstrap action** (new module
   `browser-first/host/bridge-bootstrap.mjs` exporting
   `ensureBridgeReachable({ endpoint, timeoutMs })`) that:
   - probes the bridge loopback endpoint with a fast TCP connect + a
     lightweight HTTP `GET /healthz` (returns `{ ok: true, version }` if
     reachable);
   - on `ECONNREFUSED` or timeout, returns a typed
     `{ ok: false, reason: "bridge-not-running", endpoint }`;
   - never auto-starts the bridge process (that's a future "Launch
     Bridge" prompt; out of scope here). Instead, the launch route
     surfaces the typed error so the UI can show "Bridge not running —
     open Settings → Bridge Target to start it."
   - this module is **shared** by the launch route and any other future
     bridge-aware route; do NOT inline the probe.

3. The launch route refuses to run if the terminal-host service is not
   alive (`!alive`) or if the requested `terminalAddonId` has no
   `terminal-host` grant currently granted. Both return typed errors.

**CP-XH5a gate:** route enforces loopback + capability (401/403 on
missing); a stopped bridge returns the typed `bridge-not-running` error
without crashing; a healthy bridge with the grant granted accepts the
launch and returns the receipt; the receipt contains no token /
credential / memory content.

`STOP AND REPORT` here.

---

## 4. Phase XH5b — UI affordance "Open in Terminal" · gate CP-XH5b

1. Add a **single-launch action** to the harness agent entry UI:
   - On the `Pi` agent card (and later generalized), add an
     "Open in Terminal" button. The button is visible only when the
     terminal-host service is reachable (`alive === true`).
   - The click handler:
     a. Resolves the user's preferred terminal (Ghostty if installed +
        authorized, else iTerm2, else hidden).
     b. Composes the launch request: picks the matching
        `terminalAddonId`, picks the 0600 prompt file path the operator
        already wrote (this prompt does NOT add prompt-authoring; that's
        the existing harness flow). If no prompt file exists, the button
        is disabled with the tooltip "Write a prompt first."
     c. POSTs to `/terminal-host/launch` and reads the receipt.
     d. On `bridge-not-running`, surfaces a settings-deep-link to
        **Settings → Bridge Target**.
     e. On `capability-not-granted`, surfaces an "Authorize Terminal Host"
        action that grants the `terminal-host` capability via the
        existing grant-broker flow + retries the launch.
     f. On success, focuses the Terminal dock entry (sets `currentSection`
        to `"terminal"` and selects the launched tab).

2. The button is **host-driven** (textContent only). No HTML/script
   injection. The receipt is rendered through `textContent` and only the
   documented fields are displayed (launchId, executablePath, promptPath,
   startedAt).

3. The "Open in Terminal" affordance MUST co-exist with the existing
   "Chat", "Pin to dock", and other harness actions; it does not replace
   them.

**CP-XH5b gate:** the button is present in the Pi agent entry; clicking it
with a healthy bridge and a 0600 prompt file launches Pi in the chosen
terminal, the receipt appears in a non-secret toast, and the Terminal
dock entry's badge transitions from `Not installed` (if the add-on was
not yet authorized) → `Disconnected` → `Connected` as the projection and
status update.

`STOP AND REPORT` here.

---

## 5. Phase XH5c — capability grant + retry UX · gate CP-XH5c

1. Add a typed `capability-not-granted` error from the launch route
   when the add-on exists but `terminal-host` is not in the granted set.
2. In the UI, an "Authorize Terminal Host" action:
   - opens the add-on's `grantPresets[0].grants` (already in the
     manifest: `{ capability: "terminal-host", granted: true, scope: "system",
     revocationBehavior: "degrade" }`);
   - calls the existing grant-broker endpoint to apply the grant;
   - retries the launch automatically on success (no second click).
3. The grant flow MUST NOT regress the F1 grant-ownership fix or the
   XH3 compatibility fail-closed behavior.

**CP-XH5c gate:** with the add-on installed but the grant not yet
granted, the operator clicks "Authorize Terminal Host" → the grant is
applied → the launch retries automatically → the badge transitions to
`Connected`.

`STOP AND REPORT` here.

---

## 6. Phase XH5d — telemetry + observability · gate CP-XH5d

1. `terminal-host-service.mjs` emits structured events on launch:
   - `terminal.session.started` (already exists; verify it fires on this
     path)
   - `terminal.command.started` (already exists; verify it fires)
   - new: `terminal.launch.receipt` carrying only `{ launchId, agentId,
     terminalAddonId, executablePath, promptPath, startedAt }`. No
     secrets, no memory content, no env values.
3. Tests:
   - launch route returns receipt with the documented shape, refuses
     without loopback + cap (401/403), refuses without grant
     (`capability-not-granted`), refuses with non-0600 prompt file,
     refuses with non-absolute prompt path, succeeds end-to-end with
     stubs.
   - bridge-bootstrap returns typed `bridge-not-running` on a closed port
     and `{ ok: true, version }` on a healthy port.
   - UI test: button is disabled without a 0600 prompt file; clicking
     with a valid file POSTs to `/terminal-host/launch` and surfaces the
     receipt.

**CP-XH5d gate:** all events fire, all negative paths return typed
errors, shape-walker asserts the receipt/event payload contains no
secret-shaped value.

`STOP AND REPORT` here.

---

## 7. Commands

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npx tsc --noEmit
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts
node --experimental-strip-types --test \
  browser-first/test/external-cli-harness-xh1-xh2.test.mjs \
  browser-first/test/pi-terminal-adapter.test.mjs \
  browser-first/test/pi-terminal-grant-chain.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/terminal-host-grant-broker.test.mjs \
  browser-first/test/ros-session.test.mjs \
  browser-first/test/terminal-host-session-manager.test.mjs \
  browser-first/test/harness-host-service.test.mjs \
  browser-first/test/terminal-host-status.test.mjs \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs
```

Plus a stub Ghostty smoke with `RESONANT_TERMINAL_DRIVER=in-memory` that
walks the full launch-route path end-to-end and asserts:
- receipt shape (no secrets)
- bridge-not-running typed error on a closed endpoint
- capability-not-granted typed error without a grant
- success path with stub bridge + stub adapter

Report counts labeled core / demo / browser-first + smoke result.

---

## 8. Verification discipline + STOP AND REPORT

Re-run every gate yourself; report counts by label. Never trust a green
number you did not produce.

---

## 9. Out of scope (do not build here)

- Linux WezTerm / kitty adapters (later).
- OpenCode / Codex / Hermes agent entry buttons (later — generalize
  after Pi is solid).
- Auto-starting the bridge process from the UI (later prompt: separate
  "Launch Bridge" affordance).
- Prompt authoring / file picker (existing harness flow already handles
  this).

Suggested commits:

1. `feat(terminal-host): add /terminal-host/launch route + bridge-bootstrap`
2. `feat(terminal-host): add 'Open in Terminal' action on the Pi agent entry`
3. `feat(terminal-host): authorize terminal host capability + auto-retry`
4. `test(terminal-host): cover launch route, bootstrap, and UI affordance`
5. `docs(terminal-host): capture XH5 open-in-terminal prompt` (include
   this prompt).

Report explicitly when XH5 is complete, then pause for the
"Launch Bridge" prompt (auto-starting the bridge from the UI).