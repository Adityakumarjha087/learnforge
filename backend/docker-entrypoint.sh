#!/bin/sh
set -e
echo "[learnforge-api] applying database migrations"
npx prisma migrate deploy --schema prisma/schema.prisma
if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[learnforge-api] seeding demo data (idempotent)"
  node dist/seed.js
fi
exec node dist/index.js
