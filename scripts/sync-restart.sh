#!/usr/bin/env bash
# Pause sync (cancel jobs) lalu start lagi (auto sync ON + delta semua user).
# Usage:
#   ./scripts/sync-restart.sh              # di server
#   ./scripts/sync-restart.sh arteloka    # dari laptop via ssh
set -euo pipefail

REMOTE_HOST="${1:-}"

run_restart() {
  set -euo pipefail
  cd "${HOME}/ocr-paperless"
  docker compose exec -T sync-worker node dist/cli/sync-restart-main.js
}

if [[ -n "$REMOTE_HOST" ]]; then
  ssh "$REMOTE_HOST" "$(declare -f run_restart); run_restart"
else
  run_restart
fi
