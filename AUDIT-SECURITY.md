# ResonantOS 2.0.0-alpha — Security Audit Report

**Date:** 2026-06-08  
**Auditor:** Analog 6 (Subagent — Security Audit)  
**Scope:** `~/2.0.0-alpha` — Tauri + React + Chromium browser-first desktop app, pre-community-alpha  
**Prior report cross-referenced:** `SECURITY-RED-TEAM-REPORT.md` (2026-06-06)  
**npm audit:** 1 critical vulnerability

---

## Remediation Status vs Prior Report

**All P0 and P1 findings from the 2026-06-06 Red Team Report remain UNRESOLVED.**

| Finding | Prior Severity | Status |
|---------|---------------|--------|
| `bridge-config.generated.js` — all 13 capability tokens + main token on disk | P0 | 🔴 **OPEN** |
| vitest CVE GHSA-5xrq-8626-4rwp (RCE) | P0 | 🔴 **OPEN** |
| `inline_assistant_request` body passthrough without sanitization | P1 | 🟡 **OPEN** |
| Provider credentials in `window.localStorage` | P1 | 🟡 **OPEN** |
| Missing `connect-src` in extension CSP | P1 | 🟡 **OPEN** |

Zero remediation has been applied since the prior audit. **This release is not safe for community alpha distribution in its current state.**

---

## Audit Checklist Results

### 1. Credential Exposure — API Keys / Tokens Accessible from Content Scripts

**Status: ⚠️ Partially Exposed (P0 + P1)**

**P0 — `bridge-config.generated.js` on disk:**  
File confirmed present and current:
```
-rw-------  1 dr.tom  staff  1108  Jun  6 02:39  bridge-config.generated.js
```
Permissions are 0o600 (owner-read-only), but any process running as the current user (`dr.tom`) — including malicious npm postinstall hooks, compromised VS Code extensions, or local scripts — can read it and obtain all session credentials:

- `bridgeToken` — master bridge token (all endpoints)
- 13 capability tokens: `provider-credential-write`, `provider-routing-write`, `memory-settings-write`, `memory-source-browse`, `memory-source-scan`, `memory-source-manage`, `memory-source-move`, `memory-source-review`, `memory-source-intake`, `memory-source-file-intake`, `diagnostics-report-export`, `browser-download-action`, `addon-execution-settings-write`

With these tokens an attacker can: overwrite provider API keys, inject files into memory, modify memory settings, trigger diagnostics exports, and manage add-on execution — all without any further exploitation.

**Token origin in `run-browser-first.mjs`:** Tokens are generated fresh per launch via `createBridgeToken()` (randomBytes(32).toString("base64url")) — good. The problem is that all 13 are written to a static disk path immediately after generation.

**P1 — `window.localStorage` for provider API keys:**  
`src/core/runtime.ts` lines 227 and 235 confirm:
```typescript
window.localStorage.setItem(`${STORAGE_KEY}.secret.${providerId}`, apiKey);
window.localStorage.setItem(`${STORAGE_KEY}.secret.addon.telegram-channel.bot-token`, botToken);
```
These persist API keys across browser restarts in cleartext. Accessible to any JS executing in the extension's origin (XSS, compromised extension update, or DevTools).

---

### 2. Bridge Server — Binding, Auth, Rate Limiting

**Status: ✅ Localhost binding | ✅ Auth | ⚠️ No rate limiting**

**Binding (CONFIRMED SAFE):**  
`bridge-server.mjs` line 164:
```javascript
server.listen(port, "127.0.0.1");
```
Strict loopback binding. No remote network access possible.

**Auth (CONFIRMED SAFE):**  
- `isAuthorizedBridgeRequest()` called for every non-OPTIONS request
- Uses `constantTimeEqual()` wrapping `timingSafeEqual()` — timing-safe, no oracle
- Capability-gated routes additionally check `isAuthorizedCapabilityRequest()` — 401 / 403 responses
- CORS `Access-Control-Allow-Origin` pinned to `chrome-extension://<extensionId>`

**Body size limit:** 1MB hard-reject on `data` event — present.

**Rate limiting: ABSENT.**  
No per-IP or per-time-window rate limiting exists in `bridge-server.mjs`. Any local process that has the bridge token can flood the server with requests without throttling. Given the server handles AI provider calls and file-system operations, a burst attack could cause:
- Runaway AI API spend (provider-credential-write routes)
- Memory source corruption via rapid repeated file-intake calls
- Process exhaustion (no concurrent request limit)

