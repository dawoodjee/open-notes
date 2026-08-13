#!/usr/bin/env node
// Generates the secrets a self-hosted stack needs, and prints them as .env
// lines ready to paste.
//
//   node selfhost/generate-keys.mjs            # print, paste them yourself
//   node selfhost/generate-keys.mjs --write    # fill them into .env for you
//
// ANON_KEY and SERVICE_ROLE_KEY are not random strings -- they are JWTs signed
// with JWT_SECRET, carrying a `role` claim that Postgres uses to decide what
// the caller may read. That is why they have to be generated together with the
// secret rather than invented: change JWT_SECRET later and both keys stop
// verifying.
//
// Node's built-in crypto only; nothing to install.
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const b64url = (input) => Buffer.from(input).toString('base64url');

function sign(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

// 40 hex chars. GoTrue rejects a JWT secret shorter than 32 characters.
const jwtSecret = randomBytes(20).toString('hex');
// Passwords go into Postgres connection URIs, so keep them to characters that
// need no percent-encoding -- a `@` or `/` in a password silently truncates the
// URI and produces a connection error that names the wrong host.
const pgPassword = randomBytes(24).toString('base64url');
const psPassword = randomBytes(24).toString('base64url');

const issued = Math.floor(Date.now() / 1000);
const expires = issued + 60 * 60 * 24 * 365 * 10; // 10 years

const anonKey = sign({ role: 'anon', iss: 'supabase', iat: issued, exp: expires }, jwtSecret);
const serviceKey = sign(
  { role: 'service_role', iss: 'supabase', iat: issued, exp: expires },
  jwtSecret
);

const values = {
  POSTGRES_PASSWORD: pgPassword,
  JWT_SECRET: jwtSecret,
  ANON_KEY: anonKey,
  SERVICE_ROLE_KEY: serviceKey,
  POWERSYNC_REPLICATION_PASSWORD: psPassword,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: anonKey,
};

if (!process.argv.includes('--write')) {
  process.stdout.write(`# --- generated ${new Date().toISOString()} ---\n`);
  for (const [key, value] of Object.entries(values)) {
    process.stdout.write(`${key}=${value}\n`);
  }
  process.exit(0);
}

// --write: edit .env in place rather than making someone paste six values by
// hand. Refuses to overwrite a key that already has a value, because the two
// passwords are baked into the database volume on first start -- silently
// rotating them turns a working stack into one where auth cannot log in, with
// nothing on screen to connect the two events.
const envPath = new URL('../.env', import.meta.url).pathname;
if (!existsSync(envPath)) {
  console.error('No .env found. Run `cp .env.example .env` first.');
  process.exit(1);
}

const lines = readFileSync(envPath, 'utf8').split('\n');
const filled = [];
const skipped = [];

const updated = lines.map((line) => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match) return line;
  const [, key, existing] = match;
  if (!(key in values)) return line;
  if (existing.trim() !== '') {
    skipped.push(key);
    return line;
  }
  filled.push(key);
  return `${key}=${values[key]}`;
});

const missing = Object.keys(values).filter((k) => !filled.includes(k) && !skipped.includes(k));
if (missing.length > 0) {
  console.error(`.env has no line for: ${missing.join(', ')}`);
  console.error('It looks edited or out of date. Compare it against .env.example.');
  process.exit(1);
}

writeFileSync(envPath, updated.join('\n'));

if (filled.length > 0) {
  console.log(`Filled in ${filled.length} value(s) in .env: ${filled.join(', ')}`);
} else {
  console.log('Nothing to fill in — every generated value in .env already has one.');
}
if (skipped.length > 0) {
  console.log(`Left alone (already set): ${skipped.join(', ')}`);
  console.log('Delete those values first if you really want to regenerate them.');
}
