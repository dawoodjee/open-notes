/**
 * Phase 2 verification (Stage 6): the Stage 5 two-device merge, but with note
 * content encrypted end-to-end.
 *
 * This is the check that proves encryption and the 3-way merge can coexist.
 * They very nearly cannot: diff-match-patch works by finding what each side
 * changed relative to a common ancestor, and ciphertext has no such
 * structure. One edited character rewrites every byte after it, and a fresh
 * random nonce rewrites all of them anyway. Diffing envelopes would "succeed"
 * and produce garbage.
 *
 * So the connector decrypts both sides, merges plaintext, and re-encrypts.
 * The four cases below are exactly the ones that break if any part of that
 * ordering is wrong.
 *
 * SCOPE, stated as honestly as Stage 5's equivalent: uploadData here is a
 * transcription of lib/powersync/connector.ts's uploadEntry, because the real
 * connector imports expo-secure-store and __DEV__. What is NOT transcribed is
 * the part under test -- lib/crypto/envelope.ts, lib/crypto/keys.ts and
 * lib/powersync/mergeBody.ts are imported and run directly.
 *
 * Usage: npx tsx scripts/verify-merge-encrypted.ts
 */
import { PowerSyncDatabase } from '@powersync/node';
import { AbstractPowerSyncDatabase, CrudEntry } from '@powersync/common';
import { createClient, Session } from '@supabase/supabase-js';
import ws from 'ws';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import { AppSchema } from '../lib/powersync/schema';
import { mergeBody } from '../lib/powersync/mergeBody';
import { decrypt, encrypt, isEncrypted } from '../lib/crypto/envelope';
import { generateDataKey } from '../lib/crypto/keys';
import { parseNoteContent } from '../types/note';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const POWERSYNC_URL = 'http://127.0.0.1:8080';
const SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const TEST_EMAIL = 'user-a@test.local';

const DB_A = './scripts/.verify-enc-a.db';
const DB_B = './scripts/.verify-enc-b.db';

const wsOptions = { realtime: { transport: ws as any } };

// Both devices share one data key -- which is precisely what Phase 3's
// user_keys table exists to arrange for real devices. Sharing it here isolates
// the merge behaviour from key distribution.
const DATA_KEY = generateDataKey();

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

// note_sync_base stores PLAINTEXT -- see lib/powersync/schema.ts for why.
async function getSyncBase(db: AbstractPowerSyncDatabase, noteId: string): Promise<string | null> {
  const row = await db.getOptional<{ body: string }>(
    'SELECT body FROM note_sync_base WHERE note_id = ?',
    [noteId]
  );
  return row?.body ?? null;
}

async function setSyncBase(db: AbstractPowerSyncDatabase, noteId: string, plaintext: string) {
  await db.writeTransaction(async (tx) => {
    await tx.execute('DELETE FROM note_sync_base WHERE note_id = ?', [noteId]);
    await tx.execute(
      'INSERT INTO note_sync_base (id, note_id, body, updated_at) VALUES (?, ?, ?, ?)',
      [randomUUID(), noteId, plaintext, new Date().toISOString()]
    );
  });
}

const NOTES_COLUMNS = ['user_id', 'body', 'title', 'created_at', 'updated_at', 'is_trashed'];

const mergeOutcomes: string[] = [];

function makeDevice(label: string, session: Session, file: string) {
  if (existsSync(file)) unlinkSync(file);
  const db = new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename: file } });

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    ...wsOptions,
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });

  const connector = {
    async fetchCredentials() {
      return { endpoint: POWERSYNC_URL, token: session.access_token };
    },
    async uploadData(database: AbstractPowerSyncDatabase) {
      const tx = await database.getNextCrudTransaction();
      if (!tx) return;
      for (const entry of tx.crud as CrudEntry[]) {
        const row = await database.getOptional<Record<string, any>>(
          'SELECT * FROM notes WHERE id = ?',
          [entry.id]
        );
        if (!row) continue;

        const payload: Record<string, any> = { id: entry.id };
        for (const c of NOTES_COLUMNS) if (row[c] !== undefined) payload[c] = row[c];

        const { data: remote, error: readError } = await asUser
          .from('notes')
          .select('body')
          .eq('id', entry.id)
          .maybeSingle();
        if (readError) throw readError;

        let ancestor: string | null = null;

        if (remote && typeof payload.body === 'string') {
          // Decrypt BOTH sides, merge plaintext, re-encrypt.
          const localPlain = decrypt(payload.body, DATA_KEY);
          const remotePlain = decrypt(remote.body ?? '', DATA_KEY);
          const base = await getSyncBase(database, entry.id);
          const result = mergeBody(base, localPlain, remotePlain);
          mergeOutcomes.push(`${label}:${result.outcome}`);
          console.log(`  [${label}] merge outcome: ${result.outcome}`);

          // Compared as plaintext -- comparing envelopes would always differ.
          if (result.body !== localPlain) {
            payload.body = encrypt(result.body, DATA_KEY);
            payload.title = encrypt(parseNoteContent(result.body).title, DATA_KEY);
            await database.execute('UPDATE notes SET body = ?, title = ? WHERE id = ?', [
              payload.body,
              payload.title,
              entry.id,
            ]);
          }
          ancestor = result.body;
        } else if (typeof payload.body === 'string') {
          ancestor = decrypt(payload.body, DATA_KEY);
        }

        const { error } = await asUser.from('notes').upsert(payload);
        if (error) throw error;
        if (ancestor !== null) await setSyncBase(database, entry.id, ancestor);
      }
      await tx.complete();
    },
  };

  return { db, connector };
}

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined>, tries = 40) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const v = await fn();
    if (v) return v;
  }
  throw new Error(`timed out waiting for ${what}`);
}

