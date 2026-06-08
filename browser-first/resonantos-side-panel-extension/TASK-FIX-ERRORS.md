# Task: Fix 4 Extension Errors (Red-Team Reviewed)

## Step 1: Remove `audioCapture` from manifest.json ✅ APPROVED
Remove `"audioCapture"` from the `permissions` array. It's a Chrome App permission, not valid for MV3 extensions. Nothing in the codebase uses audio capture APIs.

## Step 2: Add IIFE + injection guard to content.js ✅ APPROVED
Wrap the entire content.js body in an IIFE with a guard:
```javascript
(() => {
  if (window.__resonantOSContentScriptLoaded) return;
  window.__resonantOSContentScriptLoaded = true;
  
  // ... ALL existing content.js body goes here ...
})();
```

Red team confirmed: content.js has NO global exports consumed by other scripts. IIFE wrapping is safe. The guard is per-frame (all_frames: true gives separate window objects per frame), so it correctly prevents double-execution within a single frame without blocking per-frame injection.

## Step 3: Make ALL lib scripts idempotent ⚠️ REVISED PER RED TEAM
The original plan was to inject all 6 scripts programmatically. Red team found this causes a **ref collision bug**: re-injecting `content-control-refs.js` resets `nextControlRef = 1`, causing duplicate ref IDs on different elements.

**Revised approach:** Add idempotency guards to EACH lib script:

### content-control-refs.js
At the very start of the IIFE, add:
```javascript
if (globalThis.ResonantOSContentControlRefs) return;
```

### control-overlay.js
At the very start of the IIFE, add:
```javascript
if (globalThis.ResonantOSControlOverlay) return;
```

### content-field-safety.js
At the very start, add:
```javascript
if (globalThis.ResonantOSContentFieldSafety) return;
```

### content-inline-actions.js
At the very start, add:
```javascript
if (globalThis.ResonantOSInlineActions) return;
```

### resonant-context.js
Check if it already has a guard. If not, add one based on whatever global it sets (likely `window.ResonantContext` or `window.__resonantCtx`).

Then keep the browser-page-actions.js fix: inject ALL 6 scripts programmatically:
```javascript
files: [
  "src/lib/control-overlay.js",
  "src/lib/content-field-safety.js",
  "src/lib/content-inline-actions.js",
  "src/lib/content-control-refs.js",
  "src/lib/resonant-context.js",
  "src/content.js"
]
```

With idempotency guards, re-injection is safe — existing globals survive, no state reset.

## Step 4: Context-invalidated error handling ✅ APPROVED
NOT silencing globally. Instead, the IIFE guard in content.js (Step 2) prevents double-execution. The "Extension context invalidated" error will still show in dev console on reload, which is expected behavior. No code change needed for this — it's a dev artifact.

## Step 5: Verify
```bash
cd ~/2.0.0-alpha && npm test 2>&1 | tail -20
```

## Rules
- Do NOT change any functional behavior
- Do NOT modify files outside browser-first/resonantos-side-panel-extension/src/
- Keep ALL existing functionality intact
- Each lib script's idempotency guard must check the SAME global it sets
- After changes, run npm test from the repo root
