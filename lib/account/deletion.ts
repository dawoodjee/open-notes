import * as SecureStore from '@/lib/crypto/secureStorage';
import { supabase } from '@/lib/supabase/client';
import { getCurrentUserId } from '@/lib/auth/currentUser';
import { connectPowerSync, getPowerSync, isPowerSyncReady } from '@/lib/powersync/db';
import { logout } from '@/lib/auth/logout';
import { LAST_USER_KEY, markCancelled, markErased, markRequested, type Pending } from './suspension';

/**
 * Account deletion, device side (Stage 15b). The server side is the
 * `account-deletion` Edge Function; see its header for the authorisation model.
 *
 * Decisions (Decisions Log, 2026-09-28/29): 30-day grace period; confirm by
 * typing DELETE; every device suspends -- stops syncing, KEEPS its encrypted
 * local copy -- and erases itself once the account is actually gone.
 *
 * ── THE ONE RULE ──────────────────────────────────────────────────────────
 *
 * A device erases itself ONLY on a definite "this account was purged" from the
 * server. Never on a network error, and never on a session that simply stopped
 * working: measured on the dev stack, a dead account's refresh fails with
 * `refresh_token_not_found` -- the same error "sign out everywhere" produces.
 * Wiping on that could erase unsynced notes on a live account. So the device
 * asks the tombstone (`was-purged`) and waits for a yes.
 */

const FUNCTION = 'account-deletion';


type Invoke = { data: any; error: any; status: number | null };

async function call(action: string, extra: Record<string, unknown> = {}): Promise<Invoke> {
  const { data, error } = await supabase.functions.invoke(FUNCTION, { body: { action, ...extra } });
  // FunctionsHttpError carries the Response; a network failure does not.
  const status: number | null = error ? (error.context?.status ?? null) : 200;
  return { data, error, status };
}

// ─── Requesting and cancelling ─────────────────────────────────────────────

export async function requestAccountDeletion(): Promise<Pending> {
  const { data, error } = await call('request');
  if (error || !data?.pending) throw new Error(await describe(error, 'The request did not go through.'));
  const pending: Pending = data.pending;
  // Suspend at once rather than waiting for the row to sync down.
  markRequested(pending);
  if (isPowerSyncReady()) await getPowerSync().disconnect();
  return pending;
}

export async function cancelAccountDeletion(): Promise<void> {
  const { error } = await call('cancel');
  if (error) throw new Error(await describe(error, 'Cancelling did not go through.'));
  // The server row is gone; the local copy leaves when sync resumes, which it
  // can only do once this device stops treating itself as suspended.
  markCancelled();
  await connectPowerSync();
}

// ─── Checking in with the server ──────────────────────────────────────────

export type ServerState = 'pending' | 'cancelled' | 'purged' | 'unknown';

/**
 * What the server says about this suspended device's account.
 *
 *   pending    still in the window -- stay suspended
 *   cancelled  cancelled from another device -- resume
 *   purged     gone, per the tombstone -- erase this device
 *   unknown    offline, or anything ambiguous -- change NOTHING
 */
export async function checkServerState(): Promise<ServerState> {
  const res = await call('status');
  if (!res.error) return res.data?.pending ? 'pending' : 'cancelled';
  // Only a definite "not signed in" is worth following up; anything else --
  // no network, a 500 -- is not information.
  if (res.status !== 401) return 'unknown';
  const userId = getCurrentUserId() ?? (await getRememberedUser());
  if (!userId) return 'unknown';
  return (await wasAccountPurged(userId)) === true ? 'purged' : 'unknown';
}

/** true / false from the tombstone; null when the server could not be asked. */
export async function wasAccountPurged(userId: string): Promise<boolean | null> {
  const res = await call('was-purged', { userId });
  if (res.error || typeof res.data?.purged !== 'boolean') return null;
  return res.data.purged;
}

/**
 * Erase this device because its account no longer exists.
 *
 * The existing logout() is exactly "erase this device": it clears the local
 * database, the decrypted-text cache and the keychain before signing out.
 */
export async function eraseDeviceForPurgedAccount(): Promise<void> {
  await forgetRememberedUser();
  await logout();
  markErased();
}

// ─── The remembered account, for devices that never saw the request ───────
//
// A device offline for the whole 30 days opens to a session that no longer
// works. supabase-js drops it and the app is simply signed out -- with the old
// account's notes still on disk. Remembering which account this device was
// signed into is what lets it ask the tombstone about it.

export async function rememberSignedInUser(userId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(LAST_USER_KEY, userId);
  } catch {
    // Best effort: failing to remember costs the offline-device case only.
  }
}

export async function forgetRememberedUser(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(LAST_USER_KEY);
  } catch {
    // Nothing to forget, or storage unavailable -- either way, nothing to do.
  }
}

export async function getRememberedUser(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(LAST_USER_KEY);
  } catch {
    return null;
  }
}

/**
 * The session is gone and nobody here asked for that. Was it because the
 * account was purged? Called by AuthContext on an unrequested sign-out.
 */
export async function handleUnrequestedSignOut(): Promise<void> {
  const userId = await getRememberedUser();
  if (!userId) return;
  const purged = await wasAccountPurged(userId);
  if (purged === true) await eraseDeviceForPurgedAccount();
  // A definite "no": signed out for some other reason (revoked, signed out
  // elsewhere). Stop asking about this account.
  else if (purged === false) await forgetRememberedUser();
  // null: could not reach the server. Keep the id and ask on the next launch.
}

async function describe(error: any, fallback: string): Promise<string> {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return `${fallback} (${body.error})`;
  } catch {
    // Not JSON -- fall through.
  }
  return error?.context ? fallback : `${fallback} Check your connection and try again.`;
}
