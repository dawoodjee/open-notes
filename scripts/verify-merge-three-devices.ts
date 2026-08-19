/**
 * Stage 8: the same note edited offline on THREE devices, in three different
 * paragraphs, must end up with all three edits -- and every device must
 * converge on identical content.
 *
 * WHY THREE AND NOT TWO. scripts/verify-merge-two-devices.ts already proves a
 * two-way merge, but two devices cannot catch an ordering bug. With two, every
 * conflict has an obvious winner: one side is "the server", the other is "the
 * late arrival", and a merge that simply preferred the late arrival would pass.
 * The third device is the one that arrives when the server has ALREADY been
 * merged once, so its base is two edits behind rather than one. A merge that
 * clobbers the earlier reconciliation only shows up here.
 *
 * SCOPE, stated as honestly as the two-device script states its own: this
 * exercises the real mergeBody() and the real note_sync_base protocol, but its
 * uploadData is a stand-in for lib/powersync/connector.ts rather than that file
 * itself -- the app's connector imports expo-secure-store, expo-crypto and
 * __DEV__, none of which exist under plain Node. Bodies here are plaintext,
 * where the app would store enc:v1: envelopes; mergeBody operates on decrypted
 * text in the app too, so the algorithm under test is the same one.
 *
 * TARGET: the LIVE stack (Supabase Cloud + PowerSync Cloud), on a throwaway
 * account created and deleted by this script. It never touches a real account.
 *
 * Usage: npx tsx scripts/verify-merge-three-devices.ts
 * Needs: SUPABASE_SERVICE_ROLE_KEY in .env.live.local
 */
import { PowerSyncDatabase } from '@powersync/node';
import { AbstractPowerSyncDatabase, CrudEntry } from '@powersync/common';
import { createClient, Session } from '@supabase/supabase-js';
import ws from 'ws';
import { randomUUID } from 'node:crypto';
import { unlinkSync, existsSync, readFileSync } from 'node:fs';
import { AppSchema } from '../lib/powersync/schema';
import { mergeBody } from '../lib/powersync/mergeBody';

// Live addresses come out of eas.json's `live` profile rather than being
// duplicated here -- the same rule scripts/ios-live.sh follows, and for the
// same reason: two hand-maintained copies of a server address is how a test
// ends up quietly proving something about the wrong backend.
// Paths are relative to the repo root, matching verify-merge-two-devices.ts and
// the rest of scripts/ -- these are all run as `npx tsx scripts/<name>.ts` from
// there. Deliberately not `new URL(..., import.meta.url)`: this project
// compiles with lib.dom, so the global URL is the DOM one, which node:fs will
// not accept and fileURLToPath will not take either.
const easLive = JSON.parse(readFileSync('eas.json', 'utf-8')).build.live.env as Record<
  string,
  string
>;
const SUPABASE_URL = easLive.EXPO_PUBLIC_SUPABASE_URL;
const POWERSYNC_URL = easLive.EXPO_PUBLIC_POWERSYNC_URL;
const ANON_KEY = easLive.EXPO_PUBLIC_SUPABASE_ANON_KEY;

function readServiceKey(): string {
  const path = '.env.live.local';
  if (!existsSync(path)) {
    throw new Error(
      '.env.live.local not found. It must contain SUPABASE_SERVICE_ROLE_KEY=<key from the Supabase dashboard>.'
    );
  }
  const line = readFileSync(path, 'utf-8')
    .split('\n')
    .find((l) => l.trim().startsWith('SUPABASE_SERVICE_ROLE_KEY='));
  if (!line) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing from .env.live.local');
  return line.slice(line.indexOf('=') + 1).trim();
}

const SERVICE_KEY = readServiceKey();

// Reserved domain, and never mailed to: the codes below are minted through the
// admin API, so nothing is ever delivered. Keeping the throwaways on
// example.com makes it obvious in the dashboard which rows are test debris.
const TEST_EMAIL = `stage8-merge-${Date.now()}@example.com`;

