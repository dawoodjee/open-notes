#!/usr/bin/env node
/**
 * Proves a self-hosted stack actually works, by doing what the app does.
 *
 *   node scripts/verify-selfhost.mjs            # reads ./.env
 *   node scripts/verify-selfhost.mjs path/to/.env
 *
 * Plain node, no dependencies and no `npm install` -- someone standing up a
 * backend should not have to build the mobile app first to find out whether
 * their backend works. That is why this is .mjs rather than a .ts run through
 * tsx like the other scripts in here.
 *
 * WHAT IT PROVES, and why each step is worth a check:
 *
 *   - the sign-in email carries a 6-DIGIT CODE, not a magic link. The app's
 *     sign-in screen asks for a code; a link is unusable there, and GoTrue
 *     falls back to sending one silently if it cannot fetch the template.
 *   - that code exchanges for a session whose token says role=authenticated.
 *   - PowerSync rejects an unauthenticated client and accepts this GoTrue's
 *     token. Self-hosted GoTrue signs HS256 while a Supabase CLI stack signs
 *     ES256, so this is the single most likely thing to be misconfigured, and
 *     it fails in the worst way: every container healthy, every client refused.
 *   - a note reaches the owner's sync bucket, and the server holds ciphertext.
 *   - a SECOND account cannot see the first one's note, over sync or over the
 *     REST API, and neither can an anonymous caller.
 *
 * SAFE TO RUN: it creates two accounts and one note. It deletes nothing, and
 * touches no table other than by adding that row. Point it at a stack you are
 * still setting up, not one holding notes you care about, purely because two
 * junk accounts will be left behind.
 *
 * Requires the bundled `mailpit` service, since it reads the code out of that
 * inbox. If you have moved to real SMTP, this script cannot read your email --
 * do the same steps by hand instead.
 */
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const envPath = process.argv[2] ?? new URL('../.env', import.meta.url).pathname;
if (!existsSync(envPath)) {
  console.error(`No env file at ${envPath}. Pass one as an argument.`);
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
);

const API = `http://127.0.0.1:${env.KONG_HTTP_PORT || 8000}`;
const POWERSYNC = `http://127.0.0.1:${env.POWERSYNC_HTTP_PORT || 8080}`;
const MAILPIT = `http://127.0.0.1:${env.MAILPIT_PORT || 8025}`;
const ANON = env.ANON_KEY;

if (!ANON) {
  console.error('ANON_KEY is empty. Run `node selfhost/generate-keys.mjs --write` first.');
  process.exit(1);
}

const results = [];
function check(name, pass, detail = '') {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * /sync/stream stays open after sending the checkpoint, so reading it to
 * completion never returns. Take what arrives, stop at the checkpoint, abort.
 */
async function syncStream(jwt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${POWERSYNC}/sync/stream`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ include_checksum: true, raw_data: true, buckets: [] }),
      signal: controller.signal,
    });
    if (response.status !== 200) return { status: response.status, text: '' };
    let text = '';
    for await (const chunk of response.body) {
      text += Buffer.from(chunk).toString();
      if (text.includes('checkpoint_complete')) break;
    }
    return { status: 200, text };
  } catch (error) {
    if (error.name === 'AbortError') return { status: 0, text: '' };
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function signIn(email) {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });

  // GoTrue throttles outgoing email (roughly one per address per 15s, plus an
  // hourly instance cap). Retrying is expected, not a failure.
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${API}/auth/v1/otp`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, create_user: true }),
    });
    if (response.status === 200) break;
    if (attempt >= 7) throw new Error(`could not request a code: http ${response.status}`);
    if (attempt === 0) console.log(`      (rate limited, waiting for ${email})`);
    await sleep(17000);
  }

  await sleep(3000);
  const inbox = await (await fetch(`${MAILPIT}/api/v1/messages`)).json();
  const id = inbox.messages?.[0]?.ID;
  if (!id) throw new Error(`no email arrived for ${email} -- is the mailpit service running?`);

  const message = await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
  const content = (message.Text || '') + (message.HTML || '');
  const code = content.match(/\b\d{6}\b/)?.[0];
  check(
    `sign-in email to ${email} carries a 6-digit code`,
    !!code,
    code ? `subject "${message.Subject}"` : 'got a link instead -- see docs/self-hosting.md'
  );
  if (!code) throw new Error('no code to continue with');

  const session = await (
    await fetch(`${API}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token: code, type: 'email' }),
    })
  ).json();
  if (!session.access_token) {
    throw new Error(`verify failed: ${JSON.stringify(session).slice(0, 160)}`);
  }
  return { jwt: session.access_token, userId: session.user.id };
}

try {
  const alice = await signIn('verify-alice@example.com');
  check('the code exchanges for a session', !!alice.jwt, `user ${alice.userId}`);

  const claims = JSON.parse(Buffer.from(alice.jwt.split('.')[1], 'base64url'));
  check(
    'the token carries role and aud "authenticated"',
    claims.role === 'authenticated' && claims.aud === 'authenticated',
    `role=${claims.role || '(empty)'} aud=${claims.aud}`
  );

  const anonymous = await fetch(`${POWERSYNC}/sync/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  check('PowerSync refuses an unauthenticated client', anonymous.status === 401, `http ${anonymous.status}`);

  const owner = await syncStream(alice.jwt);
  check(
    'PowerSync accepts the token this stack issued',
    owner.status === 200,
    owner.status === 200 ? '' : `http ${owner.status} -- check client_auth in selfhost/powersync/config.yaml`
  );
  check(
    'the client gets a bucket scoped to its own user id',
    owner.text.includes('user_notes[') && owner.text.includes(alice.userId)
  );

  const noteId = randomUUID();
  const insert = await fetch(`${API}/rest/v1/notes`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${alice.jwt}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      id: noteId,
      user_id: alice.userId,
      title: 'enc:v1:dGl0bGU',
      body: 'enc:v1:Ym9keQ',
    }),
  });
  check('the owner can write a note', insert.status === 201, `http ${insert.status}`);

  await sleep(4000);
  const afterWrite = await syncStream(alice.jwt);
  check('the note replicates into the owner bucket', afterWrite.text.includes(noteId));
  check('the server holds ciphertext, not readable text', afterWrite.text.includes('enc:v1:'));

  const bob = await signIn('verify-bob@example.com');
  check('a second account can sign in', !!bob.jwt, `user ${bob.userId}`);

  const other = await syncStream(bob.jwt);
  check(
    'the second account gets its own bucket',
    other.text.includes('user_notes[') && other.text.includes(bob.userId)
  );
  check("the second account cannot see the owner's note over sync", !other.text.includes(noteId));

  const otherRest = await (
    await fetch(`${API}/rest/v1/notes?select=id`, {
      headers: { apikey: ANON, Authorization: `Bearer ${bob.jwt}` },
    })
  ).json();
  check(
    "the second account cannot see it over the REST API either",
    Array.isArray(otherRest) && otherRest.length === 0
  );

  const anonRest = await (
    await fetch(`${API}/rest/v1/notes?select=id`, { headers: { apikey: ANON } })
  ).json();
  check('an anonymous caller sees no notes at all', Array.isArray(anonRest) && anonRest.length === 0);
} catch (error) {
  console.error(`\nStopped early: ${error.message}`);
  results.push(false);
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
