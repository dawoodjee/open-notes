/**
 * DEV STACK ONLY. Clears public.user_keys rows for accounts that were claimed
 * with a key belonging to a different account.
 *
 * WHY THIS EXISTS
 *
 * Before the recovery code was scoped to its account, hasRecoveryCode() asked
 * only "does this device have a code?" -- and the code outlives the account it
 * was issued for, because logout clears the local database but deliberately
 * leaves the keychain alone (the device key still has local notes to protect).
 * So every account created on a device that had signed in before skipped the
 * step that issues a code, and claimed the account with the previous account's
 * key. Four accounts on the dev stack ended up sharing one fingerprint, and for
 * three of them no code was ever displayed to anybody.
 *
 * public.user_keys has no UPDATE and no DELETE policy, on purpose -- a key swap
 * must never be able to silently orphan existing ciphertext. That guarantee is
 * exactly what makes this unfixable from inside the app, hence a script with
 * the service key, and hence the dev-stack guard below.
 *
 * WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT
 *
 * For each fingerprint claimed by more than one account it keeps the OLDEST
 * row -- that is the account the code was actually issued for -- and deletes
 * the rest. Their next sign-in finds no account key, runs key setup, and issues
 * a real recovery code.
 *
 * It does NOT touch notes. Server-side notes for those accounts stay encrypted
 * under the old key, and if a device claims the account with a different key
 * they arrive undecryptable -- which the app already handles honestly:
 * mapRowToNote flags decryptFailed and updateNoteInDB refuses to write over
 * them, so nothing is destroyed and the state is recoverable if the original
 * code turns up. Deleting them would be the irreversible option, and it is not
 * this script's call to make.
 *
 * Not to be confused with scripts/verify-key-distribution.ts, which TRUNCATES
 * user_keys and deletes encrypted notes wholesale as test setup.
 *
 * Usage:
 *   npx tsx scripts/repair-shared-account-keys.ts           # dry run, default
 *   npx tsx scripts/repair-shared-account-keys.ts --apply   # actually delete
 */
import { createClient } from '@supabase/supabase-js';
// Node 20 has no global WebSocket, and supabase-js builds a realtime client
// eagerly even though nothing here subscribes to anything. Same shim as the
// other scripts in this directory.
import ws from 'ws';

// Hard-coded rather than read from .env, and that is the safety property, not
// laziness: this file cannot be pointed at the live cloud stack by changing an
// environment variable. These are the standard local Supabase demo keys, which
// are public by design and are worthless anywhere else.
const DEV_SUPABASE_URL = 'http://127.0.0.1:54321';
const DEV_SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const apply = process.argv.includes('--apply');

interface KeyRow {
  user_id: string;
  key_fingerprint: string;
  created_at: string;
}

async function main() {
  // Belt and braces on top of the hard-coded constant above. A stack reachable
  // at 127.0.0.1 that is somehow not the dev one would still be caught by the
  // fact that the demo service key would not authenticate against it.
  if (!DEV_SUPABASE_URL.includes('127.0.0.1') && !DEV_SUPABASE_URL.includes('localhost')) {
    throw new Error('Refusing to run: this script is for the local dev stack only.');
  }

  const admin = createClient(DEV_SUPABASE_URL, DEV_SERVICE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: ws as any },
  });

  const { data: keys, error } = await admin
    .from('user_keys')
    .select('user_id, key_fingerprint, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = (keys ?? []) as KeyRow[];
  if (rows.length === 0) {
    console.log('No rows in public.user_keys. Nothing to do.');
    return;
  }

  // Group by fingerprint, preserving the created_at ordering from the query so
  // the first of each group is the original claimant.
  const byFingerprint = new Map<string, KeyRow[]>();
  for (const row of rows) {
    const group = byFingerprint.get(row.key_fingerprint) ?? [];
    group.push(row);
    byFingerprint.set(row.key_fingerprint, group);
  }

  const doomed: KeyRow[] = [];
  for (const [fingerprint, group] of byFingerprint) {
    if (group.length < 2) continue;
    const [original, ...duplicates] = group;
    console.log(`\nFingerprint ${fingerprint} is claimed by ${group.length} accounts:`);
    console.log(`  KEEP   ${original.user_id}  (oldest, claimed ${original.created_at})`);
    for (const dup of duplicates) {
      console.log(`  DELETE ${dup.user_id}  (claimed ${dup.created_at})`);
    }
    doomed.push(...duplicates);
  }

  if (doomed.length === 0) {
    console.log('\nEvery fingerprint belongs to exactly one account. Nothing to repair.');
    return;
  }

  if (!apply) {
    console.log(
      `\nDRY RUN -- ${doomed.length} row(s) would be deleted. Re-run with --apply to do it.`
    );
    return;
  }

  // Deleted one at a time so a failure names the row it failed on, rather than
  // leaving a partial batch with nothing to identify what got through.
  for (const row of doomed) {
    const { error: delError } = await admin.from('user_keys').delete().eq('user_id', row.user_id);
    if (delError) {
      throw new Error(`Failed to delete user_keys row for ${row.user_id}: ${delError.message}`);
    }
    console.log(`Deleted user_keys row for ${row.user_id}`);
  }

  console.log(
    `\nDone -- ${doomed.length} row(s) deleted. Those accounts will run key setup and be` +
      ` issued a real recovery code on their next sign-in.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
