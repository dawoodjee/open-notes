import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { getPowerSync, connectPowerSync, claimUnownedNotes } from '@/lib/powersync/db';
import { getCurrentSession, setCurrentSession } from '@/lib/auth/currentUser';
import { runSerialized } from '@/lib/auth/serializeAuthWork';
import { setPendingAdoption } from '@/lib/crypto/adoption';
import { setPendingKeySetup } from '@/lib/crypto/keySetup';
import { AccountKeyRecord, fetchAccountKey, uploadAccountKey } from '@/lib/crypto/keyBackup';
import { resolveRecoveryFormat, unwrapDataKeyWithRecoveryCode } from '@/lib/crypto/keys';
import { reEncryptLocalNotes } from '@/lib/crypto/reEncrypt';
import {
  adoptAccountDataKey,
  getDataKeyFingerprint,
  getKeyBackupPayload,
  hasRecoveryCode,
  markKeyBackedUp,
} from '@/lib/crypto/vault';

interface AuthContextValue {
  session: Session | null;
  // True until the app-boot session restore has resolved (whether or not it
  // found a session) -- lets callers avoid flashing "logged out" UI for the
  // instant it takes SecureStore/AsyncStorage to be read.
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

// The current session lives module-level (in lib/auth/currentUser.ts, split
// out only to break an import cycle with lib/powersync/db.ts) rather than in
// component state: it must be reachable from a single serialized queue
// regardless of provider remounts, and readable without a render round-trip.
//
// The queue itself is lib/auth/serializeAuthWork.ts. It used to be a bare
// `inFlight` promise here, which was fine until the work rejected -- see that
// file for what went wrong and why it now lives somewhere it can be tested.

/**
 * Make this device's data key and the account's agree, or report that it
 * can't be done without the user.
 *
 * Three outcomes:
 *   - the account has no key yet  -> claim it with ours, nothing to re-encrypt
 *   - the account's key is ours   -> nothing to do (the common case, every
 *                                    launch after the first)
 *   - the account's key differs   -> only the recovery code can unwrap it, so
 *                                    hand off to the adoption screen
 */
async function reconcileAccountKey(
  userId: string,
  setSessionState: (s: Session | null) => void
): Promise<'ok' | 'blocked'> {
  const account = await fetchAccountKey(userId);

  if (account) {
    if (account.fingerprint === getDataKeyFingerprint()) {
      await markKeyBackedUp();
      return 'ok';
    }
    // Adoption deliberately does NOT require this device to have a recovery
    // code of its own -- it's about to inherit the account's, and its own
    // becomes meaningless the moment it adopts.
    return beginAdoption(account, setSessionState);
  }

  // This device is first, so its key becomes the account's. That is the point
  // at which a recovery code stops being optional: the wrapped blob in
  // user_keys is the ONLY way this key ever reaches a second device, and
  // uploading notes before one exists would produce ciphertext on the server
  // whose key lives on exactly one phone with no way off it.
  if (!(await hasRecoveryCode())) {
    return beginKeySetup(userId, setSessionState);
  }

  const payload = await getKeyBackupPayload();
  if (!payload) return 'ok';
  const { claimed } = await uploadAccountKey(userId, payload);
  if (claimed) {
    await markKeyBackedUp();
    return 'ok';
  }
  // Lost a race with another device signing into the same new account.
  // Fall through and adopt whatever won.
  const winner = await fetchAccountKey(userId);
  if (!winner) return 'ok';
  return beginAdoption(winner, setSessionState);
}

/**
 * Claim this device's unowned notes, then connect. The only way to connect.
 *
 * The claim MUST come before connecting. A note with no user_id belongs to
 * no sync bucket, so the first checkpoint after connecting would discard it
 * locally before it ever got an owner.
 *
 * It must NOT come before reconciliation, which is where it used to sit, and
 * that was a real bug. The key steps can end with the user backing out --
 * beginKeySetup.cancel and beginAdoption.cancel both promise the device is
 * left "exactly as it was, with its own key and its own notes intact". A
 * claim that has already run breaks that promise, and irreversibly: the
 * notes stay stamped with an account the device is no longer signed into,
 * and the next sign-in cannot fix them because claimUnownedNotes only
 * matches `user_id IS NULL`.
 *
 * The consequence is worse than an orphaned note. Uploading a row owned by
 * someone else fails the RLS insert check every time, and PowerSync replays
 * transactions strictly in order -- so that one permanently-rejected op sits
 * at the head of the queue and blocks every other note behind it. Observed
 * on the Pixel emulator: signing into the wrong account and backing out left
 * one note owned by that account and stopped the device syncing entirely.
 *
 * Claiming here instead -- at the last moment before connecting, on every
 * path that connects -- keeps the invariant and closes the window.
 */
async function claimAndConnect(userId: string): Promise<void> {
  await claimUnownedNotes(userId);
  await connectPowerSync();
}

/**
 * Pause sign-in until the user has written down a recovery code.
 *
 * Runs once per device, on first sign-in. Sync stays disconnected throughout;
 * complete() re-enters reconciliation rather than duplicating it, so the
 * upload path has exactly one implementation.
 */
function beginKeySetup(
  userId: string,
  setSessionState: (s: Session | null) => void
): 'blocked' {
  setPendingKeySetup({
    async complete() {
      setPendingKeySetup(null);
      const outcome = await reconcileAccountKey(userId, setSessionState);
      if (outcome === 'ok') await claimAndConnect(userId);
    },
    async cancel() {
      setPendingKeySetup(null);
      // Nothing was uploaded, so signing out leaves this device exactly as it
      // was, with its own key and its own notes intact.
      await supabase.auth.signOut({ scope: 'local' });
      setCurrentSession(null);
      setSessionState(null);
    },
  });
  return 'blocked';
}

function beginAdoption(
  record: AccountKeyRecord,
  setSessionState: (s: Session | null) => void
): 'blocked' {
  setPendingAdoption({
    record,
    async complete(recoveryCode: string) {
      // Throws WrongRecoveryCodeError on a bad code, before anything changes.
      //
      // The format comes off the RECORD, never from what was typed. An
      // account claimed before word codes existed has no `format` in its
      // kdf_params and its blob is only openable by normalising as the old
      // character format -- resolveRecoveryFormat is what reads that absence
      // correctly instead of assuming today's default.
      const accountKey = unwrapDataKeyWithRecoveryCode(
        record.recoveryWrappedKey,
        recoveryCode,
        record.recoverySalt,
        resolveRecoveryFormat(record.kdfParams)
      );

      const { previousKey } = await adoptAccountDataKey(
        accountKey,
        record.recoveryWrappedKey,
        record.recoverySalt,
        record.kdfParams
      );

      // Both keys are in hand only here, so the local notes have to be
      // converted now -- and before connecting, or they would upload still
      // encrypted under a key the account cannot read.
      await reEncryptLocalNotes(previousKey, accountKey);
      previousKey.fill(0);

      setPendingAdoption(null);
      // The session is already set by the time adoption can start, so this is
      // the account whose key was just adopted. No fallback to a bare
      // connect: connecting without claiming first is precisely what
      // discards unowned notes at the first checkpoint, so if the session
      // has somehow gone, fail loudly and leave sync off rather than risk
      // deleting the user's notes to keep going.
      const userId = getCurrentSession()?.user.id;
      if (!userId) {
        throw new Error('Adoption completed without a current session; refusing to connect.');
      }
      await claimAndConnect(userId);
    },
    async cancel() {
      setPendingAdoption(null);
      // Nothing was changed, so signing out leaves this device exactly as it
      // was, with its own key and its own notes intact.
      await supabase.auth.signOut({ scope: 'local' });
      setCurrentSession(null);
      setSessionState(null);
    },
  });
  return 'blocked';
}

/**
 * The ONLY function in this codebase allowed to call getPowerSync().connect() or
 * change which session is "current" locally. Every path that can produce a
 * session -- OTP verify, OAuth callback, app-boot restore, and Supabase's own
 * hourly TOKEN_REFRESHED event -- funnels through this via onAuthStateChange
 * below. No other file calls getPowerSync().connect() or writes session state
 * directly (grep for `.connect(` to confirm -- lib/powersync/db.ts's
 * connectPowerSync() is called only by claimAndConnect above, which is in
 * turn called only from this file: here, and from the two key-step
 * completions that this function hands off to).
 *
 * Why: local SQLite has no per-row access control the way Postgres RLS
 * does. If a session ever moved from account A to account B without a clear
 * step running first, A's rows would sit there locally readable by B. This
 * function is what makes that structurally impossible rather than a
 * discipline problem -- an account switch always clears before adopting the
 * new token; nothing else has a path to the token setter that skips it.
 */
async function becomeAuthenticatedLocally(
  newSession: Session,
  setSessionState: (s: Session | null) => void
) {
  // Serialize: two near-simultaneous calls (e.g. an OAuth callback landing
  // right as a stale TOKEN_REFRESHED fires) must not interleave their
  // check/clear/connect steps -- that would defeat the invariant above.
  //
  // Errors from the body still propagate to this function's caller unchanged.
  // What runSerialized guarantees is only that a failure here cannot leave the
  // queue holding a rejected promise that poisons every later sign-in.
  return runSerialized(async () => {
    const previousSession = getCurrentSession();
    const isAccountSwitch =
      previousSession !== null && previousSession.user.id !== newSession.user.id;
    const isFirstConnect = previousSession === null;

    if (isAccountSwitch) {
      await getPowerSync().disconnectAndClear();
    }

    setCurrentSession(newSession);
    setSessionState(newSession);

    if (isFirstConnect || isAccountSwitch) {
      // The claim used to be here, before reconciliation. It now happens
      // inside claimAndConnect, at the point of connecting -- see the note
      // there for why claiming this early was destructive.
      //
      // Reconcile this device's data key against the account's BEFORE
      // connecting. Every device mints its own key at PIN setup, before any
      // account exists, so signing into an account that already has notes
      // means those notes are encrypted under a different key. Connecting
      // first would pull down content this device cannot read, and push up
      // content the account cannot read.
      const reconciliation = await reconcileAccountKey(newSession.user.id, setSessionState);
      if (reconciliation === 'blocked') {
        // Sync stays disconnected until the user either writes down a new
        // recovery code or supplies the account's existing one. Whichever
        // screen is showing calls claimAndConnect() when it's done.
        return;
      }

      await claimAndConnect(newSession.user.id);
    }
    // Otherwise this is a same-user token refresh: fetchCredentials() on the
    // connector reads the session fresh whenever PowerSync needs it, so
    // there's nothing further to do. Reconnecting here would be a
    // disruptive, unnecessary resync for a routine hourly refresh.
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // The handler body is deferred out of the callback with setTimeout(0),
    // which looks like a hack and isn't. supabase-js invokes this callback
    // while holding its internal auth lock, and anything we do synchronously
    // inside it that re-enters supabase-js (getSession, refreshSession, a
    // PostgREST call that needs the token) waits on a lock its own caller is
    // still holding -- a deadlock that presents as a promise that never
    // settles, with no error and no network traffic. Supabase's docs call
    // this out directly. Deferring by a tick lets the lock release first.
    //
    // Two prior symptoms both trace back here: PowerSync's connect() calling
    // fetchCredentials from inside this callback, and useProfile's PostgREST
    // read on sign-in.
    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;

      setTimeout(() => {
        if (!mounted) return;
        // The .catch is not defensive padding. This was a bare
        // `void handleAuthEvent(...)`, so a failed sign-in produced a device
        // that was signed in, not syncing, showing no key-step prompt -- and
        // absolutely nothing in the console. Logging doesn't change control
        // flow; it just means the next occurrence names itself instead of
        // costing another debugging session (task #65).
        void handleAuthEvent(event, newSession).catch((err) => {
          console.error(`[auth] handling ${event} failed:`, err);
        });
      }, 0);
    });

    async function handleAuthEvent(event: string, newSession: Session | null) {
      if (newSession && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        await becomeAuthenticatedLocally(newSession, setSession);
      } else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !newSession)) {
        // logout() (see lib/auth/logout.ts) already ran
        // getPowerSync().disconnectAndClear() before calling supabase.auth.signOut()
        // -- by the time this fires, local state is already clean. This just
        // mirrors that into React/module state.
        setCurrentSession(null);
        setSession(null);
      }

      if (event === 'INITIAL_SESSION') {
        setIsLoading(false);
      }
    }

    // supabase-js's auto-refresh timer is normally driven by browser
    // focus/visibility events, which don't exist on RN -- without this, a
    // session can silently go stale while the app is backgrounded. This is
    // Supabase's own documented RN pattern, not a workaround.
    const appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
      appStateSub.remove();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ session, isLoading }}>{children}</AuthContext.Provider>
  );
}
