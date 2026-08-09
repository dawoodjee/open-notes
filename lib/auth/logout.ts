import { powersync } from '@/lib/powersync/db';
import { supabase } from '@/lib/supabase/client';

export interface PendingWrite {
  noteId: string;
  title: string;
}

// ps_crud's `data` column is PowerSync's internal JSON encoding of a CrudEntry,
// serialized as {"op","id","type","data"} -- note the table name is under
// `type`, NOT `table`. The TypeScript CrudEntry class exposes it as `.table`,
// which is what made `entry.table` look right; on the wire it is `type`.
//
// Getting that wrong was silent and dangerous rather than noisy: no ids
// matched, this returned [], and the sign-out path read that as "nothing
// unsynced to lose" and wiped local data without ever showing the warning.
// Verified against a real queue: {"op":"PUT","id":"...","type":"notes",...}.
// Both keys are accepted below so a future SDK change in either direction
// can't silently reintroduce a data-loss path.
export async function getPendingWrites(): Promise<PendingWrite[]> {
  const rows = await powersync.getAll<{ data: string }>('SELECT data FROM ps_crud');

  const noteIds = new Set<string>();
  for (const row of rows) {
    try {
      const entry = JSON.parse(row.data);
      const table = entry.type ?? entry.table;
      if (table === 'notes' && entry.id) {
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

  // A global sign-out revokes the refresh token server-side, which is the
  // stronger guarantee and the default. But it needs the network, and
  // logging out offline is a completely reasonable thing to do -- observed
  // live: the local database was already cleared, then signOut() threw on
  // the network call, leaving the app showing a signed-in avatar with no
  // data behind it. Falling back to a local-scope sign-out keeps the UI
  // honest about what already happened. The session on this device is gone
  // either way; only the server-side revocation is deferred, and the token
  // it leaves behind is one this device has already discarded.
  const { error } = await supabase.auth.signOut();
  if (error) {
    await supabase.auth.signOut({ scope: 'local' });
  }
}
