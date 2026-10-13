# Terminal Add-ons E2E Testing Guide

Complete manual testing checklist for Ghostty and iTerm2 terminal add-ons.

## Prerequisites

### 1. Terminal Applications

Check if terminal apps are installed:

```bash
# Ghostty
ls -la /Applications/Ghostty.app

# iTerm2
ls -la /Applications/iTerm.app
```

**If missing:**
- **Ghostty**: Download from https://ghostty.org or `brew install --cask ghostty`
- **iTerm2**: Download from https://iterm2.com or `brew install --cask iterm2`

### 2. Bridge Running

```bash
# Check bridge status
curl http://127.0.0.1:47773/healthz

# If not running, start it:
cd resonant-os/2.0.0-alpha
node browser-first/host/run-bridge-minimal.mjs --bridge-port=47773
```

### 3. Dev Server Running

```bash
# Check dev server
curl http://127.0.0.1:1430

# If not running, start it:
npm run dev
```

### 4. Chrome Extension Loaded

1. Open Chrome
2. Navigate to `chrome://extensions`
3. Enable "Developer mode" (top right toggle)
4. Click "Load unpacked"
5. Select: `resonant-os/2.0.0-alpha/browser-first/resonantos-side-panel-extension`
6. Verify extension ID: `cdpdmmalhmokbfcfgogoepnjplaakgnl`

---

## Test Matrix

### Test 1: Initial State (Fresh Install)

**Setup:** Clear user data before testing

```bash
rm -rf ~/ResonantOS_User
```

**Steps:**
1. Open Chrome extension (click icon in toolbar)
2. Click "Terminals" in left rail
3. Observe both Ghostty and iTerm2 cards

**Expected Results:**

| Element | Ghostty | iTerm2 |
|---------|---------|--------|
| Card renders | ✅ | ✅ |
| Title | "Ghostty Terminal Host" | "iTerm2 Terminal Host" |
| Badge text | "Disconnected" | "Disconnected" |
| Badge tone | "warn" (yellow) | "warn" (yellow) |
| Enable button | Visible, enabled | Visible, enabled |
| Grant button | Visible, enabled | Visible, enabled |
| Copy script button | Visible, enabled | Visible, enabled |
| Open in Terminal | Visible, **disabled** | Visible, **disabled** |
| Prompt textarea | Empty | Empty |
| Provider dropdown | Shows configured providers | Shows configured providers |

**❌ FAIL if:**
- Badge shows "Not installed" (this was the bug)
- Any button is missing
- Open in Terminal is enabled (should be disabled until connected)

---

### Test 2: Enable Add-on

**Steps:**
1. Click "Enable" on Ghostty card
2. Wait for operation to complete

**Expected Results:**

| Element | Before | After |
|---------|--------|-------|
| Enable button | "Enable" | "Disable" |
| Badge | "Disconnected" | "Disconnected" (no change) |
| Grant button | Visible | Visible (no change) |

**✅ PASS if:**
- Button toggles to "Disable"
- No errors in console (F12 → Console)
- Badge remains "Disconnected"

**❌ FAIL if:**
- Button stays "Enable"
- Error message appears
- Badge changes to "Not installed"

---

### Test 3: Grant Terminal-Host Capability

**Steps:**
1. Click "Grant" (or "Launch & connect") on Ghostty card
2. A browser confirmation dialog should appear
3. Click "OK" to approve

**Expected Results:**

| Element | Before | After |
|---------|--------|-------|
| Grant button | Visible | Hidden |
| Badge | "Disconnected" | "Disconnected" (no change yet) |
| Terminal window | Closed | **Should NOT open yet** |

**✅ PASS if:**
- Confirmation dialog appears
- Grant button disappears after approval
- Badge still shows "Disconnected"

**❌ FAIL if:**
- No confirmation dialog
- Terminal window opens (should only open on "Run session")
- Error message appears

---

### Test 4: Write Prompt

**Steps:**
1. In the prompt textarea, write: `List the current directory contents`
2. Observe the "Run session" button

**Expected Results:**

| Element | State |
|---------|-------|
| Prompt textarea | Contains text |
| Character count | Shows count (e.g., "34/65536") |
| Run session button | Still disabled (terminal not connected) |
| Save prompt button | Enabled |

**✅ PASS if:**
- Text appears in textarea
- Character count updates
- Run session remains disabled

---

### Test 5: Copy Connection Script

**Steps:**
1. Click "Copy connection script" on Ghostty card
2. Paste into a text editor to inspect

**Expected Results:**

```bash
# Should look like:
eval "$(node /path/to/ros-session attach --session-id <uuid> --token-file /tmp/<uuid>.token --provider-profile-id <id>)"
```

**✅ PASS if:**
- Script copied to clipboard
- Contains `ros-session attach`
- Contains `--session-id`
- Contains `--token-file`
- Does NOT contain actual token value (only file path)
- Does NOT contain secrets/passwords

