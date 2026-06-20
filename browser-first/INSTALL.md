# ResonantOS Browser-First Layer — Install Guide

This document walks through installing the **ResonantOS Browser Layer** (a
Manifest V3 Chrome/Edge/Brave extension) and the **ResonantOS Bridge** (a
Node.js HTTP server that the extension talks to) on **Linux, macOS, and
Windows**.

The bridge runs on the **host machine** (e.g. a Raspberry Pi, an always-on
Mac mini, or a Windows server). The extension loads in **your local
browser** (Chrome, Edge, Brave, Arc, or any Chromium-family browser
v116+). They can be the same machine, or different machines on the same
LAN / Tailscale network.

---

## Architecture (60-second version)

```
+-----------------------+        HTTPS (19443)         +-----------------------+
|  Browser extension    |  <----------------------->   |   Caddy (TLS term.)   |
|  (chrome://ext/...)   |                              |   localhost:19443     |
+-----------------------+                              +-----------+-----------+
                                                                | HTTP (plaintext)
                                                                v
                                                    +-----------------------+
                                                    |  ResonantOS Bridge    |
                                                    |  (Node.js, 47773)     |
                                                    +-----------+-----------+
                                                                |
                                                                v
                                                    +-----------------------+
                                                    |  Addons: Hermes,      |
                                                    |  OpenCode, providers, |
                                                    |  Living Archive, etc. |
                                                    +-----------------------+
```

The bridge **generates a self-signed CA and leaf cert** at first start
(`~/.resonantos-tls/ca.crt` and `leaf.crt`). The leaf cert is signed by
that CA. Caddy serves the leaf cert on `:19443`. To make browsers trust
the bridge HTTPS endpoint **without** showing a "Your connection is not
private" warning, you install the **CA cert** (`resonantos-ca.crt`) into
the **operating system trust store** on every client machine.

The bridge also auto-generates
`src/bridge-config.generated.js` inside the extension folder on each
startup, baking in the **current bridge URL** and **bridge token**. This
file is `.gitignore`'d — it is regenerated, never committed.

---

## 1. Prerequisites

All platforms need:

- **Node.js 22.x or newer** (`node --version`)
- **A modern Chromium browser** (Chrome 116+, Edge 116+, Brave, Arc) for
  loading the extension
- **OpenSSL** (for cert generation; pre-installed on macOS and Linux;
  Windows users can use the Git Bash that ships with Git for Windows, or
  install OpenSSL separately)
- **Caddy** (only needed if you want HTTPS on the bridge). Optional on
  loopback-only setups. The bridge also has a built-in `--https` mode
  for loopback that doesn't need Caddy — see *Local-only install*
  below.

Linux additionally needs:

- `systemd` user instance (most distros have this) **or** `tmux` /
  `screen` for running the bridge as a long-lived process
- `libnss3` and friends if you're going to also use the bundled native
  browser host (optional)

macOS additionally needs:

- Xcode Command Line Tools (`xcode-select --install`) for native
  browser host builds
- `~/Library/LaunchAgents/` for the bridge plist (or use `tmux`)

Windows additionally needs:

- PowerShell 5+ (built into Windows 10/11)
- **NSSM** (Non-Sucking Service Manager) for running the bridge as a
  Windows Service, OR just run it in a persistent `tmux`-style terminal

---

## 2. Build the extension

From the repo root:

```bash
# 1. Install Node deps (one-time)
npm install

# 2. (Optional) Build the native browser host
#    Skip this if you're only using the extension + bridge and your
#    own browser for the side panel.
npm run browser-native:build
```

There is no separate "build" step for the extension itself. The
`browser-first/resonantos-side-panel-extension/` directory IS the
loadable extension. Chrome loads it directly via *Load unpacked* (see
section 4).

---

## 3. Install the CA certificate (one-time per client)

The bridge auto-generates a self-signed CA at first start. After
starting the bridge once (section 5), the CA cert is at
`~/.resonantos-tls/ca.crt` on the bridge host. Copy it to the
**client** machine (the one running your browser), then:

### macOS

```bash
# Double-click ~/.resonantos-tls/ca.crt in Finder, OR:
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain ~/.resonantos-tls/ca.crt
```

Verify: open Keychain Access → System → Certificates, find
"ResonantOS Local Dev CA" — the disclosure triangle should show
"This certificate is marked as trusted for all purposes."

### Windows (PowerShell as Administrator)

