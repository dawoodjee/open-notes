#!/usr/bin/env bash
# Arm the daily account purge on the LOCAL dev stack (Stage 15b).
#
# The cron job scheduled by 20260929021900_stage15b_account_deletion.sql does
# nothing until two Vault secrets exist -- safe by default. This writes them:
#
#   account_purge_url     where the db container can reach the Edge Function
#   account_purge_secret  the shared secret the function checks on `purge`
#
# The secret is read from supabase/functions/.env (gitignored), the same file
# `supabase functions serve --env-file` hands to the function, so the two can
# never disagree. Idempotent: re-running replaces both values.
#
# LIVE is not done by this script. See docs/two-stacks.md -> "Account deletion"
# for the dashboard steps; live is never scripted from this machine.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=supabase/functions/.env
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Create it with:  printf 'PURGE_SECRET=%s\n' \"\$(openssl rand -hex 32)\" > $ENV_FILE" >&2
  exit 1
fi
PURGE_SECRET=$(grep -E '^PURGE_SECRET=' "$ENV_FILE" | cut -d= -f2-)
[[ -n "$PURGE_SECRET" ]] || { echo "PURGE_SECRET is empty in $ENV_FILE" >&2; exit 1; }

# From INSIDE the db container, the API gateway is the kong container on the
# CLI's docker network -- 127.0.0.1 would be the db container itself.
URL="http://supabase_kong_notes:8000/functions/v1/account-deletion"

docker exec -i supabase_db_notes psql -U postgres -v ON_ERROR_STOP=1 -q <<SQL
delete from vault.secrets where name in ('account_purge_url', 'account_purge_secret');
select vault.create_secret('$URL', 'account_purge_url');
select vault.create_secret('$PURGE_SECRET', 'account_purge_secret');
SQL
echo "Account purge armed on the local stack: $URL"
