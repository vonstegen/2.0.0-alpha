# NightWatch Security Review — ResonantOS 2.0.0-alpha
**Reviewer:** NightWatch Security Subagent  
**Date:** 2026-06-08  
**Scope:** Pre-release final security review  
**Branch:** dev (HEAD: 5a535b1)

---

## Summary Table

| ID | Area | Severity | Status | Short Description |
|----|------|----------|--------|-------------------|
| S-01 | IPC Boundary | 🔴 CRITICAL (FIXED) | ✅ Verified | save_runtime_state renderer capability self-grant |
| S-02 | Provider Execution | 🔴 CRITICAL (FIXED) | ✅ Verified | Codex --dangerously-bypass-approvals-and-sandbox |
| S-03 | Bridge Server | 🟠 HIGH (FIXED) | ✅ Verified | Capability tokens in filesystem artifact |
| S-04 | CEF Sandbox | 🟠 HIGH (FIXED) | ✅ Verified | Native browser sandbox disabled unconditionally |
| S-05 | IPC Boundary | 🟡 MEDIUM | ⚠️ Open | obsidian read commands lack capability gates |
| S-06 | IPC Boundary | 🟡 MEDIUM | ⚠️ Open | sideload_addon_manifest unrestricted path acceptance |
| S-07 | Extension | 🟡 MEDIUM | ⚠️ Open | Overly broad extension permissions (history, audioCapture) |
| S-08 | Bridge/Extension | 🟡 MEDIUM | ⚠️ Open | onMessage lacks sender origin validation |
| S-09 | Credential Handling | 🟢 LOW | ℹ️ Informational | API keys stored as plaintext JSON on disk |
| S-10 | CSP | 🟢 LOW | ℹ️ Informational | connect-src allows all 127.0.0.1:* ports |
| S-11 | Provider Execution | 🟢 LOW | ℹ️ Informational | Codex --full-auto + --skip-git-repo-check scope |

---

## Critical Findings (Pre-Patch) — Verified Fixed

### S-01 — Renderer capability self-grant via save_runtime_state ✅ FIXED
**File:** `src-tauri/src/lib.rs`  
**Commit:** `ccd2ff1`  
**Severity:** CRITICAL  

**What was wrong (before fix):**  
`save_runtime_state` accepted the full `ResonantShellState` JSON from the renderer and wrote it verbatim to disk. A compromised renderer could overwrite `installations[*].grantedCapabilities`, `providerProfiles`, `providerCredentials`, `securityPolicy`, and `trustTier` — effectively granting itself any capability.

**Fix implementation (lines 192–239 lib.rs):**  
```rust
const SAFE_KEYS: &[&str] = &[
    "uiPreferences", "activeSection", "chatThreads",
    "archiveSearchState", "modelStrategy", "browserState", "delegationState",
];
```
`merge_safe_state_fields()` starts from the existing on-disk state and overlays only whitelisted UX keys from the renderer. On bootstrap (no existing state), security-sensitive keys are stripped:
```rust
obj.remove("installations");
obj.remove("providerProfiles");
obj.remove("providerCredentials");
obj.remove("securityPolicy");
obj.remove("trustTier");
```

**Verification:** Fix is complete and correct. The `runtime-state-updated` event emits the filtered state, keeping renderer view consistent. The `assert_addon_capabilities_from_state` function in `host_state.rs` still reads `grantedCapabilities` only from on-disk state, which the renderer cannot overwrite.

**Minor residual note:** `delegationState` and `browserState` are in the whitelist. If future code stores security-sensitive data in those keys, the filter would not protect them. These should be documented as "UI-only" state keys.

---

### S-02 — Codex sandbox bypass flag ✅ FIXED
**File:** `src-tauri/src/provider_service.rs` line 191  
**Commit:** `93d81fe`  
**Severity:** CRITICAL  

**What was wrong:**  
```rust
// BEFORE:
"--dangerously-bypass-approvals-and-sandbox",
```
This flag instructed Codex to bypass its own safety approvals and sandbox protections, potentially allowing auto-execution of arbitrary shell commands without human confirmation.

**Fix:**  
```rust
// AFTER:
"--full-auto",
```
`--full-auto` operates within Codex's normal approval envelope. Codex's safety rails remain active.

**Verification:** Correct. The change is minimal and targeted. `--full-auto` retains automatic operation while `--skip-git-repo-check` is appropriate for the standalone provider execution context.

