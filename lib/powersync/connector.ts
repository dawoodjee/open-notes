import {
  AbstractPowerSyncDatabase,
  CrudEntry,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
  UpdateType,
} from '@powersync/common';
import { supabase } from '@/lib/supabase/client';
import { getCurrentSession } from '@/lib/auth/currentUser';
import { mergeBody } from './mergeBody';
import { encryptField, tryDecryptField } from '@/lib/crypto/noteCrypto';
import { parseNoteContent } from '@/types/note';
import * as Crypto from 'expo-crypto';

const NOTES_TABLE = 'notes';
const FOLDERS_TABLE = 'folders';
const SYNC_ISSUE_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 2 months

// Row shape notes actually has server-side -- see
// supabase/migrations/20260806122256_notes_and_profiles.sql. Used to narrow
// each op's opData before sending it, since a stale pre-Stage-5 queue entry
// can carry a dropped column (e.g. `version`) that would otherwise 400.
const NOTES_COLUMNS = [
  'user_id',
  'body',
  'title',
  'created_at',
  'updated_at',
  'is_trashed',
  'is_hidden_from_api',
  'folder_id',
  'trashed_at',
] as const;

// Same idea for folders. `name` is an enc:v1 envelope and travels as opaque
// text -- Postgres neither knows nor needs to know that it is ciphertext.
//
// `depth` is deliberately ABSENT. The server computes it from parent_id in a
// trigger (see the Stage 10 migration), so sending a client-supplied value
// would either be ignored or, worse, be trusted. The local copy is still
// correct because createFolderInDB derives it the same way.
const FOLDERS_COLUMNS = [
  'user_id',
  'parent_id',
  'name',
  'kind',
  'sort_order',
  'include_in_notes',
  'group_by_date',
  'is_enabled',
  'created_at',
  'updated_at',
] as const;

function pickFoldersColumns(data: Record<string, any> | undefined) {
  const out: Record<string, any> = {};
  if (!data) return out;
  for (const col of FOLDERS_COLUMNS) {
    if (col in data) out[col] = data[col];
  }
  if ('include_in_notes' in out) out.include_in_notes = Boolean(out.include_in_notes);
  if ('group_by_date' in out) out.group_by_date = Boolean(out.group_by_date);
  if ('is_enabled' in out) out.is_enabled = Boolean(out.is_enabled);
  return out;
}

function pickNotesColumns(data: Record<string, any> | undefined) {
  const out: Record<string, any> = {};
  if (!data) return out;
  for (const col of NOTES_COLUMNS) {
    if (col in data) out[col] = data[col];
  }
  // SQLite has no boolean type, so these round-trip as 0/1 while Postgres
  // declares them boolean. PostgREST accepts both, but normalizing here keeps
  // the payload honest about what the columns actually are.
  if ('is_trashed' in out) out.is_trashed = Boolean(out.is_trashed);
  if ('is_hidden_from_api' in out) out.is_hidden_from_api = Boolean(out.is_hidden_from_api);
  return out;
}

// A rejection Postgres/PostgREST will keep rejecting no matter how many times
// we retry. Distinguishing these from a transient network failure is what
// keeps one permanently-invalid historical op from blocking every op queued
// behind it forever.
//
// Dropping an op is a genuinely destructive act, not just "skip this sync":
// once uploadData completes the CRUD transaction, PowerSync considers the
// local mutation handed off and clears it at the next checkpoint, expecting
// the authoritative row to arrive back down the sync stream. If the row was
// never accepted server-side, nothing comes back -- and the local copy is
// gone. So this list stays as short as it can possibly be.
//
// Notably absent: 42501 / "violates row-level security". That used to be
// here, and it silently destroyed every note created before the user_id
// stamping fix -- an unowned note fails the RLS check by construction, so
// each one was rejected, dropped, and erased within seconds of being written.
// With notes now owned from creation (createNoteInDB) and pre-sign-in notes
// claimed before connecting (claimUnownedNotes), an RLS rejection no longer
// has a legitimate cause: it means something is actually wrong. Retrying
// forever and surfacing it in sync_issues is the right response to that;
// deleting the user's note is not.
function isStructuralError(error: any): boolean {
  const code = error?.code;
  const message = String(error?.message ?? '');
  return (
    code === '23505' || // unique_violation -- retrying can't make it unique
    code === '42703' || // undefined_column -- stale pre-Stage-5 queue entries
    message.includes('duplicate key value')
  );
}