**Severity:** 🔵 P2 — requires token compromise first; but token exposure is already P0, so this is a realistic second-stage risk.

---

### 3. Extension Privileges — `host_permissions` Breadth

**Status: ⚠️ Overly Broad (P1)**

`manifest.json`:
```json
"host_permissions": ["http://*/*", "https://*/*"]
```

This grants the extension permission to inject content scripts into and make fetch requests to **every HTTP/HTTPS page the user visits**. Combined with the missing `connect-src` CSP directive, any XSS in an extension page can exfiltrate data to arbitrary external URLs.

**Content scripts (`content_scripts.matches`):** Also set to `["http://*/*", "https://*/*", all_frames: true]` — the extension's content scripts run on every page in every frame.

**Practical risk:** The content script implementation is well-disciplined (`isHardRestrictedElement()`, message channel validation), but the blast radius of any future content-script vulnerability is maximized by these broad permissions.

**Recommendation:** For community alpha, restrict `host_permissions` to the minimal set of domains users actually need Augmentor features on. If universal coverage is required, document it explicitly in the extension's store listing with rationale.

---

### 4. CSP Enforcement

**Status: ⚠️ Incomplete (P1)**

Current `manifest.json` CSP:
```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'; frame-src http://127.0.0.1:* http://localhost:*;"
}
```

**Missing: `connect-src`.**  
Without an explicit `connect-src` directive, outgoing `fetch()` and `XMLHttpRequest` from extension pages are unrestricted by CSP (subject only to `host_permissions`). Given `host_permissions: ["http://*/*", "https://*/*"]`, any XSS in an extension page can call out to any URL.

**Fix:**
```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'; frame-src http://127.0.0.1:* http://localhost:*; connect-src 'self' http://127.0.0.1:*;"
}
```

If extension pages need to call external AI provider APIs directly (not through the bridge), add only those specific origins instead of a wildcard.

---

### 5. Supply Chain — npm audit

**Status: 🔴 1 Critical CVE (UNPATCHED)**

```
vitest  <4.1.0
Severity: critical
When Vitest UI server is listening, arbitrary file can be read and executed
https://github.com/advisories/GHSA-5xrq-8626-4rwp
fix available via `npm audit fix --force`
Will install vitest@4.1.8 (breaking change)
```

Currently pinned at `^3.2.4`. **Not patched since the prior audit.**

This CVE enables arbitrary file read and RCE when `vitest --ui` is running during development. In a CI/CD pipeline or a developer workstation, this is a realistic attack vector.

**Immediate action:**
```bash
npm install vitest@4.1.8 --save-dev
npm test  # verify no regressions against 296-test baseline
```

All other dependencies: **0 high/moderate/low vulnerabilities** — only the vitest critical.

---

### 6. Hardcoded Secrets Scan

**Status: ✅ Clean**

Broad grep across `src/` and `browser-first/` for patterns: `sk-`, `gsk_`, `rpa_`, `AKIA`, `xai-`, `ghp_`, `password =`, `api_key =` — **no hardcoded secrets found** in committed source files.

`bridge-config.generated.js` is confirmed in `.gitignore` and will not be committed.

`src/core/compute-fabric.ts` contains a SECRET_KEY_PATTERN regex — this is an **input validator** (detects secrets in compute job inputs), not a secret leak. Correct usage.

---

### 7. Wallet / Signing Boundary

**Status: ✅ CONFIRMED SAFE**

**Content script hard blocks (`content.js`):**  
`isHardRestrictedElement()` and `isSubmitLikeElement()` fire in the content script **before** any click/type message is sent up the chain. Wallet, payment, credential, and submit elements return `deniedToAutomation: true`. This is enforced at the source — not just a UI gate.

**Delegation layer (`src/core/delegation.ts`):**  
```typescript
const RISKY_APPROVAL_REASONS = new Set(["destructive", "public-action", "financial", "identity-sensitive", "broad-filesystem"]);
// line 80:
if (packet.approvalReasons.some((reason) => RISKY_APPROVAL_REASONS.has(reason)) && !packet.humanApprovalRequired) {
  issues.push(issue("error", "risky-task-without-approval", "Risky delegation requires explicit human approval."));
}
```

"financial" is in the risky set. Delegation packets flagged as financial require `humanApprovalRequired: true` or they fail validation with an error. External sends (`public-action`, `identity-sensitive`) also require explicit human approval — enforced at the packet level, not just in prompts.

