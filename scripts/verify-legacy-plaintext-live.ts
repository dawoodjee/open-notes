/**
 * Live-stack proof for the plaintext-forwarding fix, against a real
 * Postgres -- the same kind of check that originally discovered the bug
 * (mvp-build-plan.md's Decisions Log, 2026-08-19: "found via the account
 * probe... a direct query").
 *
 * Reproduces the exact scenario: a note whose body/title are still
 * plaintext locally (as if created before the vault existed), touched only
 * by a metadata-only write (trash) -- the write that used to forward
 * plaintext to the server, per connector.ts's uploadEntry uploading a row's
 * CURRENT LOCAL STATE rather than the changed columns. Confirms that with
 * lib/powersync/db.ts's encryptLegacyPlaintextNotes() run first (as
 * initPowerSync now does automatically), the row that reaches Postgres is
 * ciphertext.
 *
 * SCOPE NOTE, same as verify-merge-encrypted.ts: the connector here is a
 * transcription of lib/powersync/connector.ts's uploadEntry (real connector
 * imports expo-secure-store). lib/crypto/envelope.ts is imported and run for
 * real.
 *
 * Usage: npx tsx scripts/verify-legacy-plaintext-live.ts
 */
import { existsSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import ws from 'ws';
import { PowerSyncDatabase } from '@powersync/node';
import { AbstractPowerSyncDatabase, CrudEntry, UpdateType } from '@powersync/common';
import { createClient, Session } from '@supabase/supabase-js';
import { AppSchema } from '../lib/powersync/schema';
import { decrypt, encrypt, isEncrypted } from '../lib/crypto/envelope';
import { generateDataKey } from '../lib/crypto/keys';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const POWERSYNC_URL = 'http://127.0.0.1:8080';
const SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const TEST_EMAIL = 'sync-a@test.local';
const DB_FILE = './scripts/.verify-legacy-live.db';
const DATA_KEY = generateDataKey();

const wsOptions = { realtime: { transport: ws as any } };

let failed = 0;
function check(name: string, condition: boolean, detail = '') {
  if (!condition) failed++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
}

function psql(sql: string): string {
  return execSync(
    `docker exec -i supabase_db_notes psql -U postgres -d postgres -t -A -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8' }
  ).trim();
}

async function mintSession(email: string): Promise<Session> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, wsOptions);
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkError) throw linkError;

  const anon = createClient(SUPABASE_URL, ANON_KEY, wsOptions);
  const { data, error } = await anon.auth.verifyOtp({
    type: 'magiclink',
    token_hash: (linkData.properties as any).hashed_token,
  });
  if (error) throw error;
  return data.session!;
}

// Transcribed from lib/powersync/db.ts's encryptLegacyPlaintextNotes.
async function encryptLegacyPlaintextNotes(
  db: AbstractPowerSyncDatabase,
  key: Uint8Array
): Promise<number> {
  const rows = await db.getAll<{ id: string; body: string; title: string }>(
    `SELECT id, body, title FROM notes
     WHERE body NOT LIKE 'enc:v1:%' OR title NOT LIKE 'enc:v1:%'`
  );
  if (rows.length === 0) return 0;
  await db.writeTransaction(async (tx) => {
    for (const row of rows) {
      await tx.execute(`UPDATE notes SET body = ?, title = ? WHERE id = ?`, [
        encrypt(row.body, key),
        encrypt(row.title, key),
        row.id,
      ]);
    }
  });
  return rows.length;
}

// Transcribed from lib/powersync/connector.ts's uploadEntry -- the PUT/PATCH
// branch only, no merge machinery needed since this note has no server row
// when it's created and no concurrent second device in this scenario.
const NOTES_COLUMNS = ['user_id', 'body', 'title', 'created_at', 'updated_at', 'is_trashed'];

function makeConnector(session: Session) {
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    ...wsOptions,
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });

  return {
    async fetchCredentials() {
      return { endpoint: POWERSYNC_URL, token: session.access_token };
    },
    async uploadData(database: AbstractPowerSyncDatabase) {
      const tx = await database.getNextCrudTransaction();
      if (!tx) return;
      for (const entry of tx.crud as CrudEntry[]) {
        if (entry.op !== UpdateType.PUT && entry.op !== UpdateType.PATCH) continue;

        // The behaviour under test: current LOCAL state, not entry.opData.
        const row = await database.getOptional<Record<string, any>>(
          'SELECT * FROM notes WHERE id = ?',
          [entry.id]
        );
        if (!row) continue;

        const payload: Record<string, any> = { id: entry.id };
        for (const c of NOTES_COLUMNS) if (row[c] !== undefined) payload[c] = row[c];

        const { error } = await asUser.from('notes').upsert(payload);
        if (error) throw error;
      }
      await tx.complete();
    },
  };
}

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined>, tries = 40) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const v = await fn();
    if (v) return v;
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function main() {
  const session = await mintSession(TEST_EMAIL);
  console.log('Account:', TEST_EMAIL, '->', session.user.id);

  if (existsSync(DB_FILE)) unlinkSync(DB_FILE);
  const db = new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename: DB_FILE } });
  const connector = makeConnector(session);

  const noteId = randomUUID();
  const now = new Date().toISOString();
  const plainBody = '<p>legacy note, never touched since before encryption</p>';
  const plainTitle = 'legacy note, never touched since before encryption';

  try {
    // --- reproduce the scenario: a legacy plaintext note, owned, unsynced --
    console.log('\n--- setup: plaintext note, not yet connected ---');
    await db.execute(
      `insert into notes (id, user_id, body, title, created_at, updated_at, is_trashed, is_hidden_from_api)
       values (?, ?, ?, ?, ?, ?, 0, 0)`,
      [noteId, session.user.id, plainBody, plainTitle, now, now]
    );
    const planted = await db.getOptional<{ body: string }>(
      'select body from notes where id = ?',
      [noteId]
    );
    check('planted note is genuinely plaintext locally', !isEncrypted(planted!.body));

    // --- the fix: what initPowerSync now runs before anything else can ----
    const touched = await encryptLegacyPlaintextNotes(db, DATA_KEY);
    check('backfill touches exactly the one legacy note', touched === 1, `touched ${touched}`);

    // --- the write that used to leak: a metadata-only trash, not a save ---
    console.log('\n--- the metadata-only write that used to forward plaintext ---');
    await db.connect(connector);
    await db.execute('update notes set is_trashed = 1, updated_at = ? where id = ?', [
      new Date().toISOString(),
      noteId,
    ]);

    await waitFor('note to reach Postgres', async () =>
      psql(`select id from public.notes where id = '${noteId}';`)
    );

    const storedBody = psql(`select body from public.notes where id = '${noteId}';`);
    const storedTitle = psql(`select title from public.notes where id = '${noteId}';`);
    const storedTrashed = psql(`select is_trashed from public.notes where id = '${noteId}';`);
    console.log('\n--- raw Postgres row ---');
    console.log('body :', storedBody.slice(0, 72) + (storedBody.length > 72 ? '...' : ''));
    console.log('title:', storedTitle);

    check('server body is an enc:v1: envelope', isEncrypted(storedBody));
    check('server title is an enc:v1: envelope', isEncrypted(storedTitle));
    check('server body does not contain the plaintext', !storedBody.includes('legacy note'));
    check('server title does not contain the plaintext', !storedTitle.includes('legacy note'));
    check(
      'server body decrypts back to the exact original plaintext',
      decrypt(storedBody, DATA_KEY) === plainBody
    );
    check('the trash write itself still landed', storedTrashed === 't');
  } finally {
    psql(`delete from public.notes where id = '${noteId}';`);
    try {
      await db.close();
    } catch {
      // best effort
    }
    if (existsSync(DB_FILE)) unlinkSync(DB_FILE);
  }

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${failed} failing check(s)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
