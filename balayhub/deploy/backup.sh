#!/usr/bin/env bash
# Daily backup of the BalayHub database and uploaded files. Keeps 14 days.
# Run from the balayhub folder:  ./deploy/backup.sh   (cron example in DEPLOY-HOSTINGER.md)
set -euo pipefail
cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-$HOME/balayhub-backups}"
STAMP="$(date +%F-%H%M)"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file deploy/.env"
mkdir -p "$BACKUP_DIR"
$COMPOSE exec -T db pg_dump -U balayhub --clean --if-exists balayhub | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"
$COMPOSE exec -T app tar -czf - -C /data storage > "$BACKUP_DIR/uploads-$STAMP.tar.gz"
find "$BACKUP_DIR" -name '*.gz' -mtime +14 -delete
echo "Backup saved to $BACKUP_DIR ($STAMP)"