const DB_A = './scripts/.verify-merge3-a.db';
const DB_B = './scripts/.verify-merge3-b.db';
const DB_C = './scripts/.verify-merge3-c.db';

const wsOptions = { realtime: { transport: ws as any } };
const admin = createClient(SUPABASE_URL, SERVICE_KEY, wsOptions);

/**
 * The dev script shells out to `docker exec ... psql`, which has no live
 * equivalent. PostgREST with the service role reads the same rows over HTTPS
 * and bypasses RLS the same way a superuser would.
 */
async function serverNote(noteId: string): Promise<{ body: string; updated_at: string } | null> {
  const { data, error } = await admin
    .from('notes')
    .select('body, updated_at')
    .eq('id', noteId)
    .maybeSingle();
  if (error) throw error;
  return data as any;
}

async function mintSession(email: string): Promise<Session> {
  // generateLink creates the user if it does not exist and returns the token
  // WITHOUT sending mail -- which is what removes the need for an inbox.
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkError) throw linkError;

  // The `type` requested above is not the `type` verifyOtp needs below --
  // GoTrue reports the ACTUAL verification flow it minted in
  // properties.verification_type, and for a brand-new email that is
  // "signup", not "magiclink" (a real magic link only exists for an
  // account that already has one). This script mints a fresh email every
  // run, so it always hits "signup". Hardcoding 'magiclink' here produced
  // `AuthApiError: otp_expired` -- a real token, rejected for the wrong
  // verification type, misreported as expiry. Reading the type back from
  // GoTrue's own response is what makes this correct for both a fresh
  // account and a reused one (verify-merge-two-devices.ts's fixed
  // user-a@test.local never hits the "signup" branch, which is why the
  // bug was never visible there).
  const verificationType = (linkData.properties as any).verification_type as
    | 'magiclink'
    | 'signup';

  const anon = createClient(SUPABASE_URL, ANON_KEY, wsOptions);
  const { data, error } = await anon.auth.verifyOtp({
    type: verificationType,
    token_hash: (linkData.properties as any).hashed_token,
  });
  if (error) throw error;
  return data.session!;
}

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
  for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) unlinkSync(f);
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

  return { label, db, connector };
}

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined>, tries = 60) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const v = await fn();
    if (v) return v;
  }
  throw new Error(`timed out waiting for ${what}`);
}

const BASE_BODY = '<p>Alpha one</p><p>Beta two</p><p>Gamma three</p>';
const A_BODY = '<p>Alpha one EDITED-BY-A</p><p>Beta two</p><p>Gamma three</p>';
const B_BODY = '<p>Alpha one</p><p>Beta two EDITED-BY-B</p><p>Gamma three</p>';
const C_BODY = '<p>Alpha one</p><p>Beta two</p><p>Gamma three EDITED-BY-C</p>';

function marks(body: string | undefined | null) {
  if (!body) return '(none)';
  return ['A', 'B', 'C'].filter((m) => body.includes(`EDITED-BY-${m}`)).join('+') || 'base only';
}

async function localBody(dev: { db: AbstractPowerSyncDatabase }, noteId: string) {
  const row = await dev.db.getOptional<{ body: string }>('select body from notes where id = ?', [
    noteId,
  ]);
  return row?.body ?? null;
}

