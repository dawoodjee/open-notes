/**
 * The web keychain: a Map that dies with the tab.
 *
 * ── WHY IN MEMORY AND NOT localStorage ────────────────────────────────────
 *
 * This is the deliberate half of the design, not a shortcut. The items stored
 * through here are the device key and the wrapped vault -- the keys that make
 * every note in the database readable. `localStorage` is plaintext, readable by
 * any script on the origin, and survives indefinitely; putting a data key there
 * would hand out permanent cleartext access to the whole vault in exchange for
 * surviving a page refresh.
 *
 * Keeping them in memory makes "web is session-only" a STRUCTURAL fact rather
 * than a promise: there is no persistence to leak, so the at-rest question that
 * Stage 13's Phase 0 has to answer properly simply does not arise here yet.
 * `lib/powersync/openDatabase.web.ts` makes the same trade for the database
 * itself, for the same reason -- the two have to agree or one of them is lying.
 *
 * The cost is real and is the user's accepted trade (2026-08-22): a refresh is
 * a new session, with new keys and an empty database. The UI has to say so --
 * that is what `isSessionOnly` is for.
 */

export type SecureStorageOptions = {
  /** Accepted and ignored: there is no keychain here to be picky about. */
  keychainAccessible?: unknown;
};

export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = undefined as unknown as number;

export const isSessionOnly = true;

const store = new Map<string, string>();

export async function getItemAsync(key: string): Promise<string | null> {
  return store.has(key) ? store.get(key)! : null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}
