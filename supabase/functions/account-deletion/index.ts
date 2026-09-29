// Account deletion with a 30-day grace period (Stage 15b).
//
// Runs on Supabase's Edge Runtime -- Deno, not Node -- which is why the import
// below is an `npm:` specifier rather than a package.json dependency.
//
// ── WHY THIS IS A FUNCTION AT ALL ─────────────────────────────────────────
//
// Deleting an auth user needs the SERVICE ROLE: Supabase's key that bypasses
// row-level security. The app must never hold it. Supabase injects it into
// every Edge Function's environment, so it exists here and nowhere the app can
// reach. (Adam's call, 2026-09-28 -- see the Decisions Log.)
//
// ── THE ONE PROPERTY THAT MATTERS ─────────────────────────────────────────
//
// Because this code runs as the service role, it can touch ANY account. So
// every user action takes its user id from the caller's own sign-in token,
// verified by the auth server -- never from the request body. There is no
// parameter anywhere that lets one user name another.
//
// `purge` is the exception: it is called by the daily cron job, carries no user
// token, and is authorised by a shared secret instead.
//
// ── JWT VERIFICATION IS DONE HERE, NOT BY THE GATEWAY ─────────────────────
//
// Supabase normally rejects function calls without a user JWT before they
// arrive. This function is deployed with that switched off
// (`verify_jwt = false`), because the cron job and a device whose account has
// been purged both call it WITHOUT one. Every path below checks its own
// authorisation instead.

import { createClient } from 'npm:@supabase/supabase-js@2';

const GRACE_DAYS = 30;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PURGE_SECRET = Deno.env.get('PURGE_SECRET') ?? '';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// The web app calls this from a browser, which sends a CORS preflight first.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** Constant-time comparison, so the secret cannot be guessed byte by byte from response times. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length || x.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body: { action?: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'expected a JSON body' }, 400);
  }

  switch (body.action) {
    case 'purge':
      return purge(req);
    case 'was-purged':
      return wasPurged(body.userId);
    case 'request':
    case 'cancel':
    case 'status':
      return userAction(req, body.action);
    default:
      return json({ error: 'unknown action' }, 400);
  }
});

// ─── Actions a signed-in user takes on THEIR OWN account ───────────────────

async function userAction(req: Request, action: 'request' | 'cancel' | 'status'): Promise<Response> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'not signed in' }, 401);

  // The auth server verifies the token; the user id comes from IT, never from
  // the request body.
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json({ error: 'not signed in' }, 401);
  const userId = data.user.id;

  if (action === 'request') {
    const now = new Date();
    const purgeAfter = new Date(now.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
    // `ignoreDuplicates` = insert ... on conflict do nothing. A second request
    // while one is pending keeps the ORIGINAL date rather than restarting it.
    const { error: insertError } = await admin
      .from('account_deletions')
      .upsert(
        { user_id: userId, requested_at: now.toISOString(), purge_after: purgeAfter.toISOString() },
        { onConflict: 'user_id', ignoreDuplicates: true }
      );
    if (insertError) return json({ error: insertError.message }, 500);
  }

  if (action === 'cancel') {
    const { error: deleteError } = await admin.from('account_deletions').delete().eq('user_id', userId);
    if (deleteError) return json({ error: deleteError.message }, 500);
    return json({ pending: null });
  }

  const { data: row, error: readError } = await admin
    .from('account_deletions')
    .select('requested_at, purge_after')
    .eq('user_id', userId)
    .maybeSingle();
  if (readError) return json({ error: readError.message }, 500);
  return json({
    pending: row ? { requestedAt: row.requested_at, purgeAfter: row.purge_after } : null,
  });
}

// ─── "Was this account purged?" -- for a device whose session has died ────
//
// No token, by necessity: the account it would prove is gone. It answers for
// ONE id at a time and only says whether that id was purged -- never whether an
// account exists -- so it cannot be used to discover live accounts, and the id
// is an unguessable random UUID in any case.

async function wasPurged(userId: string | undefined): Promise<Response> {
  if (!userId || !UUID.test(userId)) return json({ error: 'expected a user id' }, 400);
  const { data, error } = await admin
    .from('purged_accounts')
    .select('purged_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  return json({ purged: !!data });
}

// ─── The daily purge, called by pg_cron through pg_net ─────────────────────

async function purge(req: Request): Promise<Response> {
  if (!sameSecret(req.headers.get('x-purge-secret') ?? '', PURGE_SECRET)) {
    return json({ error: 'forbidden' }, 403);
  }

  const { data: due, error } = await admin
    .from('account_deletions')
    .select('user_id')
    .lte('purge_after', new Date().toISOString());
  if (error) return json({ error: error.message }, 500);

  const purged: string[] = [];
  const failed: { userId: string; error: string }[] = [];

  for (const { user_id: userId } of due ?? []) {
    // Tombstone FIRST. If the delete then fails, a later run retries it and the
    // tombstone is harmless; the other order could erase an account and leave
    // its offline devices no way to learn they should erase themselves.
    const { error: tombError } = await admin
      .from('purged_accounts')
      .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (tombError) {
      failed.push({ userId, error: tombError.message });
      continue;
    }

    // Hard delete. The foreign keys cascade it through notes, folders,
    // user_settings, profiles, user_keys and this account's pending row.
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId, false);
    if (deleteError) failed.push({ userId, error: deleteError.message });
    else purged.push(userId);
  }

  return json({ purged: purged.length, failed });
}
