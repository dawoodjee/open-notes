import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/ciphers/utils.js';

/**
 * A stable row id derived from (user_id, key) -- effectively uuidv5 with a
 * SHA-256 digest instead of SHA-1.
 *
 * ── WHY DETERMINISM MATTERS MORE THAN IT LOOKS ────────────────────────────
 *
 * Two devices writing the same setting must produce the SAME row, or the second
 * is an INSERT that violates `user_settings_one_per_key`. A constraint
 * violation surfaces asynchronously inside the connector, where
 * `isStructuralError()` does not classify it -- so it retries forever and
 * blocks every operation queued behind it. Hashing turns "two devices race"
 * into "two devices update one row", which is a merge the database already
 * knows how to do.
 *
 * ── WHY THIS IS ITS OWN FILE ──────────────────────────────────────────────
 *
 * It has no Expo or React Native imports, and it must not gain any. The test
 * harness runs under `tsx` in plain Node, which cannot transform React Native's
 * Flow-typed source -- so anything reachable from `react-native` is untestable
 * here. `syncedSettings.ts` imports `secureStorage`, which imports
 * `expo-secure-store`, which imports `react-native`; putting this function
 * there made the whole suite fail to even load with
 * `Unexpected "typeof"` from react-native/index.js.
 *
 * Same discipline that keeps `lib/crypto/keys.ts` import-free so
 * `scripts/verify-crypto.ts` can run it under Node. The rule is worth stating
 * plainly: if a piece of logic is worth testing, it does not get to import the
 * platform.
 */
export function settingRowId(userId: string, key: string): string {
  // The separator is inside the hashed string AND both halves are length-
  // prefixed, so ("a:b", "c") and ("a", "b:c") cannot collide -- a plain
  // concatenation would let one setting silently overwrite another.
  const material = `${userId.length}:${userId}:${key.length}:${key}`;
  const digest = bytesToHex(sha256(utf8ToBytes(material)));

  // Format as a UUID and stamp version 5 / RFC-4122 variant bits, so what lands
  // in a `uuid` column is a structurally valid one rather than a hex string
  // that happens to be the right length.
  const v = digest.slice(0, 32).split('');
  v[12] = '5';
  v[16] = ((parseInt(v[16], 16) & 0x3) | 0x8).toString(16);
  const h = v.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Does this key satisfy the column constraint the migration declares?
 *
 * Mirrors `user_settings_key_shape` exactly. Duplicated here on purpose: the
 * database is the enforcement, but by the time IT rejects a key the row is
 * already in the local upload queue, where a constraint violation is not
 * classified as structural and therefore retries forever -- jamming every
 * operation behind it. A test over this function turns a stuck sync queue into
 * a failing build.
 */
export function isValidSettingKey(key: string): boolean {
  return /^[a-z0-9]+(\.[a-z0-9]+)*$/.test(key) && key.length >= 1 && key.length <= 64;
}
