import * as Crypto from 'expo-crypto';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { getPowerSync } from './db';
import { getCurrentUserId } from '@/lib/auth/currentUser';
import { encryptField, tryDecryptField } from '@/lib/crypto/noteCrypto';
// Re-exported so callers have one import surface for folder concerns, while
// the strings themselves live somewhere the verify scripts can reach.
export {
  DISABLED_FOLDER_SUBTREE_CTE,
  NOT_IN_DISABLED_FOLDER,
} from './folderQueries';
import {
  Folder,
  FolderKind,
  MAX_FOLDER_DEPTH,
  SKILLS_FOLDER_NAME,
} from '@/types/folder';

/**
 * Everything that reads or writes the folder tree.
 *
 * Kept out of db.ts, which is already the note module, so that "what can touch
 * folders" stays greppable. The one thing it borrows from there is
 * getPowerSync() -- there is still exactly one database.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: `name` crosses this boundary as
 * plaintext and is stored as an `enc:v1:` envelope, exactly like a note title.
 * No caller outside this file should ever see an envelope, and none should
 * ever hand one in.
 */

export const FOLDER_COLUMNS =
  'id, user_id, parent_id, name, kind, depth, sort_order, include_in_notes, group_by_date, is_enabled, created_at, updated_at';


/** The single point where a stored folder row becomes app data. Synchronous,
 *  same as mapRowToNote and for the same reason: it runs inside watch(). */
