/**
 * Phase 3 verification (Stage 5), check 6: the same note edited offline on two
 * devices, in different paragraphs, must end up with BOTH edits -- not one
 * silently overwriting the other.
 *
 * Two independent @powersync/node clients, two separate SQLite files, one
 * account. This is the closest thing to two real phones that doesn't involve
 * two real phones.
 *
 * SCOPE, stated honestly: this exercises the real mergeBody() and the real
 * note_sync_base protocol, but its uploadData is a stand-in for
 * lib/powersync/connector.ts rather than that file itself -- the app's
 * connector imports expo-secure-store, expo-crypto and __DEV__, none of which
 * exist under plain Node. The merge sequence below is a line-for-line
 * transcription of uploadEntry's, and the connector's own wiring was already
 * exercised on-device. What's proven here is the algorithm and the
 * base-tracking protocol, which is where the interesting failure lives.
 *
 * Usage: npx tsx scripts/verify-merge-two-devices.ts
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

const SUPABASE_URL = 'http://127.0.0.1:54321';
const POWERSYNC_URL = 'http://127.0.0.1:8080';
const SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const TEST_EMAIL = 'user-a@test.local';

const DB_A = './scripts/.verify-merge-a.db';
const DB_B = './scripts/.verify-merge-b.db';

const wsOptions = { realtime: { transport: ws as any } };

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

// --- the sync-base helpers, same shape as the connector's ---------------
async function getSyncBase(db: AbstractPowerSyncDatabase, noteId: string): Promise<string | null> {
  const row = await db.getOptional<{ body: string }>(
    'SELECT body FROM note_sync_base WHERE note_id = ?',
    [noteId]
  );
  return row?.body ?? null;
}

async function setSyncBase(db: AbstractPowerSyncDatabase, noteId: string, body: string) {
  await db.writeTransaction(async (tx) => {
    await tx.execute('DELETE FROM note_sync_base WHERE note_id = ?', [noteId]);
    await tx.execute(
      'INSERT INTO note_sync_base (id, note_id, body, updated_at) VALUES (?, ?, ?, ?)',
      [randomUUID(), noteId, body, new Date().toISOString()]
    );
  });
}

const NOTES_COLUMNS = ['user_id', 'body', 'title', 'created_at', 'updated_at', 'is_trashed'];

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

        if (remote && typeof payload.body === 'string') {
          const base = await getSyncBase(database, entry.id);
          const result = mergeBody(base, payload.body, remote.body ?? '');
          console.log(`  [${label}] merge outcome: ${result.outcome}`);
          if (result.body !== payload.body) {
            payload.body = result.body;
            await database.execute('UPDATE notes SET body = ? WHERE id = ?', [
              payload.body,
              entry.id,
            ]);
          }
        }

        const { error } = await asUser.from('notes').upsert(payload);
        if (error) throw error;
        if (typeof payload.body === 'string') {
          await setSyncBase(database, entry.id, payload.body);
        }
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

  // --- both devices online, agreeing on one note -------------------------
  await A.db.connect(A.connector);
  await A.db.execute(
    `insert into notes (id, user_id, body, title, created_at, updated_at, is_trashed)
     values (?, ?, ?, ?, ?, ?, 0)`,
    [noteId, session.user.id, BASE_BODY, 'Alpha one', now, now]
  );
  await waitFor('note to reach Postgres', async () =>
    psql(`select id from public.notes where id = '${noteId}';`)
  );
  console.log('\nSetup: note created by A and uploaded.');

  await B.db.connect(B.connector);
  await waitFor('note to reach device B', async () =>
    B.db.getOptional<any>('select id from notes where id = ?', [noteId])
  );
  await setSyncBase(B.db, noteId, BASE_BODY);
  console.log('Setup: device B pulled the same note; both bases agree.');

  // --- B goes offline and edits the LAST paragraph -----------------------
  await B.db.disconnect();
  await B.db.execute('update notes set body = ? where id = ?', [B_BODY, noteId]);
  console.log('\nOffline: B edited the third paragraph.');

  // --- A, still online, edits the FIRST paragraph and uploads ------------
  await A.db.execute('update notes set body = ? where id = ?', [A_BODY, noteId]);
  await waitFor("A's edit to reach Postgres", async () => {
    const body = psql(`select body from public.notes where id = '${noteId}';`);
    return body.includes('EDITED-BY-A') ? body : null;
  });
  console.log("Online: A's edit reached the server. The server has now moved past B's base.");

  // --- B comes back online: this is the merge under test -----------------
  console.log('\nB reconnects:');
  await B.db.connect(B.connector);

  const finalBody = await waitFor('merged body in Postgres', async () => {
    const body = psql(`select body from public.notes where id = '${noteId}';`);
    return body.includes('EDITED-BY-B') ? body : null;
  });

  console.log('\n--- RESULT ---');
  console.log('server body:', finalBody);

  const keptA = finalBody.includes('EDITED-BY-A');
  const keptB = finalBody.includes('EDITED-BY-B');
  console.log(`A's edit survived: ${keptA}`);
  console.log(`B's edit survived: ${keptB}`);

  const localB = await B.db.get<any>('select body from notes where id = ?', [noteId]);
  console.log('device B local body matches server:', localB.body === finalBody);

  psql(`delete from public.notes where id = '${noteId}';`);
  await A.db.disconnectAndClear();
  await B.db.disconnectAndClear();

  const pass = keptA && keptB;
  console.log(`\n${pass ? 'PASS' : 'FAIL'} -- both edits ${pass ? 'survived' : 'did NOT survive'}`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
