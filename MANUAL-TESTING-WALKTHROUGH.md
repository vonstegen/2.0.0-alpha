# Manual Testing Walkthrough - Terminal Add-ons

This guide will walk you through testing the Ghostty and iTerm2 terminal add-ons as a real user.

## 🚀 Quick Start

### Step 1: Start the Bridge

Open a terminal and run:

```bash
cd ~/Developer/Projects/resonant-os/2.0.0-alpha
node browser-first/host/run-bridge-minimal.mjs --bridge-port=47773
```

You should see output like:
```
[bridge] listening on http://127.0.0.1:47773
[bridge] drive id: <uuid>
```

Keep this terminal open - the bridge needs to stay running.

### Step 2: Start the Dev Server (Optional)

If you want to test via the web interface:

```bash
cd ~/Developer/Projects/resonant-os/2.0.0-alpha
npm run dev
```

The dev server will start at `http://127.0.0.1:1430`

### Step 3: Load the Chrome Extension

1. Open Chrome
2. Navigate to `chrome://extensions`
3. Toggle "Developer mode" ON (top right)
4. Click "Load unpacked"
5. Select this folder:
   ```
   ~/Developer/Projects/resonant-os/2.0.0-alpha/browser-first/resonantos-side-panel-extension
   ```
6. Verify the extension appears with ID: `cdpdmmalhmokbfcfgogoepnjplaakgnl`

### Step 4: Open the Extension

1. Click the extension icon in Chrome's toolbar (puzzle piece icon, then find "ResonantOS")
2. The side panel will open
3. You should see the main workspace

---

## 📋 Test Walkthrough

### Test 1: Initial State

**What to check:**

1. Click **"Terminals"** in the left rail
2. You should see two cards:
   - **Ghostty Terminal Host**
   - **iTerm2 Terminal Host**

**Expected appearance:**

```
┌─────────────────────────────────────┐
│ Ghostty Terminal Host               │
│ ┌──────────────┐                    │
│ │ Disconnected │ (yellow badge)     │
│ └──────────────┘                    │
│                                     │
│ [Enable] [Launch & connect]          │
│ [Copy connection script]            │
│ [Open in Terminal] (disabled)       │
└─────────────────────────────────────┘
```

**✅ PASS if:**
- Badge shows "Disconnected" (NOT "Not installed")
- Enable button is enabled
- Launch & connect button is enabled
- Copy connection script is enabled
- Open in Terminal is disabled

**❌ FAIL if:**
- Badge shows "Not installed" ← This was the bug we fixed!
- Any button is missing
- Open in Terminal is enabled (should be disabled)

---

### Test 2: Enable Ghostty

**Steps:**

1. Click **"Enable"** on the Ghostty card
2. Wait 1-2 seconds

**Expected:**

- Button changes to **"Disable"**
- Badge still shows "Disconnected"
- No error messages

**Debug if fails:**

Open Chrome DevTools (F12):
- Console tab: Look for red errors
- Network tab: Check for failed requests to `http://127.0.0.1:47773`

---

### Test 3: Grant Terminal-Host Capability

**Steps:**

1. Click **"Launch & connect"** on Ghostty card
2. A browser dialog should appear: "Grant terminal-host capability?"
3. Click **"OK"**

**Expected:**

- Dialog appears asking for permission
- After approval, "Launch & connect" button disappears
- Badge still shows "Disconnected" (terminal not launched yet)

**✅ PASS if:**
- Confirmation dialog appears
- Button disappears after approval
- No terminal window opens yet

**❌ FAIL if:**
- No confirmation dialog
- Terminal opens immediately (should wait for "Run session")
- Error message appears

---

### Test 4: Write a Prompt

**Steps:**

1. Find the prompt textarea (below the cards)
2. Type: `List files in the current directory`
3. Observe the character counter

**Expected:**

```
┌─────────────────────────────────────┐
│ Prompt File                         │
│ ┌─────────────────────────────────┐ │
│ │ List files in the current        │ │
│ │ directory                        │ │
│ │                                  │ │
│ └─────────────────────────────────┘ │
│ 34/65536 characters                 │
│ [Save prompt]                      │
└─────────────────────────────────────┘
```

**✅ PASS if:**
- Text appears in textarea
- Character count updates
- Save prompt button is enabled

---

### Test 5: Copy Connection Script

**Steps:**

1. Click **"Copy connection script"** on Ghostty card
2. Open a text editor
3. Paste (Cmd+V)

**Expected script:**