---

### S-03 — Capability tokens in generated filesystem artifact ✅ FIXED
**File:** `browser-first/host/bridge-server.mjs`  
**Commit:** `6a4d3d5`  
**Severity:** HIGH  

**What was wrong (before fix):**  
`writeBridgeConfig()` was writing `bridgeCapabilityTokens` into `bridge-config.generated.js`. Any local process with filesystem read access could obtain capability tokens without authenticating to the bridge.

**Fix implementation:**  
- `writeBridgeConfig()` now writes only `{bridgeUrl, bridgeToken}`. Capability tokens are never on disk.
- `startBridgeServer()` injects `/api/capability-tokens` as an internal route:
  ```javascript
  handler: async () => ({ capabilityTokens: bridgeCapabilityTokens }),
  ```
  This route is protected by the bridge token check (via `evaluateBridgeRequestForSelfTest` which calls `isAuthorizedBridgeRequest` using `constantTimeEqual`).
- `bridge-client.js` initializes with empty `_capabilityTokens = {}` and populates via `initCapabilityTokens()` on service-worker startup.
- `background.js` calls `initCapabilityTokens()` at module evaluation, `onInstalled`, and `onStartup`.

**Verification:** Correct. The design correctly models capability token access as requiring bridge token possession first. `constantTimeEqual` prevents timing attacks on the token comparison. File permissions `0o600` on the config file are set.

---

### S-04 — CEF sandbox disabled unconditionally ✅ FIXED
**Files:** `native_host/src/resonant_browser_native_bridge_mac.mm`, `resonant_browser_native_host.cc`  
**Commit:** `0d53876`  
**Severity:** HIGH  

**What was wrong:**  
```cpp
// BEFORE:
settings.no_sandbox = true;
```
Chromium Embedded Framework (CEF) sandbox was unconditionally disabled in both the Mac bridge and native host. A compromised renderer in the embedded browser had no sandbox barrier.

**Fix:**  
```cpp
// AFTER:
settings.no_sandbox = (std::getenv("RESONANTOS_CEF_NO_SANDBOX") != nullptr && ...);
```
Sandbox is enabled by default in production. `RESONANTOS_CEF_NO_SANDBOX` environment variable provides a documented escape hatch for development/debugging.

**Verification:** Correct. The CI trigger for browser-first is added in `alpha-build.yml` so this code path is tested in CI.

---

## Open Findings — Action Required

### S-05 — Obsidian read commands lack capability gates 🟡 MEDIUM
**File:** `src-tauri/src/lib.rs` lines ~453–503  
**Severity:** MEDIUM  

**Issue:**  
Four Tauri commands that read from user-provided filesystem paths have no `assert_addon_capabilities` check:

```rust
// No capability check:
fn obsidian_vault_status(request: ObsidianVaultRequest)          // L453
fn obsidian_list_notes(request: ObsidianListNotesRequest)         // L458
fn obsidian_read_note(request: ObsidianReadNoteRequest)           // L463
fn obsidian_vault_index(request: ObsidianVaultIndexRequest)       // L498
fn obsidian_open_note(request: ObsidianOpenNoteRequest)           // L468

// Capability check present (writes):
fn obsidian_write_note(...) → assert_addon_capabilities(..., &["filesystem"]) // L473
fn obsidian_create_note(...) → assert_addon_capabilities(...)      // L480
```

A compromised renderer (via XSS or malicious module loaded in the Tauri webview) could call `obsidian_read_note` with `vault_path = "/Users/dr.tom"` to enumerate and read any `.md` file on the filesystem. `safe_note_path()` in `obsidian_service.rs` correctly prevents path traversal outside the vault root, but a renderer can choose any root.

**Note on path validation in obsidian_service.rs:**  
`validated_vault_root()` calls `canonicalize()` and checks `is_dir()`. `safe_note_path()` ensures `resolved.starts_with(root)` and extension is `.md`. This prevents traversal, but not directory choice.

**Recommended fix:**  
Add capability gate to all read operations:
```rust
fn obsidian_read_note(app: AppHandle, request: ObsidianReadNoteRequest) -> ... {
    assert_addon_capabilities(&app, "addon.obsidian", &["filesystem"])?;
    read_obsidian_note(request)
}
```
Apply consistently to `obsidian_vault_status`, `obsidian_list_notes`, `obsidian_read_note`, `obsidian_vault_index`.

