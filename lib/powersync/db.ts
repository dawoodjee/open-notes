import { Note, parseNoteContent } from '@/types/note';
import { PowerSyncDatabase } from '@powersync/react-native';
import * as Crypto from 'expo-crypto';
import { AppSchema } from './schema';
import { connector } from './connector';

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

  // user_id stays NULL until an account claims this note in Stage 5.
  await powersync.execute(
    `INSERT INTO notes (id, user_id, body, title, created_at, updated_at, is_trashed)
     VALUES (?, NULL, ?, ?, ?, ?, 0)`,
    [id, body, title, now, now]
  );

  return {
    id,
    userId: null,
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
