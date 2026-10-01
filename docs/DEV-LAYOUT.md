# Local Development Layout

Where the ResonantOS checkouts live on this machine and how to know which
extension folder is current. Updated 2026-10-01 after the worktree prune.

## Repo topology

One repo, one main checkout, one active worktree:

| Path | Kind | Branch | Purpose |
|---|---|---|---|
| `~/Developer/Projects/resonant-os/2.0.0-alpha` | main checkout | `r-and-d/sdk-demo-003-current-dev` | Daily driver; canonical branch history |
| `~/Developer/Projects/resonant-os/pi-phase2` | worktree | `feature/pi-testing-phase` | Active testing-phase work |

The container dir `~/Developer/Projects/resonant-os/` is NOT a repo — it just
holds the checkouts above plus:

- `ROS-AL_bootstrap/` — separate project repo (charter docs), unrelated.
- `fork-cleanup/` — scratch backups; `prune-snapshots-2026-10-01/` holds the
  patches/untracked files preserved when the dead worktrees were removed.
- `resonant-symbol/`, `planning-pdf/`, `chatgpt-chat-sessions/`,
  `discord-chat-docs/` — non-repo scratch.

Removed 2026-10-01 (branches and stashes all preserved in git; uncommitted
content snapshotted under `fork-cleanup/prune-snapshots-2026-10-01/`):
`grok-alpha-test`, `resonant-os-329`, `resonant-os-331`, `pi-native-p2`
(worktrees) and `2.0.0-alpha.worktrees` (stub clone).

## The extension-load rule

Every checkout carries its own copy of
`browser-first/resonantos-side-panel-extension` (identical extension ID,
different branch state). Each copy has its own generated
`src/bridge-config.generated.js`, which the bridge rewrites **on boot and only
for its own worktree**.

> **Chrome loads the extension from the worktree whose bridge is running.**

If you load a worktree whose bridge is not running (or has restarted since its
config was written), Settings → Providers reports the bridge as unreachable —
the baked config still points at a dead port/token pair. This is exactly the
2026-10-01 55268 incident.

Boot order that always works:

1. Start the bridge for the worktree you want (e.g. the testing bridge for
   `pi-phase2` — `/tmp/pi-testing-bridge-launch.sh`).
2. The bridge rewrites that worktree's `bridge-config.generated.js` at boot.
3. Load/reload that worktree's extension folder in
   `chrome://extensions`.

`scripts/dev-extension-current.sh` prints the exact folder to load for each
running bridge.

## Hygiene

- `bridge-config.generated.js` is a git-ignored secret file (0o600); never
  commit it, never print its token values.
- Prune a worktree with `git worktree remove` — branches and stashes survive;
  only untracked files are lost (snapshot them first, as done above).
