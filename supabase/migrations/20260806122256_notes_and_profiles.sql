-- =============================================================================
-- Stage 4 — the cumulative Postgres schema. This is the single source of truth:
-- Stage 3's notes table (previously a non-applied draft) plus the profiles
-- table Stage 5's account system needs. Extend this file in future stages
-- rather than starting a new one, so the schema never has two sources of truth.
--
-- Not included on purpose:
--   * ui_state — last opened note / editor scroll offset are per-device state.
--     That table is declared localOnly in the PowerSync schema and must never
--     sync, so it has no Postgres counterpart and no user_id.
-- =============================================================================

-- Required before any table grant below means anything: PostgREST resolves
-- the schema for anon/authenticated before RLS is ever evaluated, and recent
-- Supabase defaults grant this to nobody automatically. Without it every
-- request 42501s regardless of policies or table grants.
grant usage on schema public to authenticated, anon;

-- =============================================================================
-- notes
-- =============================================================================

create table public.notes (
  -- Generated client-side with expo-crypto randomUUID() so a note has a stable
  -- identity offline, before the server has ever seen it. A server-generated
  -- key would be impossible in a local-first app.
  id uuid primary key,

  -- Nullable by design: notes created before sign-in belong to no account yet.
  -- Stage 5's claim step is then just:
  --     update notes set user_id = auth.uid() where user_id is null;
  -- on delete cascade so deleting an account removes its notes.
  user_id uuid references auth.users (id) on delete cascade,

  body  text not null default '',
  -- Derived from the first line of body by parseNoteContent(); stored rather
  -- than computed so the notes list can render without parsing every body.
  title text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Soft delete. There is deliberately no trashed_at column: updated_at
  -- already moves on both trash and restore, and a second timestamp could
  -- disagree with this flag. One field means the invalid combinations
  -- ("trashed with no timestamp", "untrashed with one") cannot be represented.
  is_trashed boolean not null default false,

  -- Per-note opt-OUT of the API access gate (Stage 6.5). A note with this set
  -- is excluded from everything lib/plaintext/ hands to an outside caller --
  -- not just its content, but its metadata too, so an app cannot learn the
  -- note exists at all.
  --
  -- Named for what it actually governs. A generic `is_private` would invite
  -- the assumption that it hides the note from something else as well: it does
  -- not. This app reads and syncs the note exactly as before; the only thing
  -- it changes is what leaves the device through the API gate.
  --
  -- Default false (visible) on purpose, which is the opposite of how the gate
  -- itself defaults. The gate is the real control and is off until the user
  -- turns it on; this is a per-note exception INSIDE a permission already
  -- granted. Defaulting to hidden would mean the API returned nothing until
  -- every note had been toggled one at a time.
  is_hidden_from_api boolean not null default false
);

-- The list query is `order by updated_at desc` filtered to a user's own rows.
create index notes_user_id_updated_at_idx
  on public.notes (user_id, updated_at desc);

alter table public.notes enable row level security;

create policy "owners read their notes"
  on public.notes for select
  using (auth.uid() = user_id);

create policy "owners insert their notes"
  on public.notes for insert
  with check (auth.uid() = user_id);

create policy "owners update their notes"
  on public.notes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "owners delete their notes"
  on public.notes for delete
  using (auth.uid() = user_id);

-- Consequence of nullable user_id: `auth.uid() = null` is NULL, not true, so
-- unclaimed rows match no policy and cannot be uploaded until the claim step
-- sets user_id. That is the desired behaviour -- it is what stops pre-sign-in
-- local notes leaking into an account by accident, and it also means the
-- authenticated REST API can never itself create an unclaimed note (verified
-- below in the red-team tests) -- only the local-first client can, before any
-- account exists.

-- RLS policies restrict *which rows* a role can touch within privileges it
-- already has -- they do not grant the underlying table privileges. Recent
-- Supabase/PostgREST defaults no longer auto-expose newly created tables to
-- the anon/authenticated roles (see the `auto_expose_new_tables` note in
-- config.toml), so without this grant every request hits a permission error
-- (42501) before RLS is ever evaluated, regardless of how correct the
-- policies above are. Found by testing against the real API, not assumed.
grant select, insert, update, delete on public.notes to authenticated;

