/**
 * Whether this server is taking new accounts (Stage 16).
 *
 * ENFORCEMENT IS THE SERVER'S, NOT THIS FILE'S. GoTrue refuses a new address
 * with 422 `signup_disabled` whatever the app does -- measured on the dev stack
 * against both the code request and a direct POST /signup. Everything here is
 * UX: warning before someone types, and an honest sentence after a refusal.
 *
 * Decided (Decisions Log, 2026-09-30): the app ASKS the server, via GoTrue's
 * public /auth/v1/settings, rather than mirroring the setting in an
 * EXPO_PUBLIC_ variable. A mirrored copy is baked into each build and drifts;
 * on live the real switch is a dashboard setting nothing in the repo can see.
 * When the two could still disagree -- offline at open, or flipped while the
 * screen sat open -- the refusal itself is translated, so the worst case is no
 * warning followed by an honest refusal, never GoTrue's raw text.
 *
 * No expo/supabase imports, so the pure half runs under the Node test harness.
 */

export const SIGNUPS_CLOSED_NOTICE =
  'New accounts are closed on this server. Existing accounts can still sign in.';

export const SIGNUPS_CLOSED_MESSAGE =
  "This server isn't accepting new accounts. If you already have one, check the address — existing accounts can still sign in.";

// `otp_disabled` is what GoTrue answers when the caller also said
// create_user:false; the app never does, but it is the same situation.
const CLOSED_CODES = ['signup_disabled', 'otp_disabled'];

/** Matched on GoTrue's error CODE -- its message wording is not a contract. */
export function isSignupClosedError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CLOSED_CODES.includes(code);
}

export function isSignupClosedCode(code: string | undefined): boolean {
  return !!code && CLOSED_CODES.includes(code);
}

/**
 * true = closed, false = open, null = could not ask (offline, old server,
 * anything odd). null shows no notice: better silent than wrong.
 */
export async function fetchSignupsClosed(
  url = process.env.EXPO_PUBLIC_SUPABASE_URL,
  anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
): Promise<boolean | null> {
  if (!url || !anonKey) return null;
  try {
    const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body?.disable_signup === 'boolean' ? body.disable_signup : null;
  } catch {
    return null;
  }
}
