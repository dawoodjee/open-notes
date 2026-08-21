-- =============================================================================
-- Stage 10 — Folders.
--
-- Additive to 20260806122256_notes_and_profiles.sql, which stays the base
-- schema. It is not extended in place this time because that file has already
-- been applied to the live project: editing it would make the two stacks
-- disagree about what "the schema" is, which is exactly the drift
-- docs/two-stacks.md warns about. New stage, new file, applied to both.
-- =============================================================================

-- =============================================================================
-- folders
--
-- The split between what is encrypted and what is not mirrors notes exactly:
-- `name` is user content and is ciphertext; everything else is structure the
-- server must be able to filter and order by, so it stays plaintext.
-- =============================================================================

create table public.folders (
  -- Client-generated, same as notes: a folder needs a stable identity offline,
  -- before any server has seen it.
  id uuid primary key,

  -- Nullable for the same reason notes' is: folders created before sign-in
  -- belong to no account yet and get claimed at login. See
  -- claimUnownedFolders() in lib/powersync/folders.ts.
  user_id uuid references auth.users (id) on delete cascade,

  -- NULL means top level. `on delete cascade` deletes a whole subtree in one
  -- statement server-side -- but note the client never relies on that: it
  -- walks the subtree itself so it can trash the notes first (see
  -- deleteFolderInDB). The cascade is the backstop, not the mechanism.
  parent_id uuid references public.folders (id) on delete cascade,

  -- An `enc:v1:` envelope, AES-256-GCM, same key and same code path as
  -- notes.title/body (lib/crypto/noteCrypto.ts). A folder name leaks as much
  -- as a note title -- "Therapy", "Tax 2026" -- so shipping it plaintext
  -- beside encrypted note bodies would contradict the guarantee.
  --
  -- The cost, accepted deliberately: no server-side filtering, sorting or
  -- searching on name. All of that is local and post-decrypt, exactly the
  -- constraint note titles already live under.
  name text not null default '',

  -- WHY DEFAULT FOLDERS ARE IDENTIFIED BY THIS AND NEVER BY NAME:
  -- `name` above is ciphertext, so nothing server-side can match on it, and
  -- even client-side a name match would break the moment names are localized
  -- or the user renames something into a collision. A stable plaintext flag
  -- is the only thing that can reliably answer "is this the Skills folder?".
  --
  -- 'user' | 'skills'. All Notes and Recently Deleted are deliberately NOT
  -- values here: they are virtual views, not rows (see the Decisions Log).
  kind text not null default 'user',

  -- How deep this folder sits: 0 for top level, up to 4. Materialized rather
  -- than computed by recursive CTE, which is safe *because re-parenting is out
  -- of scope this stage* -- a folder's depth is fixed at insert and can never
  -- go stale. Revisit this the moment drag-to-reparent lands.
  depth integer not null default 0,

  -- Ordering among top-level folders. Subfolders are ordered by this too, but
  -- only top-level reordering is exposed in the UI this stage.
  sort_order integer not null default 0,

  -- Whether this folder's notes appear in the All Notes list. Off hides them
  -- from that list ONLY -- they still appear in search. The toggle is about
  -- list clutter, not concealment, and a note you cannot find by searching for
  -- it is a lost note.
  include_in_notes boolean not null default true,

  -- Per-folder, not one global switch: a folder grouped by date on the iPad
  -- reading as ungrouped on the phone would look like a sync bug. Synced and
  -- plaintext because it is a statement about organization, not content.
  group_by_date boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint folders_kind_known
    check (kind in ('user', 'skills')),

  -- 5 levels total: top level plus 4 nested.
  constraint folders_depth_range
    check (depth between 0 and 4),

  -- A root has no parent, a non-root has one. Written as an equality between
  -- two booleans so both illegal combinations are ruled out by one constraint.
  constraint folders_root_has_no_parent
    check ((depth = 0) = (parent_id is null))
);

-- One Skills folder per account, enforced by Postgres rather than by hoping
-- the client's seed only ever runs once. It can't: a signed-in device seeds
-- locally AND receives the account's row down the sync stream, so the race is
-- real. Partial index because `kind = 'user'` rows are unconstrained.
create unique index folders_one_skills_per_user
  on public.folders (user_id)
  where kind = 'skills';

-- The sidebar query: a user's folders in render order.
create index folders_user_id_sort_idx
  on public.folders (user_id, parent_id, sort_order);

-- =============================================================================
-- Depth is derived from the parent, never trusted from the client.
--
-- The client also checks this before inserting (createFolderInDB), and that is
-- not redundancy for its own sake -- the two guards do different jobs. The app
-- check is what the user experiences: the "New Folder" menu item is disabled at
-- depth 4, so the 6th level is unreachable rather than rejected.
--
-- This one is what makes the invariant TRUE. And it has to exist, because
-- PowerSync writes to local SQLite first and uploads later: a client-only rule
-- means a bad row lands locally and fails asynchronously in the connector,
-- where isStructuralError() does not classify a check violation -- so it would
-- retry forever and block every op queued behind it.
-- =============================================================================

