#!/usr/bin/env sh
# Backup wrapper for cron (or any scheduler without PM2's env handling).
#
# Loads .env.production / .env (or ENV_FILE) so DB_PATH, BACKUP_DIR and
# BACKUP_RETENTION_DAYS are available, then runs the SQLite backup script and
# appends its output to logs/backup.log.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

ENVFILE=${ENV_FILE:-}
if [ -z "$ENVFILE" ]; then
  for candidate in .env.production .env; do
    if [ -f "$candidate" ]; then
      ENVFILE=$candidate
      break
    fi
  done
fi

if [ -n "$ENVFILE" ] && [ -f "$ENVFILE" ]; then
  set -a
  case "$ENVFILE" in
    /*) . "$ENVFILE" ;;
    *) . "./$ENVFILE" ;;
  esac
  set +a
fi

mkdir -p "${BACKUP_DIR:-./backups}" logs

{
  echo "[backup] $(date '+%Y-%m-%dT%H:%M:%S%z') starting"
  node scripts/backup-db.mjs
} >>logs/backup.log 2>&1
