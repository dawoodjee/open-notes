import * as SecureStore from '@/lib/crypto/secureStorage';
import { isValidSettingKey, settingRowId } from './settingRowId';
import { getCurrentUserId } from '@/lib/auth/currentUser';
import { getPowerSync, isPowerSyncReady } from '@/lib/powersync/db';

export { isValidSettingKey, settingRowId };

/**
 * Settings that follow the user across devices, and the mirror that makes them
 * readable before the database exists.
 *
 * ── THE CIRCULARITY THIS EXISTS TO BREAK ──────────────────────────────────
 *
 * Adam asked for settings to sync (2026-08-25). For most preferences that is
 * straightforward. For the LOCK setting it is not, and the trap is worth
 * stating because it is invisible until you try it:
 *
 *   the lock setting lives in PowerSync
 *     -> reading PowerSync needs the database open
 *       -> opening the database needs the encryption key
 *         -> getting the key needs the vault unlocked
 *           -> deciding whether to demand an unlock needs the lock setting
 *
 * A synced setting alone cannot answer a question asked before the database is
 * open. So: **the table is the source of truth, and `secureStorage` holds a
 * mirror that boot reads.** Nothing at boot waits on the network or the
 * database; `reconcile()` runs later, once both exist, and updates the mirror
 * for next time.
 *
 * This is not a new invention -- `lib/crypto/vault.ts` already mirrored the
 * lock settings into the vault blob for exactly this reason, and its comment
 * says so ("readable before the database is open"). This generalises that.
 *
 * ── WHAT THE MIRROR COSTS ─────────────────────────────────────────────────
 *
 * Two copies of every setting, so they can disagree. The rule, applied
 * consistently: the mirror wins at boot because it is the only thing available;
 * the table wins from the moment it can be read. A change made on another
 * device while this one was closed therefore lands one reconcile late, which
 * for a preference is fine and for the lock is worth knowing -- turning the
 * lock ON elsewhere does not retroactively lock an already-open session.
 */

/**
 * Namespaced and versioned in the key itself, so a setting whose SHAPE changes
 * becomes a new row rather than a value an older client cannot parse.
 *
 * ALL LOWERCASE, and that is not a style preference -- the migration constrains
 * keys to `^[a-z0-9]+(\.[a-z0-9]+)*$`. A camelCase key like `bulletStyle.v1`
 * type-checks, writes to the mirror happily, and is then REJECTED by Postgres on
 * upload, where a constraint violation is not classified as structural and so
 * retries forever, jamming every operation queued behind it. `isValidSettingKey`
 * exists so that trap is caught by a test rather than by a stuck sync queue.
 */
export const LOCK_SETTINGS_KEY = 'lock.v1';
export const APPEARANCE_KEY = 'appearance.v1';
export const APP_THEME_KEY = 'theme.v1';
export const BULLET_STYLE_KEY = 'bulletstyle.v1';

/** Every key this app syncs. Used to push local choices up at first sign-in. */
export const ALL_SETTING_KEYS = [
  LOCK_SETTINGS_KEY,
  APPEARANCE_KEY,
  APP_THEME_KEY,
  BULLET_STYLE_KEY,
];

const MIRROR_PREFIX = 'notes.settings.';

/**
 * Subscribers, so a setting arriving from another device can reach whichever
 * provider owns it.
 *
 * This exists because the providers are not nested the way the data flows.
 * `ThemeProvider` sits OUTSIDE `VaultProvider` (see app/_layout.tsx -- the
 * appearance has to be settled before anything paints, including the boot
 * spinner), but only the vault side has a database to reconcile from. So the
 * reconcile publishes, and whoever cares subscribes. A context could not carry
 * this in the direction it needs to go.
 */
type SettingsListener = (changedKeys: string[]) => void;
const listeners = new Set<SettingsListener>();

export function subscribeToSettings(listener: SettingsListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Read a setting, mirror first.
 *
 * Deliberately never touches the database. This is the call that happens at
 * boot, and its whole value is that it cannot block on anything -- see the
 * circularity above.
 */
export async function readSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await SecureStore.getItemAsync(MIRROR_PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // A corrupt or unparseable mirror is treated as absent. A settings read is
    // never important enough to fail a boot over, and the fallback is the same
    // value a first-run device would get.
    return fallback;
  }
}

/**
 * Write a setting to the mirror, and to the table when there is an account to
 * write it to.
 *
 * The mirror is written FIRST and unconditionally. If the database write fails
 * -- offline, not yet open, signed out -- the local preference still takes
 * effect immediately, which is what the user expects from a settings toggle.
 * Sync catches up on its own schedule.
 */