---

### S-06 — sideload_addon_manifest accepts arbitrary filesystem paths 🟡 MEDIUM
**File:** `src-tauri/src/lib.rs` lines 340–363  
**Severity:** MEDIUM  

**Issue:**  
```rust
fn sideload_addon_manifest(app: AppHandle, manifest_path: String) -> Result<Value, String> {
    let path = PathBuf::from(&manifest_path);
    if !path.exists() {
        return Err(format!("Manifest path does not exist: {manifest_path}"));
    }
    let raw = fs::read_to_string(&path)...
```

The renderer supplies `manifest_path` as a free-form string. `PathBuf::from()` accepts any path including `../../etc/passwd` or paths outside the application bundle. While `validate_manifest()` would reject non-manifest files (requires `id`, `name`, `version`, `runtimeType`, `description`, `surfaces`, `requestedCapabilities` fields), the raw file read happens before validation, and the function echoes the parsed manifest content back to the renderer.

**Attack scenario:**  
A compromised renderer loads a crafted manifest from a temporary or downloaded location. If the manifest passes `validate_manifest()`, it gets installed as an addon and can be used to request capability grants via the addon system.

**Recommended fixes:**  
1. Restrict `manifest_path` to user-accessible locations (e.g., require the path to be under a home directory or a designated addons staging area).
2. Consider using Tauri's file dialog (`tauri_plugin_dialog`) — already imported — to force user selection rather than accepting renderer-supplied paths programmatically.

---

### S-07 — Extension permissions are overly broad 🟡 MEDIUM
**File:** `browser-first/resonantos-side-panel-extension/manifest.json`  
**Severity:** MEDIUM  

**Issue:**  
The extension requests the following sensitive permissions:

| Permission | Risk |
|------------|------|
| `history` | Can read full browser history — significant user privacy capability |
| `audioCapture` | Can capture microphone audio — high-sensitivity |
| `clipboardRead` + `clipboardWrite` | Can read/write clipboard silently from service worker |
| `scripting` | Can inject scripts into any page |
| `host_permissions: http://*/*, https://*/*` | Access to all websites |

While these may be required for ResonantOS features, the current codebase should be audited to determine which permissions are actually used vs. pre-declared. Unnecessary permissions expand the attack surface if the extension is compromised.

**CSP (correct):**  
`"script-src 'self'; object-src 'self'; frame-src http://127.0.0.1:* http://localhost:*;"` — no `unsafe-eval` or `unsafe-inline`. Good.

**Recommended action:**  
1. Audit `history` usage — if only specific history patterns are needed, consider `chrome.history.search` with user confirmation rather than background polling.
2. Audit `audioCapture` — if only used for specific dictation features, gate the permission request on user action.
3. Document each permission with rationale in an internal permissions registry.

---

### S-08 — Background onMessage lacks sender origin validation 🟡 MEDIUM
**File:** `browser-first/resonantos-side-panel-extension/src/background.js` lines 131–196  
**Severity:** MEDIUM  

**Issue:**  
The message listener validates only `message.channel === "resonantos.browser_first"`. It does not check `sender.origin`, `sender.tab.url`, or `sender.id`:

```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.channel !== "resonantos.browser_first") {
    return false;
  }
  // No sender origin check
  if (message.type === "inline_assistant_request") {
    void bridgeRequest("/augmentor/inline", {
      method: "POST",
      body: message.body ?? {}   // ← message.body is fully renderer-controlled
    })...
  }
```

**Attack vector:**  
If a content script is compromised via XSS on any page (since content scripts run on all pages due to `"matches": ["http://*/*", "https://*/*"]`), a malicious page could inject code that sends messages with arbitrary `message.body` to trigger bridge requests, including to the `/augmentor/inline` endpoint.

**Note on MV3 `externally_connectable`:** The manifest has no `externally_connectable` stanza, so web pages cannot directly call `chrome.runtime.sendMessage`. The vector requires content script compromise, not just a web page.

**Recommended fixes:**  
1. Add sender validation:
   ```javascript
   if (sender.id !== chrome.runtime.id) return false;
   ```
2. For message types that call the bridge, validate `message.body` structure before forwarding (type-check required fields, reject unknown keys).

---

## Informational Findings

