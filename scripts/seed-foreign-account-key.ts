/**
 * Test fixture, not product code.
 *
 * Plants a user_keys row for an account using a data key this device has
 * never seen, and prints the recovery code that unwraps it. That is the only
 * practical way to exercise the adoption path on a single simulator: it makes
 * the account look exactly as it would if its notes had been created on a
 * different phone.
 *
 * Usage: npx tsx scripts/seed-foreign-account-key.ts user-a@test.local
 */
import { execSync } from 'node:child_process';
import {
  generateDataKey,
  CURRENT_RECOVERY_FORMAT,
  generateRecoveryCode,
  generateSalt,
  keyFingerprint,
  wrapDataKeyWithRecoveryCode,
} from '../lib/crypto/keys';

function psql(sql: string): string {
  return execSync(
    `docker exec -i supabase_db_notes psql -U postgres -d postgres -t -A -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8' }
  ).trim();
}

const email = process.argv[2] ?? 'user-a@test.local';
const userId = psql(`select id from auth.users where email = '${email}';`);
if (!userId) throw new Error(`No such user: ${email}`);

const key = generateDataKey();
const code = generateRecoveryCode();
const salt = generateSalt();
const wrapped = wrapDataKeyWithRecoveryCode(key, code, salt, CURRENT_RECOVERY_FORMAT);
const fingerprint = keyFingerprint(key);

psql(`delete from public.user_keys where user_id = '${userId}';`);
psql(
  `insert into public.user_keys (user_id, recovery_wrapped_key, recovery_salt, kdf_params, key_fingerprint)
   values ('${userId}', '${wrapped}', '${salt}', '{"alg":"hkdf-sha256"}'::jsonb, '${fingerprint}');`
);

console.log('account      :', email, userId);
console.log('fingerprint  :', fingerprint);
console.log('RECOVERY CODE:', code);
console.log('\nThis account now looks like its notes were created on another device.');