```powershell
# Method 1: GUI
# Double-click resonantos-ca.crt → Install Certificate →
#   Local Machine → Place in "Trusted Root Certification Authorities"

# Method 2: PowerShell
Import-Certificate -FilePath ".\resonantos-ca.crt" `
  -CertStoreLocation Cert:\LocalMachine\Root
```

Verify: `certmgr.msc` → Trusted Root Certification Authorities →
Certificates → "ResonantOS Local Dev CA" should be listed.

### Linux

```bash
# Debian/Ubuntu/Raspberry Pi OS
sudo cp resonantos-ca.crt /usr/local/share/ca-certificates/resonantos-ca.crt
sudo update-ca-certificates

# Fedora/RHEL
sudo cp resonantos-ca.crt /etc/pki/ca-trust/source/anchors/resonantos-ca.crt
sudo update-ca-trust

# Arch
sudo cp resonantos-ca.crt /etc/ca-certificates/trust-source/anchors/resonantos-ca.crt
sudo trust extract-compat
```

Verify: `trust list | grep -i resonantos`

### Browser-specific (only if OS trust didn't take)

- **Firefox** uses its OWN cert store, separate from the OS. Go to
  `about:preferences#privacy` → Certificates → View Certificates →
  Authorities → Import… and select `resonantos-ca.crt`, check "Trust
  this CA to identify websites."

### Chrome / Edge / Brave

These read the **OS trust store** on Windows, macOS, and modern Linux.
If the cert is in the OS store, the browser trusts it automatically. If
the browser still shows a cert error, restart it fully (Chrome caches
trust decisions aggressively).

---

## 4. Install the extension (every client machine)

1. **Get the extension folder** to your client machine. Either:
   - `git clone` the repo (recommended for development), OR
   - Download `resonantos-extension-v0.1.14.zip` from the project
     release page and unzip it somewhere stable (e.g. `~/resonantos/`)

2. **Generate the bridge config** for this client. The bridge writes
   `src/bridge-config.generated.js` to the extension folder at first
   startup. If you're loading the extension BEFORE starting the bridge,
   that file won't exist yet. Start the bridge (section 5) first, OR
   load the extension, see the "Bridge unreachable" status, then start
   the bridge (it will write the config and the extension will pick it
   up on next reload).

3. **Load the extension**:
   - Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`)
   - Toggle **Developer mode** (top right)
   - Click **Load unpacked**
   - Navigate to `browser-first/resonantos-side-panel-extension/`
     (the folder containing `manifest.json`)
   - The extension should appear in your list. **Note the ID** (a
     32-character string under the extension name) — you'll need it
     in step 5.

4. **Open a new tab**. The ResonantOS new-tab page should load. The
   "Bridge Target" status pill in the sidebar should show a green
   check mark. If it shows red, see Troubleshooting (section 7).

---

## 5. Start the bridge

The bridge needs to run as a long-lived process. Pick the option that
matches your platform and your comfort level.

### Option A: Bridge with Caddy (recommended for LAN/Tailscale)

**Why Caddy**: it terminates TLS using the leaf cert, so the bridge
exposes an HTTPS endpoint that any browser on the LAN can reach
without warnings. Caddy listens on `:19443`; the bridge itself listens
on `127.0.0.1:47773` over plaintext HTTP.

#### Linux (Raspberry Pi / Ubuntu) — systemd

Place the bridge launcher script somewhere stable. Example: copy
`scripts/launch-resonantos-bridge.mjs` to `~/resonantos-bridge.mjs`
(you may need to adjust the path inside; see *bridge token pinning*
below). Then create the systemd unit:

```ini
# ~/.config/systemd/user/resonant-bridge.service
[Unit]
Description=ResonantOS Browser-First Bridge
After=network.target

