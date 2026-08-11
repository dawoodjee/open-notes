/**
 * One-at-a-time execution for the auth work in contexts/AuthContext.tsx.
 *
 * WHY THIS EXISTS. becomeAuthenticatedLocally is the only place allowed to
 * change which account is current locally, and its steps (clear the old
 * account's data -> adopt the new token -> reconcile keys -> connect) must not
 * interleave with a second copy of themselves. Two near-simultaneous auth
 * events -- an OAuth callback landing as a stale TOKEN_REFRESHED fires -- are
 * a real occurrence, not a theoretical one.
 *
 * WHY IT IS ITS OWN MODULE. It was previously a bare module-level `inFlight`
 * promise inside AuthContext.tsx, and it had a bug that cost a full debugging
 * session (task #65). Three properties matter here and none of them are
 * obvious; they are asserted by scripts/verify-auth-serialization.ts, which
 * can import this file only because it pulls in nothing -- no React, no
 * react-native, no expo-secure-store, no PowerSync. Keeping it dependency-free
 * is the point, not an accident.
 *
 * THE BUG THIS REPLACES, because the shape of it recurs:
 *
 *     if (inFlight) await inFlight;
 *     inFlight = (async () => { ... })();
 *     await inFlight;
 *     inFlight = null;     // never runs if the await above throws
 *
 * If the work rejected, `inFlight` was left holding a *rejected* promise
 * forever. Every later auth event hit `await inFlight` and re-threw that same
 * stale error immediately, so it never reached the body: no reconciliation, no
 * key-step prompt, no connect. And because the caller is `void
 * handleAuthEvent(...)`, nothing was logged. One transient failure -- a flaky
 * PostgREST read inside reconcileAccountKey is enough -- silently disabled
 * sign-in for the rest of the process. Relaunching "fixed" it because module
 * state resets, which is exactly what made it look intermittent.
 */
let current: Promise<unknown> | null = null;

/**
 * Runs `work` with nothing else from this module running at the same time.
 *
 * Three properties, each of which was wrong before:
 *
 * 1. `work` is only called AFTER any in-flight run has settled -- and settled
 *    either way. `.catch(() => {})` on the wait is what stops a waiter from
 *    inheriting someone else's failure: that error was already delivered to
 *    the caller who asked for it, and a second delivery here would skip this
 *    caller's own work for a reason that has nothing to do with it.
 *
 * 2. This caller still gets its OWN error. Failures propagate exactly as
 *    before; only the cleanup changed.
 *
 * 3. The slot is cleared in a `finally`, so it is released whether the work
 *    resolved or threw -- but only if it is still this call's promise. An
 *    unconditional `current = null` would be a second bug: by the time a run
 *    finishes, a later caller may already have installed its own promise, and
 *    clearing it would let a third caller run concurrently with it, defeating
 *    the whole point.
 */
export async function runSerialized<T>(work: () => Promise<T>): Promise<T> {
  if (current) {
    await current.catch(() => {});
  }

  const run = work();
  current = run;

  try {
    return await run;
  } finally {
    if (current === run) current = null;
  }
}

/** True when no work is in flight. Exists for the verify script. */
export function isIdle(): boolean {
  return current === null;
}

/** Test-only: drop any retained promise between cases. */
export function resetForTests(): void {
  current = null;
}
