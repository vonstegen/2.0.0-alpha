# Pi Testing-Phase Report (2026-10-01)

Branch: `feature/pi-testing-phase` (worktree `pi-phase2`).
Goal: prove the full add-on chain end to end against real providers —
**credential → provider profile → grant → session-scoped credential → real
`pi` process → real provider model → real response**, plus an interactive
authentic Pi TUI session in the ROS extension, with the credential delivered
session-only and a revocation check.

**Phase status: complete.** Both providers (OpenRouter + MiniMax) run real
inference through the add-on; the interactive TUI session works through the
extension panel; the revocation check passes for both the headless proof and
the TUI session routes.

## Acceptance criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Credential entered ONLY via ROS extension Settings; never in argv, manifest, git, logs, evidence, projections, or pi `auth.json` | ✅ | Findings §Proven 3, §Hygiene; redaction in launcher + session service |
| 2 | Session-scoped credential delivery (env-only) | ✅ | `OPENROUTER_API_KEY` / `MINIMAX_API_KEY` in child env only; `PI_CODING_AGENT_DIR` isolation makes env the sole key source (commit `a24f5c62`) |
| 3 | Real `pi` binary spawned (no mocks) | ✅ | pi v0.74.2 headless proof + PTY TUI sessions, real pids, isolated session dirs |
| 4 | Real provider model reached | ✅ | Canary: OpenRouter `401 User not found.`, MiniMax `401 authentication_error` (header attached, key parsed). **Real inference confirmed by operator with both providers** (user keys saved via Settings) |
| 5 | Grant-gated authorize; revocation fails closed | ✅ | Headless proof 403 granted-less and after `agent-runtime` revocation. TUI session create: `403 permission-denied` while revoked, restore clean (registry revision 5→6→7, this session) |
| 6 | Authentic Pi TUI in the extension | ✅ | Real PTY (node-pty, direct exec, no shell) + xterm.js panel; 21 ANSI frames streamed, input/resize/cancel/dispose all live (commit `e855f1d6`) |
| 7 | Second provider binding (MiniMax) alongside OpenRouter | ✅ | `pi.native` + `pi.native.minimax` bindings; gate relaxed to (addonId, adapterId, authScheme, approved providerProfileId) |
| 8 | User's normal registry / auth.json / OMP / VIGIL untouched | ✅ | Testing registry at `/tmp/pi-testing-user-root`; `~/.pi/agent/auth.json` unchanged (size 557, sha256 `ac488b73…f73ac0`) |

## Architecture (as proven)

```
ROS extension Settings ──POST /providers/accounts──▶ bridge session credential store (memory-only)
        │                                                        │
Add-on Surfaces ▶ Pi panel                              resolveProviderProfileCredential
        │                                                        │ env-only
POST /pi-native/tui-session ─▶ piNativeAuthorize (grant gate)
                             ─▶ issuePiProjection ─▶ pi-native-session-service
                             ─▶ pi-process-launcher.launchInteractive
                             ─▶ node-pty spawn: pi v0.74.2
                                 TERM=xterm-256color
                                 PI_CODING_AGENT_DIR=<user-root>/pi-coding-agent-isolated
                                 --session-dir <isolated>/sessions   (host-computed)
        │                                                        │
GET /pi-native/tui-session/events ◀── SSE: pi.tui.data / pi.tui.exit / harness.close
POST /pi-native/tui-session/{input,resize,cancel,dispose}
```

Two operator-approved bindings share the same addon:
`pi.native` → `openai-compatible-ros-openrouter-test-api` (OpenRouter),
`pi.native.minimax` → `shared-minimax` (MiniMax-M3). Binding names stay
unique per `createHarnessCredentials`; the authorize gate no longer keys on
the binding name.

## Phase commits (feature branch, oldest→newest)

- `914ff570` Phase 2B cwd projection + read/write grant authority
- `a12d7872` Phase 2B.1 operation-revocation fencing
- `2ac7fc8b` Phase 2C generic Harness Skills projection
- `9597cd4a` Phase 2C.1 host-owned staging/layout
- `0f4917fb` Phase 2C.2 skills staging audit corrections
- `e8074499` Phase 2C.3 unambiguous staging identity encoding
- `c1961d95` reconcile P2 launcher + session service onto 2C.3 planner
- `85f755c5` pi-native-v1 adapter, clean authorize gate, session-spin UI
- `927396f1` live runbook + verification findings
- `a24f5c62` pi agent-dir isolation (auth.json precedence countermeasure)
- `9b861be1` extension reload step + generated-config alignment
- `72b37076` local dev layout map + dev-extension-current helper
- `347d8186` Pi moved into left Tools rail
- `f9bfff16` Add-on Surfaces merged into left sidebar
- `e855f1d6` interactive TUI session over real PTY + MiniMax second binding

## Bugs found and fixed this phase

1. **auth.json precedence** (critical): pi prefers durable
   `~/.pi/agent/auth.json` over env credentials. Countermeasure:
   `PI_CODING_AGENT_DIR` isolation — env becomes the sole key source.
2. **False "Missing Authentication header" finding**: OpenRouter reports
   malformed keys as missing; the Bearer was attached all along. Corrected.
3. **`startSession` wrong launch function**: called the injected parameter
   instead of the resolved launcher → opaque 503 on every session.
4. **`createRequire` under ESM**: node-pty load fixed with top-level
   `createRequire(import.meta.url)`.
5. **SSE never ended on normal completion**: TUI subscription `close()` now
   always terminates the transport; exit evidence rides the `pi.tui.exit`
   frame, `harness.close` is transport bookkeeping.
6. **Single-binding gate**: authorize required an exact binding-name match,
   making a second provider structurally impossible; gate now authorizes on
   the tuple (addonId, adapterId, authScheme, approved profile).
7. **Stale generated config** (today): pi-phase2's
   `bridge-config.generated.js` held a dead port (60216) from a crashed
   bridge instance; the extension loaded it, every bridge call failed
   silently (`rebindBridge` swallows errors), and the Add-on Surfaces rail
   rendered "No authorized tool-panel surfaces." Fixed by restarting the
   bridge (it rewrites its own worktree's config). Diagnostic rule: empty
   rail → check the generated config's `bridgeUrl` against the running
   bridge first.

## Operational invariants (carry forward)

- **Bridge restarts wipe provider credentials** (session-only store). After
  every restart, re-save the OpenRouter and MiniMax keys via Settings.
- **Load the extension from the worktree whose bridge is running**
  (`scripts/dev-extension-current.sh` prints the folder). Both worktrees
  share one extension ID.
- **Restart the bridge after touching its sources** — a pre-edit process
  serves stale behavior.
- No `--api-key` anywhere; no shell (`shell:false`; PTY is a direct exec);
  no credential in argv, projections, logs, evidence, or durable state.

## Verification state at close

- Full battery: 0 failures (route-audit + scope-audit suites updated for the
  TUI routes and the intentional xterm vendor reintroduction).
- Revocation: headless proof and TUI session both fail closed; restore clean.
- Hygiene: no lingering pi processes; isolated agent-dir auth.json is `{}`;
  user auth.json untouched.
- Live inference: operator-confirmed with both OpenRouter and MiniMax keys
  saved through the ROS extension Settings surface.

## Remaining work (out of phase scope)

- Promote the testing bridge configuration into the normal registry flow
  (currently the testing registry is isolated at `/tmp/pi-testing-user-root`).
- Session persistence UX (resume a prior TUI session after reload).
- The `provider-model-invoke` proof route's body validation is stricter than
  the TUI route's (`invalid-event` on the minimal body used in the
  revocation check); harmonize if the proof route becomes user-facing.
