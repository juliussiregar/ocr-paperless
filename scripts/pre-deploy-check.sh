#!/usr/bin/env bash
# Quick gate sebelum deploy: typecheck + worker build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

die() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "OK: $*"; }

echo "==> Prisma generate"
npx prisma generate --schema=prisma/schema.prisma

echo "==> App typecheck"
cd app
npx tsc --noEmit
ok "app tsc"

echo "==> Sync-worker build"
cd "$ROOT/sync-worker"
npm run build
ok "sync-worker tsc"

echo "==> Schema parity (SyncFile fields)"
extract_sync_file_fields() {
  awk '/^model SyncFile \{/ { in_block=1; next }
       in_block && /^\}/ { exit }
       in_block && /^  [a-zA-Z@]/ { print }' "$1" | sort
}
MAIN_FIELDS=$(extract_sync_file_fields "$ROOT/prisma/schema.prisma" || true)
DOCKER_FIELDS=$(extract_sync_file_fields "$ROOT/prisma/schema.docker.prisma" || true)
if [[ "$MAIN_FIELDS" != "$DOCKER_FIELDS" ]]; then
  echo "WARN: model SyncFile berbeda antara schema.prisma dan schema.docker.prisma"
fi

echo
ok "Pre-deploy check selesai. Lanjut: git push + ./scripts/server-up.sh di server"
