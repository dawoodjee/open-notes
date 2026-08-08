import {
  AbstractPowerSyncDatabase,
  CrudEntry,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
  UpdateType,
} from '@powersync/common';
import { supabase } from '@/lib/supabase/client';
import { getCurrentSession } from '@/lib/auth/currentUser';
import * as Crypto from 'expo-crypto';

const NOTES_TABLE = 'notes';
const SYNC_ISSUE_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 2 months

// Row shape notes actually has server-side -- see
// supabase/migrations/20260806122256_notes_and_profiles.sql. Used to narrow
// each op's opData before sending it, since a stale pre-Stage-5 queue entry
// can carry a dropped column (e.g. `version`) that would otherwise 400.
const NOTES_COLUMNS = ['user_id', 'body', 'title', 'created_at', 'updated_at', 'is_trashed'] as const;

function pickNotesColumns(data: Record<string, any> | undefined) {
  const out: Record<string, any> = {};
  if (!data) return out;
  for (const col of NOTES_COLUMNS) {
    if (col in data) out[col] = data[col];
  }
  // SQLite has no boolean type, so is_trashed round-trips as 0/1 while
  // Postgres declares it boolean. PostgREST accepts both, but normalizing
  // here keeps the payload honest about what the column actually is.
  if ('is_trashed' in out) out.is_trashed = Boolean(out.is_trashed);
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

async function uploadEntry(database: AbstractPowerSyncDatabase, entry: CrudEntry) {
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

      // upsert(), never a bare update(): a note that was blocked by RLS while
      // unowned was never inserted server-side, so its first successful write
      // is a PATCH against a row Postgres has never seen.
      const { error } = await table.upsert({ id: entry.id, ...pickNotesColumns(row) });
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
      try {
        await uploadEntry(database, entry);
        await clearSyncIssue(database, entry.id);
      } catch (error: any) {
        if (isStructuralError(error)) {
          // Not retryable -- retrying forever would block every op queued
          // after this one. Log it durably (sync_issues, not just __DEV__)
          // and move on to the next entry in this transaction.
          if (__DEV__) {
            console.warn(`[powersync] dropping op for note ${entry.id}:`, error?.message ?? error);
          }
          await recordSyncIssue(database, entry.id, error?.message ?? 'Sync failed');
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
        await recordSyncIssue(database, entry.id, error?.message ?? 'Sync failed');
        throw error;
      }
    }

    await transaction.complete();
  }
}

export const connector = new SupabaseConnector();