const BASE_BODY = '<p>Alpha one</p><p>Beta two</p><p>Gamma three</p>';
const A_BODY = '<p>Alpha one EDITED-BY-A</p><p>Beta two</p><p>Gamma three</p>';
const B_BODY = '<p>Alpha one</p><p>Beta two</p><p>Gamma three EDITED-BY-B</p>';

async function main() {
  const session = await mintSession(TEST_EMAIL);
  console.log('Account:', TEST_EMAIL, '->', session.user.id);

  const A = makeDevice('A', session, DB_A);
  const B = makeDevice('B', session, DB_B);

  const noteId = randomUUID();
  const now = new Date().toISOString();

  await A.db.connect(A.connector);
  await A.db.execute(
    `insert into notes (id, user_id, body, title, created_at, updated_at, is_trashed)
     values (?, ?, ?, ?, ?, ?, 0)`,
    [
      noteId,
      session.user.id,
      encrypt(BASE_BODY, DATA_KEY),
      encrypt('Alpha one', DATA_KEY),
      now,
      now,
    ]
  );
  await waitFor('note to reach Postgres', async () =>
    psql(`select id from public.notes where id = '${noteId}';`)
  );
  console.log('\nSetup: note created by A and uploaded.');

  // --- 1. what actually sits in Postgres --------------------------------
  const storedBody = psql(`select body from public.notes where id = '${noteId}';`);
  const storedTitle = psql(`select title from public.notes where id = '${noteId}';`);
  console.log('\n--- raw Postgres row ---');
  console.log('body :', storedBody.slice(0, 72) + '...');
  console.log('title:', storedTitle.slice(0, 72) + '...');
  check('server body is an enc:v1 envelope', isEncrypted(storedBody));
  check('server title is an enc:v1 envelope', isEncrypted(storedTitle));
  check('server body does not contain the plaintext', !storedBody.includes('Alpha one'));
  check('server title does not contain the plaintext', !storedTitle.includes('Alpha one'));

  await B.db.connect(B.connector);
  await waitFor('note to reach device B', async () =>
    B.db.getOptional<any>('select id from notes where id = ?', [noteId])
  );
  await setSyncBase(B.db, noteId, BASE_BODY);
  await setSyncBase(A.db, noteId, BASE_BODY);
  console.log('\nSetup: device B pulled the same note; both bases agree.');

  // --- 2. no-op re-save must not look like an edit -----------------------
  //
  // The question worth asking about any random-nonce scheme: re-encrypting
  // unchanged text produces different bytes, so does the system mistake that
  // for a change? Re-encrypt the SAME plaintext and push it.
  console.log('\nNo-op re-save (same text, freshly encrypted):');
  const before = mergeOutcomes.length;
  await A.db.execute('update notes set body = ? where id = ?', [
    encrypt(BASE_BODY, DATA_KEY),
    noteId,
  ]);
  await new Promise((r) => setTimeout(r, 3000));
  const noopOutcomes = mergeOutcomes.slice(before);
  check(
    'no-op re-save merges clean, not as a conflict',
    noopOutcomes.length === 0 || noopOutcomes.every((o) => o.endsWith('clean')),
    noopOutcomes.join(', ') || '(no upload triggered)'
  );

  // --- 3. the real concurrent-edit merge ---------------------------------
  await B.db.disconnect();
  await B.db.execute('update notes set body = ? where id = ?', [
    encrypt(B_BODY, DATA_KEY),
    noteId,
  ]);
  console.log('\nOffline: B edited the third paragraph.');

  await A.db.execute('update notes set body = ? where id = ?', [
    encrypt(A_BODY, DATA_KEY),
    noteId,
  ]);
  await waitFor("A's edit to reach Postgres", async () => {
    const body = psql(`select body from public.notes where id = '${noteId}';`);
    try {
      return decrypt(body, DATA_KEY).includes('EDITED-BY-A') ? body : null;
    } catch {
      return null;
    }
  });
  console.log("Online: A's edit reached the server. The server has moved past B's base.");

  console.log('\nB reconnects:');
  await B.db.connect(B.connector);

  const finalCipher = await waitFor('merged body in Postgres', async () => {
    const body = psql(`select body from public.notes where id = '${noteId}';`);
    try {
      return decrypt(body, DATA_KEY).includes('EDITED-BY-B') ? body : null;
    } catch {
      return null;
    }
  });

  const finalPlain = decrypt(finalCipher, DATA_KEY);

  console.log('\n--- RESULT ---');
  console.log('server ciphertext:', finalCipher.slice(0, 64) + '...');
  console.log('decrypted        :', finalPlain);

  check("A's edit survived the merge", finalPlain.includes('EDITED-BY-A'));
  check("B's edit survived the merge", finalPlain.includes('EDITED-BY-B'));
  check('final server value is still an envelope', isEncrypted(finalCipher));
  check(
    'final server value leaks no plaintext',
    !finalCipher.includes('EDITED-BY') && !finalCipher.includes('Alpha')
  );

  const localB = await B.db.get<any>('select body from notes where id = ?', [noteId]);
  check('device B local copy matches the server', localB.body === finalCipher);

  const baseB = await getSyncBase(B.db, noteId);
  check('note_sync_base holds PLAINTEXT, not an envelope', baseB !== null && !isEncrypted(baseB));

  psql(`delete from public.notes where id = '${noteId}';`);
  await A.db.disconnectAndClear();
  await B.db.disconnectAndClear();

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${failed} failing check(s)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
