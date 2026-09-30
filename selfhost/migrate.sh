#!/bin/bash
# Applies this repo's schema to the self-hosted database, then arms
# powersync_role. Runs as the one-shot `migrator` service and exits.
#
# WHY THIS ISN'T A db INIT SCRIPT. The schema declares
#     user_id uuid references auth.users (id)
# and auth.users is created by GoTrue's own migrations when the auth container
# starts -- not by the Postgres image. Anything in
# /docker-entrypoint-initdb.d/ runs strictly before that and dies on a table
# that does not exist yet. Compose's `depends_on: auth: service_healthy` is the
# ordering this needs, and only a service can express it.
set -euo pipefail

export PGPASSWORD="$POSTGRES_PASSWORD"
psql() { command psql -v ON_ERROR_STOP=1 -h db -U supabase_admin -d postgres --quiet "$@"; }

# Wait for auth.users specifically, not just for the auth container's health
# check. GoTrue reports healthy as soon as it is serving, which can be a moment
# before its migrations have finished creating the table.
echo "migrate: waiting for auth.users"
for i in $(seq 1 60); do
  if [ "$(psql -tAc "select to_regclass('auth.users') is not null")" = "t" ]; then
    echo "migrate: auth.users present"
    break
  fi
  if [ "$i" = "60" ]; then
    echo "migrate: gave up waiting for auth.users after 60s" >&2
    exit 1
  fi
  sleep 1
done

# Idempotency. Compose re-runs this service on every `up`, and the migrations
# are not all guarded internally -- `create publication powersync` in
# particular fails on a second run. Presence of public.notes means the schema
# is applied.
# ─── Migrations, applied incrementally ───────────────────────────────────
#
# THIS USED TO BE ALL-OR-NOTHING: "if public.notes exists, skip every
# migration". That meant an install could never receive a migration written
# after it was first set up -- found in Stage 15b, when account deletion's table
# would never have reached an existing self-host install, and neither would
# Stage 13's user_settings for anyone who installed before it.
#
# Now each applied migration is recorded, and only unrecorded ones run, each
# in its own transaction (psql -1) so a failure leaves nothing half-applied.

psql -c "create table if not exists public._selfhost_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
revoke all on public._selfhost_migrations from anon, authenticated;"

# Installs made by the OLD migrator have their schema but recorded nothing. For
# those, each migration is recognised by an object it creates, and recorded
# without being re-run. Runs once: the first time this finds the record empty
# on a database that already has notes. Migrations written after this change
# need no entry here -- they are recorded as they are applied.
signature() {
  case "$1" in
    20260806122256_notes_and_profiles.sql)   echo "to_regclass('public.notes') is not null" ;;
    20260811110910_stage6_forward_fix.sql)   echo "exists (select 1 from information_schema.columns where table_schema='public' and table_name='notes' and column_name='is_hidden_from_api')" ;;
    20260819124553_grant_service_role_reads.sql) echo "has_table_privilege('service_role', 'public.user_keys', 'SELECT')" ;;
    20260821063141_stage10_folders.sql)      echo "to_regclass('public.folders') is not null" ;;
    20260821122441_folders_is_enabled.sql)   echo "exists (select 1 from information_schema.columns where table_schema='public' and table_name='folders' and column_name='is_enabled')" ;;
    20260821165738_stage11_notes_is_pinned.sql) echo "exists (select 1 from information_schema.columns where table_schema='public' and table_name='notes' and column_name='is_pinned')" ;;
    20260826223706_stage13_user_settings.sql) echo "to_regclass('public.user_settings') is not null" ;;
    20260929021900_stage15b_account_deletion.sql) echo "to_regclass('public.account_deletions') is not null" ;;
    *) echo "false" ;;
  esac
}

if [ "$(psql -tAc "select count(*) from public._selfhost_migrations")" = "0" ] \
   && [ "$(psql -tAc "select to_regclass('public.notes') is not null")" = "t" ]; then
  echo "migrate: install from the old migrator -- recording what is already applied"
  for f in $(ls /migrations/*.sql | sort); do
    name=$(basename "$f")
    if [ "$(psql -tAc "select $(signature "$name")")" = "t" ]; then
      psql -c "insert into public._selfhost_migrations (name) values ('$name') on conflict do nothing;"
      echo "migrate:   already present: $name"
    fi
  done
fi

applied=0
for f in $(ls /migrations/*.sql | sort); do
  name=$(basename "$f")
  if [ "$(psql -tAc "select exists (select 1 from public._selfhost_migrations where name = '$name')")" = "t" ]; then
    continue
  fi
  echo "migrate: applying $name"
  psql -1 -f "$f"
  psql -c "insert into public._selfhost_migrations (name) values ('$name');"
  applied=$((applied + 1))
done
echo "migrate: $applied migration(s) applied"

psql -c "alter role powersync_role password '$POWERSYNC_REPLICATION_PASSWORD';"
echo "migrate: powersync_role password set"

# ─── Arm the daily account purge (Stage 15b) ──────────────────────────────
#
# The cron job from the 15b migration does nothing until Vault holds the
# function URL and the shared secret. Set here from .env, so a self-hoster gets
# a working purge without touching SQL. Skipped when PURGE_SECRET is unset --
# the job then stays inert, which is safe: nothing is ever deleted by a stack
# that was not deliberately told how.
if [ -n "${PURGE_SECRET:-}" ]; then
  psql -c "delete from vault.secrets where name in ('account_purge_url', 'account_purge_secret');"
  psql -c "select vault.create_secret('http://kong:8000/functions/v1/account-deletion', 'account_purge_url');" >/dev/null
  psql -c "select vault.create_secret('$PURGE_SECRET', 'account_purge_secret');" >/dev/null
  echo "migrate: account purge armed"
else
  echo "migrate: PURGE_SECRET unset -- account purge left inert"
fi

echo "migrate: done"
