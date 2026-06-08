# ResonantOS 2.0.0-alpha — Red Team Security Audit Report

**Date:** 2026-06-06  
**Auditor:** Analog 6 (Subagent — Red Team Mode)  
**Scope:** `~/2.0.0-alpha` — full codebase, browser-first host, extension, core modules  
**Test baseline:** 296 passing tests (286 original + 10 new SDK tests)

---

## Executive Summary

The architecture is **well-structured with genuine security intent**. The bridge token model, path traversal guards, and capability-scoped tokens are real mitigations, not theater. The codebase shows consistent security-awareness (secret detection patterns, approval gates, hard-restricted elements).

However, two issues require immediate attention:

- **P0 — `bridge-config.generated.js` contains all live session tokens on disk**, readable by any process running as the current user. An attacker with arbitrary file read (not even code execution) can recover the main bridge token plus all 13 capability tokens.
- **P0 — vitest critical CVE** (GHSA-5xrq-8626-4rwp): arbitrary file read and remote code execution when the Vitest UI server is listening. Current version is `< 4.1.0`.

Three P1 issues are present that could be exploited under specific conditions, and several informational findings round out the report.

---

## Findings

---

### 🔴 P0-1 — All Live Bridge Tokens Written to Disk in Plaintext

**File:** `browser-first/resonantos-side-panel-extension/src/bridge-config.generated.js` (1,108 bytes, mode 0o600)

**Current content (redacted for report):**
```
globalThis.__RESONANTOS_BRIDGE_CONFIG__ = Object.freeze({
  "bridgeUrl": "http://127.0.0.1:47773",
  "bridgeToken": "<32-byte base64url — LIVE>",
  "bridgeCapabilityTokens": {
    "provider-credential-write": "<token>",
    "provider-routing-write": "<token>",
    "memory-settings-write": "<token>",
    "memory-source-browse": "<token>",
    "memory-source-scan": "<token>",
    "memory-source-manage": "<token>",
    "memory-source-move": "<token>",
    "memory-source-review": "<token>",
    "memory-source-intake": "<token>",
    "memory-source-file-intake": "<token>",
    "diagnostics-report-export": "<token>",
    "browser-download-action": "<token>",
    "addon-execution-settings-write": "<token>"
  }
});
```

**Origin:** `bridge-server.mjs` line 79 (`writeBridgeConfig()`), which is correct to write at mode 0o600. The file IS gitignored (`browser-first/resonantos-side-panel-extension/src/bridge-config.generated.js` found in `.gitignore`).

**Attack:** Any process running as the current user (`dr.tom`) — malicious script, npm postinstall hook, compromised dependency — can `readFileSync` this file and obtain the main bridge token plus all 13 capability tokens. With the main bridge token, the attacker can call every bridge endpoint including:
- `POST /memory/source/action` (modify/delete memory sources)
- `POST /memory/source/file-intake` (inject arbitrary files into memory)
- `POST /memory/settings` (change memory configuration)
- `POST /provider/credentials` (overwrite provider API keys)
- All archive and agent-control routes

The file permission (0o600) prevents cross-user reads on multi-user systems but does not help against same-user processes.

**Also note:** `bridge-config.generated.js` is imported at the top of `background.js` (`import "./bridge-config.generated.js";`), making all tokens available in-memory within the extension's background service worker.

**Recommendation:**
1. Do NOT write all capability tokens to a file. The extension only needs the main bridge token and the capability tokens for features it actively uses.
2. Consider a token-exchange flow: the extension holds a short-lived ephemeral token and exchanges it for capability tokens as needed, with the exchange request being locally bound.
3. At minimum, consider splitting the config into two files: `bridge-config.generated.js` (main token only) and a runtime-only capability store that is never written to disk.

**Severity:** 🔴 P0 — same-user file read = full bridge access

---

### 🔴 P0-2 — Vitest Critical CVE: Arbitrary File Read + RCE

**File:** `package.json` (devDependency: `vitest`)  
**npm audit output:**
```
vitest  <4.1.0
Severity: critical
When Vitest UI server is listening, arbitrary file can be read and executed
https://github.com/advisories/GHSA-5xrq-8626-4rwp
```

If `vitest --ui` is running during development, any process that can connect to the UI server port (default 127.0.0.1, but can vary) can read arbitrary files from the host and trigger code execution.

**Recommendation:** `npm audit fix --force` (upgrades to vitest 4.1.8 — breaking change, verify test compatibility). Do not run `vitest --ui` in development until patched.

**Severity:** 🔴 P0 — CVE with RCE vector during development

---

### 🟡 P1-1 — `inline_assistant_request` Forwarded Without Body Sanitization

**File:** `browser-first/resonantos-side-panel-extension/src/background.js` lines 137–149

```javascript
if (message.type === "inline_assistant_request") {
  void bridgeRequest("/augmentor/inline", {
    method: "POST",
    body: message.body ?? {}   // ← raw passthrough, no schema validation
  })
```

