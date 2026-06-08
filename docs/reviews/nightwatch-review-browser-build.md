# Nightwatch Review — Browser-First & Build Review
## ResonantOS 2.0.0-alpha
**Reviewer:** Nightwatch subagent  
**Date:** 2026-06-08  
**Focus:** Browser-first extension completeness, build pipeline, release readiness

---

## EXECUTIVE SUMMARY

The browser-first extension is a mature, feature-complete browser extension targeting Chrome/Chromium Manifest V3. The core security model is solid and the permission structure is well-justified. The CI/CD pipeline is lean but functional. Three areas need attention before a clean release: (1) hardcoded model options in HTML, (2) missing browser-first artifact in CI output, and (3) a large chunk size warning in the Tauri/Vite build.

---

## 1. BROWSER-FIRST EXTENSION REVIEW

### 1.1 manifest.json — Severity: LOW / MEDIUM

**File:** `browser-first/resonantos-side-panel-extension/manifest.json`

**✅ Strengths:**
- Correct MV3 structure (`manifest_version: 3`)
- `minimum_chrome_version: "116"` — appropriate; side panel API stable since 114
- CSP is explicit: `script-src 'self'`, `frame-src http://127.0.0.1:* http://localhost:*` — correct for bridge frames
- `"type": "module"` on service worker — correct MV3 pattern

**⚠️ Issues:**

**MEDIUM — Permission `audioCapture` is overly broad (line 15):**
```json
"audioCapture"
```
`audioCapture` is a sensitive permission that triggers a Chrome "record audio" warning on install. If it's only used for voice dictation in the side panel, it should be requested dynamically using `getUserMedia()` rather than declared in the manifest. This will reduce install friction for users who don't use voice.

**LOW — `history` permission is declared (line 19) but `/history` command in COMET_PARITY_BACKLOG.md already documents its use:**
```json
"history"
```
Permission is appropriate given the `/history` command. Not a bug, but should be called out in permissions documentation.

**LOW — `key` field in manifest exposes the extension ID seed (lines 4–7):**
```json
"key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQE..."
```
This is intentional for stable extension ID across dev installs, but this public key should be rotated before production distribution since it pins the extension ID. Anyone who knows this key can predict the extension ID and potentially craft targeted attacks.

**LOW — Missing `web_accessible_resources` entry for `resonant-context.js`:**
The content script loads `window._ResonantContext` / `window.ResonantContext` from a lib file, but there's no `web_accessible_resources` declaration. This works because content scripts are injected directly but would fail if any page tried to load these as web-accessible resources.

---

### 1.2 background.js — Severity: LOW

**File:** `browser-first/resonantos-side-panel-extension/src/background.js`

**✅ Strengths:**
- Clear `APPROVAL_REQUIRED_ACTIONS` Set with hardcoded sensitive action names
- `syncSidePanelForTab` always enables the side panel — correct intent
- `handoffToResonantSidePanel` correctly enables panel before navigation to avoid losing sender page
- `initCapabilityTokens()` fetched on install/startup — good security pattern
- Proper `return true` in all async `onMessage` branches

**⚠️ Issues:**

**LOW — Missing `handoffToResonantSidePanel` error propagation on `tabs.update` failure (lines 64–67):**
```js
if (targetUrl) {
  await chrome.tabs.update(tab.id, { url: targetUrl }).catch(() => undefined);
}
```
Silently swallowing the tab update error means the handoff result could say `navigated: true` but the navigation failed. Should return the error in the result payload.

**LOW — `openResonantSidePanel` returns `false` silently for missing windowId without any event trace (line 36):**
```js
if (typeof chrome.sidePanel?.open !== "function" || windowId === undefined) {
  return false;
}
```
In MV3 service workers, `chrome.sidePanel.open` requires a recent user gesture. Silent return-false means activation failures are invisible. Consider logging to the extension console.

