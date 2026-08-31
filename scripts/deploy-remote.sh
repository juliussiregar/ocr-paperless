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

  append_env_if_missing() {
    local key="$1" val="$2"
    if ! grep -q "^${key}=" .env; then
      echo "${key}=${val}" >> .env
    fi
  }

  upsert_env() {
    local key="$1" val="$2"
    if grep -q "^${key}=" .env; then
      sed -i.bak "s/^${key}=.*/${key}=${val}/" .env && rm -f .env.bak
    else
      echo "${key}=${val}" >> .env
    fi
  }

  echo "==> apply tier max defaults (8GB VPS)"
  append_env_if_missing COMPOSE_PROFILES prod

  upsert_env POSTGRES_MEM_LIMIT 1536m
  upsert_env REDIS_MEM_LIMIT 512m
  upsert_env REDIS_MAXMEMORY 512mb
  upsert_env REDIS_MAXMEMORY_POLICY noeviction
  upsert_env PAPERLESS_MEM_LIMIT 3584m
  upsert_env PAPERLESS_TASK_WORKERS 4
  upsert_env PAPERLESS_THREADS_PER_WORKER 2
  upsert_env PAPERLESS_CONVERT_MEMORY_LIMIT 1024
  upsert_env PAPERLESS_CONSUMER_POLLING 3
  upsert_env APP_MEM_LIMIT 1024m
  upsert_env SYNC_WORKER_MEM_LIMIT 1536m
  upsert_env SCAN_MAX_FILES 750
  upsert_env SCAN_DISCOVER_CONCURRENCY 8
  upsert_env SCAN_INGEST_CONCURRENCY 8
  upsert_env WEBDAV_DISCOVERY_CONCURRENCY 32
  upsert_env WEBDAV_DOWNLOAD_CONCURRENCY 10
  upsert_env POST_SYNC_WARM_ENABLED true
  upsert_env POST_SYNC_WARM_MAX_DIRS 40
  upsert_env OCR_RECONCILE_INTERVAL_MS 5000
  upsert_env OCR_RECONCILE_BATCH 300
  upsert_env EMBED_BACKFILL_BATCH 35
  upsert_env EMBED_PAUSE_DURING_INGEST true

  export COMPOSE_PARALLEL_LIMIT=1
  export DOCKER_BUILDKIT=1

  echo "==> build app + sync-worker (serial)"
  docker compose build sync-worker
  docker compose build app

  echo "==> recreate infra + app + worker (mem limits & env)"
  docker compose up -d --force-recreate redis paperless app sync-worker

  echo "==> wait for app health + schema sync"
  for _ in $(seq 1 40); do
    if curl -sf "http://127.0.0.1:${APP_PORT:-3002}/api/health" >/dev/null; then
      echo "OK http://127.0.0.1:${APP_PORT:-3002}/api/health"
      break
    fi
    sleep 3
  done

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