**No code path found** that can sign, transact, or perform a financial action without surfacing a human approval gate.

---

### 8. `bridge-config.generated.js` — P0 Deep Dive

**Status: 🔴 UNRESOLVED — Release Blocker**

This is the highest-priority finding. Full token inventory on disk means the attack complexity for full bridge compromise is exactly one file read.

**Current flow:**
```
run-browser-first.mjs:
  createBridgeToken() × 14   → all tokens in memory
  startBridgeServerWithFallback()
  writeBridgeConfig() → bridge-config.generated.js  (ALL 14 tokens written to disk)
background.js:
  import "./bridge-config.generated.js"  → all tokens available in extension memory
```

**Attack scenario (no code execution needed):**
1. Attacker installs a malicious npm package with a `postinstall` hook (supply chain attack, or a typosquatted package)
2. Hook reads `~/2.0.0-alpha/browser-first/resonantos-side-panel-extension/src/bridge-config.generated.js`
3. Attacker now holds all 14 tokens
4. While the ResonantOS host process is running, attacker calls `/provider/credentials`, `/memory/source/file-intake`, etc. via localhost

**Mitigations that help but don't solve it:**
- `0o600` file permissions: prevents other OS users, not same-user processes
- Tokens regenerate per session: limits window of exposure to current session only

**Recommended fix:**
Split token delivery into two tiers:

```
Tier 1 — Disk (bridge-config.generated.js, as today):
  - bridgeUrl
  - bridgeToken (main — needed for extension startup)

Tier 2 — In-memory only (never written to disk):
  - All 13 capability tokens
  - Delivered via a dedicated token-exchange endpoint:
      GET /capability-tokens
      Auth: bridgeToken header required
      Returns: { capabilityTokens: { ... } }
      Called once at extension service-worker startup
```

This means the file on disk only yields the main bridge token. The capability tokens (the dangerous ones) are only in process memory and must be fetched over the already-authenticated bridge connection.

---

## Summary — Severity Matrix

| # | Finding | Severity | Status | Blocks Release? |
|---|---------|----------|--------|----------------|
| 1 | All 13 capability tokens + main token in `bridge-config.generated.js` | 🔴 P0 | OPEN | **YES** |
| 2 | vitest CVE GHSA-5xrq-8626-4rwp (RCE during dev) | 🔴 P0 | OPEN | YES (dev safety) |
| 3 | `inline_assistant_request` body forwarded without sanitization | 🟡 P1 | OPEN | Recommended |
| 4 | Provider API keys + Telegram token in `window.localStorage` | 🟡 P1 | OPEN | Recommended |
| 5 | Missing `connect-src` in extension CSP | 🟡 P1 | OPEN | Recommended |
| 6 | No rate limiting on bridge server | 🔵 P2 | OPEN | No |
| 7 | `host_permissions` overly broad | 🔵 P2 | OPEN | No |
| 8 | `resonant-context-snapshot` message unhandled (no-op) | ℹ️ Info | OPEN | No |
| — | Bridge localhost binding | ✅ Safe | — | — |
| — | Bridge token auth (timingSafeEqual) | ✅ Safe | — | — |
| — | Path traversal protection (3-layer) | ✅ Safe | — | — |
| — | Hardcoded secrets in source | ✅ Clean | — | — |
| — | Wallet/signing hard blocks | ✅ Safe | — | — |
| — | Delegation approval gates (financial, destructive) | ✅ Safe | — | — |

---

## Recommended Pre-Release Checklist

```
[ ] npm install vitest@4.1.8 --save-dev && npm test  (296 tests must pass)
[ ] Split bridge-config.generated.js: main token only on disk; capability tokens via in-memory exchange endpoint
[ ] Add connect-src directive to manifest.json CSP
[ ] Migrate localStorage secret writes (runtime.ts:227,235) to chrome.storage.session
[ ] Add inline_assistant_request body sanitizer in background.js
[ ] Review host_permissions breadth for community alpha scope
```

**Bottom line:** The architecture is sound — localhost binding, timing-safe auth, path traversal defense, and approval gates are all real mitigations. The two blockers are operational (all tokens on disk, unpatched CVE), not architectural. Both are fixable in hours, not days.

---

*Report generated by Analog 6 Security Audit Subagent — 2026-06-08*  
*Prior report: `SECURITY-RED-TEAM-REPORT.md` (2026-06-06)*
