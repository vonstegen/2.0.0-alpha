#!/usr/bin/env bash
# ResonantOS test-bench entrypoint.
#
# Boots:
#   - 3 addon stub HTTP servers (DeepSeek :3080, RecursiveMAS :4891,
#     Reference Memory :4888)
#   - the browser-first bridge on :47773
#
# All four run in the foreground in this container. Logs go to
# /var/log/resonant-bench/*.log AND stdout (tee), so `docker compose logs`
# shows them in real time. The bridge is the foreground process; the
# addon stubs run in the background and are killed when the bridge exits.
#
# Args:
#   up          start the bench (default)
#   roundtrip   run bench/roundtrip.mjs against an already-running bench
#
# Exit codes:
#   0  bridge exited cleanly
#   1  bridge exited non-zero

set -euo pipefail

mkdir -p "$ADDON_STUB_LOG_DIR"

log() { printf '[bench-entry] %s\n' "$*"; }

start_stub() {
  local addon_id="$1" port="$2" model="$3"
  log "starting stub $addon_id on :$port"
  node /app/bench/stub.mjs "$addon_id" "$port" "$model" \
    >>"$ADDON_STUB_LOG_DIR/${addon_id}.log" 2>&1 &
  echo $! > "$ADDON_STUB_LOG_DIR/${addon_id}.pid"
}

# Health probe via Node — the slim image has no curl. Polls /healthz up
# to ~15s (30 * 0.5s) and exits 0 on first 200.
wait_for_health() {
  local port="$1" name="$2"
  log "waiting for $name on :$port to be healthy"
  for _ in $(seq 1 30); do
    if node -e "fetch('http://127.0.0.1:${port}/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
      log "$name is healthy"
      return 0
    fi
    sleep 0.5
  done
  log "FATAL: $name did not become healthy within 15s"
  return 1
}

cmd="${1:-up}"

case "$cmd" in
  up)
    log "boot order: addon stubs -> health gate -> bridge"
    start_stub addon.deepseek-harness    3080 deepseek-chat
    start_stub addon.recursive-mas        4891 recursive-mas-light
    start_stub addon.reference-memory     4888 memory-search-stub

    wait_for_health 3080 deepseek-harness
    wait_for_health 4891 recursive-mas
    wait_for_health 4888 reference-memory

    log "starting bridge on :47773"
    exec node browser-first/host/run-bridge-minimal.mjs
    ;;

  roundtrip)
    log "running round-trip through the bridge"
    exec node /app/bench/roundtrip.mjs
    ;;

  *)
    log "unknown command: $cmd (expected: up | roundtrip)"
    exit 64
    ;;
esac