[Service]
Type=simple
# Bind 0.0.0.0 so the bridge is reachable from LAN/Tailscale. The
# IP allowlist (RESONANTOS_BRIDGE_ALLOWED_IPS) is enforced inside the
# bridge, so binding 0.0.0.0 is safe.
Environment=RESONANTOS_BRIDGE_HOST=0.0.0.0
# Public URL the extension bakes into its generated config. Pick
# the canonical address (LAN, Tailscale, or localhost).
Environment=RESONANTOS_BRIDGE_PUBLIC_URL=https://192.168.1.100:19443
# Pin a stable token so the extension doesn't have to be reloaded
# every time the bridge restarts. Generate one with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
Environment=RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN=<your-32-byte-base64url-token>
# Restrict to known networks. Loopback + RFC1918 + Tailscale CGNAT
# + Tailscale 100.112.0.0/16. Adjust to your actual subnets.
Environment=RESONANTOS_BRIDGE_ALLOWED_IPS=127.0.0.0/8,192.168.0.0/16,10.0.0.0/8,100.64.0.0/10,100.112.0.0/16,172.16.0.0/12
# CORS allowlist: chrome-extension://<your-extension-id> (and a
# wildcard for dev), plus the bridge's own HTTPS origin.
Environment=RESONANTOS_BRIDGE_ALLOWED_ORIGINS=chrome-extension://<your-extension-id>,chrome-extension://*,https://192.168.1.100:19443,https://localhost:19443,https://127.0.0.1:19443
# Path prefixes exempt from bridge-token check. The /hermes-dashboard/*
# SPA can't carry custom headers on iframe requests, so the IP
# allowlist is the only auth for these.
Environment=RESONANTOS_BRIDGE_OPEN_PROXY_PREFIXES=/hermes-dashboard,/api,/assets,/fonts-terminal,/dashboard-plugins,/favicon.ico
ExecStart=/usr/bin/node /home/pi/resonantos-build/resonantos-bridge-full.mjs
WorkingDirectory=/home/pi/resonantos-build
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
# Enable lingering so the user service runs at boot without an
# active login session
sudo loginctl enable-linger $USER

# Start and enable
systemctl --user daemon-reload
systemctl --user enable --now resonant-bridge.service
systemctl --user status resonant-bridge.service
```

#### Caddy (Linux)

```caddyfile
# /etc/caddy/Caddyfile (or ~/.config/caddy/Caddyfile)
https://:19443 {
    tls /home/<you>/.resonantos-tls/leaf.crt /home/<you>/.resonantos-tls/leaf.key
    reverse_proxy 127.0.0.1:47773 {
        header_up X-Forwarded-Proto https
    }
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

#### macOS — launchd

Create `~/Library/LaunchAgents/com.resonantos.bridge.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.resonantos.bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/<you>/resonantos-build/resonantos-bridge-full.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/<you>/resonantos-build</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>RESONANTOS_BRIDGE_HOST</key><string>0.0.0.0</string>
    <key>RESONANTOS_BRIDGE_PUBLIC_URL</key><string>https://<your-mac-lan-ip>:19443</string>
    <key>RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN</key>
    <string>&lt;your-32-byte-base64url-token&gt;</string>
    <key>RESONANTOS_BRIDGE_ALLOWED_IPS</key>
    <string>127.0.0.0/8,192.168.0.0/16,10.0.0.0/8,100.64.0.0/10,100.112.0.0/16,172.16.0.0/12</string>
    <key>RESONANTOS_BRIDGE_ALLOWED_ORIGINS</key>
    <string>chrome-extension://&lt;your-extension-id&gt;,chrome-extension://*,https://localhost:19443,https://127.0.0.1:19443</string>
    <key>RESONANTOS_BRIDGE_OPEN_PROXY_PREFIXES</key>
    <string>/hermes-dashboard,/api,/assets,/fonts-terminal,/dashboard-plugins,/favicon.ico</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/resonant-bridge.out.log</string>
  <key>StandardErrorPath</key><string>/tmp/resonant-bridge.err.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.resonantos.bridge.plist
launchctl start com.resonantos.bridge
```

For Caddy on macOS, install via Homebrew (`brew install caddy`) and
adapt the Linux Caddyfile section above (the path is the same;
`~/.resonantos-tls/` instead of `/home/<you>/.resonantos-tls/`).

#### Windows — NSSM (service) or scheduled task

**Option 1: NSSM (cleanest)**

```powershell
# Install NSSM (one-time)
choco install nssm

# Create the service. Adjust paths and env vars to your machine.
nssm install ResonantBridge "C:\Program Files\nodejs\node.exe" `
  "C:\Users\<you>\resonantos-build\resonantos-bridge-full.mjs"

nssm set ResonantBridge AppDirectory "C:\Users\<you>\resonantos-build"
nssm set ResonantBridge AppEnvironmentExtra `
  "RESONANTOS_BRIDGE_HOST=0.0.0.0" `
  "RESONANTOS_BRIDGE_PUBLIC_URL=https://<your-pc-lan-ip>:19443" `
  "RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN=<your-32-byte-base64url-token>" `
  "RESONANTOS_BRIDGE_ALLOWED_IPS=127.0.0.0/8,192.168.0.0/16,10.0.0.0/8,100.64.0.0/10,100.112.0.0/16,172.16.0.0/12" `
  "RESONANTOS_BRIDGE_ALLOWED_ORIGINS=chrome-extension://<your-extension-id>,chrome-extension://*,https://localhost:19443,https://127.0.0.1:19443" `
  "RESONANTOS_BRIDGE_OPEN_PROXY_PREFIXES=/hermes-dashboard,/api,/assets,/fonts-terminal,/dashboard-plugins,/favicon.ico"

