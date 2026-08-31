#!/usr/bin/env bash
# Deploy matang di server: build + up semua service (termasuk app), tanpa Nginx.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

if [[ ! -f .env ]]; then
  cp .env.example .env
  die "File .env belum ada. Sudah disalin dari .env.example - edit dulu (password, NEXTAUTH_URL, dll), lalu jalankan lagi."
fi

# Load .env for checks (ignore comments / blank)
set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ "${COMPOSE_PROFILES:-}" != *prod* ]]; then
  info "Menambahkan COMPOSE_PROFILES=prod ke .env (agar service app ikut naik)"
  printf '\nCOMPOSE_PROFILES=prod\n' >> .env
  export COMPOSE_PROFILES=prod
fi

require_set() {
  local key="$1"
  local val="${!key:-}"
  if [[ -z "$val" ]]; then
    die "$key kosong di .env"
  fi
  if [[ "$val" == change-me* ]] || [[ "$val" == SERVER_IP* ]] || [[ "$val" == *"SERVER_IP"* ]]; then
    die "$key masih placeholder. Ganti di .env"
  fi
}

require_set POSTGRES_PASSWORD
require_set PAPERLESS_SECRET_KEY
require_set PAPERLESS_ADMIN_PASSWORD
require_set NEXTAUTH_URL
require_set NEXTAUTH_SECRET
require_set ENCRYPTION_KEY
require_set ADMIN_PASSWORD

if [[ "${#ENCRYPTION_KEY}" -lt 32 ]]; then
  die "ENCRYPTION_KEY minimal 32 karakter"
fi

if [[ "${#ADMIN_PASSWORD}" -lt 8 ]]; then
  die "ADMIN_PASSWORD minimal 8 karakter"
fi

case "$NEXTAUTH_URL" in
  http://localhost*|http://127.0.0.1*)
    echo "WARN: NEXTAUTH_URL=$NEXTAUTH_URL - di server publik sebaiknya http://IP_ATAU_DOMAIN:${APP_PORT:-3002}"
    ;;
esac

# Port app bentrok dengan service lain di host?
PORT="${APP_PORT:-3002}"
if command -v ss >/dev/null 2>&1; then
  if ss -lnt | awk '{print $4}' | grep -E ":${PORT}\$" >/dev/null 2>&1; then
    echo "WARN: port ${PORT} sudah listen di host. Ganti APP_PORT di .env (arteloka pakai 3001 → pakai 3002)."
  fi
fi

mkdir -p paperless/consume paperless/export
touch paperless/consume/.gitkeep paperless/export/.gitkeep

# VPS kecil tanpa swap: saran (opsional, tidak dijalankan otomatis)
if [[ "$(free -b | awk '/Mem:/{print $2}')" -lt 5000000000 ]]; then
  if [[ "$(free -b | awk '/Swap:/{print $2}')" -eq 0 ]]; then
    echo "WARN: RAM <5GB dan Swap=0. OCR Paperless bisa OOM. Disarankan buat swap 2G:"
    echo "  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"
  fi
fi

info "Build & start (docker compose up -d --build) project=docsearch"
docker compose up -d --build

info "Menunggu app sehat di :$PORT ..."
ok=0
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 3
done

echo
docker compose ps
echo

if [[ "$ok" -eq 1 ]]; then
  info "App OK: http://127.0.0.1:${PORT}/api/health"
  if command -v jq >/dev/null 2>&1; then
    curl -sf "http://127.0.0.1:${PORT}/api/health" | jq '{status, checks, warnings}'
  else
    curl -sf "http://127.0.0.1:${PORT}/api/health" || true
  fi
else
  echo "WARN: health belum OK dalam ~3 menit. Cek: docker compose logs -f app"
fi

echo
echo "Portal:  ${NEXTAUTH_URL}"
echo "Login:   ${ADMIN_EMAIL:-admin} / (ADMIN_PASSWORD di .env)"
echo "Paperless (localhost saja): http://127.0.0.1:${PAPERLESS_HOST_PORT:-8000}"
echo "Host ports: app ${PORT} | pg 127.0.0.1:${POSTGRES_HOST_PORT:-5434} | redis 127.0.0.1:${REDIS_HOST_PORT:-6380}"
echo

if [[ -z "${PAPERLESS_API_TOKEN:-}" ]]; then
  cat <<EOF
Langkah sekali saja - Paperless API token:
  1) Di server: curl -I http://127.0.0.1:${PAPERLESS_HOST_PORT:-8000}
     atau dari laptop: ssh -L 8000:127.0.0.1:${PAPERLESS_HOST_PORT:-8000} user@SERVER
  2) Login Paperless (PAPERLESS_ADMIN_USER / PAPERLESS_ADMIN_PASSWORD)
  3) Profile → API Auth Tokens → Create
  4) Paste ke .env: PAPERLESS_API_TOKEN=...
  5) docker compose up -d --force-recreate app sync-worker

EOF
else
  info "PAPERLESS_API_TOKEN sudah terisi."
fi

info "Selesai. Log: docker compose logs -f"
info "Stop DocSearch saja (arteloka tetap jalan): docker compose down"
