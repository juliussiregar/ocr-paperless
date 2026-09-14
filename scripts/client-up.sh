#!/usr/bin/env bash
# Satu perintah untuk client server: cek prasyarat → validasi .env → build & up DocSearch.
# Env diisi manual di .env (dari .env.example). Tidak perlu akses remote dari mesin ini.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

command -v docker >/dev/null 2>&1 || die "Docker belum terpasang"
docker compose version >/dev/null 2>&1 || die "Docker Compose plugin belum terpasang"

if [[ ! -f .env ]]; then
  cp .env.example .env
  die "File .env belum ada. Sudah disalin dari .env.example - edit dulu, lalu jalankan lagi: ./scripts/client-up.sh"
fi

info "Validasi & deploy DocSearch"
chmod +x scripts/server-up.sh scripts/pre-deploy-check.sh scripts/verify-up.sh 2>/dev/null || true
exec bash scripts/server-up.sh