// One row per note, not one per attempt. A retried failure re-enters this
// function on every upload cycle, so an append-only log would grow without
// bound and read as dozens of separate problems when it's really one. Delete
// then insert rather than an upsert: PowerSync exposes its tables as SQLite
// views over internal storage, and views have no ON CONFLICT.
async function recordSyncIssue(database: AbstractPowerSyncDatabase, noteId: string, message: string) {
  await database.execute(`delete from sync_issues where note_id = ?`, [noteId]);
  await database.execute(
    `insert into sync_issues (id, note_id, message, occurred_at)
     values (?, ?, ?, ?)`,
    [Crypto.randomUUID(), noteId, message, new Date().toISOString()]
  );
  // Bounded growth: prune anything older than 2 months in the same write,
  // rather than a separate cleanup job.
  const cutoff = new Date(Date.now() - SYNC_ISSUE_MAX_AGE_MS).toISOString();
  await database.execute(`delete from sync_issues where occurred_at < ?`, [cutoff]);
}

async function clearSyncIssue(database: AbstractPowerSyncDatabase, noteId: string) {
  await database.execute(`delete from sync_issues where note_id = ?`, [noteId]);
}

// --- note_sync_base: the last body this device and the server agreed on ---
//
// Delete-then-insert rather than upsert, for the same reason as sync_issues:
// PowerSync tables are SQLite views over internal storage, and views have no
// ON CONFLICT. (See the project note on this -- it type-checks fine and then
// fails on device, which is a nasty way to find out.)

async function getSyncBase(
  database: AbstractPowerSyncDatabase,
  noteId: string
): Promise<string | null> {
  const row = await database.getOptional<{ body: string }>(
    'SELECT body FROM note_sync_base WHERE note_id = ?',
    [noteId]
  );
  return row?.body ?? null;
}

async function setSyncBase(
  database: AbstractPowerSyncDatabase,
  noteId: string,
  body: string
): Promise<void> {
  await database.writeTransaction(async (tx) => {
    await tx.execute('DELETE FROM note_sync_base WHERE note_id = ?', [noteId]);
    await tx.execute(
      'INSERT INTO note_sync_base (id, note_id, body, updated_at) VALUES (?, ?, ?, ?)',
      [Crypto.randomUUID(), noteId, body, new Date().toISOString()]
    );
  });
}

async function clearSyncBase(database: AbstractPowerSyncDatabase, noteId: string): Promise<void> {
  await database.execute('DELETE FROM note_sync_base WHERE note_id = ?', [noteId]);
}

/**
 * Route an op to the table it actually belongs to.
 *
 * THIS DISPATCH IS NEW IN STAGE 10 AND WAS LOAD-BEARING FROM THE FIRST FOLDER
 * ROW. Before it, uploadEntry opened `supabase.from('notes')` unconditionally
 * and ignored entry.table entirely -- correct only while `notes` was the sole
 * synced table. A folder op would have been sent to the notes table as a note,
 * where it would either 400 on unknown columns or, if PostgREST were feeling
 * generous, insert a garbage note row. Neither failure mentions folders.
 *
 * Anything not recognised is skipped rather than guessed at. A new synced
 * table added later gets a loud dev warning here instead of silently
 * uploading itself into `notes`.
 */
async function uploadEntry(database: AbstractPowerSyncDatabase, entry: CrudEntry) {
  switch (entry.table) {
    case NOTES_TABLE:
      return uploadNoteEntry(database, entry);
    case FOLDERS_TABLE:
      return uploadFolderEntry(database, entry);
    default:
      if (__DEV__) {
        console.warn(
          `[powersync] no upload handler for table "${entry.table}" -- op skipped.`
        );
      }
      return;
  }
}

/**
 * Folders upload plainly: no merge, no ancestor, no note_sync_base.
 *
 * That asymmetry with notes is deliberate rather than unfinished. The 3-way
 * merge exists because two devices can edit different paragraphs of the same
 * body and both edits must survive. A folder has no body -- its mutable fields
 * are a name, a flag, and a sort position, each of which is a single value
 * where the later write genuinely is the answer. Running diff-match-patch over
 * a folder name would let two devices produce a spliced third name that
 * neither user typed.
 *
 * Reads current local state rather than entry.opData, for exactly the reason
 * the notes path does: a folder created before sign-in is queued with no
 * user_id, and replaying that verbatim fails the RLS check forever while
 * blocking every op behind it.
 */
async function uploadFolderEntry(database: AbstractPowerSyncDatabase, entry: CrudEntry) {
  const table = supabase.from(FOLDERS_TABLE);

  switch (entry.op) {
    case UpdateType.PUT:
    case UpdateType.PATCH: {
      const row = await database.getOptional<Record<string, any>>(
        'SELECT * FROM folders WHERE id = ?',
        [entry.id]
      );
      // Deleted locally since this op was queued; the DELETE behind it is the
      // authoritative instruction. Skip rather than resurrect it server-side.
      if (!row) break;

      const { error } = await table.upsert({ id: entry.id, ...pickFoldersColumns(row) });
      if (error) throw error;
      break;
    }
    case UpdateType.DELETE: {
      const { error } = await table.delete().eq('id', entry.id);
      if (error) throw error;
      break;
    }
  }
}

