/**
 * Stage 8: read-only inspection of a LIVE account.
 *
 * Answers two questions without writing anything and without printing note
 * content:
 *
 *   1. Is what the server holds actually ciphertext? Every notes.title and
 *      notes.body must be an `enc:v1:` envelope (lib/crypto/envelope.ts:39).
 *      A single readable row would mean the encryption boundary has a hole.
 *
 *   2. Which recovery-code format does this account's key blob expect?
 *      lib/crypto/keys.ts:83 reads kdf_params.format and falls back to
 *      'crockford25' when it is absent, because codes predate words. The
 *      answer decides whether a 25-character code or 12 words is the right
 *      thing to type at AdoptKeyScreen -- which is worth knowing BEFORE a
 *      device needs re-adoption rather than during.
 *
 * Deliberately prints no plaintext: lengths and prefixes only. A diagnostic
 * that dumps your notes into a terminal transcript is its own leak.
 *
 * Usage: node scripts/probe-live-account.mjs <email>
 * Needs: SUPABASE_SERVICE_ROLE_KEY in scripts/.live-secrets.env
 */
import { readFileSync, existsSync } from 'node:fs';

const easLive = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf-8')).build.live
  .env;
const SUPABASE_URL = easLive.EXPO_PUBLIC_SUPABASE_URL;

const envPath = new URL('./.live-secrets.env', import.meta.url);
if (!existsSync(envPath)) {
  console.error('scripts/.live-secrets.env not found -- it must contain SUPABASE_SERVICE_ROLE_KEY=<key>');
  process.exit(1);
}
const line = readFileSync(envPath, 'utf-8')
  .split('\n')
  .find((l) => l.trim().startsWith('SUPABASE_SERVICE_ROLE_KEY='));
if (!line) {
  console.error('SUPABASE_SERVICE_ROLE_KEY missing from scripts/.live-secrets.env');
  process.exit(1);
}
const SERVICE_KEY = line.slice(line.indexOf('=') + 1).trim();

const email = process.argv[2];
if (!email) {
  console.error('usage: node scripts/probe-live-account.mjs <email>');
  process.exit(1);
}

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function api(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { headers: H });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const PREFIX = 'enc:v1:';
let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
};

// GoTrue's admin list endpoint has no server-side email filter, so page
// through rather than trusting the first page to contain the account.
async function findUser(target) {
  for (let page = 1; page <= 20; page++) {
    const { users } = await api(`/auth/v1/admin/users?page=${page}&per_page=200`);
    if (!users?.length) return null;
    const hit = users.find((u) => u.email?.toLowerCase() === target.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

const user = await findUser(email);
if (!user) {
  console.error(`no live account found for ${email}`);
  process.exit(1);
}
console.log(`account: ${email} -> ${user.id}`);
console.log(`created: ${user.created_at}`);
console.log(`Supabase: ${SUPABASE_URL}\n`);

// --- 1. ciphertext ---------------------------------------------------------
const notes = await api(
  `/rest/v1/notes?user_id=eq.${user.id}&select=id,title,body,is_trashed,updated_at`
);
console.log(`notes rows: ${notes.length}\n`);

if (notes.length === 0) {
  check(false, 'account has notes to inspect', 'zero rows -- nothing was proven');
} else {
  const badTitle = notes.filter((n) => n.title && !String(n.title).startsWith(PREFIX));
  const badBody = notes.filter((n) => n.body && !String(n.body).startsWith(PREFIX));
  check(
    badTitle.length === 0,
    `every title is an ${PREFIX} envelope`,
    badTitle.length ? `${badTitle.length} readable: ${badTitle.map((n) => n.id).join(', ')}` : ''
  );
  check(
    badBody.length === 0,
    `every body is an ${PREFIX} envelope`,
    badBody.length ? `${badBody.length} readable: ${badBody.map((n) => n.id).join(', ')}` : ''
  );

  const sample = notes[0];
  console.log(
    `\nsample row ${sample.id}:\n` +
      `  title: ${String(sample.title).slice(0, 24)}... (${String(sample.title).length} chars)\n` +
      `  body:  ${String(sample.body).slice(0, 24)}... (${String(sample.body).length} chars)`
  );
  const trashed = notes.filter((n) => n.is_trashed).length;
  console.log(`  trashed: ${trashed} of ${notes.length}`);
}

// --- 2. orphans ------------------------------------------------------------
// A note with no user_id belongs to nobody and syncs to nobody. The Stage 5
// claim step is what stamps them, so a stray is a claim that never ran.
const orphans = await api(`/rest/v1/notes?user_id=is.null&select=id`);
check(orphans.length === 0, 'no orphaned notes (user_id is null)', `${orphans.length} found`);

// --- 3. recovery format ----------------------------------------------------
const keys = await api(
  `/rest/v1/user_keys?user_id=eq.${user.id}&select=kdf_params,key_fingerprint,created_at,updated_at`
);
console.log('');
if (keys.length !== 1) {
  check(false, 'account has exactly one user_keys row', `found ${keys.length}`);
} else {
  const p = keys[0].kdf_params ?? {};
  const format = p.format ?? 'crockford25 (implied: no `format` field)';
  check(true, 'user_keys row present', `created ${keys[0].created_at}`);
  console.log(`  kdf_params: ${JSON.stringify(p)}`);
  console.log(`  recovery format this account expects: ${format}`);
  console.log(
    p.format === 'words12'
      ? '  -> a 12-word code is what AdoptKeyScreen will ask for.'
      : '  -> a 25-character code (5 groups of 5) is what AdoptKeyScreen will ask for.'
  );
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} -- ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
