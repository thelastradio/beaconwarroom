#!/usr/bin/env bash
# Makes an encrypted backup of the war room data.
# Usage: SUPABASE_DB_URL=... BACKUP_PASSPHRASE=... scripts/backup.sh [output-folder]
# Output: <folder>/beaconwarroom-<UTC time>.tar.gz.gpg (data.sql, schema.sql, counts.txt inside)
# Restore with scripts/restore.sh. Photos (Storage files) are not included, only their records.
set -euo pipefail
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE}"
out=${1:-backup}
PG_BIN=${PG_BIN:-}
pg_dump="${PG_BIN:+$PG_BIN/}pg_dump"
psql="${PG_BIN:+$PG_BIN/}psql"

mkdir -p "$out"
stamp=$(date -u +%Y%m%d-%H%M%S)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Data: every table in public, plus logins (auth.users, auth.identities) and photo records (storage.objects).
"$pg_dump" "$SUPABASE_DB_URL" --data-only --no-owner --no-privileges \
  --table='public.*' --table=auth.users --table=auth.identities --table=storage.objects \
  --file="$work/data.sql"
# Structure of the app tables, for reference if the migrations have changed since.
"$pg_dump" "$SUPABASE_DB_URL" --schema-only --no-owner --no-privileges --schema=public --file="$work/schema.sql"

grep -q 'PostgreSQL database dump complete' "$work/data.sql" || { echo "Backup incomplete" >&2; exit 1; }
# Row counts per table, taken from the dump itself; restore.sh checks against them.
scripts_dir=$(cd "$(dirname "$0")" && pwd)
awk -f "$scripts_dir/count_rows.awk" "$work/data.sql" > "$work/counts.txt"
grep -q '^public.events|' "$work/counts.txt" || { echo "Backup has no events table" >&2; exit 1; }

tar -czf "$work/backup.tar.gz" -C "$work" data.sql schema.sql counts.txt
file="$out/beaconwarroom-$stamp.tar.gz.gpg"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --symmetric --cipher-algo AES256 --output "$file" "$work/backup.tar.gz" 3<<<"$BACKUP_PASSPHRASE"

# Check-in (also counts as daily database activity).
"$psql" "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 -c \
  "insert into public.heartbeat (source, at, detail) values ('backup', now(), '$(basename "$file")')
   on conflict (source) do update set at = excluded.at, detail = excluded.detail" >/dev/null

echo "Backup written: $file ($(du -h "$file" | cut -f1), $(grep -c . "$work/counts.txt") tables)"
