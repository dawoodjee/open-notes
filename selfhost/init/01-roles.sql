-- Give the Supabase service roles a password.
--
-- The Postgres image creates these roles but leaves them without passwords, so
-- GoTrue (supabase_auth_admin) and PostgREST (authenticator) cannot log in
-- until this runs. Symptom without it: those two containers restart forever
-- with "password authentication failed", while db itself is perfectly healthy.
--
-- Runs once, on an empty data directory. `docker compose down` then `up` does
-- NOT re-run it; only `down -v` does.
--
-- psql cannot read environment variables directly, hence the backtick trick:
-- \set runs a shell command and binds its output to a variable.

\set pgpass `echo "$POSTGRES_PASSWORD"`

alter user postgres with password :'pgpass';
alter user supabase_admin with password :'pgpass';
alter user authenticator with password :'pgpass';
alter user supabase_auth_admin with password :'pgpass';
alter user supabase_storage_admin with password :'pgpass';
alter user supabase_replication_admin with password :'pgpass';
alter user supabase_read_only_user with password :'pgpass';
alter user pgbouncer with password :'pgpass';
