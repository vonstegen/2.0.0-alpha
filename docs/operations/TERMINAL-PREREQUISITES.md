# Terminal Prerequisites (CP-BR7 / CP-BR9)

> Status: **CP-BR7 + CP-BR9 (Complete on `r-and-d/terminal-host-current-dev`)**.
> Companion to
> [`docs/product/TERMINAL-ACTIVATION.md`](../product/TERMINAL-ACTIVATION.md).

The two reviewed terminal add-ons are `addon.resonant-terminal-ghostty`
and `addon.resonant-terminal-iterm2`. Each is gated by the
`terminal-host` capability and ships with its own platform
prerequisites. CP-BR9 installs both add-ons into the host registry
automatically on every bridge boot (idempotent; see
[`terminal-addon-seed.mjs`](../../browser-first/host/terminal-addon-seed.mjs)),
so the operator does not need to install them by hand; the rows
appear in Bridge & Runtimes on the first bridge boot.

## Common prerequisites

- ResonantOS Alpha bridge running (see
  [`docs/architecture/BRIDGE-BOOTSTRAP-ROS-STARTUP.md`](../architecture/BRIDGE-BOOTSTRAP-ROS-STARTUP.md)).
- ResonantOS extension installed in the same Chrome profile.
- The operator has been granted the `terminal-host` capability for
  the chosen add-on.

**`RESONANT_TERMINAL_HOST_BRIDGE` is no longer a manual operator
flag.** The bridge composition always boots without the bridge-level
service in CP-BR9; the live terminal-host service comes from the
add-on that holds the singleton. Do not set this variable as a
workaround — it has no effect on the production path and the
lifecycle surface in Bridge & Runtimes is the only operator
control.

## Ghostty

- **Binary:** `ghostty` on the user's `PATH`. The factory pins
  `RESONANT_TERMINAL_DRIVER=ghostty`; the spawn policy looks up the
  binary from the host-pinned `PATH` (the factory does not spread
  `process.env`; it sets only the documented allowlist).
- **Permissions:** Ghostty must be able to read the operator's
  prompt file (0600) and write to the host's terminal-host
  bus socket.
- **AppleScript bridge:** Ghostty exposes its CLI through a
  fixed-root helper. The factory spawns the helper from the
  Ghostty install directory; the spawn policy never accepts a
  caller-supplied path.
- **No-confirm teardown:** Ghostty's `quit` is wired into
  `closeSessions`. The factory calls it before `stop`.

## iTerm2

- **Binary:** `iTerm2` installed under `/Applications/iTerm2.app`.
  The factory pins the driver to `iterm2` and locates the Python
  API through `HOME` (the documented allowlist exception).
- **Permissions:** iTerm2's Python API must be reachable from the
  bridge process. The factory does not start a Python subprocess;
  it uses the iTerm2 AppleScript bridge through the same helper
  directory as Ghostty.
- **Session grants:** the Pi grant/resource projection is
  unchanged. The terminal-host grant is separate from the iTerm2
  internal permissions.

## Failure modes

| Symptom                                                | Likely cause                              |
| ------------------------------------------------------ | ----------------------------------------- |
| Runtime row reads `failed` with `terminal-not-found`   | Binary not on `PATH` (Ghostty) or not in `/Applications` (iTerm2) |
| Runtime row reads `degraded` with `terminal-health-error` | Adapter started but the health probe timed out |
| `Open in Terminal` is disabled with "Terminal is not ready" | Projection status is not `ready`; check Bridge & Runtimes for the failure code |
| Switching terminals leaves two adapters running       | Reconciler tick was bypassed; restart the bridge |

## What you should never do

- **Do not install Ghostty or iTerm2 into a non-standard location
  and pass the path to the factory.** The factory pins the spawn
  policy; it does not accept caller-supplied paths.
- **Do not grant `terminal-host` to an add-on that is not
  reviewed.** The CP-BR4 factory registry refuses unknown factory
  ids; an unknown add-on is not wired to the lifecycle.
- **Do not run the bridge as root to "fix" a permission error.**
  Root violates the host's per-user credential model and breaks
  the per-user bridge TLS lifecycle.