**LOW — No service worker keepalive for long async tasks:**
The `onMessage` handler for `browser_control_handoff` awaits `handoffToResonantSidePanel` which itself does multiple async operations. MV3 service workers can be killed mid-flight. Consider using `chrome.alarms` or explicit keepalive pings for tasks expected to take >30s.

---

### 1.3 content.js — Severity: LOW / MEDIUM

**File:** `browser-first/resonantos-side-panel-extension/src/content.js`

**✅ Strengths:**
- IIFE guard: `if (window.__resonantOSContentScriptLoaded) return;` — prevents double injection
- `isResonantosInternalElement()` correctly excludes overlay/inline UI from snapshots and field targeting
- Comprehensive ambiguous-target detection with `ambiguousTargetResponse()` returning candidate refs
- `isHardRestrictedElement` regex covers wallet/payment/login keywords
- `classifyEditableField` uses field-safety classification before any type action
- Shadow DOM traversal via `querySelectorAllDeep` with limit=600 — performance-conscious

**⚠️ Issues:**

**MEDIUM — `visiblePageText()` exposes up to 12,000 chars of page content including all shadow DOM text (lines ~150–156):**
```js
const visiblePageText = () => [
  document.body?.innerText ?? ...,
  ...openShadowHosts().map((host) => host.shadowRoot?.innerText ?? ...)
].filter(Boolean).join("\n").slice(0, 12000);
```
This includes text from shadow roots of password managers, autofill prompts, and embedded payment iframes. On e-commerce pages, this could capture partially visible payment field labels or autofill suggestions. The `isResonantosInternalElement` check only applies to controls/fields, not to `visiblePageText`. The shadow DOM text aggregation should also exclude elements classified as sensitive fields.

**MEDIUM — `localInlineResult` fallback exposes selected text verbatim in fact-check and translate actions (lines ~487–493):**
```js
if (action === "fact-check") return `Fact-check this claim with primary sources before relying on it:\n${clipped}`;
if (action === "translate") return `Translation requires the configured model. Selected text:\n${clipped}`;
```
If the selected text contains credentials or sensitive data and the bridge is unavailable, these fallbacks echo back the raw text into the result div which is visible DOM. Minor risk but worth noting.

**LOW — `querySelectorAllDeep` shadow DOM traversal limit is 600 elements total but uses `*` for shadow host discovery (line ~95):**
```js
let allElements = [];
try {
  allElements = Array.from(scope.querySelectorAll("*"));
} catch {
  return;
}
```
Querying `querySelectorAll("*")` on large pages inside shadow roots can be expensive. On pages with complex shadow DOM (e.g. web components-heavy apps), this will pause the page thread.

**LOW — `setNativeValue` uses native setter descriptor lookup on each call (lines ~402–407):**
```js
const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
setter?.call(element, value);
```
No caching of the descriptor — this is called on every `typeIntoPage` invocation. Cache the setter reference.

**LOW — `positionInlineButtonSync` (line ~530) is called on `mouseup` and `select` events without the permission check that `positionInlineButton` performs:**
```js
const positionInlineButton = () => {
  void currentSitePermission().then((mode) => {
    if (mode === "blocked") { ... return; }
    ...
  });
};

const positionInlineButtonSync = () => {
  // No permission check here
  const details = currentSelectionDetails();
  ...
};
```
`positionInlineButtonSync` is defined but actually only `positionInlineButton` (the async variant) is called from event listeners. The sync variant is effectively dead code unless used elsewhere. Verify this is intentional.

---

### 1.4 side-panel.html — Severity: LOW

**File:** `browser-first/resonantos-side-panel-extension/src/side-panel.html`

**✅ Strengths:**
- Proper `aria-live="polite"` on transcript and job monitor
- Semantic HTML with proper `<form>` and `aria-label` attributes
- `<section>` hierarchy is logically structured

**⚠️ Issues:**

