-- Stage 15b: account deletion with a 30-day grace period.
--
-- Decisions (dev-docs/iteration-2-build-plan.md, Decisions Log, 2026-09-28/29):
-- a request starts a 30-day window; every device suspends but keeps its
-- encrypted local copy; cancelling within the window restores everything; after
-- it, the account and all its data are purged and devices erase themselves.
--
-- WHAT THIS MIGRATION DOES NOT DO is delete anything. Every table holding a
-- user's data -- notes, folders, user_settings, profiles, user_keys -- already
-- says `references auth.users (id) on delete cascade`, so removing the one auth
-- user erases the lot. That removal happens in the `account-deletion` Edge
-- Function through GoTrue's admin API, not in SQL: `postgres` is not the
-- superuser in a Supabase stack and `auth.users` belongs to
-- `supabase_auth_admin` (docs/two-stacks.md), so a SQL delete there is exactly
-- the kind of thing that works on one stack and fails on another.

-- ─── Pending deletions ─────────────────────────────────────────────────────

create table public.account_deletions (
  -- One pending request per account. A second request while one is pending
  -- does NOT restart the clock -- the function inserts with `on conflict do
  -- nothing` -- so nobody can extend their own grace period by accident.
  user_id uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now(),
  purge_after timestamptz not null,
  constraint account_deletions_window check (purge_after > requested_at)
);

alter table public.account_deletions enable row level security;

-- Devices READ their own row -- that is how every device learns, through sync,
-- that its account is pending and must suspend.
create policy "owners read their pending deletion"
  on public.account_deletions for select
  using (auth.uid() = user_id);

-- No insert, update or delete policy, deliberately: a client cannot request,
-- cancel or reschedule a deletion by writing the table. Only the Edge Function,
-- running as the service role, does -- so the grace period cannot be skipped by
-- a client writing `purge_after = now()`.
grant select on public.account_deletions to authenticated;

-- This project grants the service role explicitly and minimally (see
-- 20260819124553_grant_service_role_reads.sql) rather than relying on
-- defaults, so the function's access is spelled out here.
grant select, insert, update, delete on public.account_deletions to service_role;

-- Synced to devices like any other user table.
alter publication powersync add table public.account_deletions;
grant select on public.account_deletions to powersync_role;

-- ─── Tombstones ────────────────────────────────────────────────────────────
--
-- WHY THIS EXISTS. A device that was offline for the whole 30 days never saw
-- the pending row. When it next opens, its session simply fails -- and that is
-- ambiguous: "sign out everywhere" and a revoked token look identical. Wiping
-- on that alone could erase unsynced notes on a perfectly live account.
--
-- So the purge leaves a tombstone, and a device whose session dies asks "was
-- this account purged?" before erasing anything. Only a definite yes wipes.
--
-- WHAT IT HOLDS: the account's random UUID and when it was purged. No email,
-- no name, no content -- nothing that identifies a person once the auth row is
-- gone. No foreign key, because the user it names no longer exists.

create table public.purged_accounts (
  user_id uuid primary key,
  purged_at timestamptz not null default now()
);

alter table public.purged_accounts enable row level security;
-- No policies at all: clients never read this table directly. The function
-- answers "was THIS id purged?" one id at a time, so the table cannot be
-- listed to learn which accounts existed.
grant select, insert on public.purged_accounts to service_role;

-- ─── The daily purge ───────────────────────────────────────────────────────
--
-- pg_cron is Postgres's scheduler; pg_net lets SQL make an HTTP request. The
-- job calls the Edge Function's `purge` action with a shared secret. The URL and
-- the secret come from Vault (Supabase's encrypted secret store), never from
-- this file -- a committed migration is public, and the URL differs per stack.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_account_purge()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  function_url text;
  purge_secret text;
begin
  select decrypted_secret into function_url
    from vault.decrypted_secrets where name = 'account_purge_url';
  select decrypted_secret into purge_secret
    from vault.decrypted_secrets where name = 'account_purge_secret';

  -- Not configured on this stack (a fresh dev database, a self-hoster who has
  -- not set it up): do nothing. Safe by default -- nothing is ever deleted by
  -- a stack that was not deliberately told how.
  if function_url is null or purge_secret is null then
    return;
  end if;

  -- Only wake the function when something is actually due.
  if not exists (select 1 from public.account_deletions where purge_after <= now()) then
    return;
  end if;

  perform net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-purge-secret', purge_secret
    ),
    body := jsonb_build_object('action', 'purge')
  );
end;
$$;

-- Not callable by clients through the API. Functions in `public` are executable
-- by everyone unless revoked, and PostgREST exposes them as RPC endpoints.
revoke all on function public.invoke_account_purge() from public, anon, authenticated;

-- Daily at 03:17 UTC -- off the hour, where scheduled jobs cluster.
select cron.schedule(
  'purge-deleted-accounts',
  '17 3 * * *',
  $$select public.invoke_account_purge()$$
);
