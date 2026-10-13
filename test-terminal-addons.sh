#!/bin/bash
# Terminal Add-ons Test Helper
# Checks prerequisites and guides through manual testing

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     ResonantOS Terminal Add-ons - Test Helper             ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }

# 1. Check Terminal Apps
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. Checking Terminal Applications"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -d "/Applications/Ghostty.app" ]; then
    pass "Ghostty installed"
    GHOSTTY_VERSION=$(/Applications/Ghostty.app/Contents/MacOS/ghostty --version 2>/dev/null || echo "unknown")
    echo "  Version: $GHOSTTY_VERSION"
else
    fail "Ghostty not installed"
    echo "  Install: brew install --cask ghostty"
fi

if [ -d "/Applications/iTerm.app" ]; then
    pass "iTerm2 installed"
else
    fail "iTerm2 not installed"
    echo "  Install: brew install --cask iterm2"
fi

echo ""

# 2. Check Bridge
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2. Checking Bridge Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

BRIDGE_PORT=47773
BRIDGE_URL="http://127.0.0.1:$BRIDGE_PORT"

if curl -s "$BRIDGE_URL/healthz" | jq -e '.ok == true' > /dev/null 2>&1; then
    pass "Bridge running on port $BRIDGE_PORT"
    echo "  URL: $BRIDGE_URL"

    # Check terminal status
    echo ""
    echo "  Terminal Status:"
    curl -s "$BRIDGE_URL/terminal-host/status" 2>/dev/null | jq -r '.surfaces[] | "    - \(.adapterId): \(.connected)"' 2>/dev/null || echo "    No terminals connected"
else
    warn "Bridge not running on port $BRIDGE_PORT"
    echo "  Start with: node browser-first/host/run-bridge-minimal.mjs --bridge-port=$BRIDGE_PORT"
fi

echo ""

# 3. Check Dev Server
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3. Checking Dev Server"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

DEV_PORT=1430
DEV_URL="http://127.0.0.1:$DEV_PORT"

if curl -s "$DEV_URL" > /dev/null 2>&1; then
    pass "Dev server running on port $DEV_PORT"
    echo "  URL: $DEV_URL"
else
    warn "Dev server not running on port $DEV_PORT"
    echo "  Start with: npm run dev"
fi

echo ""

# 4. Check Chrome
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4. Checking Chrome"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    pass "Chrome installed"
    CHROME_VERSION=$("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version 2>/dev/null | head -1)
    echo "  Version: $CHROME_VERSION"
else
    fail "Chrome not installed"
    echo "  Install from: https://www.google.com/chrome/"
fi

echo ""

# 5. Check User Data
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5. Checking User Data"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

USER_ROOT="$HOME/ResonantOS_User"

if [ -d "$USER_ROOT" ]; then
    warn "User data exists at $USER_ROOT"

    if [ -f "$USER_ROOT/.addons/registry.json" ]; then
        echo "  Installed add-ons:"
        jq -r '.installations | keys[]' "$USER_ROOT/.addons/registry.json" 2>/dev/null | sed 's/^/    - /' || echo "    None"

        echo ""
        echo "  Terminal grants:"
        jq -r '.installations | to_entries[] | select(.key | contains("terminal")) | "\(.key): \(.value.grantedCapabilities | map(select(.capability == \"terminal-host\" and .granted)) | length) grants"' "$USER_ROOT/.addons/registry.json" 2>/dev/null | sed 's/^/    /' || echo "    None"
    fi

    echo ""
    echo "  To reset: rm -rf $USER_ROOT"
else
    pass "Clean user state (no existing data)"
fi

echo ""

# 6. Interactive Test Menu
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "6. Interactive Testing"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "What would you like to do?"
echo ""
echo "  1) Open Chrome with extension (manual testing)"
echo "  2) Run automated E2E test"
echo "  3) Reset user data and start fresh"
echo "  4) View bridge logs"
echo "  5) Check provider configuration"
echo "  6) Exit"
echo ""
read -p "Choice [1-6]: " choice

case $choice in
    1)
        echo ""
        echo "Opening Chrome with extension..."
        echo ""
        echo "Steps:"
        echo "  1. Chrome will open - go to chrome://extensions"
        echo "  2. Enable 'Developer mode' (top right)"
        echo "  3. Click 'Load unpacked'"
        echo "  4. Select: $(pwd)/browser-first/resonantos-side-panel-extension"
        echo "  5. Click the extension icon"
        echo "  6. Click 'Terminals' in the left rail"
        echo ""
        read -p "Press Enter to open Chrome..."
        open -a "Google Chrome"
        ;;
    2)
        echo ""
        echo "Running automated E2E test..."
        echo ""
        RESONANTOS_LIVE_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
            node browser-first/test/terminals-browser-e2e.mjs
        ;;
    3)
        echo ""
        read -p "This will delete all user data. Continue? [y/N]: " confirm
        if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
            echo "Clearing user data..."
            rm -rf "$USER_ROOT"
            lsof -ti:47773 | xargs kill -9 2>/dev/null || true
            pass "User data cleared"
            echo ""
            echo "Start fresh bridge with:"
            echo "  node browser-first/host/run-bridge-minimal.mjs --bridge-port=47773"
        else
            echo "Cancelled"
        fi
        ;;
    4)
        echo ""
        if [ -f "/tmp/ros-terminals-e2e-bridge.log" ]; then
            echo "Last 50 lines of bridge log:"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            tail -50 /tmp/ros-terminals-e2e-bridge.log
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            echo "Follow live: tail -f /tmp/ros-terminals-e2e-bridge.log"
        else
            echo "No bridge log found at /tmp/ros-terminals-e2e-bridge.log"
        fi
        ;;
    5)
        echo ""
        echo "Provider configuration:"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

        if [ -f "$USER_ROOT/settings/providers.json" ]; then
            jq '.' "$USER_ROOT/settings/providers.json" 2>/dev/null || echo "Could not parse providers.json"
        else
            echo "No providers configured"
            echo ""
            echo "Configure providers at: Settings → Providers"
        fi
        ;;
    6)
        echo ""
        echo "Happy testing! 🚀"
        exit 0
        ;;
    *)
        echo ""
        echo "Invalid choice"
        ;;
esac

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "For detailed testing guide, see:"
echo "  TERMINAL-TESTING-GUIDE.md"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