export async function writeSetting<T>(key: string, value: T): Promise<void> {
  /**
   * Refuse an invalid key HERE, where it is a loud local error, rather than
   * letting Postgres refuse it later, where it is not.
   *
   * `user_settings_key_shape` constrains keys to `^[a-z0-9]+(\.[a-z0-9]+)*$`.
   * A key that breaks it -- `bulletStyle.v1` was the one that nearly shipped --
   * type-checks, writes to the mirror happily, and only fails on UPLOAD, inside
   * the connector, where `isStructuralError()` does not classify a constraint
   * violation. It would retry forever and block every operation queued behind
   * it: no error surface, no sync, and nothing on screen to explain it.
   *
   * A test covers the keys this app ships today (`isValidSettingKey`), but a
   * test only covers the list someone remembered to add to. This covers the
   * next caller, including one written by someone who never read the migration.
   * The throw is deliberate rather than a silent skip -- a preference that
   * cannot sync should fail where it is written.
   */
  if (!isValidSettingKey(key)) {
    throw new Error(
      `Invalid setting key "${key}". Keys must match ^[a-z0-9]+(\\.[a-z0-9]+)*$ ` +
        '(lowercase, dot-separated) or Postgres will reject the row and jam the upload queue.'
    );
  }

  const encoded = JSON.stringify(value);
  await SecureStore.setItemAsync(MIRROR_PREFIX + key, encoded);

  const userId = getCurrentUserId();
  // Signed out is a legitimate state, not an error: there is no account to sync
  // with yet. The migration makes `user_id` NOT NULL precisely so this cannot
  // be fudged -- a null-owner row would fail RLS at upload and jam the queue.
  if (!userId || !isPowerSyncReady()) return;

  const db = getPowerSync();
  const id = settingRowId(userId, key);
  const now = new Date().toISOString();

  /**
   * Read-merge-write rather than UPSERT. PowerSync's local tables are VIEWS,
   * and `INSERT ... ON CONFLICT` against a view type-checks fine and then fails
   * on device -- a trap this project has already paid for once.
   */
  const existing = await db.getOptional<{ id: string }>(
    'SELECT id FROM user_settings WHERE id = ?',
    [id]
  );

  if (existing) {
    await db.execute('UPDATE user_settings SET value = ?, updated_at = ? WHERE id = ?', [
      encoded,
      now,
      id,
    ]);
    return;
  }

  await db.execute(
    'INSERT INTO user_settings (id, user_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, userId, key, encoded, now]
  );
}

/**
 * Pull the account's settings down into the mirror.
 *
 * Runs once the database is open and has had a chance to sync -- so the NEXT
 * boot reads what the user set on another device. Returns the keys that
 * actually changed, so a caller can react to a setting that arrived from
 * elsewhere rather than re-applying everything.
 */
export async function reconcileSettings(): Promise<string[]> {
  const userId = getCurrentUserId();
  if (!userId || !isPowerSyncReady()) return [];

  const rows = await getPowerSync().getAll<{ key: string; value: string }>(
    'SELECT key, value FROM user_settings WHERE user_id = ?',
    [userId]
  );

  const changed: string[] = [];
  for (const row of rows) {
    const mirrorKey = MIRROR_PREFIX + row.key;
    const current = await SecureStore.getItemAsync(mirrorKey);
    if (current === row.value) continue;
    await SecureStore.setItemAsync(mirrorKey, row.value);
    changed.push(row.key);
  }

  if (changed.length) {
    for (const listener of listeners) {
      try {
        listener(changed);
      } catch (err) {
        // One bad subscriber must not stop the others hearing about a change.
        console.warn('Settings listener failed:', err);
      }
    }
  }
  return changed;
}

/**
 * Push the mirror up after a first sign-in.
 *
 * Settings chosen before there was an account exist only locally. Without this
 * they would be silently overwritten the first time `reconcile()` ran, because
 * the table would be empty and the mirror would look stale rather than new.
 * Only writes keys the account does not already have -- an existing row is the
 * user's choice from another device and outranks whatever this device did while
 * signed out.
 */
export async function adoptLocalSettings(keys: string[]): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId || !isPowerSyncReady()) return;

  const db = getPowerSync();
  for (const key of keys) {
    const mirrored = await SecureStore.getItemAsync(MIRROR_PREFIX + key);
    if (mirrored === null) continue;

    const existing = await db.getOptional<{ id: string }>(
      'SELECT id FROM user_settings WHERE id = ?',
      [settingRowId(userId, key)]
    );
    if (existing) continue;

    await db.execute(
      'INSERT INTO user_settings (id, user_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)',
      [settingRowId(userId, key), userId, key, mirrored, new Date().toISOString()]
    );
  }
}
