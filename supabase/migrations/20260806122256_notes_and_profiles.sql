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
  is_trashed boolean not null default false
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

  -- Length.
  constraint username_length
    check (username is null or char_length(username) between 3 and 20),

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
