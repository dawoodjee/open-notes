import { getPowerSync } from '@/lib/powersync/db';
import { supabase } from '@/lib/supabase/client';
import { clearNoteCryptoCache, tryDecryptField } from '@/lib/crypto/noteCrypto';

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
  const rows = await getPowerSync().getAll<{ data: string }>('SELECT data FROM ps_crud');

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
  const titled = await getPowerSync().getAll<{ id: string; title: string }>(
    `SELECT id, title FROM notes WHERE id IN (${placeholders})`,
    Array.from(noteIds)
  );
  // Titles are stored encrypted, so this is the one place outside
  // mapRowToNote that has to decrypt in JS -- the SQL above can only hand
  // back envelopes. A title that won't decrypt falls through to the
  // "Untitled note" default below, which is the right outcome for a warning
  // dialog: it still tells you something is unsynced, it just can't name it.
  const titleById = new Map(titled.map((r) => [r.id, tryDecryptField(r.title).text]));

  return Array.from(noteIds).map((id) => ({
    noteId: id,
    title: titleById.get(id) || 'Untitled note',
  }));
}

export async function getPendingWriteCount(): Promise<number> {
  const row = await getPowerSync().get<{ count: number }>('SELECT count(*) as count FROM ps_crud');
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
  await getPowerSync().disconnectAndClear();

  // The decrypted-plaintext cache outlives the rows it came from, so it has
  // to be dropped explicitly. Otherwise the next account signing in on this
  // device could be served the previous account's note text out of memory --
  // the in-JS equivalent of the local-data leak that disconnectAndClear()
  // exists to prevent.
  clearNoteCryptoCache();

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