-- =============================================================================
-- profiles
--
-- One row per auth.users, created automatically on signup (trigger below).
-- Username is nullable so account creation never blocks on picking one.
-- =============================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,

  -- Stored exactly as typed, so "Alice" displays as "Alice".
  username text,

  -- The comparison/uniqueness form. NFKC first, then lowercase: NFKC collapses
  -- compatibility-equivalent forms (fullwidth "A" -> "A", the ligature "fi"
  -- -> "fi") before case-folding. See the note below on why this is *not*
  -- what stops impersonation -- the ascii charset check further down is.
  username_lower text generated always as (lower(normalize(username, nfkc))) stored,

  username_changed_at timestamptz,
  created_at timestamptz not null default now(),

  -- Display name -- a free-text label, not an identifier. None of username's
  -- hardening applies: no charset restriction (real names use non-ASCII
  -- scripts routinely), no uniqueness, no reserved-word list, no rate limit.
  -- The only rule is a length cap; leading/trailing whitespace is trimmed
  -- client-side on write, the same place title/body are already normalized
  -- in lib/powersync/db.ts, rather than adding a DB trigger for a cosmetic
  -- rule that has no security consequence if skipped.
  full_name text,

  -- Length.
  constraint username_length
    check (username is null or char_length(username) between 3 and 20),

  constraint full_name_length
    check (full_name is null or char_length(full_name) <= 100),

  -- ASCII letters, digits, underscore only. This -- not NFKC normalization --
  -- is what actually stops impersonation via Unicode confusables. NFKC only
  -- folds characters that are compatibility-equivalent to the same character
  -- (fullwidth "A" -> "A"); it does NOT fold homoglyphs, because they are not
  -- compatibility-equivalent. Cyrillic "a" (U+0430) and Latin "a" (U+0061)
  -- are visually identical but are different letters with no NFKC mapping
  -- between them, so normalizing "аdmin" (Cyrillic a) would leave it as
  -- "аdmin" forever -- distinct from "admin" -- and it would sail through a
  -- uniqueness check that only normalizes. Restricting the charset to ASCII
  -- rejects that Cyrillic "a" outright, full stop, regardless of
  -- normalization. Normalization is kept anyway as defense in depth for a
  -- narrower case: it future-proofs the *comparison* path if a later stage
  -- ever loosens the charset to allow non-Latin scripts.
  constraint username_charset
    check (username is null or username ~ '^[A-Za-z0-9_]+$'),

  -- No leading/trailing underscore, no consecutive underscores.
  constraint username_no_edge_underscore
    check (username is null or (left(username, 1) <> '_' and right(username, 1) <> '_')),
  constraint username_no_double_underscore
    check (username is null or username !~ '__'),

  -- Reserved names: never issuable, seeded from the given list plus this
  -- app's actual route surface. app/ currently only has index and _layout,
  -- so nothing route-specific to add yet -- revisit when routes like
  -- /settings exist.
  constraint username_not_reserved
    check (
      username is null or lower(normalize(username, nfkc)) <> all (array[
        'admin', 'administrator', 'support', 'api', 'help', 'settings',
        'root', 'system', 'null', 'undefined', 'notes', 'auth', 'login',
        'logout', 'signup', 'signin', 'account', 'profile', 'user', 'users'
      ])
    )
);

-- The unique index lives on the generated, normalized column -- so it is
-- Postgres's own index-level locking, not application logic, that decides
-- who wins a race between two concurrent same-username inserts.
create unique index profiles_username_lower_key
  on public.profiles (username_lower);

-- Rate limit: once every 30 days. This has to be a trigger, not a CHECK,
-- because it needs to compare the new value against the *previous* row's
-- timestamp -- a CHECK constraint only ever sees a single row in isolation
-- and cannot look at history.
create function public.enforce_username_change_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.username is distinct from old.username then
    if old.username_changed_at is not null
       and now() - old.username_changed_at < interval '30 days' then
      raise exception 'username can only be changed once every 30 days';
    end if;
    new.username_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger enforce_username_change_limit
  before update on public.profiles
  for each row
  execute function public.enforce_username_change_limit();