### S-09 — API keys stored as plaintext JSON 🟢 LOW
**File:** `src-tauri/src/host_state.rs` `write_provider_secrets()`  
**Location:** `{ResonantOS_User}/Secrets/provider-secrets.json`  

Provider API keys are stored as plaintext JSON. Standard for desktop apps (macOS Keychain integration not implemented). The `Secrets/` directory is created with default umask permissions (typically 700 on macOS).

**Recommendation:** Consider OS keychain integration via `tauri-plugin-keyring` for production releases. At minimum, document the plaintext storage and ensure the portable user state root is not synced to cloud services by default.

---

### S-10 — CSP connect-src allows all 127.0.0.1 ports 🟢 LOW
**File:** `src-tauri/tauri.conf.json`  
**CSP:** `connect-src 'self' http://127.0.0.1:* ...`

The wildcard `http://127.0.0.1:*` allows the renderer to make fetch requests to any local port. This is necessary for the bridge server and local Ollama, but also means a compromised renderer could probe all local services.

**Context:** The bridge server uses token authentication, so an unauthenticated renderer fetch to the bridge port returns 401. However, other local services on the machine are probe-able.

**Recommendation:** If the bridge port is stable (configured), consider restricting to specific ports in production builds.

---

### S-11 — Codex --full-auto --skip-git-repo-check scope 🟢 LOW
**File:** `src-tauri/src/provider_service.rs` lines 188–202  

`execute_codex_subscription_chat_with_usage` launches Codex with:
- `--full-auto` — automatic mode (no per-action human confirmation)
- `--skip-git-repo-check` — skips requiring a git repo context

Combined with the output file written to `$TMPDIR`, Codex has broad filesystem access during execution. This is by design for the Codex provider integration but should be documented.

**Observation:** The output path `codex_output_path()` is generated server-side (process ID + nanosecond timestamp), not renderer-controlled. No path injection possible.

---

## Verification Summary — Claimed Security Fixes

| Commit | Fix | Code Verified | Correct? |
|--------|-----|---------------|----------|
| `ccd2ff1` | `save_runtime_state` whitelist filter | ✅ Yes — lib.rs lines 192–239 | ✅ Yes |
| `6a4d3d5` | Bridge capability token delivery | ✅ Yes — bridge-server.mjs + bridge-client.js | ✅ Yes |
| `93d81fe` | Codex sandbox bypass removal | ✅ Yes — provider_service.rs line 191 | ✅ Yes |
| `0d53876` | CEF sandbox re-enable | ✅ Yes — native_host C++ files + CI triggers | ✅ Yes |

All four claimed security fixes are correctly implemented. No bypass vectors detected for any of the four patches.

---

## Architecture Observations (Not Vulnerabilities)

1. **Bridge trust model:** Holding the bridge token grants access to all capability tokens via `/api/capability-tokens`. The bridge token is effectively a root key for the extension. This is acceptable (the extension must be trusted) but should be documented in the threat model.

2. **Renderer→provider routing of SSRF-adjacent data:** `api_base_url` and `runtime_node_endpoint` are renderer-supplied and used in HTTP client requests. By design for LAN runtime discovery, but worth noting: a compromised renderer can direct HTTP traffic to any reachable host/port on the LAN.

3. **`execute_remote_probe` hardcoded hosts (`GX10_HOST`, `NAS_HOST`):** Remote SSH commands are tightly gated (allowlist of `node_id` values, hardcoded commands). No injection vectors found. The SSH commands use separate args (no shell expansion). Correct.

4. **`switch_gx10_llama_model` format! string:** The format string uses `model.path`, `model.port`, `model.log_path`, `LLAMA_SERVER_PATH` — all from a static `GX10_MODELS` array lookup keyed on renderer-provided `model_id`. No user input reaches the format string. Correct.

---

## Priority Action List

| Priority | Finding | Action |
|----------|---------|--------|
| P1 | S-05 | Add capability gates to 4 obsidian read commands |
| P1 | S-06 | Restrict sideload_addon_manifest to user-chosen paths (use dialog) |
| P2 | S-08 | Add `sender.id` check + body schema validation in background.js |
| P3 | S-07 | Audit and minimize extension permissions before store submission |
| P4 | S-09 | Document plaintext secret storage; plan keychain migration |

---

*Report complete. All findings include line numbers referencing the current HEAD commit (5a535b1).*
