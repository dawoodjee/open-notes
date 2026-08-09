import { supabase } from '@/lib/supabase/client';
import { withTimeout } from './withTimeout';

const RESERVED = new Set([
  'admin', 'administrator', 'support', 'api', 'help', 'settings',
  'root', 'system', 'null', 'undefined', 'notes', 'auth', 'login',
  'logout', 'signup', 'signin', 'account', 'profile', 'user', 'users',
]);

// Mirrors the DB's constraints (username_charset/length/edge_underscore/
// double_underscore in supabase/migrations/20260806122256_notes_and_profiles.sql)
// closely enough for a good starting suggestion -- not a guarantee of
// validity. The DB constraints remain the real enforcement either way.
export function sanitizeUsername(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
}

/**
 * Turn a starting suggestion into one that's actually free, by trying
 * `base`, `base2`, `base3`... until the availability check clears.
 *
 * Only for values the app proposes on the user's behalf -- notably the
 * username seeded from a provider's full name at signup. A suggestion that
 * lands on a taken name is a dead end: the tick is grey, the message says
 * "taken", and nothing tells the person what to do about a name they never
 * typed. Common real names collide constantly, so this isn't an edge case.
 *
 * Never used for what someone types themselves. Silently rewriting a chosen
 * username to `adam_dawoodjee3` would be worse than telling them it's taken.
 *
 * Gives up after a few tries and returns the last candidate rather than
 * looping: the field stays editable, the availability check still runs, and
 * the unique violation on save is still the real guarantee.
 */
export async function suggestAvailableUsername(
  base: string,
  excludeUserId?: string
): Promise<string> {
  const root = sanitizeUsername(base);
  if (root.length < 3) return root;

  for (let n = 1; n <= 5; n++) {
    // Truncate before appending, so a 20-char base doesn't produce an
    // over-length candidate that the DB's length constraint would reject.
    const suffix = n === 1 ? '' : String(n);
    const candidate = root.slice(0, 20 - suffix.length) + suffix;
    if (await checkUsernameAvailable(candidate, excludeUserId)) return candidate;
  }
  return root;
}

// UX only -- a fast, non-authoritative hint while typing. The DB's unique
// index on username_lower is the real guarantee; a caller must still handle
// the 23505 unique-violation error path on the actual write, since this
// pre-check can race (two people typing the same name at once) exactly as
// found during Stage 4's concurrency testing.
//
// excludeUserId matters: without it, opening Manage Account and re-checking
// your own already-saved username finds your own row and reports "taken"
// (or, if the check races ahead of the save, a confusing flash of
// "available" for a name you already have).
export async function checkUsernameAvailable(
  username: string,
  excludeUserId?: string
): Promise<boolean> {
  if (RESERVED.has(username.toLowerCase())) return false;
  let query = supabase.from('profiles').select('id').eq('username_lower', username.toLowerCase());
  if (excludeUserId) {
    query = query.neq('id', excludeUserId);
  }
  try {
    // This is a UX-only hint (see doc comment above) -- on timeout, resolve
    // as "available" rather than hanging the caller's "checking…" state
    // forever. The unique-violation on the actual save is what's
    // authoritative either way, so a wrong optimistic guess here just means
    // the save itself reports "taken", not a security gap.
    const { data } = await withTimeout(query.maybeSingle(), 5000, 'Username availability check');
    return !data;
  } catch {
    return true;
  }
}

// The 30-day rate limit is enforced by the enforce_username_change_limit
// trigger server-side -- this just renders the same rule client-side so the
// UI can explain *why* a change was rejected instead of a bare error.
export function formatRateLimitRemaining(usernameChangedAt: string): string {
  const changedAt = new Date(usernameChangedAt).getTime();
  const unlockAt = changedAt + 30 * 24 * 60 * 60 * 1000;
  const msRemaining = unlockAt - Date.now();
  if (msRemaining <= 0) return '';

  const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
  return `You can change your username again in ${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'}.`;
}
