/**
 * Test fixture, not product code.
 *
 * Writes a note to Postgres encrypted under an ACCOUNT's key, obtained by
 * unwrapping public.user_keys with the recovery code. Stands in for "a note
 * created on the user's other device" so a freshly-wiped simulator can prove
 * it decrypts content it never wrote.
 *
 * Usage: npx tsx scripts/seed-note-under-account-key.ts <email> <recovery-code>
 */
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { encrypt } from '../lib/crypto/envelope';
import { keyFingerprint, unwrapDataKeyWithRecoveryCode } from '../lib/crypto/keys';

function psql(sql: string): string {
  return execSync(
    `docker exec -i supabase_db_notes psql -U postgres -d postgres -t -A -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8' }
  ).trim();
}

const email = process.argv[2];
const code = process.argv.slice(3).join(' ');
if (!email || !code) throw new Error('usage: <email> <recovery-code>');

const userId = psql(`select id from auth.users where email = '${email}';`);
if (!userId) throw new Error(`No such user: ${email}`);

const wrapped = psql(`select recovery_wrapped_key from public.user_keys where user_id='${userId}';`);
const salt = psql(`select recovery_salt from public.user_keys where user_id='${userId}';`);
if (!wrapped) throw new Error('That account has no key row.');

const accountKey = unwrapDataKeyWithRecoveryCode(wrapped, code, salt);
console.log('unwrapped account key, fingerprint:', keyFingerprint(accountKey));

const body = '<p>FROMOTHERDEVICE written under the account key</p>';
const title = 'FROMOTHERDEVICE written under the account key';
const id = randomUUID();
const now = new Date().toISOString();

psql(
  `insert into public.notes (id, user_id, body, title, created_at, updated_at, is_trashed)
   values ('${id}', '${userId}', '${encrypt(body, accountKey)}', '${encrypt(title, accountKey)}', '${now}', '${now}', false);`
);

console.log('seeded note', id, 'for', email);
console.log('It is encrypted under the ACCOUNT key, which a fresh device does not have.');
