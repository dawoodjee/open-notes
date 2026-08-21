/**
 * Stage 8: RLS actually isolates two accounts on the LIVE stack.
 *
 * Two throwaway accounts, created and deleted by this script. Account A
 * writes a note; account B (and an anonymous caller) must not be able to
 * read it, list it, or see it exist -- over the REST API, which is the
 * surface every client (including a self-hoster's own tooling) actually
 * uses.
 *
 * This is deliberately separate from verify-merge-three-devices.ts, which
 * proves merge correctness on ONE account across three devices and never
 * exercises isolation between accounts at all.
 *
 * Usage: node scripts/verify-account-isolation-live.mjs
 * Needs: SUPABASE_SERVICE_ROLE_KEY in scripts/.live-secrets.env
 */
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const easLive = JSON.parse(readFileSync('eas.json', 'utf-8')).build.live.env;
const SUPABASE_URL = easLive.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = easLive.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const envPath = 'scripts/.live-secrets.env';
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

const results = [];
function check(label, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

async function api(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...opts.headers },
  });
  return res;
}

// See scripts/verify-merge-three-devices.ts for why `type` has to be read
// back from GoTrue's response rather than assumed: a brand-new email mints a
// "signup" verification, not "magiclink".
async function mintSession(email) {
  const linkRes = await api('/auth/v1/admin/generate_link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  const link = await linkRes.json();
  if (!linkRes.ok) throw new Error(`generate_link -> ${linkRes.status} ${JSON.stringify(link)}`);

  const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: link.verification_type, token_hash: link.hashed_token }),
  });
  const session = await verifyRes.json();
  if (!verifyRes.ok) throw new Error(`verify -> ${verifyRes.status} ${JSON.stringify(session)}`);
  return session; // { access_token, user: { id, ... } }
}

async function deleteUser(userId) {
  await api(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
}

const now = Date.now();
const emailA = `stage8-iso-a-${now}@example.com`;
const emailB = `stage8-iso-b-${now}@example.com`;
let sessA, sessB, noteId;

try {
  sessA = await mintSession(emailA);
  check('account A can sign in', !!sessA.access_token, `user ${sessA.user.id}`);
  sessB = await mintSession(emailB);
  check('account B can sign in', !!sessB.access_token, `user ${sessB.user.id}`);

  noteId = randomUUID();
  const insert = await fetch(`${SUPABASE_URL}/rest/v1/notes`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${sessA.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      id: noteId,
      user_id: sessA.user.id,
      title: 'enc:v1:c3RhZ2U4LWlzb2xhdGlvbi10aXRsZQ',
      body: 'enc:v1:c3RhZ2U4LWlzb2xhdGlvbi1ib2R5',
    }),
  });
  check('account A can write its own note', insert.status === 201, `http ${insert.status}`);

  const ownRead = await (
    await fetch(`${SUPABASE_URL}/rest/v1/notes?id=eq.${noteId}&select=id`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${sessA.access_token}` },
    })
  ).json();
  check('account A can read its own note back', Array.isArray(ownRead) && ownRead.length === 1);

  const bList = await (
    await fetch(`${SUPABASE_URL}/rest/v1/notes?select=id`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${sessB.access_token}` },
    })
  ).json();
  check(
    "account B's own note list contains none of A's rows",
    Array.isArray(bList) && !bList.some((r) => r.id === noteId)
  );

  const bDirect = await (
    await fetch(`${SUPABASE_URL}/rest/v1/notes?id=eq.${noteId}&select=id`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${sessB.access_token}` },
    })
  ).json();
  check(
    "account B cannot read A's note by id directly",
    Array.isArray(bDirect) && bDirect.length === 0
  );

  const bClaim = await fetch(`${SUPABASE_URL}/rest/v1/notes?id=eq.${noteId}`, {
    method: 'PATCH',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${sessB.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ user_id: sessB.user.id }),
  });
  const bClaimBody = await bClaim.json().catch(() => null);
  check(
    "account B cannot claim A's note by rewriting user_id",
    Array.isArray(bClaimBody) ? bClaimBody.length === 0 : bClaim.status >= 400,
    `http ${bClaim.status}`
  );

  // anon has no table grant at all on notes (migration grants select only to
  // authenticated), so this isn't RLS filtering to an empty list -- it's a
  // flat 401/42501 permission denied. Accept either shape: what matters is
  // that no row ever comes back, not which layer stopped it.
  const anonRes = await fetch(`${SUPABASE_URL}/rest/v1/notes?id=eq.${noteId}&select=id`, {
    headers: { apikey: ANON_KEY },
  });
  const anonRead = await anonRes.json();
  const anonBlocked =
    (Array.isArray(anonRead) && anonRead.length === 0) || anonRes.status === 401 || anonRes.status === 403;
  check(
    'an anonymous caller cannot read the note at all',
    anonBlocked,
    anonRes.ok ? '' : `http ${anonRes.status} ${anonRead?.code ?? ''}`
  );

  const stillA = await (
    await fetch(`${SUPABASE_URL}/rest/v1/notes?id=eq.${noteId}&select=user_id`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${sessA.access_token}` },
    })
  ).json();
  check(
    "the note is still owned by A after B's claim attempt",
    stillA[0]?.user_id === sessA.user.id
  );
} finally {
  if (noteId) await api(`/rest/v1/notes?id=eq.${noteId}`, { method: 'DELETE' }).catch(() => {});
  if (sessA?.user?.id) await deleteUser(sessA.user.id);
  if (sessB?.user?.id) await deleteUser(sessB.user.id);
  console.log(`\ncleanup: deleted ${emailA} and ${emailB}`);
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
