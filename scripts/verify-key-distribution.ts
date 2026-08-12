/**
 * Phase 3 verification (Stage 6): cross-device key distribution and the
 * isolation of public.user_keys.
 *
 * The premise being tested: every device mints its own data key at PIN setup,
 * before any account exists. So the second device to sign into an account
 * holds the WRONG key, and the account's notes are unreadable to it until it
 * adopts the account key -- which only the recovery code can unwrap, because
 * the server-side blob is deliberately not protected by the 6-digit PIN.
 *
 * Runs the real lib/crypto modules under Node (they have no React Native
 * imports). Only the PowerSync-side re-encryption pass is out of scope here;
 * it is exercised on device.
 *
 * Usage: npx tsx scripts/verify-key-distribution.ts
 */
import { createClient, Session } from '@supabase/supabase-js';
import ws from 'ws';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { decrypt, encrypt, isEncrypted } from '../lib/crypto/envelope';
import {
  generateDataKey,
  CURRENT_RECOVERY_FORMAT,
  generateRecoveryCode,
  generateSalt,
  keyFingerprint,
  unwrapDataKeyWithRecoveryCode,
  wrapDataKeyWithRecoveryCode,
} from '../lib/crypto/keys';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

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

function clientFor(session: Session) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    ...wsOptions,
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
}

