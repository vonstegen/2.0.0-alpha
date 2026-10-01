#!/bin/bash
# Prints which extension folder to load in Chrome for each RUNNING bridge,
# per docs/DEV-LAYOUT.md ("Chrome loads the extension from the worktree whose
# bridge is running"). No secrets are ever printed — only paths and ports.
set -euo pipefail

echo "== Running browser-first bridges =="
found=0
while IFS= read -r pid_cmd; do
  pid=${pid_cmd%% *}
  cmd=${pid_cmd#* }
  # Resolve the worktree root: the first run-bridge-minimal.mjs on the cmdline
  # lives at <worktree>/browser-first/host/run-bridge-minimal.mjs.
  script=$(printf '%s\n' "$cmd" | sed -nE 's/.* ([^ ]*browser-first\/host\/run-bridge-minimal\.mjs).*/\1/p')
  [ -z "$script" ] && continue
  worktree=$(dirname "$(dirname "$(dirname "$script")")")
  port=$(lsof -nP -a -p "$pid" -iTCP -sTCP:LISTEN 2>/dev/null | sed -nE 's/.*:([0-9]+) \(LISTEN\).*/\1/p' | head -1)
  found=1
  echo
  echo "bridge pid $pid  port ${port:-?}"
  echo "  worktree:    $worktree"
  echo "  load folder: $worktree/browser-first/resonantos-side-panel-extension"
  echo "  then:        chrome://extensions -> Reload on the ResonantOS side panel"
done < <(pgrep -fl "run-bridge-minimal" | grep -v pgrep)

if [ "$found" -eq 0 ]; then
  echo "(none) Start a bridge first; it will rewrite its own worktree's"
  echo "bridge-config.generated.js at boot."
fi

echo
echo "== Chrome extension state =="
echo "Both checkouts share one extension ID (same manifest key), so switching"
echo "folders reuses the same Chrome storage — no duplicate extensions."
