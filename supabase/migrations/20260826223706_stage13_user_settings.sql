-- =============================================================================
-- Stage 13b — user_settings.
--
-- Additive, in its own file, for the same reason Stage 10's folders migration
-- was: every earlier migration has already been applied to the live project, so
-- editing one would make the two stacks disagree about what "the schema" is.
-- New stage, new file, applied to both (see docs/two-stacks.md).
--
-- WHY THIS TABLE EXISTS AT ALL. Adam, 2026-08-25: settings sync across devices.
-- The forcing case is the web lock -- it has to inherit whatever the user set
-- on their phone -- but the shape below is deliberately general so Stage 13c can
-- add appearance, theme and bullet style without another migration.
-- =============================================================================

-- =============================================================================
-- KEY-VALUE, NOT ONE ROW OF TYPED COLUMNS. This is the load-bearing decision.
--
-- A single settings row per user with a column per setting is the obvious
-- design, is better typed, and is WRONG HERE -- because of how this app syncs.
-- PowerSync's connector uploads a row's ENTIRE current local state on any write
-- (a deliberate Stage 5 choice; see the 2026-08-20 Decisions Log entry, where
-- the same property caused the plaintext leak). So with one wide row, changing
-- the appearance on the phone uploads the phone's whole settings row -- lock
-- setting included -- and silently reverts a lock change made on the iPad
-- seconds earlier. Two unrelated preferences would clobber each other with no
-- error and no way to notice.
--
-- One row per setting makes independent settings genuinely independent: they
-- occupy different rows, so they merge instead of racing. The cost is that
-- Postgres can no longer type or range-check individual settings -- `value` is
-- just text. That validation moves to lib/settings/, which is where the
-- defaults already live.
-- =============================================================================

create table public.user_settings (
  -- Client-generated and DETERMINISTIC: uuidv5-style, derived from
  -- (user_id, key) -- see settingRowId() in lib/settings/syncedSettings.ts.
  --
  -- That is what makes two devices writing the same setting produce an UPDATE
  -- to one row rather than two competing INSERTs. It matters more than it looks:
  -- a duplicate would violate the unique index below, and a constraint violation
  -- surfaces asynchronously inside the connector, where isStructuralError() does
  -- not classify it -- so it would retry forever and block every operation
  -- queued behind it. The same trap the folders trigger comment describes.
  id uuid primary key,

  -- NOT NULL, unlike folders.user_id. Folders can exist before sign-in and get
  -- claimed at login; settings deliberately cannot. A signed-out device keeps
  -- its preferences in the local mirror only (lib/crypto/secureStorage) and
  -- pushes them on first sign-in -- there is nothing to sync with until there
  -- is an account. Callers must not write here while signed out; a null would
  -- fail at upload and jam the queue rather than fail visibly.
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Namespaced, e.g. 'lock.v1', 'appearance.v1'. Versioned in the key itself so
  -- a setting whose SHAPE changes becomes a new row rather than a value an old
  -- client cannot parse -- older devices keep reading the key they understand.
  key text not null,

  -- JSON. Text rather than jsonb because PowerSync's local SQLite has no jsonb
  -- and the column has to round-trip losslessly; the app parses it either way.
  value text not null,

  updated_at timestamptz not null default now(),

  -- Belt and braces with the deterministic id above. The id makes a duplicate
  -- impossible by construction; this makes it impossible in fact, including
  -- from a client that gets the derivation wrong.
  constraint user_settings_one_per_key unique (user_id, key),

  -- Deliberately NOT a check against a list of known keys. That would mean a
  -- migration -- against both stacks -- every time a preference is added, which
  -- is exactly what this table's shape exists to avoid. Format only: non-empty,
  -- bounded, and no whitespace, so a typo'd key is still cheap and local.
  constraint user_settings_key_shape
    check (key ~ '^[a-z0-9]+(\.[a-z0-9]+)*$' and length(key) between 1 and 64),

  constraint user_settings_value_bounded
    check (length(value) <= 4096)
);

-- =============================================================================
-- NOT ENCRYPTED, and the line is the same one folders draws.
--
-- folders.name is ciphertext because a folder name is user content -- "Therapy",
-- "Tax 2026" leak as much as a note title. A preference is not content: it is
-- structure, in the same category as sort_order, include_in_notes and
-- group_by_date, all of which are plaintext and synced.
--
-- Stated plainly so it is a decision and not an oversight: this does mean the
-- server can see THAT a user has a lock enabled and how long its timeout is. It
-- cannot see any note, folder name, or key. That is metadata of the same kind
-- the schema already exposes, and encrypting it would buy nothing while making
-- every setting unreadable to any future server-side feature.
-- =============================================================================

alter table public.user_settings enable row level security;

-- Owner-only in both directions, identical shape to notes and folders.
create policy "owners read their settings"
  on public.user_settings for select
  using (auth.uid() = user_id);

create policy "owners insert their settings"
  on public.user_settings for insert
  with check (auth.uid() = user_id);

create policy "owners update their settings"
  on public.user_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "owners delete their settings"
  on public.user_settings for delete
  using (auth.uid() = user_id);

-- RLS restricts which rows a role may touch within privileges it already has;
-- it does not grant those privileges. Without this every request 42501s before
-- a policy is evaluated. Same note as notes' and folders' grants.
grant select, insert, update, delete on public.user_settings to authenticated;

-- =============================================================================
-- PowerSync replication
--
-- Both lines are required and neither fails loudly. Without the publication
-- entry the table never enters the WAL stream; without the grant the
-- replication role cannot read it. In both cases every container reports
-- healthy and the client simply receives no settings -- which here would look
-- exactly like "settings don't sync yet", the bug this table is fixing.
-- =============================================================================

alter publication powersync add table public.user_settings;
grant select on public.user_settings to powersync_role;

-- =============================================================================
-- Local SQLite (PowerSync) vs Postgres type differences
--
--   id, user_id    text -> uuid
--   updated_at     text (ISO-8601) -> timestamptz
--
-- key and value are text on both sides. `value` happens to hold JSON, which
-- Postgres neither knows nor needs to know about -- the same arrangement as
-- folders.name holding an enc:v1 envelope.
-- =============================================================================
