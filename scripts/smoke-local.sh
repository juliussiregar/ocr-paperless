#!/usr/bin/env bash
# Smoke lokal tanpa Docker: unit test Tanya Arsip + pre-deploy typecheck.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Unit tests (ask-mode, ask-evidence)"
cd app
npx tsx --test src/lib/ask-mode.test.ts src/lib/ask-evidence.test.ts
cd "$ROOT"

echo "==> Pre-deploy check"
bash scripts/pre-deploy-check.sh

echo
echo "OK: smoke lokal selesai."
echo "Di server client (setelah .env diisi): ./scripts/client-up.sh"