async function main() {
  const session = await mintSession(TEST_EMAIL);
  const userId = session.user.id;
  console.log(`Throwaway account: ${TEST_EMAIL} -> ${userId}`);
  console.log(`Supabase:  ${SUPABASE_URL}`);
  console.log(`PowerSync: ${POWERSYNC_URL}\n`);

  const A = makeDevice('A', session, DB_A);
  const B = makeDevice('B', session, DB_B);
  const C = makeDevice('C', session, DB_C);
  const devices = [A, B, C];

  const noteId = randomUUID();
  const now = new Date().toISOString();
  let failure: string | null = null;

  try {
    // --- all three online, agreeing on one note --------------------------
    await A.db.connect(A.connector);
    await A.db.execute(
      `insert into notes (id, user_id, body, title, created_at, updated_at, is_trashed)
       values (?, ?, ?, ?, ?, ?, 0)`,
      [noteId, userId, BASE_BODY, 'Three device merge', now, now]
    );
    await setSyncBase(A.db, noteId, BASE_BODY);
    await waitFor('note to reach Postgres', () => serverNote(noteId));
    console.log('Setup: A created the note and uploaded it.');

    for (const d of [B, C]) {
      await d.db.connect(d.connector);
      await waitFor(`note to reach device ${d.label}`, () => localBody(d, noteId));
      await setSyncBase(d.db, noteId, BASE_BODY);
      console.log(`Setup: device ${d.label} pulled the same note; base agrees.`);
    }

    // --- all three go offline, each edits a different paragraph ----------
    for (const d of devices) await d.db.disconnect();
    await A.db.execute('update notes set body = ? where id = ?', [A_BODY, noteId]);
    await B.db.execute('update notes set body = ? where id = ?', [B_BODY, noteId]);
    await C.db.execute('update notes set body = ? where id = ?', [C_BODY, noteId]);
    console.log('\nAll three offline. A edited para 1, B para 2, C para 3.\n');

    // --- reconnect one at a time, reporting after EACH ------------------
    for (const d of devices) {
      console.log(`--- ${d.label} reconnects ---`);
      await d.db.connect(d.connector);
      await waitFor(`${d.label}'s edit to reach the server`, async () => {
        const n = await serverNote(noteId);
        return n?.body.includes(`EDITED-BY-${d.label}`) ? n : null;
      });
      // Let the other connected devices pull the new server state before we
      // photograph them, otherwise we are just racing the sync loop.
      await new Promise((r) => setTimeout(r, 2500));
      const server = await serverNote(noteId);
      console.log(`  server: ${marks(server?.body)}`);
      for (const other of devices) {
        console.log(`  device ${other.label}: ${marks(await localBody(other, noteId))}`);
      }
      console.log('');
    }

    // --- final convergence ----------------------------------------------
    const server = await serverNote(noteId);
    const finalBodies = await Promise.all(devices.map((d) => localBody(d, noteId)));

    console.log('--- RESULT ---');
    console.log('server body:', server?.body);
    for (const [i, d] of devices.entries()) {
      console.log(`device ${d.label}: ${marks(finalBodies[i])}`);
    }

    const allEdits = ['A', 'B', 'C'].every((m) => server?.body.includes(`EDITED-BY-${m}`));
    const converged = finalBodies.every((b) => b === server?.body);
    console.log(`\nall three edits survived on the server: ${allEdits}`);
    console.log(`all three devices match the server:      ${converged}`);

    if (!allEdits) failure = 'an edit was lost';
    else if (!converged) failure = 'devices did not converge';
  } finally {
    // Teardown runs even on failure: a throwaway account left behind on live
    // is exactly the debris this pass is supposed to avoid creating.
    try {
      await admin.from('notes').delete().eq('id', noteId);
      await admin.from('user_keys').delete().eq('user_id', userId);
    } catch (e) {
      console.error('cleanup: row delete failed:', e);
    }
    for (const d of devices) {
      try {
        await d.db.disconnectAndClear();
        await d.db.close();
      } catch {
        /* a device that never connected has nothing to tear down */
      }
    }
    try {
      await admin.auth.admin.deleteUser(userId);
      console.log(`\ncleanup: deleted throwaway ${TEST_EMAIL}`);
    } catch (e) {
      console.error('cleanup: user delete failed:', e);
    }
  }

  console.log(failure ? `\nFAIL -- ${failure}` : '\nPASS -- three-way merge converged');
  process.exit(failure ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
