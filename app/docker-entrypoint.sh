#!/bin/sh
set -e

SCHEMA=/app/prisma/schema.prisma
PRISMA="node /app/node_modules/prisma/build/index.js"

echo "Applying database migrations..."
if $PRISMA migrate deploy --schema="$SCHEMA"; then
  echo "migrate deploy OK; skip db push to preserve pgvector columns"
else
  echo "migrate deploy failed; falling back to prisma db push..."
  if ! $PRISMA db push --schema="$SCHEMA" --skip-generate; then
    echo "WARN: prisma db push failed; continuing to start Next.js"
  fi
fi

if [ -n "${ADMIN_EMAIL:-}" ]; then
  echo "Seeding admin user..."
  NODE_PATH=/app/node_modules node /app/prisma/docker-seed.mjs || echo "WARN: seed failed"
else
  echo "ADMIN_EMAIL not set; skip seed."
fi

# Resolve Next standalone server.js (flat or nested under app/)
if [ -f /app/server.js ]; then
  SERVER_JS=/app/server.js
elif [ -f /app/app/server.js ]; then
  SERVER_JS=/app/app/server.js
  cd /app/app
else
  echo "ERROR: server.js not found under /app"
  find /app -name 'server.js' -type f 2>/dev/null | head -20
  exit 1
fi

echo "Starting Next.js ($SERVER_JS)..."
exec node "$SERVER_JS"