export function mapRowToFolder(row: any): Folder {
  const name = tryDecryptField(row.name ?? '');

  return {
    id: row.id,
    userId: row.user_id ?? null,
    parentId: row.parent_id ?? null,
    name: name.text,
    kind: (row.kind === 'skills' ? 'skills' : 'user') as FolderKind,
    depth: row.depth ?? 0,
    sortOrder: row.sort_order ?? 0,
    includeInNotes: Boolean(row.include_in_notes),
    groupByDate: Boolean(row.group_by_date),
    // Absent reads as ENABLED. A row written before this column existed must
    // behave as a normal folder rather than silently vanishing from the sidebar.
    isEnabled: row.is_enabled == null ? true : Boolean(row.is_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Surfaced rather than swallowed, same as Note.decryptFailed: an
    // undecryptable folder must not look like an unnamed one, or rename would
    // cheerfully overwrite content a working key could still recover.
    decryptFailed: !name.ok,
  };
}

// =============================================================================
// Reads
// =============================================================================

export async function listFolders(): Promise<Folder[]> {
  const rows = await getPowerSync().getAll<any>(
    `SELECT ${FOLDER_COLUMNS} FROM folders ORDER BY sort_order ASC, created_at ASC`
  );
  return rows.map(mapRowToFolder);
}

/**
 * Notes per folder -- each folder's OWN notes, not an aggregate over its
 * descendants. Trashed notes are excluded because they belong to Recently
 * Deleted, not to the folder they came from.
 *
 * One grouped query rather than one per folder: the sidebar re-renders on
 * every watch tick, and a query per row turns a 30-folder tree into 30 round
 * trips per keystroke.
 */
export async function folderNoteCounts(): Promise<Map<string, number>> {
  const rows = await getPowerSync().getAll<{ folder_id: string; count: number }>(
    `SELECT folder_id, count(*) as count FROM notes
     WHERE is_trashed = 0 AND folder_id IS NOT NULL
     GROUP BY folder_id`
  );
  return new Map(rows.map((r) => [r.folder_id, r.count]));
}

/** Ids of `folderId` and everything beneath it, walked breadth-first.
 *
 *  Reads from SQLite rather than from the in-memory tree so that callers who
 *  are about to DELETE act on what the database currently holds, not on a
 *  render snapshot that may be a tick behind. */
export async function subtreeFolderIds(
  db: AbstractPowerSyncDatabase,
  folderId: string
): Promise<string[]> {
  const ids = [folderId];
  let frontier = [folderId];

  // Bounded by MAX_FOLDER_DEPTH, so this cannot loop away even if a cycle
  // somehow existed (the depth trigger makes one impossible server-side).
  for (let level = 0; level < MAX_FOLDER_DEPTH && frontier.length > 0; level++) {
    const placeholders = frontier.map(() => '?').join(',');
    const rows = await db.getAll<{ id: string }>(
      `SELECT id FROM folders WHERE parent_id IN (${placeholders})`,
      frontier
    );
    frontier = rows.map((r) => r.id);
    ids.push(...frontier);
  }

  return ids;
}

export async function getFolder(folderId: string): Promise<Folder | null> {
  const row = await getPowerSync().getOptional<any>(
    `SELECT ${FOLDER_COLUMNS} FROM folders WHERE id = ?`,
    [folderId]
  );
  return row ? mapRowToFolder(row) : null;
}

/** Is this note in the Skills folder (or a subfolder of it)? Used to decide a
 *  new note's api visibility. */
export async function isSkillsFolder(folderId: string | null): Promise<boolean> {
  if (!folderId) return false;
  const row = await getPowerSync().getOptional<{ kind: string; parent_id: string | null }>(
    'SELECT kind, parent_id FROM folders WHERE id = ?',
    [folderId]
  );
  if (!row) return false;
  if (row.kind === 'skills') return true;
  return isSkillsFolder(row.parent_id);
}

// =============================================================================
// Writes
// =============================================================================

export interface CreateFolderOptions {
  name: string;
  parentId?: string | null;
  kind?: FolderKind;
  includeInNotes?: boolean;
}

/**
 * The depth guard lives here as well as in Postgres, and the duplication is
 * deliberate -- the two do different jobs.
 *
 * This one is what the user experiences: the menu disables "New Folder" at the
 * limit, and this throw is the backstop for any path that misses that. The
 * server constraint is what makes the invariant true. Relying on the server
 * alone would be actively bad: PowerSync writes locally first, so the row would
 * appear, then fail asynchronously in the connector -- where a check violation
 * is not classified structural and would therefore retry forever, blocking
 * every op queued behind it.
 */
export async function createFolderInDB(options: CreateFolderOptions): Promise<Folder> {
  const { name, parentId = null, kind = 'user', includeInNotes = true } = options;

  let depth = 0;
  if (parentId) {
    const parent = await getPowerSync().getOptional<{ depth: number }>(
      'SELECT depth FROM folders WHERE id = ?',
      [parentId]
    );
    if (!parent) throw new Error(`Parent folder ${parentId} does not exist.`);
    depth = parent.depth + 1;
    if (depth > MAX_FOLDER_DEPTH) {
      throw new Error(
        `Folders nest ${MAX_FOLDER_DEPTH + 1} levels deep at most; this would be level ${depth + 1}.`
      );
    }
  }

  // New folders go after everything at their level. Computed among SIBLINGS,
  // not globally: sort_order only ever orders a folder against the folders
  // drawn beside it.
  const sortRow = await getPowerSync().get<{ next: number }>(
    parentId
      ? 'SELECT coalesce(max(sort_order), -1) + 1 AS next FROM folders WHERE parent_id = ?'
      : 'SELECT coalesce(max(sort_order), -1) + 1 AS next FROM folders WHERE parent_id IS NULL',
    parentId ? [parentId] : []
  );

  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  const userId = getCurrentUserId();

  await getPowerSync().execute(
    `INSERT INTO folders
       (id, user_id, parent_id, name, kind, depth, sort_order, include_in_notes, group_by_date, is_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
    [
      id,
      userId,
      parentId,
      encryptField(name),
      kind,
      depth,
      sortRow.next,
      includeInNotes ? 1 : 0,
      now,
      now,
    ]
  );

  return {
    id,
    userId,
    parentId,
    name,
    kind,
    depth,
    sortOrder: sortRow.next,
    includeInNotes,
    groupByDate: false,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** Takes PLAINTEXT. Refuses to overwrite a name it could not read, same guard
 *  and same reasoning as updateNoteInDB. */
export async function renameFolderInDB(id: string, name: string): Promise<void> {
  const existing = await getPowerSync().getOptional<{ name: string }>(
    'SELECT name FROM folders WHERE id = ?',
    [id]
  );
  if (!existing) return;

  const current = tryDecryptField(existing.name ?? '');
  if (!current.ok) {
    throw new Error(`Refusing to rename folder ${id}: its stored name could not be decrypted.`);
  }
  if (current.text === name) return;

  await getPowerSync().execute(
    'UPDATE folders SET name = ?, updated_at = ? WHERE id = ?',
    [encryptField(name), new Date().toISOString(), id]
  );
}

export async function setFolderIncludeInNotes(id: string, include: boolean): Promise<void> {
  await getPowerSync().execute(
    'UPDATE folders SET include_in_notes = ?, updated_at = ? WHERE id = ?',
    [include ? 1 : 0, new Date().toISOString(), id]
  );
}

export async function setFolderGroupByDate(id: string, group: boolean): Promise<void> {
  await getPowerSync().execute(
    'UPDATE folders SET group_by_date = ?, updated_at = ? WHERE id = ?',
    [group ? 1 : 0, new Date().toISOString(), id]
  );
}

/**
 * Delete a folder and its whole subtree, TRASHING the notes rather than
 * destroying them.
 *
 * Order matters and is the entire correctness argument. The notes are trashed
 * FIRST, inside the same transaction, while `folder_id` still points at the
 * folders being removed. Deleting the folders first would leave nothing to
 * find the notes by -- the FK's `on delete set null` would already have unfiled
 * them, and they would sit in All Notes as if nothing happened.
 *
 * After the folder rows go, that same `on delete set null` clears folder_id.
 * So a note trashed this way restores into All Notes rather than to its old
 * folder, which is the only honest answer: the folder no longer exists.
 */
export async function deleteFolderInDB(folderId: string): Promise<{ trashedNotes: number }> {
  const db = getPowerSync();
  const ids = await subtreeFolderIds(db, folderId);
  const placeholders = ids.map(() => '?').join(',');
  const now = new Date().toISOString();

  let trashedNotes = 0;

  await db.writeTransaction(async (tx) => {
    const pending = await tx.getAll<{ id: string }>(
      `SELECT id FROM notes WHERE folder_id IN (${placeholders}) AND is_trashed = 0`,
      ids
    );
    trashedNotes = pending.length;

    if (pending.length > 0) {
      await tx.execute(
        `UPDATE notes SET is_trashed = 1, trashed_at = ?, updated_at = ?
         WHERE folder_id IN (${placeholders}) AND is_trashed = 0`,
        [now, now, ...ids]
      );
    }

    // Deepest first. The server has `on delete cascade` and would not care,
    // but PowerSync replays these as individual ops against Postgres, and
    // deleting a parent before its children means the cascade removes rows the
    // later ops then try to delete again.
    for (const id of [...ids].reverse()) {
      await tx.execute('DELETE FROM folders WHERE id = ?', [id]);
    }
  });

  return { trashedNotes };
}

/** Whether deleting this folder needs the confirmation modal. Silent when
 *  there is genuinely nothing to lose. */
export async function folderHasContents(folderId: string): Promise<boolean> {
  const db = getPowerSync();
  const ids = await subtreeFolderIds(db, folderId);
  if (ids.length > 1) return true;

  const row = await db.get<{ count: number }>(
    'SELECT count(*) as count FROM notes WHERE folder_id = ? AND is_trashed = 0',
    [folderId]
  );
  return row.count > 0;
}

/**
 * Move one top-level folder up or down among its siblings.
 *
 * Swaps the two rows' sort_order rather than renumbering the list, so a
 * reorder is two writes regardless of how many folders exist -- and two
 * devices reordering different pairs concurrently converge instead of one
 * wholesale renumbering clobbering the other.
 */
export async function moveTopLevelFolder(id: string, direction: -1 | 1): Promise<void> {
  const db = getPowerSync();

  // Skills is pinned. Guarded here as well as hidden in the sidebar, so the
  // rule survives a second caller appearing later -- a UI-only rule is one
  // refactor away from being no rule at all.
  const moving = await db.getOptional<{ kind: string }>(
    'SELECT kind FROM folders WHERE id = ?',
    [id]
  );
  if (moving?.kind === 'skills') return;

  // Skills is also excluded from the ORDER the swap is computed against, so a
  // user folder directly below it moves past it rather than trading places
  // with a row that cannot move.
  const siblings = await db.getAll<{ id: string; sort_order: number }>(
    `SELECT id, sort_order FROM folders WHERE parent_id IS NULL AND kind != 'skills'
     ORDER BY sort_order ASC, created_at ASC`
  );

  const index = siblings.findIndex((s) => s.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= siblings.length) return;

  const a = siblings[index];
  const b = siblings[target];
  const now = new Date().toISOString();

  // Equal sort_orders would make the swap a no-op and leave the pair ordered
  // by created_at forever. Renumber the whole level in that case; it is rare
  // (only reachable from seed data or a migration) and cheap.
  if (a.sort_order === b.sort_order) {
    await db.writeTransaction(async (tx) => {
      for (let i = 0; i < siblings.length; i++) {
        await tx.execute('UPDATE folders SET sort_order = ?, updated_at = ? WHERE id = ?', [
          i,
          now,
          siblings[i].id,
        ]);
      }
      await tx.execute('UPDATE folders SET sort_order = ?, updated_at = ? WHERE id = ?', [
        target,
        now,
        a.id,
      ]);
      await tx.execute('UPDATE folders SET sort_order = ?, updated_at = ? WHERE id = ?', [
        index,
        now,
        b.id,
      ]);
    });
    return;
  }

  await db.writeTransaction(async (tx) => {
    await tx.execute('UPDATE folders SET sort_order = ?, updated_at = ? WHERE id = ?', [
      b.sort_order,
      now,
      a.id,
    ]);
    await tx.execute('UPDATE folders SET sort_order = ?, updated_at = ? WHERE id = ?', [
      a.sort_order,
      now,
      b.id,
    ]);
  });
}

/**
 * Switch a folder on or off.
 *
 * Reversible by construction: this writes ONE flag and touches no note. What
 * makes the notes invisible to apps is the broker consulting that flag at read
 * time (see DISABLED_FOLDER_SUBTREE_CTE above), so re-enabling restores exactly
 * the visibility that was there before, per-note choices included.
 */
export async function setFolderEnabled(id: string, enabled: boolean): Promise<void> {
  await getPowerSync().execute(
    'UPDATE folders SET is_enabled = ?, updated_at = ? WHERE id = ?',
    [enabled ? 1 : 0, new Date().toISOString(), id]
  );
}

export type SubtreeApiVisibility = 'all-visible' | 'all-hidden' | 'mixed' | 'empty';

/**
 * Whether the notes under a folder are visible to apps -- as one answer.
 *
 * Returns 'mixed' rather than picking a side when they disagree, because the
 * menu item that renders this is a bulk action: showing it as simply "on" when
 * three of five notes are hidden would misrepresent what tapping it destroys.
 */
export async function subtreeApiVisibility(folderId: string): Promise<SubtreeApiVisibility> {
  const db = getPowerSync();
  const ids = await subtreeFolderIds(db, folderId);
  const placeholders = ids.map(() => '?').join(',');

  const row = await db.get<{ total: number; hidden: number }>(
    `SELECT count(*) as total, sum(is_hidden_from_api) as hidden FROM notes
     WHERE folder_id IN (${placeholders}) AND is_trashed = 0`,
    ids
  );

  if (row.total === 0) return 'empty';
  const hidden = row.hidden ?? 0;
  if (hidden === 0) return 'all-visible';
  if (hidden === row.total) return 'all-hidden';
  return 'mixed';
}

/**
 * Set api visibility on every note under a folder, including subfolders.
 *
 * DESTRUCTIVE OF PER-NOTE CHOICES, deliberately and by instruction: "affecting
 * all its contents" is what a bulk action means, and there is no way to honour
 * that while also preserving the individual flags it is overwriting. The menu
 * item surfaces the aggregate first (see subtreeApiVisibility) so the state
 * being replaced is at least visible before it is replaced.
 *
 * Contrast setFolderEnabled above, which is reversible precisely because it
 * writes no note. Two different tools, and the difference is worth keeping
 * clear: one stands the folder down, the other rewrites its contents.
 *
 * Does not touch updated_at, same as setNoteHiddenFromApi: changing who may
 * read a note is not an edit to the note, and bumping it would reorder the list.
 */
export async function setSubtreeApiVisibility(
  folderId: string,
  visible: boolean
): Promise<number> {
  const db = getPowerSync();
  const ids = await subtreeFolderIds(db, folderId);
  const placeholders = ids.map(() => '?').join(',');

  const affected = await db.getAll<{ id: string }>(
    `SELECT id FROM notes WHERE folder_id IN (${placeholders}) AND is_trashed = 0
       AND is_hidden_from_api != ?`,
    [...ids, visible ? 0 : 1]
  );
  if (affected.length === 0) return 0;

  await db.execute(
    `UPDATE notes SET is_hidden_from_api = ?
     WHERE folder_id IN (${placeholders}) AND is_trashed = 0`,
    [visible ? 0 : 1, ...ids]
  );
  return affected.length;
}

// =============================================================================
// Seeding and claiming
// =============================================================================

/**
 * Create the Skills folder if this account doesn't have one.
 *
 * THE TRAP THIS GUARDS, because it is not obvious: a signed-in device will
 * ALSO receive the account's existing Skills row down the sync stream, moments
 * after launch. Seeding unconditionally therefore produces two Skills folders
 * on every device after the first -- and the second one syncs, so the mistake
 * is permanent and spreads.
 *
 * The guard is the same three-state reasoning NotesLayout's
 * emptyDatabaseIsTrustworthy() uses: an empty local table only means "no
 * folders exist" when nothing is still on its way. Signed out, local SQLite is
 * the whole truth. Signed in, wait for hasSynced.
 *
 * The unique partial index in Postgres is the backstop for whatever this misses.
 */
export async function seedSkillsFolder(db: AbstractPowerSyncDatabase): Promise<void> {
  const existing = await db.getOptional<{ id: string }>(
    "SELECT id FROM folders WHERE kind = 'skills'"
  );
  if (existing) return;


  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO folders
       (id, user_id, parent_id, name, kind, depth, sort_order, include_in_notes, group_by_date, is_enabled, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 'skills', 0, 0, 0, 0, 1, ?, ?)`,
    [
      Crypto.randomUUID(),
      getCurrentUserId(),
      encryptField(SKILLS_FOLDER_NAME),
      now,
      now,
    ]
  );
}

/**
 * Attach a newly-signed-in user to folders created before sign-in.
 *
 * Same requirement, same ordering and same failure mode as claimUnownedNotes:
 * must run BEFORE connect(), because an unowned folder can never satisfy the
 * insert policy (`auth.uid() = NULL` is NULL, not true) and would be erased at
 * the first checkpoint.
 */
export async function claimUnownedFolders(userId: string): Promise<number> {
  const unowned = await getPowerSync().getAll<{ id: string }>(
    'SELECT id FROM folders WHERE user_id IS NULL'
  );
  if (unowned.length === 0) return 0;

  await getPowerSync().execute('UPDATE folders SET user_id = ? WHERE user_id IS NULL', [userId]);
  return unowned.length;
}

/**
 * seedSkillsFolder, gated on whether an empty folders table can be believed.
 *
 * This is the same three-state question NotesLayout's
 * emptyDatabaseIsTrustworthy() asks about notes, and it has the same three
 * answers -- which is why the shape is copied rather than reinvented:
 *
 *   auth still resolving -> answer nothing. Session restore is async, so a
 *                           signed-in user looks signed out for a moment, and
 *                           seeding in that window creates an unowned folder
 *                           that then collides with the real one.
 *   signed out           -> local SQLite is the whole truth. Nothing is
 *                           coming, so no Skills row means no Skills row.
 *   signed in            -> wait for hasSynced. The account's existing Skills
 *                           folder is on its way down the stream.
 *
 * Called from the same effect as autoCreateIfTrulyEmpty, which already waits
 * on waitForFirstSync for precisely this reason.
 */
export async function seedSkillsFolderIfSettled(options: {
  authLoading: boolean;
  signedIn: boolean;
  hasSynced: boolean;
}): Promise<void> {
  if (options.authLoading) return;
  if (options.signedIn && !options.hasSynced) return;
  await seedSkillsFolder(getPowerSync());
}