async function uploadNoteEntry(database: AbstractPowerSyncDatabase, entry: CrudEntry) {
  const table = supabase.from(NOTES_TABLE);

  switch (entry.op) {
    case UpdateType.PUT:
    case UpdateType.PATCH: {
      // Uploads the row's CURRENT local state, deliberately not entry.opData
      // (the values as they were when this op was recorded).
      //
      // ps_crud is an operation log, replayed in order, and a queued op is a
      // snapshot of the past. That bites hard here: a note created before
      // sign-in is recorded with no user_id, and replaying that op verbatim
      // after signing in still sends no user_id -- so it fails the RLS insert
      // check forever, and because PowerSync replays transactions strictly in
      // order it blocks every op behind it, including the very claim that
      // would have fixed it. Observed exactly that: a PUT with no user_id
      // stuck at the head of the queue with the claiming PATCH sitting
      // unreachable behind it.
      //
      // Reading current state instead makes replay self-healing -- whatever
      // the row looks like now is what gets sent, so the claim is already
      // baked in by the time the stale op is retried. The tradeoff is losing
      // per-op granularity: if a row changed after an op was queued, the
      // newer state uploads. For notes that's the desired end state anyway,
      // and later ops in the queue would have converged on it regardless.
      const row = await database.getOptional<Record<string, any>>(
        'SELECT * FROM notes WHERE id = ?',
        [entry.id]
      );
      // Gone locally since this op was queued -- the DELETE queued behind
      // this one is the authoritative instruction, so skip rather than
      // resurrect the row server-side.
      if (!row) break;

      const payload: Record<string, any> = { id: entry.id, ...pickNotesColumns(row) };

      // The plaintext that will become this note's new sync ancestor. Held
      // separately because payload.body is an envelope from here on, and
      // note_sync_base must store plaintext for the next merge to be able to
      // diff against it.
      let ancestorPlaintext: string | null = null;

      // Before overwriting the server's body, check whether it moved since we
      // last agreed with it -- another device may have edited this same note
      // while we were offline. mergeBody replays only *our* changes onto
      // their current text, so edits in different paragraphs both survive
      // instead of the later upload silently erasing the earlier one.
      const { data: remote, error: readError } = await table
        .select('body')
        .eq('id', entry.id)
        .maybeSingle();
      if (readError) throw readError;

      // --- the merge now runs on PLAINTEXT, never on ciphertext -----------
      //
      // This is the collision Stage 6 had to resolve rather than bolt on.
      // diff-match-patch finds the edits one side made by diffing against a
      // common ancestor. Ciphertext has no such structure: a one-character
      // edit changes every byte after it, and a fresh nonce changes them all
      // anyway. Diffing envelopes would produce garbage that still "merges"
      // cleanly -- the worst kind of failure.
      //
      // So: decrypt both sides, merge, re-encrypt. note_sync_base keeps its
      // ancestor in plaintext, which is safe now only because Phase 1
      // encrypted the whole local database file.
      if (remote && typeof payload.body === 'string') {
        const localPlain = tryDecryptField(payload.body);
        const remotePlain = tryDecryptField(remote.body ?? '');

        if (!localPlain.ok || !remotePlain.ok) {
          // Cannot merge what cannot be read. Retryable rather than dropped:
          // a locked vault resolves itself, and a foreign key is Phase 3's
          // problem -- neither is a reason to destroy an edit.
          throw new Error(
            `Cannot merge note ${entry.id}: ${!localPlain.ok ? 'local' : 'remote'} content did not decrypt`
          );
        }

        const base = await getSyncBase(database, entry.id);
        const result = mergeBody(base, localPlain.text, remotePlain.text);

        if (result.outcome === 'partial') {
          // Not fatal -- the merge still happened and most of the edit
          // survived -- but the user has provably lost some text, which is
          // exactly the kind of thing that must not live only in a dev log.
          await recordSyncIssue(
            database,
            entry.id,
            'Some offline edits to this note could not be merged with changes from another device.'
          );
        }

        // Compared as plaintext. Comparing the envelopes would be true every
        // single time -- re-encrypting identical text yields different bytes
        // -- so every upload would look like a merge and rewrite the row.
        if (result.body !== localPlain.text) {
          payload.body = encryptField(result.body);
          // Keep title consistent with the merged body -- title is derived
          // from body (parseNoteContent), so shipping a merged body with the
          // pre-merge title would make the two disagree.
          payload.title = encryptField(parseNoteContent(result.body).title);
          // The merged text is also what this device should now show;
          // otherwise the other device's changes stay invisible here until
          // the next pull happens to overwrite them.
          await database.execute('UPDATE notes SET body = ?, title = ? WHERE id = ?', [
            payload.body,
            payload.title,
            entry.id,
          ]);
        }

        // The ancestor is the plaintext both sides now agree on.
        ancestorPlaintext = result.body;
      } else if (typeof payload.body === 'string') {
        // No server row yet -- nothing to merge against, so the ancestor is
        // simply what we're about to upload.
        const localPlain = tryDecryptField(payload.body);
        if (!localPlain.ok) {
          throw new Error(`Cannot upload note ${entry.id}: local content did not decrypt`);
        }
        ancestorPlaintext = localPlain.text;
      }

      // upsert(), never a bare update(): a note that was blocked by RLS while
      // unowned was never inserted server-side, so its first successful write
      // is a PATCH against a row Postgres has never seen.
      const { error } = await table.upsert(payload);
      if (error) throw error;

      // Record the new common ancestor only after the write is confirmed --
      // claiming agreement we never actually reached would make the *next*
      // merge diff against a version the server never had.
      //
      // Stored as PLAINTEXT. Storing the envelope would be useless: the next
      // merge diffs against this value, and diffing ciphertext produces
      // nonsense. Safe because the whole local database file is encrypted.
      if (ancestorPlaintext !== null) {
        await setSyncBase(database, entry.id, ancestorPlaintext);
      }
      break;
    }
    case UpdateType.DELETE: {
      const { error } = await table.delete().eq('id', entry.id);
      if (error) throw error;
      await clearSyncBase(database, entry.id);
      break;
    }
  }
}