nssm start ResonantBridge
```

**Option 2: Scheduled task (no admin)**

```powershell
$action = New-ScheduledTaskAction `
  -Execute "C:\Program Files\nodejs\node.exe" `
  -Argument "C:\Users\<you>\resonantos-build\resonantos-bridge-full.mjs" `
  -WorkingDirectory "C:\Users\<you>\resonantos-build"

# Set environment variables via a wrapper script that exports them,
# OR by reading from a .env file. See `resonantos-bridge-full.mjs`
# for which env names it honors.

Register-ScheduledTask `
  -TaskName "ResonantBridge" `
  -Action $action `
  -Trigger (New-ScheduledTaskTrigger -AtLogOn) `
  -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1))
```

For Caddy on Windows, install via `choco install caddy` and adapt the
Linux Caddyfile (use `C:\Users\<you>\.resonantos-tls\leaf.crt` paths).

### Option B: Loopback-only (no Caddy, no LAN)

If the extension and bridge run on the **same machine** and you don't
need LAN access, you can skip Caddy entirely. The bridge will detect
loopback and self-serve HTTPS directly on a separate port using the
leaf cert. See `scripts/launch-resonantos-bridge.mjs` `--loopback-https`
flag (or the in-source equivalent). The public URL becomes
`https://127.0.0.1:19443` and the cert in `~/.resonantos-tls/ca.crt`
still needs to be trusted by the OS.

This is the simplest setup for single-machine development.

### Option C: tmux / iterm / Windows Terminal (just run it)

If you don't want to set up a service:

```bash
# Linux / macOS
tmux new -s bridge
node /path/to/resonantos-build/resonantos-bridge-full.mjs
# Ctrl-B D to detach; `tmux attach -t bridge` to reattach
```

```powershell
# Windows PowerShell — use Windows Terminal with multiple panes
cd C:\path\to\resonantos-build
node .\resonantos-bridge-full.mjs
# Don't close the terminal; minimize it.
```

This works fine for development. Lose the terminal session, lose the
bridge.

---

## 6. Verify

1. **Bridge is listening**: from the bridge host,
   `curl -s -k https://127.0.0.1:19443/status` should return
   `{"ok":true,...}`. With the bridge token in the header,
   `curl -s https://127.0.0.1:19443/status -H "X-ResonantOS-Bridge-Token: $RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN"`
   should return a populated status.

2. **From a client machine** on the same network,
   `curl -s https://<bridge-host>:19443/status` (no `-k` this time) —
   if the CA cert is trusted, this should succeed without cert errors.

3. **In the browser**: open a new tab. The ResonantOS new-tab page
   should show the Augmentor chat, a left rail with your projects, and
   a right sidebar with addon status pills. Click the **Hermes**
   workspace in the rail — the Hermes dashboard should load inside an
   iframe (you'll see "Dashboard running · http://192.168.1.100:9119"
   if Hermes is up).

4. **Send a chat message**: type "hello" in the composer, hit Enter.
   The bridge should respond and the message should appear in the
   thread.

---

## 7. Troubleshooting

### "Your connection is not private" / NET::ERR_CERT_AUTHORITY_INVALID

The CA cert is not trusted by the browser. Re-do section 3 on the
**client** machine. On Windows specifically, Chrome reads the **user**
cert store, not just the local machine store — run
`certmgr.msc` (not `certlm.msc`) and check the user-trusted roots
section.

### Bridge unreachable / Failed to fetch / CORS error

1. Is the bridge process actually running? `systemctl --user status`
   (Linux), `launchctl list | grep resonantos` (macOS), or check Task
   Manager (Windows).
2. Is the bridge listening on the IP you think? On Linux,
   `ss -tlnp | grep 47773` shows the bind address. If it shows
   `127.0.0.1:47773` only, you need
   `Environment=RESONANTOS_BRIDGE_HOST=0.0.0.0` in the systemd unit.
3. Is the IP allowlist too tight? The error response will say
   "client IP not in allowlist" or similar — temporarily set
   `RESONANTOS_BRIDGE_ALLOWED_IPS=` (empty) to disable IP gating and
   see if that fixes it.