async function main() {
  // Clean slate. Done as postgres, not as a user -- there is deliberately no
  // delete policy, so an authenticated client cannot do this.
  psql('delete from public.user_keys;');
  psql("delete from public.notes where title like 'enc:%' or body like 'enc:%';");

  const sessionA = await mintSession('user-a@test.local');
  const sessionB = await mintSession('user-b@test.local');
  const userA = sessionA.user.id;
  const asA = clientFor(sessionA);
  const asB = clientFor(sessionB);
  console.log('user-a:', userA);
  console.log('user-b:', sessionB.user.id);

  // --- DEVICE 1: mints a key, claims the account, writes a note ------------
  console.log('\n--- device 1 ---');
  const key1 = generateDataKey();
  const recoveryCode = generateRecoveryCode();
  const recoverySalt = generateSalt();
  const wrapped = wrapDataKeyWithRecoveryCode(key1, recoveryCode, recoverySalt, CURRENT_RECOVERY_FORMAT);

  const { error: insertError } = await asA.from('user_keys').insert({
    user_id: userA,
    recovery_wrapped_key: wrapped,
    recovery_salt: recoverySalt,
    kdf_params: { alg: 'hkdf-sha256' },
    key_fingerprint: keyFingerprint(key1),
  });
  check('device 1 claims the account key', !insertError, insertError?.message ?? '');

  const NOTE = '<p>written on device 1, before device 2 existed</p>';
  const noteId = randomUUID();
  const now = new Date().toISOString();
  const { error: noteError } = await asA.from('notes').insert({
    id: noteId,
    user_id: userA,
    body: encrypt(NOTE, key1),
    title: encrypt('written on device 1', key1),
    created_at: now,
    updated_at: now,
    is_trashed: false,
  });
  check('device 1 uploads an encrypted note', !noteError, noteError?.message ?? '');

  // --- what the server actually holds --------------------------------------
  console.log('\n--- what the server holds ---');
  const storedKey = psql(`select recovery_wrapped_key from public.user_keys where user_id='${userA}';`);
  const storedBody = psql(`select body from public.notes where id='${noteId}';`);
  console.log('wrapped key:', storedKey.slice(0, 64) + '...');

  check('the stored key is a wrapped envelope', isEncrypted(storedKey));
  // The single most important assertion in this file.
  check(
    'the RAW data key never transits the server',
    !storedKey.includes(Buffer.from(key1).toString('base64')) &&
      !storedKey.includes(Buffer.from(key1).toString('hex'))
  );
  check('the note body is an envelope', isEncrypted(storedBody));
  check('the note body leaks no plaintext', !storedBody.includes('device 1'));

  // --- DEVICE 2: different key, must adopt ---------------------------------
  console.log('\n--- device 2 (its own key, signing into the same account) ---');
  const key2 = generateDataKey();
  check('device 2 holds a different key', keyFingerprint(key2) !== keyFingerprint(key1));

  const { data: fetched } = await asA
    .from('user_keys')
    .select('recovery_wrapped_key, recovery_salt, key_fingerprint')
    .eq('user_id', userA)
    .maybeSingle();

  check(
    'device 2 detects the mismatch by fingerprint alone',
    fetched!.key_fingerprint !== keyFingerprint(key2)
  );

  // Before adopting, device 2 cannot read the note at all.
  let readableBefore = true;
  try {
    decrypt(storedBody, key2);
  } catch {
    readableBefore = false;
  }
  check("device 2 cannot read the account's notes before adopting", !readableBefore);

  // A wrong recovery code must not help.
  let wrongCodeWorked = true;
  try {
    unwrapDataKeyWithRecoveryCode(
      fetched!.recovery_wrapped_key,
      generateRecoveryCode(),
      fetched!.recovery_salt,
      CURRENT_RECOVERY_FORMAT
    );
  } catch {
    wrongCodeWorked = false;
  }
  check('a wrong recovery code is rejected', !wrongCodeWorked);

  // The real adoption.
  const adopted = unwrapDataKeyWithRecoveryCode(
    fetched!.recovery_wrapped_key,
    recoveryCode,
    fetched!.recovery_salt,
    CURRENT_RECOVERY_FORMAT
  );
  check('the recovery code yields the account key', keyFingerprint(adopted) === keyFingerprint(key1));
  check('device 2 can now read the note', decrypt(storedBody, adopted) === NOTE);

  // --- isolation ------------------------------------------------------------
  console.log('\n--- isolation ---');
  const { data: leaked } = await asB
    .from('user_keys')
    .select('recovery_wrapped_key')
    .eq('user_id', userA);
  check(
    "a second account cannot read user-a's key row",
    !leaked || leaked.length === 0,
    `rows returned: ${leaked?.length ?? 0}`
  );

  const { data: allKeys } = await asB.from('user_keys').select('user_id');
  check(
    'an unfiltered select returns only the caller\'s own row',
    (allKeys ?? []).every((r: any) => r.user_id === sessionB.user.id),
    `rows: ${JSON.stringify(allKeys)}`
  );

  // No update policy: a second insert must fail rather than replace the key,
  // which would orphan every note encrypted under the original.
  const { error: overwrite } = await asA.from('user_keys').insert({
    user_id: userA,
    recovery_wrapped_key: wrapDataKeyWithRecoveryCode(key2, recoveryCode, recoverySalt, CURRENT_RECOVERY_FORMAT),
    recovery_salt: recoverySalt,
    kdf_params: { alg: 'hkdf-sha256' },
    key_fingerprint: keyFingerprint(key2),
  });
  check('the account key cannot be overwritten', !!overwrite, overwrite?.code ?? 'no error!');

  const { error: updateError } = await asA
    .from('user_keys')
    .update({ key_fingerprint: 'tampered' })
    .eq('user_id', userA);
  const stillOriginal =
    psql(`select key_fingerprint from public.user_keys where user_id='${userA}';`) ===
    keyFingerprint(key1);
  check('the account key cannot be updated', stillOriginal, updateError?.message ?? 'update blocked by RLS');

  // --- every note on the server is ciphertext -------------------------------
  const plaintextCount = psql(
    `select count(*) from public.notes where body is not null and body <> '' and body not like 'enc:v1:%';`
  );
  check('every note body in Postgres is an enc:v1 envelope', plaintextCount === '0', `non-envelope rows: ${plaintextCount}`);

  psql(`delete from public.notes where id='${noteId}';`);
  psql('delete from public.user_keys;');

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${failed} failing check(s)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
