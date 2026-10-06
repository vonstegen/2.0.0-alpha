# ResonantOS Bridge Bootstrap — macOS Runbook

> CP-BR1 installs a per-user Chrome native-messaging host that owns
> independent `status` / `start` / `restart` / `stopForShutdown`
> authority over the Alpha bridge. This runbook covers installation,
> removal, and troubleshooting on macOS. The protocol reference is
> [BRIDGE-BOOTSTRAP-PROTOCOL.md](BRIDGE-BOOTSTRAP-PROTOCOL.md).

## 1. Files Installed

| Path | Purpose | Mode |
| --- | --- | --- |
| `~/Library/Application Support/ResonantOS/bootstrap/ros-bridge-bootstrap-host.sh` | Pinned wrapper: `exec "<pinned node>" "<pinned native-host-main.mjs>"`. The native host Chrome actually launches. | `0755` |
| `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.resonantos.bridge_bootstrap.json` | Chrome native-host manifest. `allowed_origins` is pinned to the Alpha extension origin. | `0644` |

The wrapper script and manifest are **per-user** (under the user's
Library), not under `/Library`. Re-running the installer regenerates
both files; the uninstaller removes them and the bootstrap support
directory if empty.

Nothing under the repository is modified by install or uninstall.
Nothing in `~/ResonantOS_User/` or `bridge-config.generated.js` is
touched.

## 2. Install

From the Alpha repository root:

```sh
node browser-first/bootstrap/install-macos.mjs
```

The installer:

1. Resolves the Node executable: defaults to `process.execPath`
   (the Node running the installer). Override with `--node=/abs/node`.
   The Node must be absolute, exist, and report `node --version`
   >= `v24`.
2. Resolves the host entry:
   `browser-first/bootstrap/native-host-main.mjs` (absolute, derived
   from this package's location).
3. Validates both with absolute-path and newline/quote checks; the
   wrapper script quotes each operand and refuses quotes or newlines.
4. Writes the wrapper and manifest into the per-user locations listed
   above.

Dry run (`--print`) prints the resolved paths, the wrapper, and the
manifest without writing anything. Use it after edits to confirm the
planned install before re-installing.

```sh
node browser-first/bootstrap/install-macos.mjs --print
node browser-first/bootstrap/install-macos.mjs --node=/opt/homebrew/bin/node
```

After install, **reload the extension or restart Chrome** so Chrome
re-reads the native host manifest. Without the reload, Chrome keeps
using its in-memory copy of the previously installed manifest.

## 3. Uninstall

```sh
node browser-first/bootstrap/uninstall-macos.mjs
```

Removes the wrapper and the manifest; removes the bootstrap support
directory only when empty. Idempotent: re-running on a system without
the files is a no-op.

`--print` lists what would be removed without touching the filesystem.

## 4. Troubleshooting

### 4.1 status returns `offline` while the bridge is running

The bridge is reachable on `http://127.0.0.1:47773`, but the bootstrap
host reports `offline`. This means the bridge is answering on a
**different** port — most commonly because the bridge fell back to a
random port when `47773` was busy at startup. Either:

- Stop whatever is holding `47773` (a stale `npm run browser-first:bridge`
  from a different terminal, a different user's bridge, a developer
  page binding the loopback, etc.), restart the bridge via the
  bootstrap host, and confirm the bound URL is `http://127.0.0.1:47773`.
- Or restart the bridge deliberately so it can claim `47773` first.

If you expect a foreign bridge to live on `47773`, do not install the
native host; use the bootstrap's `start` for an `alreadyRunning` report
on a foreign bridge, and leave `stopForShutdown` alone.

### 4.2 start returns `start-failed` or `health-timeout`

- `start-failed` with no public code: the child failed to spawn or
  died before health polling began. Check stderr on Chrome's extension
  page (`chrome://extensions` → ResonantOS → "Errors") for one
  `bootstrap.host_exit` event with the `code` field (the only
  non-secret diagnostics the host emits).
- `health-timeout`: the bridge started but never answered
  `http://127.0.0.1:47773/healthz` (or its auth-guard signature) within
  10 seconds. Confirm `run-bridge-minimal.mjs` is reachable and the
  repository is on Node 24+. Re-run `npm install` if dependencies are
  stale.

### 4.3 restart returns `restart-failed` with `status: "connected"`

The bridge is healthy but this host never spawned it (a foreign bridge
on `47773`). The bootstrap host does not own it; it will not stop it,
and it will not spawn a new one behind it. Stop the foreign bridge
yourself (or the operator who started it), then `start` again.

### 4.4 version-mismatch

The host will report `version-mismatch` only when the bridge responds
to its probe with a `version` field that disagrees with the host-pinned
expected version. The Alpha bridge does not currently expose a version
on `/healthz`; this code is forward-looking for the moment a versioned
health route exists.

### 4.5 Installer refuses the node with `node-too-old`

The pinned Node must be >= `v24` (per `package.json#engines.node`).
Upgrade Node (e.g. `brew install node@26` or download a current LTS)
and re-run the installer with `--node=/abs/path/to/node`.

### 4.6 Installer refuses the node with `host-entry-missing`

The host entry is `browser-first/bootstrap/native-host-main.mjs`. The
installer only writes files; it never clones the repository. Confirm
the Alpha repository is present at the path you ran the installer
from.

### 4.7 Chrome refuses to start the native host

Chrome only loads the manifest after a reload of the extension or a
restart of Chrome. The manifest's `path` must be absolute and the
wrapper script must be executable (`0755`). Verify with:

```sh
ls -l ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.resonantos.bridge_bootstrap.json
ls -l ~/Library/Application\ Support/ResonantOS/bootstrap/ros-bridge-bootstrap-host.sh
file ~/Library/Application\ Support/ResonantOS/bootstrap/ros-bridge-bootstrap-host.sh
```

If Chrome still refuses, open `chrome://extensions` → ResonantOS →
"Errors" and inspect the most recent `bootstrap.host_exit` line for the
host's exit code (`2` for oversized frame, `0` for stdin end).

## 5. Cross-Platform Note

CP-BR1 ships an explicit macOS installer only. The bridge bootstrap
host itself is platform-agnostic (`native-host-main.mjs`), but Chrome
native-host manifest discovery and the per-user install layout differ
on Linux (`~/.config/google-chrome/NativeMessagingHosts/`) and Windows
(`%APPDATA%\Google\Chrome\NativeMessagingHosts\`). Cross-platform
installers are intentionally deferred — the Alpha browser is Chrome
on macOS for now.

## 6. References

- [BRIDGE-BOOTSTRAP-PROTOCOL.md](BRIDGE-BOOTSTRAP-PROTOCOL.md)
- [ADR-047](ADR-047-core-bridge-bootstrap-runtime-lifecycle.md)
- CP-BR1 gate: the bridge-runtime roadmap (see `docs/architecture/README.md`)