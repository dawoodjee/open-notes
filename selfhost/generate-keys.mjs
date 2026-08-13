#!/usr/bin/env node
// Generates the secrets a self-hosted stack needs, and prints them as .env
// lines ready to paste.
//
//   node selfhost/generate-keys.mjs
//
// ANON_KEY and SERVICE_ROLE_KEY are not random strings -- they are JWTs signed
// with JWT_SECRET, carrying a `role` claim that Postgres uses to decide what
// the caller may read. That is why they have to be generated together with the
// secret rather than invented: change JWT_SECRET later and both keys stop
// verifying.
//
// Node's built-in crypto only; nothing to install.
import { createHmac, randomBytes } from 'node:crypto';

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

process.stdout.write(`# --- generated ${new Date().toISOString()} ---
POSTGRES_PASSWORD=${pgPassword}
JWT_SECRET=${jwtSecret}
ANON_KEY=${anonKey}
SERVICE_ROLE_KEY=${serviceKey}
POWERSYNC_REPLICATION_PASSWORD=${psPassword}
EXPO_PUBLIC_SUPABASE_ANON_KEY=${anonKey}
`);
