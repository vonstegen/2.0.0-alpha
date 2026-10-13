# Terminal Add-ons & TUI Harnesses — Handoff (2026-10-13)

For: Tom
Repo: https://github.com/vonstegen/2.0.0-alpha (branch `r-and-d/terminal-host-current-dev`)

## What this is

The ResonantOS side-panel extension can now launch and manage **real terminal
applications** (Ghostty, iTerm2) running **TUI agent harnesses** (Pi; the
layer is harness-generic) with ResonantOS-provided resources: provider
credentials, prompts, and a bridge-attached session. The terminal is pure
transport — ROS supplies the grant, the credential, and the session; the
harness runs as an external CLI, never as a bridge-spawned PTY.

## Architecture in one paragraph

The loopback bridge (`browser-first/host/run-bridge-minimal.mjs`, port 47773)
runs the terminal-host service, which manages one adapter per terminal
add-on (`examples/sdk-demo/terminal-host/{ghostty,iterm2}`). The extension
talks to the bridge over capability-token-guarded HTTP. When the operator
launches, the bridge mints a **one-time session grant** (0600 token file) and
an **auth file** (0600) carrying the selected provider credential, then hands
the terminal a bootstrap command that runs `ros-session attach`. That CLI
consumes the grant, applies the session env (including the credential under
its host-owned env var, e.g. `MINIMAX_API_KEY`), and execs the Pi TUI
attached to the bridge session. Window title flips to `ROS: connected`.

## The two launch paths

| Path | How | When |
|---|---|---|
| **Open in Terminal** | Extension POSTs `/terminal-host/launch`; the adapter opens the terminal app via AppleScript and pastes the bootstrap | Card shows Connected; one click |
| **Copy connection script** | Extension POSTs `/terminal-host/connection-script`; the minted command lands on the clipboard | Manual: paste into any terminal session |

Both mint the same artifact:

```bash
eval "$(node '…/bin/ros-session.mjs' attach \
  --session-id '<id>' \
  --token-file '/var/folders/…/<id>.token' \
  --provider-profile-id 'shared-minimax' \
  --auth-file '/var/folders/…/<id>.auth.json')"; printf '\033]2;ROS: connected\007'
```

Single-use: the grant is consumed on attach. A failed paste or closed window
means mint a fresh one.

## Security model (invariants enforced by tests)

- Grants are operator-consented, one-time, short-lived; never auto-granted.
- Secrets never enter argv, the clipboard, the DOM, logs, or durable state —
  only 0600 file *paths* do. (`scripts/security-pipeline/checks/*no-argv-secret*`)
- Capability tokens scope every `/terminal-host/*` route; the bootstrap token
  never appears in URLs or events.
- Extension seam contract: the host envelope's `ok` is stripped by `unwrap()`;
  handlers key success on payload fields (`command`, `launchId`, `reason`).

## Run it

```bash
cd 2.0.0-alpha
node browser-first/host/run-bridge-minimal.mjs --bridge-port=47773
```

1. Chrome → `chrome://extensions` → Developer mode → Load unpacked →
   `browser-first/resonantos-side-panel-extension`
2. Open the side panel → **Terminals** rail.
3. Per card: **Enable** → **Grant** (browser confirm) → either
   **Open in Terminal** (auto) or **Copy connection script** (paste).
4. Expect: terminal opens, title `ROS: connected`, Pi TUI live with the
   selected provider profile.

Prereqs: Ghostty ≥ 1.3.1; iTerm2 with the Python API enabled
(Preferences → General → Magic); Chrome; Node 22+.

## Verification evidence (as of this push)

- 288/288 tests green across 15 suites (`node --experimental-strip-types
  --test browser-first/test/<suite>`), incl. click-through regression for the
  Copy path (CP-BR11 #7) and the faithful-envelope Launch test (#5).
- Live end-to-end: sessions launched in both Ghostty and iTerm2 replied via
  the MiniMax provider (credential confirmed present in-harness; never
  printed).

## Known follow-ups

- iTerm2's adapter **exits when the app is absent** at attach time (Ghostty
  idles). Recovery today: toggle the add-on or restart the bridge. Planned:
  idle-with-connect-backoff in `adapter.py`.
- The extension loads code at install/reload — after pulling new commits,
  reload at `chrome://extensions`.
- Session grant is single-use; a re-paste of the same script will fail
  closed by design.

## Deeper docs in this repo

- `TERMINAL-HARNESS-LAUNCH-STATUS.md` — running engineering log (fixes, decisions, evidence)
- `TERMINAL-TESTING-GUIDE.md`, `MANUAL-TESTING-WALKTHROUGH.md`, `QUICK-REFERENCE.md` — test matrix + troubleshooting
- `prompts/` — the build prompts (CP-BR7…CP-BR11, XH1–XH5) this work was executed from
- `browser-first/host/harness-examples/*.json` — harness manifests (pi-terminal etc.)
