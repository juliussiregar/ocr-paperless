#!/usr/bin/env bash
# Cek cepat setelah client-up / server-up: health, Paperless, env kritis.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PORT="${APP_PORT:-3002}"
PL_PORT="${PAPERLESS_HOST_PORT:-8000}"
fail=0

info() { echo "==> $*"; }
ok() { echo "  OK  $*"; }
bad() { echo "  FAIL $*"; fail=1; }
warn() { echo "  WARN $*"; }

info "Health app :$PORT"
if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  if command -v jq >/dev/null 2>&1; then
    curl -sf "http://127.0.0.1:${PORT}/api/health" | jq '{status, checks, warnings}' || true
  fi
  ok "app health"
else
  bad "app health tidak merespons"
fi

info "Paperless :$PL_PORT"
if curl -sf -o /dev/null -I "http://127.0.0.1:${PL_PORT}" 2>/dev/null \
  || curl -sf -o /dev/null "http://127.0.0.1:${PL_PORT}" 2>/dev/null; then
  ok "Paperless reachable"
else
  warn "Paperless belum merespons di :$PL_PORT (bisa masih boot)"
fi

info "Env kritis"
openai_ok=1
token_ok=1
if [[ -z "${OPENAI_API_KEY:-}" ]] || [[ "${OPENAI_API_KEY}" == change-me* ]]; then
  warn "OPENAI_API_KEY kosong → Tanya Arsip / embedding off"
  openai_ok=0
else
  ok "OPENAI_API_KEY terisi"
fi
if [[ -z "${PAPERLESS_API_TOKEN:-}" ]]; then
  warn "PAPERLESS_API_TOKEN kosong → sync OCR ke DocSearch belum lengkap"
  token_ok=0
else
  ok "PAPERLESS_API_TOKEN terisi"
fi

echo
if [[ "$fail" -ne 0 ]]; then
  info "verify-up: ada kegagalan health"
  exit 1
fi
if [[ "$openai_ok" -eq 0 || "$token_ok" -eq 0 ]]; then
  info "verify-up: health OK, tapi Tanya Arsip/OCR belum siap (lihat WARN)"
  exit 2
fi
info "verify-up: lulus"
exit 0
