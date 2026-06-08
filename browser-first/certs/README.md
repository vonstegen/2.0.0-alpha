# ResonantOS Bridge CA Certificate

This is the **self-signed CA certificate** that the ResonantOS bridge
generates at first start. The bridge auto-creates and signs a leaf
certificate from this CA for its HTTPS endpoint. When you install this
CA in your operating system's trust store, your browser will trust the
bridge's HTTPS endpoint without security warnings.

## Important

- **This file is safe to distribute** to any machine that needs to
  reach the bridge. It's a public certificate.
- The corresponding **private key** is at `~/.resonantos-tls/ca.key`
  on the bridge host and is **NEVER distributed**.
- If you regenerate the CA (e.g. via `node scripts/rotate-bridge-ca.mjs`
  or by deleting `~/.resonantos-tls/`), the new CA needs to be
  re-distributed to all client machines and re-installed into their
  trust stores. The bridge token in `src/bridge-config.generated.js`
  also rotates when this happens, so the extension needs a reload.

## Install steps per platform

See `../INSTALL.md` section 3 for full details. Quick reference:

| Platform   | Where to install                                                        |
|------------|-------------------------------------------------------------------------|
| macOS      | System Keychain (Double-click → Add to System Keychain → Always Trust)  |
| Windows    | Trusted Root Certification Authorities (Local Machine)                  |
| Linux      | `/usr/local/share/ca-certificates/` (Debian) or `/etc/pki/ca-trust/...` (RHEL) |
| Firefox    | `about:preferences#privacy` → View Certificates → Authorities → Import  |

## How to verify

After installing, the certificate should appear as
"ResonantOS Local Dev CA" with these identifying details:

- **Subject CN**: `ResonantOS Local Dev CA`
- **Issuer CN**: `ResonantOS Local Dev CA` (self-signed)
- **Valid from**: the date the bridge first started
- **Valid to**: ~10 years from then (so you won't have to re-do this often)
- **Key type**: ECDSA P-256 (or Ed25519 on older installs; both work)

If you see the cert listed but the bridge still shows warnings, you
probably have a **different CA installed** (e.g. you ran the bridge
under a different user account and got a different `~/.resonantos-tls/`).
Either install this CA or delete the old one and re-install.
