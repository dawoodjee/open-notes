import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { powersync, connectPowerSync, claimUnownedNotes } from '@/lib/powersync/db';
import { getCurrentSession, setCurrentSession } from '@/lib/auth/currentUser';

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
let inFlight: Promise<void> | null = null;

/**
 * The ONLY function in this codebase allowed to call powersync.connect() or
 * change which session is "current" locally. Every path that can produce a
 * session -- OTP verify, OAuth callback, app-boot restore, and Supabase's own
 * hourly TOKEN_REFRESHED event -- funnels through this via onAuthStateChange
 * below. No other file calls powersync.connect() or writes session state
 * directly (grep for `.connect(` to confirm -- lib/powersync/db.ts's
 * connectPowerSync() has exactly one caller: this function).
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
  if (inFlight) {
    await inFlight;
  }

  inFlight = (async () => {
    const previousSession = getCurrentSession();
    const isAccountSwitch =
      previousSession !== null && previousSession.user.id !== newSession.user.id;
    const isFirstConnect = previousSession === null;

    if (isAccountSwitch) {
      await powersync.disconnectAndClear();
    }

    setCurrentSession(newSession);
    setSessionState(newSession);

    if (isFirstConnect || isAccountSwitch) {
      // Claim before connecting, never after. Notes written before sign-in
      // have no user_id, which means no sync bucket can contain them -- so
      // the first checkpoint after connecting would discard them locally
      // before they ever got an owner. See claimUnownedNotes' own comment.
      //
      // Safe to run on an account switch too, but only because the clear
      // above has already emptied local storage by this point: there is
      // nothing of the previous account's left for this to claim.
      await claimUnownedNotes(newSession.user.id);
      await connectPowerSync();
    }
    // Otherwise this is a same-user token refresh: fetchCredentials() on the
    // connector reads the session fresh whenever PowerSync needs it, so
    // there's nothing further to do. Reconnecting here would be a
    // disruptive, unnecessary resync for a routine hourly refresh.
  })();

  await inFlight;
  inFlight = null;
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
        void handleAuthEvent(event, newSession);
      }, 0);
    });

    async function handleAuthEvent(event: string, newSession: Session | null) {
      if (newSession && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        await becomeAuthenticatedLocally(newSession, setSession);
      } else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !newSession)) {
        // logout() (see lib/auth/logout.ts) already ran
        // powersync.disconnectAndClear() before calling supabase.auth.signOut()
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
