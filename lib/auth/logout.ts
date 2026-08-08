import { powersync } from '@/lib/powersync/db';
import { supabase } from '@/lib/supabase/client';

export interface PendingWrite {
  noteId: string;
  title: string;
}

// ps_crud's `data` column is PowerSync's internal JSON encoding of a
// CrudEntry (id, op, table, opData, ...) -- parsed here rather than exposed
// as a public API, so this reads it defensively.
export async function getPendingWrites(): Promise<PendingWrite[]> {
  const rows = await powersync.getAll<{ data: string }>('SELECT data FROM ps_crud');

  const noteIds = new Set<string>();
  for (const row of rows) {
    try {
      const entry = JSON.parse(row.data);
      if (entry.table === 'notes' && entry.id) {
        noteIds.add(entry.id);
      }
    } catch {
      // Malformed entry -- still counts as "something unsynced", but we
      // can't name it. Skipped here; still included by getPendingWriteCount.
    }
  }

  if (noteIds.size === 0) return [];

  const placeholders = Array.from(noteIds)
    .map(() => '?')
    .join(',');
  const titled = await powersync.getAll<{ id: string; title: string }>(
    `SELECT id, title FROM notes WHERE id IN (${placeholders})`,
    Array.from(noteIds)
  );
  const titleById = new Map(titled.map((r) => [r.id, r.title]));

  return Array.from(noteIds).map((id) => ({
    noteId: id,
    title: titleById.get(id) || 'Untitled note',
  }));
}

export async function getPendingWriteCount(): Promise<number> {
  const row = await powersync.get<{ count: number }>('SELECT count(*) as count FROM ps_crud');
  return row.count;
}

/**
 * disconnectAndClear() before signOut() -- that order specifically, matching
 * PowerSync's own documented pattern: the local database must be wiped
 * while the connector can still be constructed with the current (about to
 * be invalidated) session, not after. Default clearLocal (true) wipes
 * ui_state too -- a last_opened_note_id pointing at a note that no longer
 * exists locally would serve no purpose.
 *
 * Callers are responsible for checking getPendingWriteCount() and
 * confirming with the user first -- this function itself does not warn,
 * it trusts the caller already got consent.
 */
export async function logout(): Promise<void> {
  await powersync.disconnectAndClear();
  await supabase.auth.signOut();
}