```bash
eval "$(node /path/to/ros-session attach --session-id <uuid> --token-file /tmp/<uuid>.token --provider-profile-id <id>)"
```

**✅ PASS if:**
- Script copied to clipboard
- Contains `ros-session attach`
- Contains `--session-id`
- Contains `--token-file` with path (NOT actual token)
- Does NOT contain actual token value
- Does NOT contain API keys

**❌ FAIL if:**
- Script contains `Bearer eyJ...` (token leaked!)
- Script contains API keys
- Script contains passwords

---

### Test 6: Launch Terminal (Ghostty)

**Prerequisites:**
- Ghostty.app installed at `/Applications/Ghostty.app`
- Prompt written
- Capability granted

**Steps:**

1. Click **"Run session"** (or "Open in Terminal")
2. Watch for Ghostty window to open
3. Check the window/tab title

**Expected:**

```
Ghostty window opens
┌─────────────────────────────────────────────┐
│ ROS: connected                               │ ← Window title
├─────────────────────────────────────────────┤
│ $ eval "$(node ros-session attach ...)"      │ ← Bootstrap runs
│ [output from ros-session]                    │
│ $ pi @<prompt-file>                          │ ← Pi agent starts
│ > _                                          │
└─────────────────────────────────────────────┘
```

**In the UI:**

- Badge changes to **"Connected"** (green)
- "Open in Terminal" button becomes enabled

**✅ PASS if:**
- Ghostty window opens
- Title shows "ROS: connected"
- Bootstrap command executes
- Pi agent starts
- UI badge changes to "Connected"

**❌ FAIL if:**
- Ghostty doesn't open
- Window opens but closes immediately
- Bootstrap doesn't run
- Error in console

**Debug:**

1. Check bridge logs:
   ```bash
   tail -f /tmp/ros-bridge-manual.log
   ```

2. Check Ghostty version:
   ```bash
   /Applications/Ghostty.app/Contents/MacOS/ghostty --version
   ```
   Should be 1.3.1 or later

---

### Test 7: Verify Connection Status

**Steps:**

1. Look at the Ghostty card in the UI
2. Check all UI elements

**Expected:**

```
┌─────────────────────────────────────┐
│ Ghostty Terminal Host               │
│ ┌───────────┐                       │
│ │ Connected │ (green badge)         │
│ └───────────┘                       │
│                                     │
│ [Disable]                           │
│ [Copy connection script]            │
│ [Open in Terminal] (enabled)        │
└─────────────────────────────────────┘
```

**✅ PASS if:**
- Badge: "Connected" (green)
- Launch & connect button: hidden (already granted)
- Open in Terminal: enabled
- Copy script: enabled
- Disable: enabled

---

### Test 8: Test iTerm2

**Steps:**

1. Repeat Tests 2-7 for the iTerm2 card
2. Use iTerm2 instead of Ghostty

**Expected:**

- Same results as Ghostty
- iTerm2 window opens instead
- Title shows "ROS: connected"

**Note:** Only ONE terminal can be active at a time (singleton pattern)

---

### Test 9: Switch Between Terminals

**Steps:**

1. With Ghostty connected, click **"Enable"** on iTerm2
2. Click **"Launch & connect"** on iTerm2
3. Click **"Run session"** on iTerm2

**Expected:**

- iTerm2 launches
- Ghostty disconnects OR error shows "terminal-service-owned"

**✅ PASS if:**
- iTerm2 launches successfully
- Ghostty disconnects (badge changes to "Disconnected")
- OR error message appears

---

### Test 10: Disable Terminal

**Steps:**

1. With Ghostty connected, click **"Disable"**
2. Observe terminal window and UI

**Expected:**

- Badge changes to "Disconnected"
- Ghostty window closes
- ROS-owned sessions are terminated

**✅ PASS if:**
- Badge: "Disconnected"
- Terminal window closes
- No orphaned processes

---

### Test 11: Revoke Grant

**Steps:**

1. Navigate to **Settings → Add-ons**
2. Find **"addon.resonant-terminal-ghostty"**
3. Click **"Revoke"** on the terminal-host capability
4. Return to Terminals workspace

**Expected:**

- Badge: "Disconnected"
- "Launch & connect" button appears again
- Terminal window closed (if was open)

---

### Test 12: Provider Selection

**Prerequisites:**
- At least one provider configured (OpenAI, OpenRouter, etc.)

**Steps:**