4. Is the CORS allowlist missing your extension ID? The error
   response will say "origin not allowed" — add your extension ID
   (the 32-char string from `chrome://extensions`) to
   `RESONANTOS_BRIDGE_ALLOWED_ORIGINS`. The wildcard
   `chrome-extension://*` covers dev, but production should pin the
   exact ID.
5. Is the bridge token stale? The extension has
   `src/bridge-config.generated.js` baked with the OLD token, but
   the bridge was restarted with a NEW token. Re-run the bridge once
   with the OLD token, or restart with the new token AND
   `chrome://extensions` → ResonantOS → Reload.

### "bridgeRequest is not a function" in console

This was the v0.1.12 race condition, **fixed in v0.1.13**. Make sure
you are loading the v0.1.13+ extension. Check `manifest.json`
inside your loaded extension folder — version should be 0.1.14.

### "Issues 1 found" warning in Chrome

This was the deprecated `audioCapture` permission, **removed in
v0.1.14**. Verify your manifest doesn't list `audioCapture`. If
you loaded an older version, remove the extension and reload the
v0.1.14 folder.

### "Failed to fetch" from the Hermes iframe specifically

The Hermes dashboard is at `http://127.0.0.1:9119` (or whichever port
Hermes is on) on the bridge host. The bridge proxies
`/hermes-dashboard/*` from the extension's iframe to that upstream.
This proxy is exempt from the bridge-token check (browsers can't set
custom headers on iframe requests), so it relies on the IP allowlist
alone. Make sure your client's IP is in
`RESONANTOS_BRIDGE_ALLOWED_IPS`.

### "Mixed content blocked" on the Hermes iframe

The new-tab page is `chrome-extension://...` (secure context). It
embeds an `<iframe src="https://...:19443/hermes-dashboard/">`. The
iframe's own origin is HTTPS, so the browser blocks the iframe from
loading HTTP upstreams inside it. The bridge handles this by setting
`X-Forwarded-Proto https` and serving the iframe with HTTPS. If
you're seeing mixed content, your Caddy config is probably missing
the `header_up X-Forwarded-Proto https` line.

### Bridge token rotated and the extension broke

Tokens rotate if you don't pin them. The fix:
1. Pick a token: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
2. Set `RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN=<that token>` in the
   bridge service config
3. Restart the bridge
4. The bridge writes the new token into
   `src/bridge-config.generated.js` automatically
5. Reload the extension in `chrome://extensions` to pick up the new
   generated config

---

## 8. Security notes

- **The CA cert is your trust root.** Anyone with that file can mint
  certs that your browser will trust. Don't share it. The private key
  is at `~/.resonantos-tls/ca.key` — keep that file `chmod 600` and
  never commit it.
- **The bridge token is shared between bridge and extension.** It
  authenticates the extension to the bridge. Treat it like an API
  key. Don't paste it in chat / docs / public repos.
- **CORS `chrome-extension://*` is dev-only.** For a production
  build, pin the exact extension ID in
  `RESONANTOS_BRIDGE_ALLOWED_ORIGINS`. The wildcard covers the case
  where Chrome rotates the extension ID on each load (which it does
  for unpacked extensions when the `key` field in manifest.json
  changes — keep that key stable across builds).
- **The IP allowlist is your second line of defense.** Even if the
  bridge token leaks, only clients in
  `RESONANTOS_BRIDGE_ALLOWED_IPS` can reach the bridge.
- **`/hermes-dashboard/` and similar paths bypass the bridge
  token.** They rely on the IP allowlist. If you have a hostile
  network, restrict this further.

---

## 9. What runs where (TL;DR)

| Component                  | Where it runs            | Lifecycle                |
|----------------------------|--------------------------|--------------------------|
| Browser extension          | Client machine (browser) | Loaded via `chrome://ext`|
| Caddy (TLS terminator)     | Bridge host              | System service           |
| ResonantOS Bridge          | Bridge host              | System service or tmux   |
| `~/.resonantos-tls/`       | Bridge host              | Generated on first run   |
| `src/bridge-config.gen.js` | Bridge host + extension folder | Overwritten on every bridge start |
| CA cert (`resonantos-ca.crt`) | Bridge host        | Distribute to clients    |

The bridge and the extension are **coupled by**:
- The CA cert (client trusts it → trusts the bridge's HTTPS)
- The bridge URL (extension knows where to dial)
- The bridge token (extension authenticates to the bridge)

Changing any of these three requires a coordinated restart (bridge
first, then reload the extension).