create function public.folders_set_depth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_depth integer;
  parent_owner uuid;
begin
  if new.parent_id is null then
    new.depth := 0;
    return new;
  end if;

  select f.depth, f.user_id into parent_depth, parent_owner
  from public.folders f
  where f.id = new.parent_id;

  if parent_depth is null then
    raise exception 'parent folder % does not exist', new.parent_id;
  end if;

  -- Without this a client could nest under someone else's folder and read its
  -- position in their tree. RLS stops them SELECTing the parent; it does not
  -- stop them referencing it by id.
  if parent_owner is distinct from new.user_id then
    raise exception 'parent folder belongs to a different account';
  end if;

  new.depth := parent_depth + 1;
  return new;
end;
$$;

create trigger folders_set_depth
  before insert or update on public.folders
  for each row
  execute function public.folders_set_depth();

alter table public.folders enable row level security;

-- Owner-only in both directions, identical shape to notes.
create policy "owners read their folders"
  on public.folders for select
  using (auth.uid() = user_id);

create policy "owners insert their folders"
  on public.folders for insert
  with check (auth.uid() = user_id);

create policy "owners update their folders"
  on public.folders for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "owners delete their folders"
  on public.folders for delete
  using (auth.uid() = user_id);

-- RLS restricts which rows a role may touch within privileges it already has;
-- it does not grant those privileges. Without this every request 42501s before
-- a policy is ever evaluated. Same note as notes' grant.
grant select, insert, update, delete on public.folders to authenticated;

-- =============================================================================
-- notes — two new columns
-- =============================================================================

-- One folder per note: a single nullable reference, not a join table.
--
-- `on delete set null` rather than cascade, and the difference is the whole
-- point: deleting a folder must not destroy its notes. deleteFolderInDB()
-- trashes them first (is_trashed = 1, trashed_at = now()), then deletes the
-- folder rows; this clause then unfiles them, so they land in Recently Deleted
-- and restore into All Notes. A cascade here would delete the user's notes.
alter table public.notes
  add column folder_id uuid references public.folders (id) on delete set null;

create index notes_folder_id_idx on public.notes (folder_id);

-- WHY THIS COLUMN NOW EXISTS, having been deliberately rejected in Stage 4.
--
-- The original objection was sound: two fields describing one fact can
-- disagree, and "trashed with no timestamp" / "untrashed with one" are illegal
-- states that a single is_trashed flag simply cannot represent. The reason it
-- is reversed here is that the 30-day auto-purge needs an AGE, and the
-- substitute Stage 4 assumed -- updated_at -- is not one. updated_at moves for
-- reasons that have nothing to do with trashing: an inbound 3-way merge from
-- another device rewrites it, and each such write would silently restart the
-- 30-day clock on a note the user deleted weeks ago.
--
-- The objection is answered rather than ignored: the check constraint below
-- makes both illegal combinations unrepresentable, which is exactly the
-- property the single-field design was protecting. trashNoteInDB and
-- restoreNoteInDB set and clear this in the same statement that flips
-- is_trashed, so the two cannot drift in the first place.
alter table public.notes
  add column trashed_at timestamptz;

-- BACKFILL BEFORE THE CONSTRAINT, and the order is not cosmetic.
--
-- `add constraint ... check` validates every existing row immediately. Any
-- note already trashed when this migration runs has trashed_at NULL and fails
-- it, so adding the constraint first aborts the whole migration on any
-- database that has ever had a note in the trash -- which is every real one.
-- Caught locally on a stack holding four trashed rows; it would otherwise have
-- surfaced as a failed `db push` against live.
--
-- updated_at is the best available answer for when these were trashed: it is
-- exactly what Stage 4's comment claimed the field was doing. Used once, here.
update public.notes set trashed_at = updated_at where is_trashed and trashed_at is null;

alter table public.notes
  add constraint notes_trashed_at_matches_flag
  check ((is_trashed and trashed_at is not null)
      or (not is_trashed and trashed_at is null));

-- The Recently Deleted list and the purge sweep.
create index notes_trashed_at_idx on public.notes (user_id, trashed_at)
  where is_trashed;

-- =============================================================================
-- PowerSync replication
--
-- Both lines are required and neither fails loudly. Without the publication
-- entry folders never enter the WAL stream; without the grant the replication
-- role cannot read the table. In both cases every container reports healthy and
-- the client simply receives no folders.
-- =============================================================================

alter publication powersync add table public.folders;
grant select on public.folders to powersync_role;

-- =============================================================================
-- Local SQLite (PowerSync) vs Postgres type differences (folders)
--
-- Same lossless mappings the notes table already documents:
--
--   id, user_id, parent_id   text -> uuid
--   include_in_notes,        integer 0/1 -> boolean
--   group_by_date
--   created_at, updated_at   text (ISO-8601) -> timestamptz
--
-- depth and sort_order are integers on both sides. `kind` and `name` are text
-- on both sides -- `name` happens to hold an enc:v1 envelope, which Postgres
-- neither knows nor needs to know about.
-- =============================================================================
