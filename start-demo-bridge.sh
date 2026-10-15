#!/usr/bin/env bash
# ResonantOS demo bridge launcher — one command, no version juggling.
#
# Starts the browser-first bridge with the canonical sdk-demo token set
# (matching examples/sdk-demo/README.md). The bridge embeds any missing
# demo upstream (echo, counter, sdk-guide, pi) in-process, so this is the
# ONLY terminal command the demo needs.
#
# Handles the two failure modes that make the bridge "unreachable" in the
# extension:
#   1. Node without TypeScript type-stripping (the bridge imports .ts at
#      boot; instant ERR_UNKNOWN_FILE_EXTENSION crash). This script uses
#      `nvm use` when available (repo .nvmrc pins 24.21.0) and otherwise
#      adds --experimental-strip-types on Node 22.6-22.17.
#   2. Stale demo processes holding ports 47300/47321-47324 from a previous
#      session. `--fresh` kills them first.
#
# Usage:
#   ./start-demo-bridge.sh           # start (foreground; Ctrl-C to stop)
#   ./start-demo-bridge.sh --fresh   # kill stale demo processes, then start
set -euo pipefail
cd "$(dirname "$0")"

# --- optional cleanup ------------------------------------------------------
if [[ "${1:-}" == "--fresh" ]]; then
  echo "[demo-bridge] --fresh: stopping stale demo processes (if any)"
  pkill -f 'examples/sdk-demo/(echo|counter|sdk-guide|pi)/server\.mjs' 2>/dev/null || true
  pkill -f 'browser-first/host/run-bridge-minimal\.mjs' 2>/dev/null || true
  sleep 1
fi

# --- node selection --------------------------------------------------------
# Prefer the repo-pinned runtime via nvm (loaded from the usual locations
# because this script may run in a non-interactive shell where nvm is not
# yet on PATH).
if ! command -v nvm >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [[ -s "$NVM_DIR/nvm.sh" ]] && source "$NVM_DIR/nvm.sh" || true
fi
if command -v nvm >/dev/null 2>&1; then
  nvm use --silent || echo "[demo-bridge] nvm could not satisfy .nvmrc ($(cat .nvmrc)); falling back to system node"
fi

NODE_VERSION="$(node -v)"                 # e.g. v22.13.0
NODE_MAJOR="${NODE_VERSION#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
NODE_MINOR="$(node -e 'console.log(process.versions.node.split(".")[1])')"

STRIP_FLAG=()
if (( NODE_MAJOR < 22 || (NODE_MAJOR == 22 && NODE_MINOR < 6) )); then
  echo "[demo-bridge] ERROR: Node >= 22.6 required (found $NODE_VERSION). The repo .nvmrc pins 24.21.0 — run \`nvm install\`." >&2
  exit 1
elif (( NODE_MAJOR == 22 && NODE_MINOR < 18 )); then
  STRIP_FLAG=(--experimental-strip-types)
  echo "[demo-bridge] Node $NODE_VERSION detected — enabling --experimental-strip-types (default-on from 22.18; .nvmrc pins 24.21.0)"
else
  echo "[demo-bridge] Node $NODE_VERSION detected — type-stripping is default-on"
fi

# --- port preflight --------------------------------------------------------
for port in 47300 47321 47322 47323 47324; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[demo-bridge] NOTE: port $port is already in use:"
    lsof -nP -iTCP:"$port" -sTCP:LISTEN | tail -n +2 | sed 's/^/[demo-bridge]   /'
    if [[ "$port" == "47300" ]]; then
      echo "[demo-bridge]   A bridge is likely already running — the extension may connect to it as-is. To restart cleanly: $0 --fresh"
    else
      echo "[demo-bridge]   The bridge will use that external upstream as-is (external always wins over the embedded copy)."
    fi
  fi
done

# --- launch ----------------------------------------------------------------
echo "[demo-bridge] starting bridge on http://127.0.0.1:47300 (Ctrl-C to stop)"
# ${arr[@]+"${arr[@]}"} is the bash-3.2-safe empty-array idiom (set -u).
exec node ${STRIP_FLAG[@]+"${STRIP_FLAG[@]}"} browser-first/host/run-bridge-minimal.mjs \
  --bridge-port=47300 \
  --bridge-token=demo-bridge-token \
  --addon-runtime-read-token=demo-addon-runtime-read \
  --addon-runtime-control-token=demo-addon-runtime-control \
  --echo-bearer-token=demo-echo-bearer \
  --echo-admin-token=demo-echo-admin \
  --counter-bearer-token=demo-counter-bearer \
  --counter-admin-token=demo-counter-admin \
  --sdk-guide-bearer-token=demo-guide-bearer \
  --sdk-guide-admin-token=demo-guide-admin \
  --pi-bearer-token=demo-pi-bearer \
  --pi-admin-token=demo-pi-admin
