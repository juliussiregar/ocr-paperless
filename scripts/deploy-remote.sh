#!/usr/bin/env bash
# Deploy DocSearch ke server via git pull (bukan rsync).
# Usage (dari laptop):
#   ./scripts/deploy-remote.sh user@SERVER_HOST
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

  echo "==> apply tier max defaults (8GB VPS) + missing env keys"
  append_env_if_missing COMPOSE_PROFILES prod
  append_env_if_missing POSTGRES_HOST_PORT 5434
  append_env_if_missing REDIS_HOST_PORT 6380
  append_env_if_missing PAPERLESS_HOST_PORT 8000
  append_env_if_missing PAPERLESS_WEBSERVER_WORKERS 2
  append_env_if_missing BAPPENAS_URL https://cloud.bappenas.go.id
  append_env_if_missing INGEST_AUTO_RETRY_MAX 1

  upsert_env POSTGRES_MEM_LIMIT 1536m
  append_env_if_missing POSTGRES_MAX_CONNECTIONS 200
  upsert_env REDIS_MEM_LIMIT 512m
  upsert_env REDIS_MAXMEMORY 512mb
  upsert_env REDIS_MAXMEMORY_POLICY noeviction
  upsert_env PAPERLESS_MEM_LIMIT 3584m
  upsert_env PAPERLESS_TASK_WORKERS 5
  upsert_env PAPERLESS_THREADS_PER_WORKER 2
  upsert_env PAPERLESS_CONVERT_MEMORY_LIMIT 1024
  upsert_env PAPERLESS_CONSUMER_POLLING 3
  upsert_env APP_MEM_LIMIT 1024m
  upsert_env SYNC_WORKER_MEM_LIMIT 1536m
  upsert_env SCAN_MAX_FILES 750
  upsert_env SCAN_DISCOVER_CONCURRENCY 12
  upsert_env SCAN_INGEST_CONCURRENCY 12
  upsert_env WEBDAV_DISCOVERY_CONCURRENCY 24
  upsert_env WEBDAV_DOWNLOAD_CONCURRENCY 14
  upsert_env WEBDAV_TOTAL_CONCURRENCY 28
  append_env_if_missing PRISMA_CONNECTION_LIMIT_APP 8
  upsert_env PRISMA_CONNECTION_LIMIT_WORKER 16
  append_env_if_missing PRISMA_POOL_TIMEOUT 30
  upsert_env FOLDER_SNAPSHOT_UPSERT_CONCURRENCY 4
  upsert_env FOLDER_SNAPSHOT_BATCH_SIZE 40
  append_env_if_missing DB_HOT_CLIENTS_THRESHOLD 130
  append_env_if_missing DB_HOT_MAX_WAIT_MS 120000
  append_env_if_missing FULL_WALK_INTERVAL_MS 10800000
  upsert_env POST_SYNC_WARM_ENABLED true
  upsert_env POST_SYNC_WARM_MAX_DIRS 40
  upsert_env OCR_RECONCILE_INTERVAL_MS 5000
  upsert_env OCR_RECONCILE_BATCH 300
  upsert_env EMBED_BACKFILL_BATCH 35
  upsert_env EMBED_PAUSE_DURING_INGEST true

  echo "==> Tanya Arsip env defaults (D1-D3)"
  append_env_if_missing ASK_VERIFY_ANSWER true
  append_env_if_missing ASK_VERIFY_CONTEXT_CHARS 40000
  append_env_if_missing ASK_AI_SEARCH_KEYWORDS true
  append_env_if_missing ASK_HYDE_ENABLED true
  append_env_if_missing ASK_RERANK_ENABLED true
  append_env_if_missing ASK_SEARCH_CACHE true
  append_env_if_missing ASK_SEARCH_CACHE_TTL_MS 60000
  append_env_if_missing ASK_AGENT_LOOP false
  append_env_if_missing ASK_AGENT_SECOND_PASS true
  append_env_if_missing ASK_PGVECTOR_TOP_K 80
  append_env_if_missing ASK_DOC_SUMMARY_ENABLED true
  append_env_if_missing ASK_VISION_ENABLED true
  append_env_if_missing PAPERLESS_FETCH_RETRIES 2

  export COMPOSE_PARALLEL_LIMIT=1
  export DOCKER_BUILDKIT=1

  echo "==> build app + sync-worker (serial)"
  docker compose build sync-worker
  docker compose build app

  echo "==> recreate postgres (pgvector + max_connections) + redis + paperless + app + worker"
  docker compose up -d --force-recreate postgres redis paperless app sync-worker

  echo "==> ensure pgvector extension on app DB"
  PGUSER="$(grep '^POSTGRES_USER=' .env | cut -d= -f2- | tr -d '\r')"
  docker compose exec -T postgres psql -U "$PGUSER" -d app -c "CREATE EXTENSION IF NOT EXISTS vector;" || true

  echo "==> wait for app health + schema sync"
  for _ in $(seq 1 40); do
    if curl -sf "http://127.0.0.1:${APP_PORT:-3002}/api/health" >/dev/null; then
      echo "OK http://127.0.0.1:${APP_PORT:-3002}/api/health"
      break
    fi
    sleep 3
  done

  echo "==> migrate legacy empty FAILED to SKIPPED warnings"
  PGUSER="$(grep '^POSTGRES_USER=' .env | cut -d= -f2- | tr -d '\r')"
  docker compose exec -T postgres psql -U "$PGUSER" -d app <<'SQL'
UPDATE sync_files
SET sync_status = 'SKIPPED',
    error_message = 'Peringatan: file kosong (0 byte). Tidak bisa di-OCR. Perbaiki atau ganti file di Cloud Bappenas.',
    ocr_pending_at = NULL
WHERE sync_status = 'FAILED'
  AND (
    file_size = 0
    OR error_message ILIKE '%file kosong%'
    OR error_message ILIKE '%0 byte%'
  );
SQL

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
