#!/usr/bin/env bash
#
# Dump the rows that represent "you" out of the local Supabase database, so a
# `supabase db reset` stops being a data-loss event.
#
# There is no pg_dump on this Mac's PATH, and installing one risks a version
# skew with the server. Instead this runs the Postgres 17 client that already
# lives *inside* the database container, and streams the dump out over stdout.
#
# Connects as supabase_admin, not postgres. Contrary to what you'd assume,
# `postgres` is NOT the superuser in a Supabase stack -- supabase_admin is, and
# auth.users is owned by supabase_auth_admin. As postgres, the restore's
# ALTER TABLE ... DISABLE TRIGGER ALL fails with "must be owner of table users".
#
# Usage: scripts/backup-local-data.sh [output-file]
#        (default: supabase/backups/<timestamp>.sql)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="supabase_db_notes"

# Only the four tables that hold identity and content. Deliberately NOT
# auth.sessions or auth.refresh_tokens: a reset invalidates them anyway, and
# signing in again on each device is a five-second cost that isn't worth the
# risk of restoring a token that points at a row we didn't keep.
TABLES=(auth.users auth.identities public.profiles public.notes)

OUT="${1:-$ROOT/supabase/backups/$(date +%Y%m%d-%H%M%S).sql}"
mkdir -p "$(dirname "$OUT")"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "error: $CONTAINER is not running -- start Supabase first (supabase start)" >&2
  exit 1
fi

args=(--data-only --disable-triggers --inserts --on-conflict-do-nothing --rows-per-insert=100)
for t in "${TABLES[@]}"; do args+=(--table="$t"); done

# --disable-triggers is what makes restore order irrelevant. auth.identities,
# public.profiles and public.notes all carry foreign keys to auth.users, and
# pg_dump does not guarantee it emits parents before children in --data-only
# mode. Wrapping the load in ALTER TABLE ... DISABLE TRIGGER ALL sidesteps the
# whole problem -- and it also stops the handle_new_user trigger firing on the
# restored auth.users rows, which would otherwise fight the profiles rows we
# are restoring by hand.
docker exec -i "$CONTAINER" pg_dump -U supabase_admin -d postgres "${args[@]}" > "$OUT"

echo "Backed up to $OUT ($(wc -l < "$OUT" | tr -d ' ') lines)"
for t in "${TABLES[@]}"; do
  count=$(docker exec -i "$CONTAINER" psql -U supabase_admin -d postgres -tAc "select count(*) from $t")
  printf '  %-20s %s rows\n' "$t" "$count"
done