**LOW — Hardcoded model options in `<select id="model-select">` (lines in side-panel.html):**
```html
<option value="MiniMax-M3">MiniMax M3</option>
<option value="gpt-5.5">GPT 5.5</option>
<option value="gpt-5.4-mini">GPT 5.4 Mini</option>
<option value="batiai/gemma4-e2b:q4">Gemma 4 2B</option>
```
Model options are hardcoded in HTML. These should be dynamically populated from the bridge settings (`/api/settings` or similar). Hardcoded model names will break when models are renamed, deprecated, or user-specific. The same issue exists in `main-workspace.html` (to a lesser degree — the `hydrateProviderModelOptions` function in `composer-runtime.js` exists but the defaults are still hardcoded in the HTML).

**LOW — `bridge-config.generated.js` is loaded via a `<script>` tag before the module script:**
```html
<script src="./bridge-config.generated.js"></script>
<script type="module" src="./side-panel.js"></script>
```
`bridge-config.generated.js` populates `globalThis.__RESONANTOS_BRIDGE_CONFIG__`. If this file doesn't exist (first run before the host writes it), the side panel will still load but `bridgeUrl` will fall back to the default `http://127.0.0.1:47773`. This is graceful but should be documented; the generated file is gitignored and must be created by `writeBridgeConfig()` in `bridge-server.mjs` before the extension is usable.

---

### 1.5 side-panel.js — Severity: LOW

The file is 100+ imports with well-factored single-responsibility modules. Architecture is good.

**LOW — No explicit error boundary around the module initialization block:**
If any of the 50+ imports fails to resolve (e.g. a missing file in a partial build), the entire side panel will silently fail to initialize with no user-visible error. An `init().catch((err) => { document.body.textContent = err.message; })` pattern would aid debugging.

---

### 1.6 src/lib/ — Severity: MEDIUM (bridge-client.js)

**`bridge-client.js`:**

**MEDIUM — `_capabilityTokens` is module-level mutable state with no expiry or rotation (lines 6–7):**
```js
const _capabilityTokens = {};
```
Once populated by `initCapabilityTokens()`, capability tokens never expire or rotate within a service worker lifetime. If the bridge rotates tokens (e.g. on restart), the extension will use stale tokens until the service worker is killed. Add a TTL or re-fetch on 401 responses.

**LOW — `initCapabilityTokens` silently swallows all errors (lines 50–62):**
```js
} catch {
  // Bridge may not be reachable yet...
}
```
No retry logic. If the bridge starts late, tokens are never fetched until the next `chrome.runtime.onStartup` or `onInstalled` event.

**`content-field-safety.js`:**
✅ Solid. Comprehensive heuristics for credential/payment/login/personal-contact/search/document classification. Properly self-isolating with the IIFE guard. No issues.

**`content-control-refs.js`:**
✅ 46 lines. Looks clean — `createControlRefStore` creates a WeakRef-based store for stable element refs.

---

## 2. BROWSER-FIRST HOST REVIEW

### 2.1 run-browser-first.mjs — Severity: LOW

**File:** `browser-first/host/run-browser-first.mjs`

The file is large and well-structured with good separation of concerns. No critical issues found.

**LOW — `hostBinary` path is hardcoded relative to `import.meta.dirname` (lines ~42–51):**
```js
const hostBinary = path.join(
  repoRoot,
  "addons",
  "resonant-browser-native",
  "build",
  "ResonantBrowserNativeHost.app",
  ...
);
```
This path assumes macOS `.app` bundle structure. On Linux/Windows, the binary path will differ. The `firstExistingExecutable(executableCandidates(...))` pattern is used elsewhere for cross-platform support — verify it's also used for `hostBinary` (the `executableCandidates` import exists, which is encouraging).

### 2.2 bridge-server.mjs — Severity: LOW

**File:** `browser-first/host/bridge-server.mjs`

**✅ Strengths:**
- `timingSafeEqual` for token comparison — correct
- CORS headers restrict to `extensionOrigin` — correct
- `bridgeCapabilityTokens` not written to generated config file — correct security boundary
- `readJsonBody` enforces 1MB body limit — correct