`message.body` is passed directly to the bridge server without any schema check, type validation, or field filtering. A malicious content script (e.g., loaded on a compromised site) could craft a body that:
- Contains fields the backend treats as special (`__proto__`, nested objects)
- Includes extremely large payloads (bridge limits at 1MB — line 42 of `bridge-server.mjs` — but no limit is applied in the extension layer before the request is made)

**Mitigating factor:** Content scripts cannot call `chrome.runtime.sendMessage` to the background directly from the web page — only extension code can. However, if the content script has a `window.postMessage` relay (it doesn't currently), this surface would open.

**Recommendation:** Add a `sanitizeInlineRequest(body)` function in `background.js` that whitelists known fields (`action`, `selection`, `prompt`, `pageContext`) with type and length enforcement before forwarding. Example:
```javascript
function sanitizeInlineRequest(body) {
  return {
    action: String(body?.action ?? "").slice(0, 64),
    prompt: String(body?.prompt ?? "").slice(0, 2000),
    selection: String(body?.selection ?? "").slice(0, 8000),
    pageContext: String(body?.pageContext ?? "").slice(0, 3000),
  };
}
```

**Severity:** 🟡 P1 — no immediate exploit path, but defense-in-depth gap at a message boundary

---

### 🟡 P1-2 — Provider Credentials Stored in `window.localStorage` (Browser Fallback Path)

**File:** `src/core/runtime.ts` lines 227, 235

```typescript
// line 227 — when NOT in Tauri/Electron:
window.localStorage.setItem(`${STORAGE_KEY}.secret.${providerId}`, apiKey);

// line 235 — Telegram bot token fallback:
window.localStorage.setItem(`${STORAGE_KEY}.secret.addon.telegram-channel.bot-token`, botToken);
```

When the Tauri/Electron shell is not present (pure browser/extension context), provider API keys and the Telegram bot token are persisted to `window.localStorage` of the extension's main-workspace page. localStorage in Chrome extensions is:
- Scoped to the extension origin (not readable by web pages — good)
- Accessible to all scripts running in the extension origin (including injected content from `chrome.scripting.executeScript`)
- Persisted across browser restarts (API key survives until explicitly cleared)
- Not encrypted by the browser; visible in Chrome DevTools > Application > Storage for any user with access to the Chrome profile

**Attack surface:** If an attacker can execute arbitrary JS in the extension's main-workspace origin (via an XSS in the extension pages or via a compromised extension update), all stored provider API keys are immediately available via `localStorage.getItem()`.

**Recommendation:**
1. Prefer `chrome.storage.session` (in-memory, cleared on browser close) for the browser-extension path instead of `localStorage`.
2. For persistent storage, use `chrome.storage.local` with encryption at rest, or clearly document that the browser path is dev/test only and does not persist secrets in production.
3. Never store raw API key strings in localStorage for production deployments.

**Severity:** 🟡 P1 — requires XSS in extension pages or DevTools access, but impact is full provider key exposure

---

### 🟡 P1-3 — Extension CSP Missing `connect-src` Directive

**File:** `browser-first/resonantos-side-panel-extension/manifest.json` lines 23–25

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'; frame-src http://127.0.0.1:* http://localhost:*;"
}
```

`connect-src` is not specified. Per the Chrome extension CSP specification, when `connect-src` is absent, the effective policy falls back to the default-src (which is not set here either). In Chrome MV3 extensions, the default behavior permits outbound `fetch()` and `XMLHttpRequest` to all origins from extension pages, subject only to `host_permissions`.

Since the extension has `host_permissions: ["http://*/*", "https://*/*"]`, any XSS in an extension page can exfiltrate data to arbitrary external URLs via `fetch()`.

**Recommendation:** Add `connect-src 'self' http://127.0.0.1:*;` to the CSP to restrict outgoing connections to the bridge server only. External AI provider calls should originate from the host process (bridge server), not from extension pages directly.

**Severity:** 🟡 P1 — defense-in-depth: limits blast radius of an extension-page XSS

---

### 🟢 Confirmed-Safe: Bridge Server Network Binding

**File:** `browser-first/host/bridge-server.mjs` line 164

```javascript
server.listen(port, "127.0.0.1");  // ← explicit loopback bind
```

The bridge server **only listens on 127.0.0.1**. Network-level access from remote hosts is not possible. Port is dynamic (falls back to OS-assigned). CORS origin is pinned to `chrome-extension://<extensionId>` — the ACAO header correctly restricts browser-initiated cross-origin requests.

**Auth:** Bridge token uses `timingSafeEqual()` (line 16–19) — timing-safe comparison, no timing oracle.

---

### 🟢 Confirmed-Safe: Path Traversal Protection

**File:** `browser-first/host/memory-source-paths.mjs`

```javascript
// normalizeSourceRelativeFile — lines 22–35
// Rejects: null bytes, absolute paths, Windows drive letters, ".." components
// resolveSourceRelativeFile — lines 11–17: double-check after path.resolve()
// assertResolvedSourceFileInsideSource — lines 54–63: realpath() to follow symlinks
```

