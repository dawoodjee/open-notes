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
if [ "$(psql -tAc "select to_regclass('public.notes') is not null")" = "t" ]; then
  echo "migrate: schema already applied, skipping migrations"
else
  # Sorted so the timestamp-prefixed filenames apply in the order they were
  # written. The second migration depends on the first.
  for f in $(ls /migrations/*.sql | sort); do
    echo "migrate: applying $(basename "$f")"
    psql -f "$f"
  done
  echo "migrate: migrations applied"
fi

# Always, not only on first run. The migration deliberately creates this role
# with `password null` so that no working password is ever committed to the
# repo; without this line PowerSync fails with
#   28P01 password authentication failed for user "powersync_role"
# and replicates nothing, while every container still reports healthy. That
# combination -- silent, and healthy-looking -- is why this is here rather than
# in a setup step someone can skip.
psql -c "alter role powersync_role password '$POWERSYNC_REPLICATION_PASSWORD';"
echo "migrate: powersync_role password set"

echo "migrate: done"
