#!/usr/bin/env bash
# Tests the keep-alive endpoint and the backup/restore scripts against the local stack.
# Needs: local stack running (Postgres :54322, gateway :54321 started with scripts/localstack/env.sh).
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/localstack/env.sh
SRC=postgresql://postgres:postgres@127.0.0.1:54322/postgres
TGT=postgresql://postgres:postgres@127.0.0.1:54322/restore_target
pass=0; fail=0
ok() { if eval "$2"; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1"; fail=$((fail+1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
q() { psql "$1" -X -At -c "$2"; }

# keep-alive
ok "keepalive refuses no secret" '[ "$(code localhost:54321/api/keepalive)" = 401 ]'
ok "keepalive refuses wrong secret" '[ "$(code -H "Authorization: Bearer nope" localhost:54321/api/keepalive)" = 401 ]'
body=$(curl -s -H "Authorization: Bearer $CRON_SECRET" localhost:54321/api/keepalive)
ok "keepalive succeeds with secret" '[ "$(echo "$body" | node -pe "JSON.parse(require(\"fs\").readFileSync(0)).ok")" = true ]'
n=$(q $SRC "select count(*) from heartbeat where source='keepalive' and at > now() - interval '1 minute'")
ok "keepalive check-in written" '[ "$n" = 1 ]'
ok "keepalive table hidden from app users" '! psql $SRC -X -q -c "set role authenticated; select * from public.heartbeat" 2>/dev/null'

# backup
out=$(mktemp -d)
export SUPABASE_DB_URL=$SRC BACKUP_PASSPHRASE='test pass phrase 42'
ok "backup runs" 'bash scripts/backup.sh "$out" > "$out/log" 2>&1'
file=$(ls "$out"/*.gpg 2>/dev/null | head -1)
ok "backup file written" '[ -s "$file" ]'
email=$(q $SRC "select email from auth.users limit 1")
ok "backup is encrypted (no readable emails)" '! grep -aq "$email" "$file" && ! gzip -t "$file" 2>/dev/null'
d=$(q $SRC "select detail from heartbeat where source='backup'")
ok "backup check-in written" '[ "$d" = "$(basename "$file")" ]'

# restore into a fresh database with the same structure (stands in for a new project with the migrations run)
psql $SRC -X -q -c "drop database if exists restore_target" -c "create database restore_target"
pg_dump $SRC --schema-only --no-owner | grep -v "^CREATE PUBLICATION\|^ALTER PUBLICATION" | psql $TGT -X -q -v ON_ERROR_STOP=1 >/dev/null
psql $TGT -X -q -f supabase/migrations/0003_seed.sql >/dev/null   # someone also ran the seed: restore must cope
ok "wrong passphrase refused" '! TARGET_DB_URL=$TGT BACKUP_PASSPHRASE=wrong bash scripts/restore.sh "$file" 2>/dev/null'
ok "restore runs and verifies counts" 'TARGET_DB_URL=$TGT bash scripts/restore.sh "$file" > "$out/rlog" 2>&1'
for t in public.events public.items public.item_updates public.incidents public.event_members public.profiles public.departments public.template_items public.compliance_findings auth.users auth.identities; do
  a=$(q $SRC "select md5(coalesce(string_agg(x::text, '' order by x::text), '')) from $t x")
  b=$(q $TGT "select md5(coalesce(string_agg(x::text, '' order by x::text), '')) from $t x")
  ok "identical after restore: $t" '[ "$a" = "$b" ]'
done
ok "second restore refused (target not empty)" '! TARGET_DB_URL=$TGT bash scripts/restore.sh "$file" 2>/dev/null'
n=$(q $TGT "select count(*) from pg_trigger where not tgisinternal and tgrelid='public.item_updates'::regclass")
ok "restored database keeps the status-change trigger" '[ "$n" -ge 1 ]'

psql $SRC -X -q -c "drop database restore_target"
rm -rf "$out"
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