Three-layer path traversal defense: normalize → resolve → realpath. Symlinks are resolved before the inside-source check, defeating symlink traversal. This is well-implemented.

---

### 🟢 Confirmed-Safe: Wallet / Payment Hard Blocks

**File:** `browser-first/resonantos-side-panel-extension/src/content.js` (within `clickElement` and `typeIntoPage`)

`isHardRestrictedElement()` and `isSubmitLikeElement()` are checked before any click/type action. Wallet, payment, credential, and submit actions are hard-blocked with `deniedToAutomation: true`. The block is enforced in the content script before any message is sent up — not just a UI gate.

---

### 🟢 Confirmed-Safe: Hardcoded Secrets Scan

Grep for `sk-`, `gsk_`, `rpa_`, `AKIA`, `xai-`, `ghp_` across `src/` and `browser-first/` (excluding node_modules and test files): **no hardcoded secrets found** in source files.

The `compute-fabric.ts` line 128 contains a detection pattern for secrets in compute jobs (used as an input validator, not a leak):
```typescript
const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|credential|private[_-]?key|bearer|ssh[_-]?key)/i;
```

---

### 🟢 Confirmed-Safe: Bridge Token Auth on All Endpoints

**File:** `bridge-server.mjs` — `isAuthorizedBridgeRequest()` is called for every non-OPTIONS request (line 118 of the compiled route). Unauthenticated requests receive HTTP 401. Capability-gated routes additionally check the capability token (returning HTTP 403 for mismatch). The test `runBridgeAuthSelfTest()` verifies this behavior deterministically.

---

### 🟢 Confirmed-Safe: Content Script Message Channel Validation

**File:** `browser-first/resonantos-side-panel-extension/src/content.js` line 931

```javascript
if (!message || message.channel !== "resonantos.browser_first.content") {
  return false;
}
```

Messages not addressed to the content-script channel are rejected. The content script does not expose a `window.postMessage` relay, so web pages cannot inject commands into the extension pipeline.

---

### 🟡 Informational: `resonant-context-snapshot` Message Unhandled

**File:** `browser-first/resonantos-side-panel-extension/src/content.js` line 43 (our new SDK init code) and `background.js` (no handler found)

The SDK init block sends `{ type: 'resonant-context-snapshot', payload: snapshot }` to the background, but `background.js` has no handler for this message type. The message is silently dropped (Chrome will call `sendResponse` with `undefined`). This is not a security issue, but means the feature is a no-op until a handler is added.

**Recommendation:** Add a handler in `background.js` (or note in the SDK init comment that it is a future extension point).

---

## Victor's Question: Can Source-Code Knowledge Enable Config/User-Data Manipulation?

**Yes, under specific conditions.**

An adversary with:
1. **Source code knowledge** (knows the file path of `bridge-config.generated.js` and its format)
2. **Local filesystem read access as the current user** (trivially achieved by any code running as `dr.tom` — a malicious `npm postinstall`, a local script, a malicious VS Code extension)

…can recover all live bridge tokens and make authenticated calls to ANY bridge endpoint while the host process is running.

With those tokens, the adversary can:
- Read all memory sources (`/memory/source/browse`)
- Inject arbitrary files into memory (`/memory/source/file-intake`)
- Modify memory source settings (`/memory/settings`)
- Overwrite provider credentials (`/provider/credential-write`)
- Export diagnostics (`/diagnostics-report-export`)
- Manage add-on execution settings (`/addon-execution-settings-write`)

The only structural barrier is that the host process must be running (tokens are per-session). At shutdown, the tokens become invalid.

**Root cause:** All tokens are co-located in a single file, readable by the operating system user.

---

## Priority Recommendations

| Priority | Finding | Action |
|----------|---------|--------|
| **P0** | vitest CVE GHSA-5xrq-8626-4rwp | `npm install vitest@4.1.8` — verify tests still pass |
| **P0** | All capability tokens in bridge-config.generated.js | Split file; extension receives only the main bridge token; capability tokens issued on-demand via a token-exchange endpoint |
| **P1** | `inline_assistant_request` body passthrough | Add field-level sanitizer before forwarding to bridge |
| **P1** | Provider credentials in `localStorage` | Migrate browser fallback to `chrome.storage.session` or document as dev-only |
| **P1** | Missing `connect-src` in extension CSP | Add `connect-src 'self' http://127.0.0.1:*;` to manifest.json CSP |
| **P2** | `resonant-context-snapshot` unhandled | Add background.js handler or remove the sendMessage call |

---

## Test Verification

All 296 tests pass post-audit (286 original + 10 new SDK tests):

```
Test Files  37 passed (37)
     Tests  296 passed (296)
  Duration  ~15s
```

No regressions introduced by Part 1 (SDK installation) changes.

---

*Report generated by Analog 6 Red Team Subagent — 2026-06-06 03:28 EDT*