-- Create the profile row automatically when an account is created.
--
-- security definer is required because this trigger fires as part of an
-- auth.users insert, which GoTrue performs as its own restricted
-- supabase_auth_admin role -- a role with no privileges on public.profiles.
-- security definer runs the function with its *owner's* privileges instead
-- (the role that ran this migration), so the insert succeeds regardless of
-- who triggered it.
--
-- set search_path = '' is required alongside it. A security definer function
-- without a pinned search_path still resolves unqualified names using the
-- *caller's* search_path -- so a caller able to set search_path to a schema
-- they control (containing e.g. a decoy "profiles" table) could get this
-- function to silently write there instead, or get a same-named function of
-- theirs invoked with this function's elevated privileges. Pinning
-- search_path = '' forces every reference to be fully schema-qualified
-- (hence public.profiles below), closing that hole. This is a known
-- Postgres/Supabase security-linter finding ("Function Search Path Mutable")
-- and standard practice for every security definer function.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

alter table public.profiles enable row level security;

-- Readable by any authenticated user -- deliberately different from notes.
-- Username availability checks (and later, any "look up by @username"
-- feature) need every signed-in user to be able to read every profile.
create policy "any authenticated user can read profiles"
  on public.profiles for select
  to authenticated
  using (true);

-- Writable only by the owner.
create policy "owners can update their profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No insert policy for ordinary users: the only way a profile row is ever
-- created is the security definer trigger above, which runs as the table
-- owner and therefore bypasses RLS (Postgres table owners are exempt from
-- their own table's RLS unless FORCE ROW LEVEL SECURITY is set, which is not
-- set here). A client can never POST a profile row directly, only get one via
-- signup.
--
-- No delete policy either: profiles disappear only via the
-- "on delete cascade" from auth.users, i.e. account deletion, never as a
-- standalone action a client can request.

-- Only select/update granted -- no insert/delete -- mirroring the policies
-- above exactly. The trigger's inserts run as the table owner (a superuser
-- role), which is never subject to a GRANT check, so it needs none.
grant select, update on public.profiles to authenticated;

-- One-time backfill: accounts that signed up via an OAuth provider (Google,
-- Apple) often already have a name in their GoTrue user metadata -- no
-- reason to make them retype it. GoTrue flattens whatever the provider's
-- userinfo response contained into auth.users.raw_user_meta_data; Google
-- populates a "name" key, Apple (when it sends a name at all -- only on
-- first authorization) is normalized by GoTrue into the same flat keys, so
-- checking both "full_name" and "name" covers both providers. Email-OTP
-- accounts have no such claim and correctly stay null -- there is nothing to
-- backfill from and this deliberately does not guess one.
update public.profiles p
set full_name = coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
from auth.users u
where p.id = u.id
  and p.full_name is null
  and coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name') is not null;

-- =============================================================================
-- PowerSync replication (Stage 5)
--
-- The powersync-service reads Postgres's write-ahead log directly, as this
-- one dedicated role, to build per-user sync buckets (see powersync/sync-
-- rules.yaml). Note what this role does and doesn't need:
-- =============================================================================

-- Which rows end up in which bucket -- notes' actual per-user privacy
-- boundary during sync.
create publication powersync for table public.notes;

-- bypassrls: replication reads the raw table, not as any particular end
-- user, so there is no "current user" for RLS to evaluate against at this
-- layer -- RLS is simply inapplicable here, not bypassed as a workaround.
-- The publication above is what actually decides which columns/rows flow
-- into replication; the sync-rules bucket definition (keyed to each client's
-- own JWT) is what decides which of those a given client receives. RLS is
-- untouched everywhere else -- PostgREST/the REST API still enforces it
-- exactly as verified in Stage 4.
--
-- Password intentionally left unset here: a real value committed into a
-- migration is exactly the kind of thing that gets copied verbatim by
-- anyone following these docs later, including past a local-dev context.
-- Set via `alter role powersync_role password '<value>';` by hand, using the
-- POWERSYNC_REPLICATION_PASSWORD value in the repo's root .env (gitignored)
-- -- same pattern as the Google OAuth secret.
--
-- This has to be re-run after anything that recreates the database volume
-- (`supabase db reset`, `supabase stop --no-backup`, deleting the volume).
-- The role comes back from this migration with a null password, so PowerSync
-- fails with `28P01 password authentication failed for user "powersync_role"`
-- and replicates nothing -- while every other container looks perfectly
-- healthy, which makes it a confusing failure to walk into cold.
create role powersync_role with replication bypassrls login password null;
grant usage on schema public to powersync_role;
grant select on public.notes to powersync_role;

