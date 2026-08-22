#!/bin/sh
set -e

SCHEMA=/app/prisma/schema.prisma
PRISMA="node /app/app/node_modules/prisma/build/index.js"

echo "Running database migrations..."
if $PRISMA migrate deploy --schema="$SCHEMA"; then
  echo "Migrations applied."
else
  echo "migrate deploy failed; falling back to db push..."
  $PRISMA db push --schema="$SCHEMA" --skip-generate
fi

if [ -n "${ADMIN_EMAIL:-}" ]; then
  echo "Seeding admin user..."
  # Resolve @prisma/client + bcryptjs from /app/app/node_modules
  NODE_PATH=/app/app/node_modules node /app/prisma/docker-seed.mjs
else
  echo "ADMIN_EMAIL not set; skip seed."
fi

echo "Starting Next.js..."
exec node server.js