**❌ FAIL if:**
- Script contains `Bearer <token>` in plaintext
- Script contains API keys
- Script contains passwords

---

### Test 6: Launch Terminal (Ghostty)

**Prerequisites:**
- Ghostty.app installed
- Add-on enabled
- Capability granted
- Prompt written

**Steps:**
1. Click "Run session" (or "Open in Terminal")
2. Observe Ghostty window opening
3. Check terminal title
4. Check terminal content

**Expected Results:**

| Element | State |
|---------|-------|
| Ghostty window | Opens |
| Window/tab title | "ROS: connected" |
| Bootstrap command | Auto-executes |
| Pi agent | Starts running |
| Badge in UI | Changes to "Connected" |
| Badge tone | Changes to "ok" (green) |
| Open in Terminal | Becomes enabled |

**✅ PASS if:**
- Ghostty window opens
- Title shows "ROS: connected"
- Bootstrap command executes (you see output)
- Pi agent starts (shows prompt or waits for input)
- UI badge changes to "Connected"
- No errors in browser console

**❌ FAIL if:**
- Ghostty doesn't open
- Window opens but closes immediately
- Bootstrap command doesn't run
- Error in console: "permission-denied"
- Error in console: "terminal-not-running"

---

### Test 7: Verify Connection Status

**Steps:**
1. Look at the Ghostty card in the UI
2. Check badge and buttons

**Expected Results:**

| Element | State |
|---------|-------|
| Badge | "Connected" |
| Badge tone | "ok" (green) |
| Grant button | Hidden (already granted) |
| Open in Terminal | Enabled |
| Copy script | Enabled |
| Disable button | Enabled |

**✅ PASS if:**
- Badge shows "Connected"
- All buttons in correct state

---

### Test 8: Test iTerm2

**Steps:**
1. Repeat Tests 2-7 for iTerm2 card
2. Use iTerm2 instead of Ghostty

**Expected Results:**
- Same as Ghostty tests
- iTerm2 window opens instead
- Title shows "ROS: connected"

---

### Test 9: Switch Between Terminals

**Steps:**
1. With Ghostty connected, click "Enable" on iTerm2
2. Click "Grant" on iTerm2
3. Click "Run session" on iTerm2

**Expected Results:**

| Action | Result |
|--------|--------|
| Enable iTerm2 | Ghostty stays connected |
| Grant iTerm2 | Ghostty stays connected |
| Run iTerm2 session | **Ghostty should disconnect** OR error message |

**Note:** Only ONE terminal can be active at a time (singleton pattern)

**✅ PASS if:**
- iTerm2 launches
- Ghostty disconnects OR error shows "terminal-service-owned"

---

### Test 10: Disable Terminal

**Steps:**
1. With Ghostty connected, click "Disable"
2. Observe terminal window and UI

**Expected Results:**

| Element | Before | After |
|---------|--------|-------|
| Badge | "Connected" | "Disconnected" |
| Terminal window | Open | **Should close** |
| Enable button | "Disable" | "Enable" |

**✅ PASS if:**
- Badge changes to "Disconnected"
- Terminal window closes
- ROS-owned sessions are terminated

---

### Test 11: Revoke Grant

**Steps:**
1. Navigate to Settings → Add-ons
2. Find Ghostty terminal add-on
3. Revoke the terminal-host capability
4. Return to Terminals workspace

**Expected Results:**

| Element | State |
|---------|-------|
| Badge | "Disconnected" |
| Grant button | Visible again |
| Terminal window | Closed (if was open) |

---

### Test 12: Provider Selection

**Prerequisites:**
- At least one provider configured (OpenAI, OpenRouter, etc.)

**Steps:**
1. In the Terminals workspace, find the Provider dropdown
2. Select a provider (e.g., "OpenAI GPT-4")
3. Write a prompt
4. Launch terminal

**Expected Results:**

| Element | State |
|---------|-------|
| Provider dropdown | Shows configured providers |
| Selected provider | Highlighted |
| Launch command | Includes `--provider-profile-id <id>` |

**✅ PASS if:**
- Dropdown shows your configured providers
- Selecting a provider works
- Terminal launches with correct provider

---

### Test 13: Error Handling

**Test 13a: Launch Without Grant**

**Steps:**
1. Clear grants (revoke terminal-host)
2. Try to launch terminal

**Expected:**
- Error message: "Grant required" or similar
- Terminal does NOT open

---

**Test 13b: Launch Without Prompt**

**Steps:**
1. Don't write a prompt
2. Try to launch terminal

**Expected:**
- "Run session" button disabled
- Cannot launch

---

**Test 13c: Terminal App Not Installed**

**Steps:**
1. Temporarily rename/move Ghostty.app
2. Try to launch

**Expected:**
- Error message: "Ghostty not found" or "Not installed"
- Terminal does NOT open

---

## Debugging Guide

### Check Browser Console

1. Open Chrome DevTools (F12 or Cmd+Option+I)
2. Go to Console tab
3. Look for errors (red text)

