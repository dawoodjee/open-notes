import { Note, parseNoteContent } from '@/types/note';
import { PowerSyncDatabase } from '@powersync/react-native';
import * as Crypto from 'expo-crypto';
import { AppSchema } from './schema';
import { connector } from './connector';
import { getCurrentUserId } from '@/lib/auth/currentUser';

export const powersync = new PowerSyncDatabase({
  schema: AppSchema,
  database: {
    dbFilename: 'notes.db',
  },
});

let isInitialized = false;

export async function initPowerSync(): Promise<void> {
  if (isInitialized) return;
  await powersync.init();
  isInitialized = true;
}

// Not called from initPowerSync -- connecting is an auth-state decision
// (Phase 2 wires this to login/logout), not something that should happen
// unconditionally at app boot. The app keeps working fully offline/local-only
// without this ever being called, exactly as it did before Stage 5.
export async function connectPowerSync(): Promise<void> {
  await powersync.connect(connector);
}

/**
 * Attach a newly-signed-in user to every local note that doesn't have an
 * owner yet -- the notes they wrote before enabling sync.
 *
 * Must run BEFORE connectPowerSync(), not after. Once connected, the first
 * sync checkpoint discards local rows the server doesn't know about, and an
 * unowned note is unknowable to the server by construction (the sync bucket
 * is `where user_id = bucket.user_id`). Claiming after connecting would race
 * that checkpoint and usually lose.
 *
 * Purely local SQL, so it only ever touches rows already on this device.
 * That's safe *because* an account switch clears local storage first (see
 * becomeAuthenticatedLocally) -- without that ordering, this same statement
 * would happily hand the previous account's notes to the new one.
 */
export async function claimUnownedNotes(userId: string): Promise<number> {
  const unowned = await powersync.getAll<{ id: string }>(
    'SELECT id FROM notes WHERE user_id IS NULL'
  );
  if (unowned.length === 0) return 0;

  await powersync.execute('UPDATE notes SET user_id = ? WHERE user_id IS NULL', [userId]);
  return unowned.length;
}

export function mapRowToNote(row: any): Note {
  return {
    id: row.id,
    userId: row.user_id ?? null,
    body: row.body ?? '',
    title: row.title ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isTrashed: Boolean(row.is_trashed),
  };
}

export async function createNoteInDB(): Promise<Note> {
  const id = Crypto.randomUUID();
  const body = '';
  const { title } = parseNoteContent(body);
  const now = new Date().toISOString();

  // Stamped with the current owner at creation, NULL only when genuinely
  // signed out (those get claimed at login -- see claimUnownedNotes below).
  //
  // This is not cosmetic. Once PowerSync is connected, every local insert is
  // queued for upload immediately, and a note with a NULL user_id can never
  // satisfy the `owners insert their notes` RLS policy -- `auth.uid() = NULL`
  // is NULL, not true. The rejected op gets dropped, PowerSync treats the
  // local mutation as handed off, and the row is erased from local storage at
  // the next checkpoint because the server never echoes it back (it isn't in
  // any sync bucket). The note vanishes seconds after being created.
  const userId = getCurrentUserId();
  await powersync.execute(
    `INSERT INTO notes (id, user_id, body, title, created_at, updated_at, is_trashed)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [id, userId, body, title, now, now]
  );

  return {
    id,
    userId,
    body,
    title,
    createdAt: now,
    updatedAt: now,
    isTrashed: false,
  };
}

export async function updateNoteInDB(id: string, body: string): Promise<void> {
  const { title } = parseNoteContent(body);
  const now = new Date().toISOString();

  await powersync.execute(
    `UPDATE notes SET body = ?, title = ?, updated_at = ? WHERE id = ?`,
    [body, title, now, id]
  );
}

// updated_at doubles as "when was this trashed" — see types/note.ts.
export async function trashNoteInDB(id: string): Promise<void> {
  const now = new Date().toISOString();
  await powersync.execute(
    `UPDATE notes SET is_trashed = 1, updated_at = ? WHERE id = ?`,
    [now, id]
  );
}

export async function restoreNoteInDB(id: string): Promise<void> {
  const now = new Date().toISOString();
  await powersync.execute(
    `UPDATE notes SET is_trashed = 0, updated_at = ? WHERE id = ?`,
    [now, id]
  );
}

export async function permanentDeleteNoteInDB(id: string): Promise<void> {
  await powersync.execute('DELETE FROM notes WHERE id = ?', [id]);
}

export async function emptyTrashInDB(): Promise<void> {
  await powersync.execute('DELETE FROM notes WHERE is_trashed = 1');
}

export interface UiState {
  lastOpenedNoteId: string | null;
  editorScrollOffset: number;
}

export async function getUiState(): Promise<UiState> {
  const row = await powersync.getOptional<any>(
    'SELECT last_opened_note_id, editor_scroll_offset FROM ui_state WHERE id = ?',
    ['singleton']
  );

  return {
    lastOpenedNoteId: row?.last_opened_note_id ?? null,
    editorScrollOffset: row?.editor_scroll_offset ?? 0,
  };
}

// PowerSync exposes tables as SQLite *views* (INSTEAD OF triggers over internal
// storage), which support INSERT/UPDATE/DELETE but not UPSERT — so this
// read-merge-writes rather than using ON CONFLICT.
export async function saveUiState(partial: Partial<UiState>): Promise<void> {
  await powersync.writeTransaction(async (tx) => {
    const existing = await tx.getOptional<any>(
      'SELECT last_opened_note_id, editor_scroll_offset FROM ui_state WHERE id = ?',
      ['singleton']
    );

    const lastOpenedNoteId =
      partial.lastOpenedNoteId ?? existing?.last_opened_note_id ?? null;
    const editorScrollOffset =
      partial.editorScrollOffset ?? existing?.editor_scroll_offset ?? 0;

    if (existing) {
      await tx.execute(
        `UPDATE ui_state SET last_opened_note_id = ?, editor_scroll_offset = ? WHERE id = ?`,
        [lastOpenedNoteId, editorScrollOffset, 'singleton']
      );
    } else {
      await tx.execute(
        `INSERT INTO ui_state (id, last_opened_note_id, editor_scroll_offset) VALUES (?, ?, ?)`,
        ['singleton', lastOpenedNoteId, editorScrollOffset]
      );
    }
  });
}
