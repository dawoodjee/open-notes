import { Note, parseNoteContent } from '@/types/note';
import { PowerSyncDatabase } from '@powersync/react-native';
import * as Crypto from 'expo-crypto';
import { AppSchema } from './schema';

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

  // Seed default notes on first launch if empty
  const existingNotes = await powersync.getAll('SELECT count(*) as count FROM notes');
  const count = (existingNotes[0] as any)?.count ?? 0;

  if (count === 0) {
    const now = new Date().toISOString();
    const twoDaysAgo = new Date(Date.now() - 86400000 * 2).toISOString();

    const initialNotes = [
      {
        id: Crypto.randomUUID(),
        body: 'MVP Build Plan<br>The frictionless experience of Apple Notes, the data sovereignty of Obsidian, and the extensibility of Notion.',
        title: 'MVP Build Plan',
        created_at: now,
        updated_at: now,
        is_trashed: 0,
        trashed_at: null,
        version: 1,
      },
      {
        id: Crypto.randomUUID(),
        body: '<h1>Supabase Architecture</h1><p>Row Level Security and Postgres schemas for local-first sync using PowerSync.</p>',
        title: 'Supabase Architecture',
        created_at: twoDaysAgo,
        updated_at: twoDaysAgo,
        is_trashed: 0,
        trashed_at: null,
        version: 1,
      },
      {
        id: Crypto.randomUUID(),
        body: "<h1>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</h1>",
        title: 'Lorem Ipsum',
        created_at: now,
        updated_at: now,
        is_trashed: 0,
        trashed_at: null,
        version: 1,
      },
    ];

    for (const note of initialNotes) {
      await powersync.execute(
        `INSERT INTO notes (id, body, title, created_at, updated_at, is_trashed, trashed_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          note.id,
          note.body,
          note.title,
          note.created_at,
          note.updated_at,
          note.is_trashed,
          note.trashed_at,
          note.version,
        ]
      );
    }
  }
}

export function mapRowToNote(row: any): Note {
  return {
    id: row.id,
    body: row.body ?? '',
    title: row.title ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isTrashed: Boolean(row.is_trashed),
    trashedAt: row.trashed_at ?? null,
    isSynced: true,
    version: row.version ?? 1,
  };
}

export async function fetchAllNotesFromDB(): Promise<Note[]> {
  const rows = await powersync.getAll('SELECT * FROM notes ORDER BY updated_at DESC');
  return rows.map(mapRowToNote);
}

export async function createNoteInDB(): Promise<Note> {
  const id = Crypto.randomUUID();
  const body = '';
  const { title } = parseNoteContent(body);
  const now = new Date().toISOString();

  await powersync.execute(
    `INSERT INTO notes (id, body, title, created_at, updated_at, is_trashed, trashed_at, version)
     VALUES (?, ?, ?, ?, ?, 0, NULL, 1)`,
    [id, body, title, now, now]
  );

  return {
    id,
    body,
    title,
    createdAt: now,
    updatedAt: now,
    isTrashed: false,
    trashedAt: null,
    isSynced: false,
    version: 1,
  };
}

export async function updateNoteInDB(id: string, body: string): Promise<void> {
  const { title } = parseNoteContent(body);
  const now = new Date().toISOString();

  await powersync.execute(
    `UPDATE notes SET body = ?, title = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
    [body, title, now, id]
  );
}

export async function trashNoteInDB(id: string): Promise<void> {
  const now = new Date().toISOString();
  await powersync.execute(
    `UPDATE notes SET is_trashed = 1, trashed_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, id]
  );
}

export async function restoreNoteInDB(id: string): Promise<void> {
  const now = new Date().toISOString();
  await powersync.execute(
    `UPDATE notes SET is_trashed = 0, trashed_at = NULL, updated_at = ? WHERE id = ?`,
    [now, id]
  );
}

export async function permanentDeleteNoteInDB(id: string): Promise<void> {
  await powersync.execute('DELETE FROM notes WHERE id = ?', [id]);
}

export async function emptyTrashInDB(): Promise<void> {
  await powersync.execute('DELETE FROM notes WHERE is_trashed = 1');
}
