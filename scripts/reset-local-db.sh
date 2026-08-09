#!/usr/bin/env bash
#
# The reset you actually run. `supabase db reset` on its own drops the whole
# database -- which since Stage 5 means dropping your account, and since we
# started using real devices means dropping real notes. This wraps it:
#
#   back up -> reset -> restore -> re-arm replication -> restart PowerSync
#
# Usage: scripts/reset-local-db.sh [--yes]

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="supabase_db_notes"
cd "$ROOT"

if [[ "${1:-}" != "--yes" ]]; then
  read -r -p "Reset the local database (data is backed up and restored)? [y/N] " reply
  [[ "$reply" == [yY]* ]] || { echo "Aborted."; exit 1; }
fi

BACKUP="$ROOT/supabase/backups/pre-reset-$(date +%Y%m%d-%H%M%S).sql"

echo "==> 1/5 backing up"
"$ROOT/scripts/backup-local-data.sh" "$BACKUP"

echo "==> 2/5 supabase db reset"
supabase db reset

echo "==> 3/5 restoring"
"$ROOT/scripts/restore-local-data.sh" "$BACKUP"

echo "==> 4/5 re-arming powersync_role"
# Not optional, and the single easiest way to lose an afternoon on this
# project. The migration creates the role with `password null`, so every reset
# leaves replication authenticating with no password and PowerSync stuck on
#   28P01 password authentication failed for user "powersync_role"
# with nothing obviously wrong anywhere else.
if [[ ! -f "$ROOT/.env" ]]; then
  echo "error: no .env at $ROOT -- cannot recover POWERSYNC_REPLICATION_PASSWORD" >&2
  exit 1
fi
PS_PASSWORD=$(grep -E '^POWERSYNC_REPLICATION_PASSWORD=' "$ROOT/.env" | cut -d= -f2-)
if [[ -z "$PS_PASSWORD" ]]; then
  echo "error: POWERSYNC_REPLICATION_PASSWORD is empty in $ROOT/.env" >&2
  exit 1
fi
docker exec -i "$CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 --quiet \
  -c "alter role powersync_role password '$PS_PASSWORD';"

echo "==> 5/5 restarting PowerSync"
# PowerSync keeps its own bucket/checkpoint state in this same database
# (PS_STORAGE_URI), so the reset wiped that too. Restarting makes it rebuild
# from scratch and re-replicate; the devices then re-pull. Your notes are
# already back from step 3 -- it's only the sync bookkeeping being rebuilt.
docker compose restart powersync
sleep 5

# Prove it actually restarted rather than trusting a zero exit code -- compose
# will happily no-op if it resolves the wrong project name (see the `name:` key
# in docker-compose.yml for why that used to happen from a worktree).
started_at=$(docker inspect notes-powersync-1 --format '{{.State.StartedAt}}')
echo "PowerSync container started at: $started_at"

status=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/probes/liveness || true)
echo "PowerSync liveness: $status"
[[ "$status" == "200" ]] || echo "  (not 200 yet -- give it a few more seconds, then check: docker compose logs powersync)"

echo
echo "Done. Backup kept at $BACKUP"
