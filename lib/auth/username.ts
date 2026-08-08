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

// Not copied raw from full_name (a display label with no charset
// restriction) -- sanitized through the same rules a manually-typed username
// would need to satisfy, then treated exactly like any other candidate: a
// starting suggestion the availability check and unique-violation fallback
// both still apply to.
export function suggestUsername(fullName: string | null, email: string): string {
  const fromFullName = fullName ? sanitizeUsername(fullName.replace(/\s+/g, '_')) : '';
  if (fromFullName.length >= 3) return fromFullName;

  const localPart = email.split('@')[0] ?? '';
  return sanitizeUsername(localPart);
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
