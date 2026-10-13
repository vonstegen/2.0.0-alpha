# Terminal Add-ons Quick Reference

## 🚨 Common Issues & Fixes

### 1. Badge Shows "Not installed" Instead of "Disconnected"

**Fix:**
```bash
rm -rf ~/ResonantOS_User
# Restart bridge
```

---

### 2. Terminal Doesn't Open

**Check:**
```bash
# Is terminal app installed?
ls -la /Applications/Ghostty.app
ls -la /Applications/iTerm.app

# Is bridge running?
curl http://127.0.0.1:47773/healthz

# Check logs
tail -f /tmp/ros-bridge-manual.log
```

---

### 3. Permission Denied Error

**Fix:**
1. Click "Launch & connect"
2. Approve the grant in the dialog
3. Try again

---

### 4. iTerm2 Not Responding

**Fix:**
1. Open iTerm2
2. Preferences → General → Magic
3. Enable "Python API"
4. Restart iTerm2

---

### 5. Ghostty Closes Immediately

**Check version:**
```bash
/Applications/Ghostty.app/Contents/MacOS/ghostty --version
```
Need 1.3.1 or later.

---

## 📍 Key URLs

| Service | URL |
|---------|-----|
| Bridge Health | http://127.0.0.1:47773/healthz |
| Terminal Status | http://127.0.0.1:47773/terminal-host/status |
| Dev Server | http://127.0.0.1:1430 |
| Extension | chrome-extension://cdpdmmalhmokbfcfgogoepnjplaakgnl |

---

## 🔧 Quick Commands

```bash
# Start bridge
node browser-first/host/run-bridge-minimal.mjs --bridge-port=47773

# Start dev server
npm run dev

# Run E2E test
RESONANTOS_LIVE_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node browser-first/test/terminals-browser-e2e.mjs

# Reset user data
rm -rf ~/ResonantOS_User

# View logs
tail -f /tmp/ros-bridge-manual.log
tail -f /tmp/ros-terminals-e2e-bridge.log

# Kill bridge
lsof -ti:47773 | xargs kill -9
```

---

## ✅ Test Checklist (Quick)

- [ ] Both cards render
- [ ] Badges: "Disconnected" (not "Not installed")
- [ ] Enable button works
- [ ] Grant button works
- [ ] Terminal opens
- [ ] Title: "ROS: connected"
- [ ] Badge: "Connected" (green)
- [ ] No secrets in UI

---

## 🐛 Debug Mode

Enable verbose logging:
```bash
DEBUG=ros:* node browser-first/host/run-bridge-minimal.mjs --bridge-port=47773
```

---

## 📚 Documentation

- Full Guide: `MANUAL-TESTING-WALKTHROUGH.md`
- Test Guide: `TERMINAL-TESTING-GUIDE.md`
- Architecture: `docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md`

---

## 🆘 Getting Help

1. Check logs: `/tmp/ros-bridge-manual.log`
2. Check console: F12 → Console
3. Check docs: `TERMINAL-TESTING-GUIDE.md`
4. Report issue with:
   - Screenshot
   - Console errors
   - Bridge logs
   - Steps to reproduce
