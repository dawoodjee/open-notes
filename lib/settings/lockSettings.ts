import type { LockSettings } from '@/lib/crypto/vault';
import { DEFAULT_LOCK_SETTINGS } from '@/lib/crypto/vault';
import { LOCK_SETTINGS_KEY, readSetting, writeSetting } from './syncedSettings';

export type { LockSettings };
export { DEFAULT_LOCK_SETTINGS };

/**
 * The lock settings, now an account setting rather than a device one.
 *
 * ── WHY THEY MOVED OUT OF vault.ts ────────────────────────────────────────
 *
 * They used to live in the vault blob (`StoredVault.lock`), read straight from
 * the keychain. Adam's call (2026-08-25) is that settings follow the user, so
 * they now go through `syncedSettings` -- table as the source of truth, mirror
 * for boot.
 *
 * They could not simply start calling `syncedSettings` from inside `vault.ts`,
 * and the reason is a genuine import cycle rather than tidiness:
 *
 *   vault.ts -> syncedSettings.ts -> powersync/db.ts -> vault.ts
 *                                    (for getDatabaseKey)
 *
 * `db.ts` has needed the database key from `vault.ts` since Stage 6. So the
 * lock settings move to the settings layer, which is where they always
 * belonged -- `vault.ts` itself notes they are "a separate, purely UI-level
 * decision". The type and default stay in `vault.ts` and are re-exported here,
 * because a `import type` is erased at runtime and cannot close the loop.
 *
 * ── WHAT HAPPENS TO AN EXISTING DEVICE ────────────────────────────────────
 *
 * `readLockSettings` falls back to the vault blob when the mirror has nothing,
 * which is exactly the state of every device upgrading into this stage. The
 * first write moves it across. No migration step, no flag day, and a user who
 * never touches the setting keeps the value they had.
 */

/**
 * Read at boot, and therefore never allowed to touch the database -- see the
 * circularity note in `syncedSettings.ts`. Mirror first, then the legacy vault
 * blob for a device that has not written a setting since upgrading.
 */
export async function getLockSettings(): Promise<LockSettings> {
  const mirrored = await readSetting<LockSettings | null>(LOCK_SETTINGS_KEY, null);
  if (mirrored && typeof mirrored.enabled === 'boolean') return mirrored;

  // Pre-13b devices. Imported lazily so this module does not pull the vault in
  // on every boot for a path that only matters once.
  const { getLegacyLockSettings } = await import('@/lib/crypto/vault');
  return getLegacyLockSettings();
}

export async function setLockSettings(lock: LockSettings): Promise<void> {
  await writeSetting(LOCK_SETTINGS_KEY, lock);
}
