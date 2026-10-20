#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh into a NEW, empty Supabase project.
# Before running: in the new project's SQL Editor run 0001_core.sql, 0002_storage.sql and 0004_heartbeat.sql
# (not 0003_seed.sql: the backup carries your departments and checklist), and do not add any users.
# Usage: TARGET_DB_URL=... BACKUP_PASSPHRASE=... scripts/restore.sh beaconwarroom-<time>.tar.gz.gpg
set -euo pipefail
: "${TARGET_DB_URL:?Set TARGET_DB_URL (session pooler connection string of the new project)}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE}"
src=${1:?Give the backup file}
PG_BIN=${PG_BIN:-}
psql="${PG_BIN:+$PG_BIN/}psql"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt --output "$work/backup.tar.gz" "$src" 3<<<"$BACKUP_PASSPHRASE"
tar -xzf "$work/backup.tar.gz" -C "$work"

# Never restore over live data.
used=$("$psql" "$TARGET_DB_URL" -X -At -v ON_ERROR_STOP=1 -c \
  "select (select count(*) from public.events) + (select count(*) from auth.users)")
if [ "$used" != "0" ]; then
  echo "Target already has events or users. Restore only into a new, empty project." >&2
  exit 1
fi

# One transaction: all or nothing. Triggers are paused so history and logins load exactly as saved.
"$psql" "$TARGET_DB_URL" -X -q --single-transaction -v ON_ERROR_STOP=1 \
  -c 'set session_replication_role = replica' \
  -c 'delete from public.template_items' \
  -c 'delete from public.departments' \
  -c 'delete from public.heartbeat' \
  -f "$work/data.sql" >/dev/null

# Compare row counts with the backup.
bad=0
while IFS='|' read -r table want; do
  [ -n "$table" ] || continue
  have=$("$psql" "$TARGET_DB_URL" -X -At -c "select count(*) from $table" 2>/dev/null || echo missing)
  if [ "$have" != "$want" ]; then echo "MISMATCH $table: backup $want, restored $have" >&2; bad=1; fi
done < "$work/counts.txt"
[ "$bad" = 0 ] || exit 1
echo "Restored and verified $(grep -c . "$work/counts.txt") tables from $(basename "$src")."