**LOW — `writeJson` sets CORS headers on every response including error responses (line ~34–41):**
401 responses also include `Access-Control-Allow-Origin: extensionOrigin`. This is technically correct (the extension needs to read 401 responses to know it's unauthorized) but worth documenting explicitly.

**LOW — No explicit `Connection: close` or keep-alive timeout on the HTTP server:**
A long-lived Node.js `http.Server` without keep-alive limits can accumulate connections. Not critical for a local bridge but worth noting for hardening.

### 2.3 browser-first-self-test-service.mjs — Severity: LOW

**✅ Strengths:**
- Deterministic in-process auth tests covering unauthorized/wrong-token/authorized paths
- Self-test exits with code 0/1 for CI integration

**LOW — Self-test coverage is focused on auth only; no self-test for route correctness:**
The in-process self-test only proves the auth layer (`/status` endpoint). Route-level correctness (e.g. `/augmentor/inline`, `/api/capability-tokens`) is not covered by the self-test service. This is partially covered by the `test:browser-first` suite but the self-test diagnostic doesn't cover it.

---

## 3. COMET PARITY GAP

**File:** `browser-first/COMET_PARITY_BACKLOG.md`

**Current State:**
The "Implemented" list is extremely long and comprehensive — this is a very mature feature set. The gap analysis:

**Still Blocking Parity:**

1. **Email/Calendar Provider Connectors** — Current connectors are manual handoff (open Gmail compose URL). Actual API-based send/schedule is explicitly blocked pending account grants + approval flows + audit trails. **This is the largest functional gap vs. Comet-style productivity.**

2. **Secure Autofill (Vault-backed)** — Search-field submission allowed, but credential/payment/contact autofill blocked until vault + approval ADRs complete. Comet-style autofill (password manager integration) is entirely absent.

3. **Wallet/DAO Automation** — Read-only only. DAO helpers prepare page-specific instructions but stop before signing/submitting. This is the correct security boundary but means automation parity with Comet is zero in this category.

**Not in backlog but notable gaps:**
- No screen capture / visual understanding (Comet-class browser AI)
- No native notifications integration
- No background tab monitoring (only active tab snapshot)

**Verdict:** Browser-first is feature-complete for its stated browser-companion scope. The gaps are intentional security boundaries, not implementation gaps.

---

## 4. CI/CD REVIEW

**File:** `.github/workflows/alpha-build.yml`

**✅ Strengths:**
- Matrix build for macOS, Windows, Ubuntu — good
- `npm ci` for reproducible installs
- Runs both `npm test` and `npm run test:browser-first` before building
- Runs Rust fmt check and Rust tests
- Uploads artifacts with `if-no-files-found: error` — CI will fail if the build didn't produce outputs
- `retention-days: 14` — appropriate for alpha

**⚠️ Issues:**

**HIGH — CI only builds Tauri bundle, never browser-first extension:**
```yaml
- name: Build Tauri bundle
  run: npm run tauri:build
```
The workflow builds `npm run tauri:build` which builds the Vite/Tauri app. It does NOT separately build or package the browser-first extension. The extension files live at `browser-first/resonantos-side-panel-extension/` but they are not built, zipped, or uploaded as artifacts. This means the browser-first path (the subject of this whole review) is **tested but never shipped** through CI.

**Fix needed:** Add a step to zip the extension and upload it:
```yaml
- name: Package browser-first extension
  run: zip -r resonantos-extension.zip browser-first/resonantos-side-panel-extension/

- name: Upload browser-first extension
  uses: actions/upload-artifact@v4
  with:
    name: resonantos-extension-${{ matrix.platform }}
    path: resonantos-extension.zip
    if-no-files-found: error
```

**MEDIUM — No dependency caching for npm beyond Node.js `cache: npm` in setup-node:**
`cache: npm` caches the npm cache directory but doesn't cache `node_modules`. On large dependency trees, this still requires re-running `npm ci` fully. Consider adding an explicit `node_modules` cache keyed on `package-lock.json` hash.

**MEDIUM — No separate electron-host build/test:**
The CI runs `test:browser-first` but not `test:electron-host`. The `electron-host/` directory has its own test suite (`test:electron-host` script). Given the electron host is a distinct packaging path, it should be tested in CI.

**LOW — Rust toolchain pinned to `1.94.1` (a future version as of early 2026):**
```yaml
uses: dtolnay/rust-toolchain@1.94.1
```
This looks like a forward pin. Verify this is intentional and the toolchain exists.

**LOW — No step to run `npm run test:health` or `npm run test:browser-native`:**
Health check tests and browser-native tests are defined in package.json but not run in CI.

**LOW — No code signing steps:**
macOS `.dmg` will trigger Gatekeeper warnings if unsigned. Windows NSIS installer will trigger SmartScreen without code signing. For an alpha this is acceptable but should be planned before beta.

---

## 5. PACKAGE.JSON — DEPENDENCY AUDIT

**File:** `package.json`

**Overall:** Dependencies are modern and appropriate. No obviously deprecated or known-vulnerable packages.

**⚠️ Issues:**

**MEDIUM — No lockfile audit step in CI:**
`npm audit` is not run in the workflow. Known CVEs in dependencies would not be caught. Add `npm audit --audit-level=moderate` before `npm ci`.

**LOW — Large production bundle warning in build output:**
```
dist/assets/index-BrqUMDRY.js  729.54 kB │ gzip: 211.11 kB
```
The main chunk is 729KB minified (211KB gzipped). For a Tauri app this doesn't matter (not served over the network), but if this is ever served as a web app, this would be slow. The vite build warns about chunks >500KB. Consider manual chunking via `rollupOptions.output.manualChunks`.

**LOW — `playwright@^1.59.1` in devDependencies:**
Playwright is a large package used for browser-host live tests. No issue beyond disk space; verify it's only used in the right test paths.

**LOW — Version ranges use `^` throughout:**
All versions use semver caret ranges. For reproducibility, `npm ci` honors the lockfile, so this is fine. But the lockfile should be committed and kept up to date.

---

## 6. BUILD OUTPUT VERIFICATION

**Command:** `npm run build`  
**Result:** ✅ PASS — builds cleanly in 1.63s

**dist/ structure:**
```
dist/
  index.html
  assets/       (22 JS/CSS chunks)
  icons/
  addons/
```

**Correct outputs verified:**
- `index.html` present
- All workspace chunks present (ArchiveWorkspace, SettingsWorkspace, AddOnsWorkspace, etc.)
- No TypeScript errors (tsc ran clean before vite build)

**Issues:**
- 729KB main chunk warning (noted above)
- No browser-first extension in `dist/` (expected — extension has its own source directory, not built by `npm run build`)

---

## 7. SEVERITY SUMMARY

| Severity | Count | Key Items |
|----------|-------|-----------|
| 🔴 HIGH | 1 | CI never packages/ships browser-first extension |
| 🟠 MEDIUM | 6 | audioCapture permission too broad; capability token expiry; CI missing npm audit; CI missing electron-host tests; large Vite chunk; shadow DOM text exposes sensitive content |
| 🟡 LOW | 15 | Hardcoded model options in HTML; manifest key rotation; service worker keepalive; positionInlineButtonSync dead code; bridge token retry logic; etc. |

---

## 8. RELEASE READINESS VERDICT

**Browser-first extension:** Feature-complete for stated scope. Security model is solid. Needs `audioCapture` permission audit and capability token expiry before production.

**Build pipeline:** Functional but **incomplete** — the browser-first extension is never packaged as an artifact in CI. This is the most critical gap.

**COMET parity:** Intentional security boundaries account for most gaps. Not a blocker for alpha release.

**`npm run build`:** PASSES cleanly. ✅

**Overall alpha readiness:** 🟡 Ready for internal alpha with known gaps. NOT ready for public release without addressing the CI packaging gap and audioCapture permission audit.