**Common errors:**

```
❌ "replaceChildren is not a function"
→ Fix: Update Chrome or check renderer code

❌ "permission-denied"
→ Fix: Grant the terminal-host capability

❌ "terminal-not-running"
→ Fix: Check if terminal app is installed

❌ "missing-credential"
→ Fix: Configure provider in Settings
```

---

### Check Bridge Logs

```bash
# View bridge logs
tail -f /tmp/ros-terminals-e2e-bridge.log

# Or check the running bridge's stderr
ps aux | grep "node.*bridge"
```

---

### Check Terminal Adapter Logs

**Ghostty:**
```bash
# Check Console.app for Ghostty process logs
open -a Console
# Filter by: Ghostty
```

**iTerm2:**
```bash
# Check iTerm2 logs
ls -la ~/Library/Logs/iTerm2/
```

---

### Check User Data

```bash
# List installed add-ons
ls -la ~/ResonantOS_User/.addons/

# Check registry
cat ~/ResonantOS_User/.addons/registry.json | jq .

# Check grants
cat ~/ResonantOS_User/.addons/registry.json | jq '.installations["addon.resonant-terminal-ghostty"].grantedCapabilities'
```

---

### Reset State

If tests fail or state is corrupted:

```bash
# Kill bridge
lsof -ti:47773 | xargs kill -9

# Clear user data
rm -rf ~/ResonantOS_User

# Restart bridge
cd resonant-os/2.0.0-alpha
node browser-first/host/run-bridge-minimal.mjs --bridge-port=47773
```

---

## Success Criteria

**Minimum Viable Test (MVP):**

- [ ] Both cards render
- [ ] Badges show "Disconnected" (not "Not installed")
- [ ] Enable/Grant buttons work
- [ ] Terminal window opens
- [ ] Badge changes to "Connected"
- [ ] No secrets in UI

**Full Test:**

- [ ] All MVP criteria
- [ ] Provider selection works
- [ ] Switching terminals works
- [ ] Disable closes terminal
- [ ] Revoke grant works
- [ ] Error handling works
- [ ] No console errors

---

## Known Issues

### Issue 1: Python Type Errors in iTerm2 Adapter

**Symptom:** Type-checking errors in `adapter.py`

**Impact:** None (runtime works fine, just type-checker warnings)

**Fix:** Add `# type: ignore` comments or install iTerm2 type stubs

---

### Issue 2: Ghostty Not Opening

**Symptom:** Click "Run session" but nothing happens

**Possible causes:**
1. Ghostty not installed
2. Ghostty older than 1.3.1
3. Permission denied

**Debug:**
```bash
# Check Ghostty version
/Applications/Ghostty.app/Contents/MacOS/ghostty --version

# Check logs
tail -f /tmp/ros-terminals-e2e-bridge.log
```

---

### Issue 3: iTerm2 Python API Not Available

**Symptom:** iTerm2 doesn't respond to commands

**Fix:**
1. Open iTerm2
2. Go to Preferences → General → Magic
3. Enable "Python API"

---

## Reporting Issues

When reporting issues, include:

1. **Browser console errors** (F12 → Console)
2. **Bridge logs** (`/tmp/ros-terminals-e2e-bridge.log`)
3. **Terminal app version** (Ghostty/iTerm2)
4. **macOS version**
5. **Steps to reproduce**
6. **Expected vs actual behavior**

---

## Test Results Template

```markdown
## Test Results - [Date]

**Environment:**
- macOS: [version]
- Chrome: [version]
- Ghostty: [version]
- iTerm2: [version]
- Bridge port: 47773

**Results:**

| Test | Ghostty | iTerm2 | Notes |
|------|---------|--------|-------|
| 1. Initial state | ✅/❌ | ✅/❌ | |
| 2. Enable | ✅/❌ | ✅/❌ | |
| 3. Grant | ✅/❌ | ✅/❌ | |
| 4. Write prompt | ✅/❌ | ✅/❌ | |
| 5. Copy script | ✅/❌ | ✅/❌ | |
| 6. Launch | ✅/❌ | ✅/❌ | |
| 7. Verify connection | ✅/❌ | ✅/❌ | |
| 8. Switch terminals | ✅/❌ | ✅/❌ | |
| 9. Disable | ✅/❌ | ✅/❌ | |
| 10. Revoke grant | ✅/❌ | ✅/❌ | |
| 11. Provider selection | ✅/❌ | ✅/❌ | |
| 12. Error handling | ✅/❌ | ✅/❌ | |

**Issues Found:**
- [Description]

**Console Errors:**
```
[Paste errors]
```

**Bridge Logs:**
```
[Paste relevant logs]
```
```

---

## Next Steps

After testing:

1. **If all tests pass:** Document any edge cases found
2. **If tests fail:** Use debugging guide above
3. **If new issues found:** Report using template above
4. **If improvements needed:** Update this guide