-- =============================================================================
-- Local SQLite (PowerSync) vs Postgres type differences (notes table)
--
-- PowerSync's local schema only offers text / integer / real, so several
-- columns are stored in a different type locally than on the server. All of
-- these are lossless:
--
--   id, user_id    text  -> uuid
--       We generate RFC-4122 UUIDs, which Postgres parses on insert.
--
--   is_trashed     integer 0/1 -> boolean
--       SQLite has no boolean type at all; 0/1 is the standard encoding and
--       Postgres coerces it. mapRowToNote() does Boolean(row.is_trashed) on
--       the way back out.
--
--   created_at,    text (ISO-8601) -> timestamptz
--   updated_at
--       ISO-8601 with a Z suffix is unambiguous and casts deterministically.
--       Storing it as text locally also means lexicographic order equals
--       chronological order, which is why the local `order by updated_at desc`
--       watch query is correct without any date parsing.
--
-- profiles has no local/PowerSync counterpart at all: username is account
-- metadata, not offline-critical note content, and lives entirely server-side
-- keyed by the same auth user id notes.user_id already references.
-- =============================================================================

-- =============================================================================
-- user_keys — Stage 6 (end-to-end encryption)
-- =============================================================================
--
-- One row per account, holding this account's note-encryption key in wrapped
-- form so a second device can obtain it. The server never sees the raw key.
--
-- WHY A SEPARATE TABLE RATHER THAN COLUMNS ON profiles:
-- profiles carries the policy "any authenticated user can read profiles",
-- which exists so username availability can be checked before signup. That is
-- exactly right for a username and exactly wrong for key material. Even
-- wrapped, a key blob readable by every signed-in user hands an attacker an
-- unlimited supply of offline targets. Separate table, owner-only both ways.
--
-- WHY IT IS WRAPPED UNDER THE RECOVERY CODE AND NOT THE PIN:
-- A blob an attacker can take offline is protected only by the entropy of
-- whatever wraps it. A 6-digit PIN is 10^6 candidates -- a GPU exhausts that
-- in hours no matter how the KDF is tuned, because the attacker runs native
-- code, not our JavaScript. The recovery code is 125 bits, which is not
-- searchable by anyone, ever. The cost of this choice is that adding a device
-- needs the recovery code rather than just the PIN; that was accepted
-- deliberately.
create table public.user_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- enc:v1 envelope (AES-256-GCM) of the account's 32-byte data key,
  -- encrypted under hkdf(recovery code). See lib/crypto/keys.ts.
  recovery_wrapped_key text not null,
  recovery_salt text not null,

  -- Records which KDF and parameters produced the wrapping key, so the cost
  -- can be raised later without stranding blobs written under the old ones.
  kdf_params jsonb not null,

  -- A non-secret HKDF tag derived from the data key, used only to answer "is
  -- the key this device holds the same one this account already uses?"
  -- without either side revealing or transmitting the key itself. Comparing
  -- wrapped blobs would not work: different salts and nonces make two
  -- wrappings of the SAME key look completely different.
  key_fingerprint text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_keys enable row level security;

-- Owner-only, in both directions, with no shared-read policy of any kind.
create policy "owners read their key"
  on public.user_keys for select
  to authenticated
  using (auth.uid() = user_id);

create policy "owners insert their key"
  on public.user_keys for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Deliberately NO update or delete policy. Overwriting this row makes every
-- note already encrypted under the old key permanently unreadable, and a
-- delete does the same to every device that hasn't cached the key yet. Key
-- rotation is a real feature that needs a re-encryption plan behind it, not
-- something to leave one stray upsert away from happening by accident.

grant select, insert on public.user_keys to authenticated;

-- No updated_at trigger, deliberately: with no update policy above, this row
-- is insert-once and can never be modified by a client, so updated_at can
-- only ever equal created_at. It's kept as a column purely so a future
-- key-rotation feature has somewhere to record itself.
