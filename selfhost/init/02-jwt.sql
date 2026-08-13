-- Publish the JWT secret as a database setting.
--
-- Some Supabase-provided SQL helpers read `app.settings.jwt_secret` rather than
-- being handed it. PostgREST in this stack is configured with PGRST_JWT_SECRET
-- directly and does not depend on this, but the setting is cheap and its
-- absence produces confusing errors in anything that does expect it.

\set jwt_secret `echo "$JWT_SECRET"`
\set jwt_exp `echo "$JWT_EXP"`

alter database postgres set "app.settings.jwt_secret" to :'jwt_secret';
alter database postgres set "app.settings.jwt_exp" to :'jwt_exp';
