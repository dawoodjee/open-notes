import { Session } from '@supabase/supabase-js';

// A deliberately tiny module holding the current session, separate from
// contexts/AuthContext.tsx purely to break an import cycle: AuthContext
// imports lib/powersync/db.ts (to connect), and db.ts needs to know the
// current user id (to stamp new notes), so db.ts can't import AuthContext
// back. Both import this instead.
//
// This does NOT weaken the single-entry-point invariant AuthContext
// documents. Writing this variable isn't what makes a session "active"
// locally -- connecting PowerSync is, and connectPowerSync() still has
// exactly one caller. becomeAuthenticatedLocally() is the only thing that
// calls the setter below, and it's the only thing allowed to.
let currentSession: Session | null = null;

/** AuthContext.becomeAuthenticatedLocally / the SIGNED_OUT handler only. */
export function setCurrentSession(session: Session | null): void {
  currentSession = session;
}

export function getCurrentSession(): Session | null {
  return currentSession;
}

/**
 * The user id to stamp onto locally-created rows, or null when signed out.
 *
 * Null is a legitimate value, not a missing one: notes created before anyone
 * signs in genuinely have no owner yet, and get one at the claim step in
 * AuthContext. What null must never mean is "signed in but we couldn't tell"
 * -- a note written with a null owner while a session exists can't satisfy
 * the `owners insert their notes` RLS policy, so PowerSync would fail to
 * upload it and then discard the local row at the next checkpoint. That's
 * the exact failure this whole indirection exists to prevent.
 */
export function getCurrentUserId(): string | null {
  return currentSession?.user.id ?? null;
}
