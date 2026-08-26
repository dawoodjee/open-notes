/**
 * What locking DOES, beyond painting the lock screen.
 *
 * Native: nothing, and that is deliberate rather than unfinished. `vault.ts`
 * keeps the keys in memory while locked so the database stays open and sync
 * keeps running with the phone in a pocket -- its comment says so at length.
 * What the lock protects against there is someone picking up an unlocked phone,
 * not a memory dump of a running process, which it was never going to stop.
 *
 * `lockBehaviour.web.ts` is the opposite, because a browser tab has no OS
 * sandbox around it. See there.
 */
export async function onLock(): Promise<void> {
  // Intentionally empty. See above.
}

/** True where locking genuinely tears the session down, so the UI can say so. */
export const LOCK_DISCARDS_KEYS = false;
