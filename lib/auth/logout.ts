import { getPowerSync } from '@/lib/powersync/db';
import { supabase } from '@/lib/supabase/client';
import { clearNoteCryptoCache, tryDecryptField } from '@/lib/crypto/noteCrypto';
import { clearRecoveryState } from '@/lib/crypto/vault';

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

  // The recovery code is the third thing that outlives the account if nobody
  // clears it -- and the one whose survival did real damage. It lives in the
  // keychain, which disconnectAndClear() has no reach into, so it sat there
  // after sign-out and made the NEXT account's sign-in skip issuing a code of
  // its own. See clearRecoveryState for what is deliberately left behind: the
  // device key and the database seed, without which this device's remaining
  // local notes would be unreadable.
  await clearRecoveryState();

  // scope: 'local' -- sign out THIS device, explicitly, rather than taking
  // supabase-js's default.
  //
  // That default is 'global', which revokes the account's refresh token
  // server-side, on every device. Observed live: logging out on the phone
  // silently signed out the tablet. Not immediately, which is what made it
  // confusing to place -- the other device's access token stays valid until
  // it next refreshes, so it carried on working and then dropped out the
  // moment something made a network call (opening Manage Account reads the
  // profile, which is enough). And its notes survived, because that device
  // never ran this function; it only saw a SIGNED_OUT event, which mirrors
  // state and never clears local data. "Signed out but my notes are still
  // here" is exactly the fingerprint of a revocation that came from
  // somewhere else.
  //
  // Little is given up by scoping this locally. The refresh token stops
  // being revoked, but it only ever existed in this device's storage, which
  // signOut deletes as part of this same call -- so there is no surviving
  // copy for the revocation to protect against. Signing out every device at
  // once is a different feature (for a lost phone) and belongs behind its
  // own deliberate action, not attached to the ordinary logout button.
  //
  // It also removes a failure mode rather than adding one: a global sign-out
  // needs the network, and logging out offline is completely reasonable.
  // This used to be a global call with a local-scope retry in its error
  // path, because the network call threw after the local database had
  // already been cleared and left the app showing a signed-in avatar with no
  // data behind it. A local sign-out has nothing to fail at, so the fallback
  // ladder is gone.
  await supabase.auth.signOut({ scope: 'local' });
}
