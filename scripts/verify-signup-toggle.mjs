#!/usr/bin/env node
/**
 * Proves the sign-up switch does what it says, against whatever state the
 * server is in right now (Stage 16).
 *
 *   node scripts/verify-signup-toggle.mjs <existing-account-email> [path/to/.env]
 *
 * Reads the server's own answer from /auth/v1/settings, then checks both
 * halves of the feature:
 *
 *   - a NEW address is refused SERVER-SIDE when sign-ups are closed -- by the
 *     code request the app makes AND by a direct POST /signup, since hiding a
 *     button stops nobody -- and no auth user appears. When open, it is
 *     accepted (and a throwaway account is created: the one cost of checking).
 *   - an EXISTING account still completes a full sign-in: code from the inbox,
 *     exchanged for a session whose token says role=authenticated. That is the
 *     half most likely to break, and the whole point of the switch.
 *
 * Works on the dev stack (.env, Mailpit on 54324) and a self-hosted one
 * (MAILPIT_PORT, default 8025). Needs a Mailpit inbox to read the code from.
 * Plain node, no dependencies, like verify-selfhost.mjs.
 */
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const existing = process.argv[2];
const envPath = process.argv[3] ?? new URL('../.env', import.meta.url).pathname;
if (!existing || !existsSync(envPath)) {
  console.error('Usage: node scripts/verify-signup-toggle.mjs <existing-account-email> [path/to/.env]');
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
);
const API = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY || env.ANON_KEY;
// The CLI dev stack puts Mailpit on 54324; the self-host compose on MAILPIT_PORT.
const MAILPIT = API?.endsWith(':54321')
  ? 'http://127.0.0.1:54324'
  : `http://127.0.0.1:${env.MAILPIT_PORT || 8025}`;
if (!API || !ANON) {
  console.error(`${envPath} needs EXPO_PUBLIC_SUPABASE_URL and an anon key.`);
  process.exit(1);
}

const results = [];
function check(name, pass, detail = '') {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const post = async (path, body) => {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

try {
  const settings = await (await fetch(`${API}/auth/v1/settings`, { headers: { apikey: ANON } })).json();
  const closed = settings.disable_signup === true;
  console.log(`Server ${API} says sign-ups are ${closed ? 'CLOSED' : 'OPEN'}\n`);

  // ── A new address ────────────────────────────────────────────────────────
  const stranger = `signup-probe-${randomBytes(3).toString('hex')}@example.test`;
  const otp = await post('/auth/v1/otp', { email: stranger, create_user: true });
  const direct = await post('/auth/v1/signup', { email: stranger, password: randomBytes(16).toString('hex') });
  if (closed) {
    check('a new address is refused by the code request', otp.status === 422 && otp.body.error_code === 'signup_disabled', `http ${otp.status} ${otp.body.error_code ?? ''}`);
    check('a new address is refused by a direct /signup too', direct.status === 422 && direct.body.error_code === 'signup_disabled', `http ${direct.status} ${direct.body.error_code ?? ''}`);
  } else {
    check('a new address is accepted', otp.status === 200, `http ${otp.status} -- created ${stranger}`);
  }

  // ── An existing account, all the way to a session ────────────────────────
  const since = Date.now();
  let requested;
  for (let attempt = 0; ; attempt++) {
    requested = await post('/auth/v1/otp', { email: existing, create_user: true }); // what the app sends
    if (requested.status !== 429 || attempt >= 5) break;
    if (attempt === 0) console.log('      (rate limited, waiting)');
    await sleep(17000);
  }
  check('an existing account can request a code', requested.status === 200, `http ${requested.status} ${requested.body.error_code ?? ''}`);

  let code;
  for (let i = 0; i < 10 && !code; i++) {
    await sleep(1000);
    const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${existing}`)}`)).json();
    const latest = found.messages?.[0];
    if (latest && Date.parse(latest.Created) >= since - 2000) {
      const message = await (await fetch(`${MAILPIT}/api/v1/message/${latest.ID}`)).json();
      code = ((message.Text || '') + (message.HTML || '')).match(/\b\d{6}\b/)?.[0];
    }
  }
  check('the code arrives', !!code);

  if (code) {
    const session = await post('/auth/v1/verify', { email: existing, token: code, type: 'email' });
    const claims = session.body.access_token
      ? JSON.parse(Buffer.from(session.body.access_token.split('.')[1], 'base64url').toString())
      : {};
    check('and exchanges for a signed-in session', claims.role === 'authenticated', `role=${claims.role ?? '(none)'}`);
  }
} catch (error) {
  console.error(`\nStopped early: ${error.message}`);
  results.push(false);
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
