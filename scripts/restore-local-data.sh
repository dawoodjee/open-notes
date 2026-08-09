#!/usr/bin/env bash
#
# Replay a dump produced by backup-local-data.sh back into the local Supabase
# database.
#
# Usage: scripts/restore-local-data.sh [dump-file]
#        (default: the newest file in supabase/backups/)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="supabase_db_notes"

DUMP="${1:-}"
if [[ -z "$DUMP" ]]; then
  DUMP=$(ls -t "$ROOT"/supabase/backups/*.sql 2>/dev/null | head -1 || true)
fi

if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "error: no dump to restore (looked in $ROOT/supabase/backups)" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "error: $CONTAINER is not running -- start Supabase first (supabase start)" >&2
  exit 1
fi

echo "Restoring $DUMP"

# ON_ERROR_STOP turns a partial restore into a loud failure instead of a
# half-populated database that looks fine until sync misbehaves. The dump's own
# ON CONFLICT DO NOTHING clauses make a re-run harmless.
# stdout is discarded (it's just per-statement chatter); errors still surface on
# stderr and ON_ERROR_STOP still aborts the whole load.
docker exec -i "$CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 --quiet < "$DUMP" > /dev/null

for t in auth.users auth.identities public.profiles public.notes; do
  count=$(docker exec -i "$CONTAINER" psql -U supabase_admin -d postgres -tAc "select count(*) from $t")
  printf '  %-20s %s rows\n' "$t" "$count"
done
