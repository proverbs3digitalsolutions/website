#!/usr/bin/env bash
# Pull the latest code and restart BalayHub. Database migrations run automatically on start.
set -euo pipefail
cd "$(dirname "$0")/.."
./deploy/backup.sh
git pull --ff-only
docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d --build
docker image prune -f >/dev/null
echo "BalayHub updated."
