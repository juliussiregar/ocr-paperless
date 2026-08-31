#!/usr/bin/env bash
# Deploy DocSearch ke server via git pull (bukan rsync).
# Usage (dari laptop):
#   ./scripts/deploy-remote.sh arteloka
# Di server langsung:
#   cd ~/ocr-paperless && ./scripts/deploy-remote.sh
set -euo pipefail

REMOTE_HOST="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

remote_deploy() {
  set -euo pipefail
  cd "${HOME}/ocr-paperless"
  echo "==> git pull"
  git fetch origin
  git pull --ff-only origin main

  if [[ ! -f .env ]]; then
    echo "ERROR: .env belum ada. cp .env.example .env lalu edit."
    exit 1
  fi

  # Soft defaults without overwriting user values
  append_env_if_missing() {
    local key="$1" val="$2"
    if ! grep -q "^${key}=" .env; then
      echo "${key}=${val}" >> .env
    fi
  }
  append_env_if_missing PAPERLESS_CONSUMER_POLLING 5
  append_env_if_missing OCR_RECONCILE_INTERVAL_MS 10000
  append_env_if_missing COMPOSE_PROFILES prod
  append_env_if_missing SCAN_MAX_FILES 150
  append_env_if_missing SCAN_DISCOVER_CONCURRENCY 6
  append_env_if_missing SCAN_INGEST_CONCURRENCY 6
  append_env_if_missing WEBDAV_DISCOVERY_CONCURRENCY 32
  append_env_if_missing WEBDAV_DOWNLOAD_CONCURRENCY 6
  append_env_if_missing POST_SYNC_WARM_ENABLED true
  append_env_if_missing POST_SYNC_WARM_MAX_DIRS 24
  append_env_if_missing EMBED_BACKFILL_BATCH 25

  export COMPOSE_PARALLEL_LIMIT=1
  export DOCKER_BUILDKIT=1

  echo "==> build app + sync-worker (serial)"
  docker compose build sync-worker
  docker compose build app

  echo "==> recreate app (db push runs in entrypoint)"
  docker compose up -d --force-recreate app

  echo "==> wait for app health + schema sync"
  for _ in $(seq 1 40); do
    if curl -sf "http://127.0.0.1:${APP_PORT:-3002}/api/health" >/dev/null; then
      echo "OK http://127.0.0.1:${APP_PORT:-3002}/api/health"
      break
    fi
    sleep 3
  done

  echo "==> recreate sync-worker (after schema ready)"
  docker compose up -d --force-recreate sync-worker

  echo "==> final health"
  for _ in $(seq 1 40); do
    if curl -sf "http://127.0.0.1:${APP_PORT:-3002}/api/health" >/dev/null; then
      echo "OK http://127.0.0.1:${APP_PORT:-3002}/api/health"
      docker compose ps
      exit 0
    fi
    sleep 3
  done
  echo "WARN: health belum OK"
  docker compose logs --tail=40 app
  exit 1
}

if [[ -n "$REMOTE_HOST" ]]; then
  echo "==> push origin main (pastikan sudah commit)"
  cd "$ROOT"
  git push origin main
  echo "==> run deploy on $REMOTE_HOST"
  ssh "$REMOTE_HOST" "$(declare -f remote_deploy); remote_deploy"
else
  remote_deploy
fi
