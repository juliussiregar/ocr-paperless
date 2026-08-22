#!/bin/sh
set -e

SCHEMA=/app/prisma/schema.prisma
PRISMA="node /app/app/node_modules/prisma/build/index.js"

echo "Applying database migrations..."
if ! $PRISMA migrate deploy --schema="$SCHEMA"; then
  echo "migrate deploy failed; continuing with db push..."
fi

# Safety net: keep DB aligned with prisma/schema.prisma on every boot
echo "Syncing schema (prisma db push)..."
$PRISMA db push --schema="$SCHEMA" --skip-generate

if [ -n "${ADMIN_EMAIL:-}" ]; then
  echo "Seeding admin user..."
  NODE_PATH=/app/app/node_modules node /app/prisma/docker-seed.mjs
else
  echo "ADMIN_EMAIL not set; skip seed."
fi

echo "Starting Next.js..."
exec node server.js
