import { forgetDataKey } from '@/lib/crypto/vault';
import { closePowerSync } from '@/lib/powersync/db';

/**
 * On web, locking is not a screen over a running app -- it tears the session
 * down.
 *
 * Adam's call, 2026-08-25, choosing this over parity with native: on a locked
 * tab the keys must be GONE, so that anyone opening devtools finds nothing.
 * Native can afford to keep them resident because the OS sandbox stops another
 * process reading them; a browser tab has no such boundary, and the same
 * devtools that debug the app will happily print a key out of a closure.
 *
 * Both halves are required and the order matters. `closePowerSync()` first, so
 * the encrypted database is closed while the key that opened it still exists --
 * closing after forgetting would leave a live handle onto a database whose key
 * this process can no longer produce. Then `forgetDataKey()`, which zeroes the
 * data key, the db seed and the device key, and (through deviceKeyStore.web)
 * drops the unwrapped copy the gate produced.
 *
 * Unlocking re-derives all of it: the gate hands back the device key, the vault
 * unwraps the rest, and `initPowerSync()` reopens the database. That round trip
 * is the cost of the stronger guarantee, and it is why the web lock cannot be
 * the "overlay over a live app" the native one is.
 *
 * WHAT THIS DOES NOT DO: stop script that is already running in the tab at the
 * moment you lock. Encryption at rest protects the disk, not a live page --
 * web's standing residual gap, documented in dev-docs/web-at-rest-findings.md.
 */
export async function onLock(): Promise<void> {
  await closePowerSync();
  forgetDataKey();
}

export const LOCK_DISCARDS_KEYS = true;