1. In Terminals workspace, find the **Provider dropdown**
2. Click to open
3. Select a provider (e.g., "OpenAI GPT-4")
4. Write a prompt
5. Launch terminal

**Expected:**

- Dropdown shows your configured providers
- Selecting works
- Terminal launches with `--provider-profile-id <id>`

**Verify:**

Check the bootstrap command in terminal:
```bash
eval "$(node ros-session attach --provider-profile-id <your-id> ...)"
```

---

## 🐛 Debugging Common Issues

### Issue: Badge Shows "Not installed"

**Cause:** Compatibility check was using grant state instead of platform

**Fix:** Already fixed in the code. If you see this, run:
```bash
rm -rf ~/ResonantOS_User
```
And restart the bridge.

---

### Issue: Terminal Doesn't Open

**Possible causes:**

1. **Terminal app not installed**
   ```bash
   ls -la /Applications/Ghostty.app
   ls -la /Applications/iTerm.app
   ```

2. **Permission denied**
   - Check bridge logs for "permission-denied"
   - Grant the terminal-host capability

3. **Bridge not running**
   ```bash
   curl http://127.0.0.1:47773/healthz
   ```

4. **Ghostty version too old**
   ```bash
   /Applications/Ghostty.app/Contents/MacOS/ghostty --version
   ```
   Need 1.3.1 or later

---

### Issue: iTerm2 Python API Not Working

**Symptom:** iTerm2 doesn't respond to commands

**Fix:**

1. Open iTerm2
2. Go to **Preferences → General → Magic**
3. Enable **"Python API"**
4. Restart iTerm2

---

### Issue: "replaceChildren is not a function"

**Cause:** Old Chrome version

**Fix:** Update Chrome to latest version

---

### Issue: Secrets Visible in UI

**Symptom:** Token/API key shown in UI

**Fix:** This is a security bug! Report immediately.

**Check:**
1. Open Chrome DevTools
2. Search for "Bearer", "token=", "apiKey"
3. If found, do NOT use in production

---

## 📊 Test Results Checklist

Print this and check off as you test:

```
Test 1: Initial State
  [ ] Ghostty card renders
  [ ] iTerm2 card renders
  [ ] Badges show "Disconnected"
  [ ] Enable buttons enabled
  [ ] Open in Terminal disabled

Test 2: Enable Ghostty
  [ ] Button toggles to "Disable"
  [ ] No errors

Test 3: Grant Capability
  [ ] Confirmation dialog appears
  [ ] Button disappears after grant

Test 4: Write Prompt
  [ ] Text appears
  [ ] Character count updates

Test 5: Copy Script
  [ ] Script copied
  [ ] No secrets in script

Test 6: Launch Ghostty
  [ ] Window opens
  [ ] Title: "ROS: connected"
  [ ] Bootstrap runs
  [ ] Badge: "Connected"

Test 7: Verify Status
  [ ] Badge: "Connected" (green)
  [ ] Open in Terminal: enabled

Test 8: Test iTerm2
  [ ] Same as Ghostty tests

Test 9: Switch Terminals
  [ ] iTerm2 launches
  [ ] Ghostty disconnects

Test 10: Disable
  [ ] Badge: "Disconnected"
  [ ] Window closes

Test 11: Revoke Grant
  [ ] Grant button reappears

Test 12: Provider Selection
  [ ] Dropdown works
  [ ] Provider passed to terminal
```

---

## 🎯 Success Criteria

**Minimum Viable Product (MVP):**

- ✅ Both cards render
- ✅ Badges show "Disconnected" (not "Not installed")
- ✅ Enable/Grant buttons work
- ✅ Terminal window opens
- ✅ Badge changes to "Connected"
- ✅ No secrets in UI

**Full Test:**

- ✅ All MVP criteria
- ✅ Provider selection works
- ✅ Switching terminals works
- ✅ Disable closes terminal
- ✅ Revoke grant works
- ✅ Error handling works
- ✅ No console errors

---

## 📝 Reporting Issues

If you find issues, please include:

1. **Screenshot** of the UI
2. **Browser console errors** (F12 → Console)
3. **Bridge logs** (`/tmp/ros-bridge-manual.log`)
4. **Terminal app version** (Ghostty/iTerm2)
5. **macOS version**
6. **Steps to reproduce**

---

## 🚀 Next Steps

After successful testing:

1. ✅ Document any edge cases found
2. ✅ Update testing guide if needed
3. ✅ Consider automating additional scenarios
4. ✅ Share results with team

Happy testing! 🎉
