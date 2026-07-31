-- =============================================================================
-- DRAFT — Postgres schema for Supabase.  NOT APPLIED ANYWHERE.
--
-- This is the Stage 3 target shape, written down now so the client type
-- (types/note.ts), the local PowerSync schema (lib/powersync/schema.ts) and the
-- eventual server all agree before a backend exists.  When Stage 5 wires up
-- Supabase + PowerSync, this becomes the first migration.
--
-- Not included on purpose:
--   * ui_state — last opened note / editor scroll offset are per-device state.
--     That table is declared localOnly in the PowerSync schema and must never
--     sync, so it has no Postgres counterpart and no user_id.
-- =============================================================================

create table public.notes (
  -- Generated client-side with expo-crypto randomUUID() so a note has a stable
  -- identity offline, before the server has ever seen it.  A server-generated
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

  -- Soft delete.  There is deliberately no trashed_at column: updated_at
  -- already moves on both trash and restore, and a second timestamp could
  -- disagree with this flag.  One field means the invalid combinations
  -- ("trashed with no timestamp", "untrashed with one") cannot be represented.
  is_trashed boolean not null default false
);

-- The list query is `order by updated_at desc` filtered to a user's own rows.
create index notes_user_id_updated_at_idx
  on public.notes (user_id, updated_at desc);

-- =============================================================================
-- Row Level Security
--
-- Must exist before the first sync, not after: PowerSync connects as the signed
-- in user, so without these policies every row would be readable by everyone.
-- =============================================================================

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

-- Note the consequence of nullable user_id: `auth.uid() = null` is NULL, not
-- true, so unclaimed rows match no policy and cannot be uploaded until the
-- claim step sets user_id.  That is the desired behaviour — it is what stops
-- pre-sign-in local notes leaking into an account by accident.

-- =============================================================================
-- Local SQLite (PowerSync) vs Postgres type differences
--
-- PowerSync's local schema only offers text / integer / real, so several
-- columns are stored in a different type locally than on the server.  All of
-- these are lossless:
--
--   id, user_id    text  -> uuid
--       We generate RFC-4122 UUIDs, which Postgres parses on insert.
--
--   is_trashed     integer 0/1 -> boolean
--       SQLite has no boolean type at all; 0/1 is the standard encoding and
--       Postgres coerces it.  mapRowToNote() does Boolean(row.is_trashed) on
--       the way back out.
--
--   created_at,    text (ISO-8601) -> timestamptz
--   updated_at
--       ISO-8601 with a Z suffix is unambiguous and casts deterministically.
--       Storing it as text locally also means lexicographic order equals
--       chronological order, which is why the local `order by updated_at desc`
--       watch query is correct without any date parsing.
-- =============================================================================
