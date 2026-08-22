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
    echo "WARN: NEXTAUTH_URL=$NEXTAUTH_URL - di server publik sebaiknya http://IP_ATAU_DOMAIN:3000"
    ;;
esac

mkdir -p paperless/consume paperless/export
touch paperless/consume/.gitkeep paperless/export/.gitkeep

info "Build & start (docker compose up -d --build)"
docker compose up -d --build

PORT="${APP_PORT:-3000}"
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
else
  echo "WARN: health belum OK dalam ~3 menit. Cek: docker compose logs -f app"
fi

echo
echo "Portal:  ${NEXTAUTH_URL}"
echo "Login:   ${ADMIN_EMAIL:-admin} / (ADMIN_PASSWORD di .env)"
echo "Paperless (localhost server saja): http://127.0.0.1:8000"
echo

if [[ -z "${PAPERLESS_API_TOKEN:-}" ]]; then
  cat <<EOF
Langkah sekali saja - Paperless API token:
  1) Di server: buka http://127.0.0.1:8000
     atau dari laptop: ssh -L 8000:127.0.0.1:8000 user@SERVER
  2) Login Paperless (PAPERLESS_ADMIN_USER / PAPERLESS_ADMIN_PASSWORD)
  3) Profile → API Auth Tokens → Create
  4) Paste ke .env: PAPERLESS_API_TOKEN=...
  5) docker compose up -d --force-recreate app sync-worker

EOF
else
  info "PAPERLESS_API_TOKEN sudah terisi."
fi

info "Selesai. Log: docker compose logs -f"