export class SupabaseConnector implements PowerSyncBackendConnector {
  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    // Reads the session AuthContext already holds rather than calling
    // supabase.auth.getSession(), and that is load-bearing, not a shortcut.
    //
    // This method is reached (via connectPowerSync) from inside
    // onAuthStateChange's callback. supabase-js runs that callback while
    // holding its internal auth lock, and getSession() wants the same lock --
    // so calling it from in there deadlocks: the promise simply never
    // settles. No error, no network request, nothing in the GoTrue or Kong
    // logs to find. Supabase's own docs warn against calling further auth
    // methods inside that callback for exactly this reason.
    //
    // That deadlock is what the 8s timeouts elsewhere in this codebase were
    // really papering over. An earlier theory blamed expo-secure-store, since
    // swapping the storage adapter appeared to fix it -- it only changed the
    // timing enough to lose the race sometimes.
    //
    // The cached session is not staler than getSession() would be: every
    // TOKEN_REFRESHED event routes through becomeAuthenticatedLocally, which
    // updates it, so access_token here is always the current one.
    const session = getCurrentSession();
    if (!session) return null;

    return {
      endpoint: process.env.EXPO_PUBLIC_POWERSYNC_URL!,
      token: session.access_token,
    };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    for (const entry of transaction.crud) {
      // sync_issues is keyed by note_id and is surfaced in Settings > Advanced
      // as a problem with a NOTE. Recording a folder failure there would show
      // the user a note that doesn't exist. Folder failures still retry and
      // still log in dev -- they just don't claim to be about a note.
      const tracksIssues = entry.table === NOTES_TABLE;
      try {
        await uploadEntry(database, entry);
        if (tracksIssues) await clearSyncIssue(database, entry.id);
      } catch (error: any) {
        if (isStructuralError(error)) {
          // Not retryable -- retrying forever would block every op queued
          // after this one. Log it durably (sync_issues, not just __DEV__)
          // and move on to the next entry in this transaction.
          if (__DEV__) {
            console.warn(
              `[powersync] dropping op for ${entry.table} ${entry.id}:`,
              error?.message ?? error
            );
          }
          if (tracksIssues) {
            await recordSyncIssue(database, entry.id, error?.message ?? 'Sync failed');
          }
          continue;
        }
        // Retryable -- rethrow so PowerSync retries the whole transaction
        // after its configured wait period. The local row is preserved
        // either way, since the transaction never completes.
        //
        // Recorded anyway, because "retryable" doesn't mean "harmless": an
        // RLS rejection or a server that's been unreachable for days will
        // retry forever and never resolve itself, and the user deserves to
        // find that in Settings > Advanced rather than wonder why a note
        // isn't on their other device. The row is keyed by note_id and
        // cleared on the next success, so a genuinely transient blip leaves
        // nothing behind.
        if (tracksIssues) {
          await recordSyncIssue(database, entry.id, error?.message ?? 'Sync failed');
        }
        throw error;
      }
    }

    await transaction.complete();
  }
}

export const connector = new SupabaseConnector();
