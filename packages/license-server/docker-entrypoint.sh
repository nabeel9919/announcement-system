#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
cd /app/packages/license-server
prisma migrate deploy --schema=src/db/schema.prisma

echo "[entrypoint] Starting license server..."
exec node /app/packages/license-server/dist/index.js
