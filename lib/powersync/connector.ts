import {
  AbstractPowerSyncDatabase,
  CrudEntry,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
  UpdateType,
} from '@powersync/common';
import { supabase } from '@/lib/supabase/client';
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
  return out;
}

// A rejection Postgres/PostgREST will keep rejecting no matter how many
// times we retry -- an RLS violation, a unique-constraint violation, or a
// reference to a column that no longer exists. Distinguishing these from a
// transient network failure is what keeps one permanently-invalid historical
// op from blocking every op queued after it forever.
function isStructuralError(error: any): boolean {
  const code = error?.code;
  const message = String(error?.message ?? '');
  return (
    code === '23505' || // unique_violation
    code === '42501' || // insufficient_privilege (RLS)
    code === '42703' || // undefined_column (stale pre-Stage-5 queue entries)
    message.includes('violates row-level security') ||
    message.includes('duplicate key value')
  );
}

async function recordSyncIssue(database: AbstractPowerSyncDatabase, noteId: string, message: string) {
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
      // Both go through .upsert(), never a bare .update(). A note claimed
      // after account creation (Stage 5 Phase 3) was blocked by RLS while
      // user_id was null, so it was never actually inserted server-side --
      // its first successful write is technically a PATCH against a row
      // Postgres has never seen. upsert() makes that self-healing regardless
      // of which local op type produced it.
      const { error } = await table.upsert({ id: entry.id, ...pickNotesColumns(entry.opData) });
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
    const {
      data: { session },
    } = await supabase.auth.getSession();

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
        // Transient (network, etc) -- rethrow so PowerSync retries the whole
        // transaction after its configured wait period.
        throw error;
      }
    }

    await transaction.complete();
  }
}

export const connector = new SupabaseConnector();
