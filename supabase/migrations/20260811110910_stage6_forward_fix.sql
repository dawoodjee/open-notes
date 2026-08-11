-- Forward-only replay of the Stage 6 / 6.5 schema additions.
--
-- WHY THIS FILE EXISTS AT ALL, given the same DDL is already written out in
-- 20260806122256_notes_and_profiles.sql:
--
-- Stage 6 added `user_keys` and `notes.is_hidden_from_api` by *editing* that
-- earlier migration rather than adding a new one. Locally that is invisible --
-- `supabase db reset` drops the database and replays every file, so the edits
-- take effect and everything works. A remote database cannot do that. It
-- records applied migrations by version string, `20260806122256` was applied
-- to the live project before those edits existed, and `supabase db push`
-- compares version strings, not file contents. So the edits would never reach
-- the live database, and no command would ever report a problem: push simply
-- says there is nothing to do, forever.
--
-- The symptom was the live project answering PGRST205 ("Could not find the
-- table 'public.user_keys' in the schema cache") for a table the app requires
-- at sign-in, on a schema the CLI considered fully up to date.
--
-- Every statement below is guarded so this file is a harmless no-op against a
-- database built by replaying the amended migration -- which is exactly what a
-- local `supabase db reset` produces. Both paths converge on the same schema
-- and, from here on, the same migration history.
--
-- The rule this encodes: once a migration has been applied anywhere you cannot
-- rebuild from scratch, it is immutable. Change it and the two databases drift
-- silently. New change, new file.

-- -----------------------------------------------------------------------------
-- notes.is_hidden_from_api (Stage 6.5)
-- -----------------------------------------------------------------------------
-- Per-note opt-OUT of the API access gate. Excluded from everything
-- lib/plaintext/ hands to an outside caller -- content and metadata both, so
-- an app cannot learn the note exists.
--
-- Default false (visible), matching the authoring migration. That default is
-- deliberate there and is what makes this backfill safe: existing rows become
-- API-visible, but only inside a gate that is itself off until the user turns
-- it on. Defaulting to hidden would mean the API returned nothing until every
-- note had been toggled one at a time.
alter table public.notes
  add column if not exists is_hidden_from_api boolean not null default false;

-- -----------------------------------------------------------------------------
-- user_keys (Stage 6)
-- -----------------------------------------------------------------------------
-- One row per account, holding the account's note-encryption key in wrapped
-- form so a second device can obtain it. The server never sees the raw key.
--
-- Separate from profiles on purpose: profiles carries "any authenticated user
-- can read profiles" so username availability can be checked before signup.
-- Correct for a username, badly wrong for key material -- even wrapped, a blob
-- readable by every signed-in user is an unlimited supply of offline targets.
create table if not exists public.user_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- enc:v1 envelope (AES-256-GCM) of the account's 32-byte data key, encrypted
  -- under hkdf(recovery code) -- not the PIN. A blob an attacker can take
  -- offline is protected only by the entropy wrapping it, and 6 digits is 10^6
  -- candidates, which a GPU exhausts regardless of KDF tuning. The recovery
  -- code is 125 bits. The accepted cost is that adding a device needs the
  -- recovery code, not just the PIN.
  recovery_wrapped_key text not null,
  recovery_salt text not null,

  -- Which KDF and parameters produced the wrapping key, so the cost can be
  -- raised later without stranding blobs written under the old ones.
  kdf_params jsonb not null,

  -- Non-secret HKDF tag over the data key. Answers "is the key this device
  -- holds the same one this account already uses?" without either side
  -- transmitting it. Comparing wrapped blobs cannot work -- different salts
  -- and nonces make two wrappings of the SAME key look entirely different.
  key_fingerprint text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_keys enable row level security;

-- Owner-only in both directions, with no shared-read policy of any kind.
-- Postgres has no `create policy if not exists`, hence the drop-then-create.
drop policy if exists "owners read their key" on public.user_keys;
create policy "owners read their key"
  on public.user_keys for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "owners insert their key" on public.user_keys;
create policy "owners insert their key"
  on public.user_keys for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Deliberately NO update or delete policy. Overwriting this row makes every
-- note already encrypted under the old key permanently unreadable, and a delete
-- does the same to any device that has not cached the key yet. Key rotation is
-- a real feature needing a re-encryption plan, not something to leave one stray
-- upsert away from happening by accident.

grant select, insert on public.user_keys to authenticated;
