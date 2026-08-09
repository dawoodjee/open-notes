/**
 * Phase 1 verification (Stage 5) -- proves the sync pipe end-to-end without
 * the mobile app or any UI, using @powersync/node (a separate, non-RN
 * PowerSync client SDK that runs directly under Node). Reuses the exact same
 * AppSchema the app itself uses, so this is a real test of the real schema,
 * not a stand-in.
 *
 * Usage: npx tsx scripts/verify-sync.ts
 */
import { PowerSyncDatabase } from '@powersync/node';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import { AppSchema } from '../lib/powersync/schema';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const POWERSYNC_URL = 'http://127.0.0.1:8080';
const SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const TEST_EMAIL = 'user-a@test.local';
const DB_FILE = './scripts/.verify-sync.db';

// Node 20 has no native WebSocket global that satisfies supabase-js's
// realtime client (Node 22+ does) -- this script doesn't use realtime at
// all, but supabase-js still constructs the client eagerly, so it needs a
// polyfill regardless.
const wsOptions = { realtime: { transport: ws as any } };

function psql(sql: string): string {
  return execSync(
    `docker exec -i supabase_db_notes psql -U postgres -d postgres -t -A -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8' }
  ).trim();
}

async function mintSession(email: string) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, wsOptions);
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkError) throw linkError;

  const anon = createClient(SUPABASE_URL, ANON_KEY, wsOptions);
  const { data: verifyData, error: verifyError } = await anon.auth.verifyOtp({
    type: 'magiclink',
    token_hash: (linkData.properties as any).hashed_token,
  });
  if (verifyError) throw verifyError;
  return verifyData.session!;
}

async function main() {
  if (existsSync(DB_FILE)) unlinkSync(DB_FILE);

  console.log('--- Minting a real session for', TEST_EMAIL, '---');
  const session = await mintSession(TEST_EMAIL);
  console.log('Got session for user id:', session.user.id);

  const db = new PowerSyncDatabase({
    schema: AppSchema,
    database: { dbFilename: DB_FILE },
  });

  const connector = {
    async fetchCredentials() {
      return { endpoint: POWERSYNC_URL, token: session.access_token };
    },
    async uploadData(database: PowerSyncDatabase) {
      // Authenticated AS THE USER (their access token against the anon key),
      // not service_role -- this is what the real app connector does via its
      // session-bound client, and it's what actually exercises notes' RLS
      // policies rather than bypassing them.
      const asUser = createClient(SUPABASE_URL, ANON_KEY, {
        ...wsOptions,
        global: { headers: { Authorization: `Bearer ${session.access_token}` } },
      });
      const tx = await database.getNextCrudTransaction();
      if (!tx) return;
      for (const entry of tx.crud) {
        const { error } = await asUser.from('notes').upsert({ id: entry.id, ...entry.opData });
        if (error) throw error;
      }
      await tx.complete();
    },
  };

  await db.connect(connector);
  console.log('Connected to PowerSync service at', POWERSYNC_URL);

  // --- Check 1: create a note through the script, confirm it lands in Postgres ---
  const noteId = randomUUID();
  const now = new Date().toISOString();
  await db.execute(
    `insert into notes (id, user_id, body, title, created_at, updated_at, is_trashed)
     values (?, ?, ?, ?, ?, ?, 0)`,
    [noteId, session.user.id, 'Hello from verify-sync.ts', 'Hello from verify-sync.ts', now, now]
  );
  console.log('\n--- Check 1: local note created, waiting for upload ---');
  console.log('note id:', noteId);

  let uploaded = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const row = psql(`select id, title from public.notes where id = '${noteId}';`);
    if (row) {
      uploaded = true;
      console.log('CHECK 1 RESULT: found in Postgres ->', row);
      break;
    }
  }
  if (!uploaded) {
    console.log('CHECK 1 RESULT: FAILED -- note never appeared in Postgres');
  }

  // --- Check 2: insert directly into Postgres, confirm it appears locally ---
  const serverNoteId = randomUUID();
  const serverNow = new Date().toISOString();
  psql(
    `insert into public.notes (id, user_id, body, title, created_at, updated_at, is_trashed)
     values ('${serverNoteId}', '${session.user.id}', 'Hello from Postgres', 'Hello from Postgres', '${serverNow}', '${serverNow}', false);`
  );
  console.log('\n--- Check 2: inserted directly into Postgres, waiting for it to sync down ---');
  console.log('note id:', serverNoteId);

  let downloaded = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const row = await db.getOptional<any>('select id, title from notes where id = ?', [serverNoteId]);
    if (row) {
      downloaded = true;
      console.log('CHECK 2 RESULT: found locally ->', JSON.stringify(row));
      break;
    }
  }
  if (!downloaded) {
    console.log('CHECK 2 RESULT: FAILED -- note never appeared locally');
  }

  await db.disconnectAndClear();
  process.exit(uploaded && downloaded ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
