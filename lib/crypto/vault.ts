// Must be imported before anything calls into noble, which reaches for
// crypto.getRandomValues(). React Native has no such global until this
// polyfill installs it. (lib/supabase/client.ts imports it too; it's
// idempotent, and relying on that file having been loaded first would be a
// load-order bug waiting to happen.)
import 'react-native-get-random-values';

import * as SecureStore from 'expo-secure-store';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/ciphers/utils.js';
import {
  KdfParams,
  CURRENT_RECOVERY_FORMAT,
  RECOVERY_KDF_PARAMS,
  generateDataKey,
  generateDeviceKey,
  generateRecoveryCode,
  generateSalt,
  keyFingerprint,
  unwrapWith,
  wrapDataKeyWithRecoveryCode,
  wrapWith,
} from './keys';

/**
 * Everything that persists the vault, and the in-memory unlocked state.
 *
 * Split from keys.ts on purpose: keys.ts is pure computation with no Expo or
 * React Native imports, which is what lets scripts/verify-crypto.ts exercise
 * the real code under Node. This file is the part that can only run on a
 * device, and it's deliberately thin so there's little here that isn't
 * covered by that script.
 *
 * THE KEY MODEL, after the move to device-native unlock:
 *
 *   dataKey     encrypts note content. Wrapped under deviceKey locally, and
 *               under the recovery code server-side.
 *   dbSeed      derives the SQLCipher key for the local file. Device-local,
 *               never uploaded, never recoverable -- see below.
 *   deviceKey   32 random bytes in the OS keychain. Wraps both of the above.
 *
 * The user types nothing to unlock. Whether a lock screen appears at all is a
 * separate, purely UI-level decision (see LockSettings and
 * lib/auth/deviceAuth.ts) -- the keychain is what actually protects these
 * bytes at rest, and the device credential is a gate in front of the app, not
 * a second layer of encryption.
 */

const VAULT_KEY = 'notes.vault.v2';
const DEVICE_KEY_ITEM = 'notes.devicekey.v2';

/**
 * The pre-6.5 vault, which wrapped its keys under scrypt(6-digit PIN).
 *
 * Kept only as a name to delete. There is deliberately no migration: unwrapping
 * a v1 vault requires the PIN, and the screens that could collect one are gone.
 * See hasLegacyVault().
 */
const LEGACY_VAULT_KEY = 'notes.vault.v1';

/**
 * Why this accessibility level and not the stronger-sounding one.
 *
 * WHEN_PASSCODE_SET_THIS_DEVICE_ONLY reads like the obvious choice for a
 * security-sensitive item, and it is a trap: iOS **deletes** those items when
 * the user removes their device passcode. Someone turning off their passcode
 * would silently lose every note that had never synced. WHEN_UNLOCKED_THIS_-
 * DEVICE_ONLY still requires the device to be unlocked, still never leaves the
 * device, and still stays out of iCloud backups -- without the trapdoor.
 *
 * Android note: keychainAccessible is iOS-only. Android Keystore has no
 * equivalent attribute, so the key there is hardware-backed and non-exportable
 * but readable whenever this process runs. Practically the same for a
 * foreground app; the guarantee is genuinely weaker, and the Security screen
 * copy must not claim otherwise.
 */
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Whether to show a lock screen, and after how long away. */
export interface LockSettings {
  enabled: boolean;
  /** 0 means lock the moment the app leaves the foreground. */
  afterMs: number;
}

export const DEFAULT_LOCK_SETTINGS: LockSettings = { enabled: false, afterMs: 5 * 60 * 1000 };

interface StoredVault {
  /** The data key, wrapped under the device key. */
  wrappedByDevice: string;
  /**
   * The SQLCipher seed, wrapped under the device key.
   *
   * WHY IT IS SEPARATE FROM THE DATA KEY (a Stage 6 mistake, corrected then and
   * still load-bearing): the database key was originally derived from the data
   * key. That is fine until a device has to ADOPT a different account's data
   * key on login -- at which point the database key would silently change and
   * the open database file would become unopenable, requiring a full SQLCipher
   * rekey mid-login. Two secrets with two jobs avoids that entirely.
   */
  wrappedDbSeedByDevice: string;
  /**
   * The same data key, wrapped under the recovery code. Absent until the user
   * signs in -- a device that has never had an account has nothing to transport
   * the key TO, so there is nothing to recover and no reason to make someone
   * transcribe twelve words before writing their first note.
   */
  wrappedByRecoveryCode?: string;
  recoverySalt?: string;
  /** Travels with the blob so a future derivation change doesn't strand it. */
  kdfParams?: KdfParams;
  /**
   * WHICH ACCOUNT the recovery code above belongs to.
   *
   * Everything else in this blob describes the device. This one field
   * describes an account, and it is here because the recovery code is the one
   * piece of vault state that is account-scoped: it wraps the key for one
   * specific account, and means nothing for any other.
   *
   * Without it a code looked current no matter whose it was, and that had
   * teeth. hasRecoveryCode() gates whether sign-in stops to issue a code, so a
   * stale code left behind by a previous account made every later sign-up skip
   * the step and silently claim the account with the old device key -- no code
   * shown, and public.user_keys is insert-only, so the wrong key was permanent.
   * Observed on the dev stack: three unrelated accounts sharing one
   * fingerprint, two of which had no recoverable code in existence.
   *
   * Undefined on vaults written before this field existed, and read as "not
   * this account" -- see hasRecoveryCode. That errs toward issuing a fresh
   * code, which is the harmless direction.
   */
  recoveryUserId?: string;
  /** Whether wrappedByRecoveryCode has made it to public.user_keys yet. */
  backedUp: boolean;
  /**
   * False between generating a recovery code and the user typing it back.
   *
   * Without this flag there's a window that produces an unrecoverable account:
   * the code is displayed exactly once, and killing the app mid-screen would
   * leave a vault whose recovery code nobody has ever seen. Treating an
   * unconfirmed code as no code at all means the step simply runs again.
   */
  recoveryConfirmed: boolean;
  /**
   * Mirrored here, with ui_state as the editable source of truth.
   *
   * Not redundancy for its own sake: the boot path has to decide whether to
   * show a lock screen BEFORE it can open the database, and ui_state lives
   * inside that database. Something readable earlier has to hold the answer.
   */
  lock: LockSettings;
}

// --- in-memory unlocked state ----------------------------------------------
//
// Module-level rather than React state, mirroring lib/auth/currentUser.ts:
// lib/powersync/connector.ts needs the key from inside uploadData(), which
// has no component and no render cycle to read from.
//
// These stay in memory while the lock screen is showing. That is deliberate:
// re-locking hides the UI, it does not tear down the database or disconnect
// sync, so notes keep syncing while the phone is in a pocket. What the lock
// protects against is someone picking up an unlocked phone -- not a memory
// dump of a running process, which it was never going to stop anyway.
let dataKey: Uint8Array | null = null;
let dbSeed: Uint8Array | null = null;
let deviceKey: Uint8Array | null = null;

export function isUnlocked(): boolean {
  return dataKey !== null;
}

export function getDataKey(): Uint8Array {
  if (!dataKey) {
    throw new Error('The vault is locked -- no data key available.');
  }
  return dataKey;
}

/** Only for sign-out and account switches, where the next user must not
 *  inherit the previous one's key. Showing the lock screen does not call this. */
export function forgetDataKey(): void {
  if (dataKey) dataKey.fill(0);
  dataKey = null;
  if (dbSeed) dbSeed.fill(0);
  dbSeed = null;
  if (deviceKey) deviceKey.fill(0);
  deviceKey = null;
}

// --- persistence ------------------------------------------------------------

async function readVault(): Promise<StoredVault | null> {
  const raw = await SecureStore.getItemAsync(VAULT_KEY, SECURE_STORE_OPTIONS);
  return raw ? (JSON.parse(raw) as StoredVault) : null;
}

async function writeVault(vault: StoredVault): Promise<void> {
  // Comfortably inside SecureStore's ~2KB per-value cap: two envelopes of a
  // 32-byte key plus a salt is well under 600 bytes. (Contrast
  // lib/supabase/client.ts, where a full session blew past the cap and needed
  // the LargeSecureStore workaround.)
  await SecureStore.setItemAsync(VAULT_KEY, JSON.stringify(vault), SECURE_STORE_OPTIONS);
}

export async function hasVault(): Promise<boolean> {
  return (await readVault()) !== null;
}

/**
 * Is there a pre-6.5 vault sitting in the keychain?
 *
 * Its keys are wrapped under a PIN this app can no longer collect, so both it
 * and the database it belongs to are unreadable. The caller wipes both and
 * starts fresh -- see contexts/VaultContext.tsx.
 */
export async function hasLegacyVault(): Promise<boolean> {
  return (await SecureStore.getItemAsync(LEGACY_VAULT_KEY)) !== null;
}

export async function clearLegacyVault(): Promise<void> {
  await SecureStore.deleteItemAsync(LEGACY_VAULT_KEY);
}

// --- lifecycle --------------------------------------------------------------

/**
 * First launch. Mints everything and leaves the vault unlocked.
 *
 * No PIN, no recovery code, no user interaction at all -- the point is that a
 * new user reaches an empty note with nothing between them and it. The recovery
 * code is generated later, at sign-in (see addRecoveryCode), which is the first
 * moment the key has to become portable off this device.
 */
export async function createLocalVault(): Promise<void> {
  const key = generateDataKey();
  const seed = generateDataKey(); // same shape, different job -- see wrappedDbSeedByDevice
  const device = generateDeviceKey();

  await SecureStore.setItemAsync(DEVICE_KEY_ITEM, bytesToHex(device), SECURE_STORE_OPTIONS);
  await writeVault({
    wrappedByDevice: wrapWith(key, device),
    wrappedDbSeedByDevice: wrapWith(seed, device),
    backedUp: false,
    recoveryConfirmed: false,
    lock: DEFAULT_LOCK_SETTINGS,
  });

  dataKey = key;
  dbSeed = seed;
  deviceKey = device;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Load the keys into memory from the keychain.
 *
 * Returns false rather than throwing when the device key is missing, which is
 * a real state: the keychain item survives app deletion on iOS while the
 * database does not, so an odd combination can outlive a reinstall. The caller
 * treats false as "start over".
 */
export async function unlockWithDeviceKey(): Promise<boolean> {
  const vault = await readVault();
  if (!vault) return false;

  const hex = await SecureStore.getItemAsync(DEVICE_KEY_ITEM, SECURE_STORE_OPTIONS);
  if (!hex) return false;

  try {
    const device = hexToBytes(hex);
    dataKey = unwrapWith(vault.wrappedByDevice, device);
    dbSeed = unwrapWith(vault.wrappedDbSeedByDevice, device);
    deviceKey = device;
    return true;
  } catch {
    return false;
  }
}

// --- lock settings ----------------------------------------------------------

/** Readable before the database is open, which is the whole reason the
 *  settings are mirrored into the vault blob. */
export async function getLockSettings(): Promise<LockSettings> {
  const vault = await readVault();
  return vault?.lock ?? DEFAULT_LOCK_SETTINGS;
}

export async function setLockSettings(lock: LockSettings): Promise<void> {
  const vault = await readVault();
  if (!vault) return;
  await writeVault({ ...vault, lock });
}

// --- recovery code ----------------------------------------------------------

/**
 * Does this device hold a confirmed recovery code FOR THIS ACCOUNT?
 *
 * The userId argument is not decoration. This used to ask only whether a code
 * existed, and a code outlives the account it was issued for -- logout clears
 * the local database but the keychain is untouched, by design, because the
 * device key still has local notes to protect. So the next account to sign in
 * on this device found a code sitting there, skipped the step that issues one,
 * and claimed the account with a key nobody had ever written down.
 *
 * A code belonging to someone else is not a code as far as this question is
 * concerned. Same for a vault predating recoveryUserId: unknown ownership is
 * treated as foreign, so the worst case is issuing a fresh code that was not
 * strictly needed.
 */
export async function hasRecoveryCode(userId: string): Promise<boolean> {
  const vault = await readVault();
  if (!vault?.wrappedByRecoveryCode || !vault.recoveryConfirmed) return false;
  return vault.recoveryUserId === userId;
}

/**
 * Forget the recovery code, keeping everything else. Called from logout().
 *
 * ONLY the account-scoped fields. Wiping the whole vault would be the obvious
 * reading of "clean up after sign-out" and it would destroy data: the vault
 * also holds wrappedByDevice and wrappedDbSeedByDevice, which are what make
 * this device's remaining local notes -- and the SQLCipher file they live in --
 * readable at all. Those belong to the device and survive signing out.
 *
 * Belt and braces alongside recoveryUserId above. That field alone is enough to
 * stop a stale code being MISTAKEN for a current one; this stops it lingering
 * in the keychain after the account it belonged to is gone, which is a
 * different and equally good reason.
 *
 * Signing back into the same account is unaffected: the data key is untouched,
 * so its fingerprint still matches the account's and reconciliation returns
 * 'ok' without ever consulting any of this.
 */
export async function clearRecoveryState(): Promise<void> {
  const vault = await readVault();
  if (!vault) return;

  // Rebuilt by hand rather than spread-and-undefine: `{...vault, x: undefined}`
  // keeps the keys with undefined values, and JSON.stringify drops them, so it
  // happens to work -- via two coincidences in a row. Naming what stays is
  // worth more here than brevity, since what stays is the difference between
  // readable notes and a brick.
  await writeVault({
    wrappedByDevice: vault.wrappedByDevice,
    wrappedDbSeedByDevice: vault.wrappedDbSeedByDevice,
    backedUp: false,
    recoveryConfirmed: false,
    lock: vault.lock,
  });
}

/**
 * Generate the recovery code and wrap the data key under it.
 *
 * Returns the code in plaintext -- the ONLY time it is ever available that
 * way. It is not stored in readable form anywhere, so if the user doesn't
 * write it down here it genuinely cannot be produced again.
 *
 * Leaves recoveryConfirmed false; see markRecoveryConfirmed.
 */
export async function addRecoveryCode(): Promise<string> {
  const vault = await readVault();
  if (!vault) throw new Error('No vault on this device.');

  const recoveryCode = generateRecoveryCode();
  const recoverySalt = generateSalt();

  await writeVault({
    ...vault,
    wrappedByRecoveryCode: wrapDataKeyWithRecoveryCode(
      getDataKey(),
      recoveryCode,
      recoverySalt,
      CURRENT_RECOVERY_FORMAT
    ),
    recoverySalt,
    kdfParams: RECOVERY_KDF_PARAMS,
    recoveryConfirmed: false,
  });

  return recoveryCode;
}

/**
 * Called once the recovery code has been shown AND typed back.
 *
 * Also the moment the code gets stamped with its owner. Deliberately here
 * rather than in addRecoveryCode: an unconfirmed code is not a code (see
 * recoveryConfirmed), so claiming ownership of the account before the user has
 * proved they wrote it down would be claiming something untrue.
 */
export async function markRecoveryConfirmed(userId: string): Promise<void> {
  const vault = await readVault();
  if (!vault) throw new Error('No vault to confirm.');
  await writeVault({ ...vault, recoveryConfirmed: true, recoveryUserId: userId });
}

// --- account key reconciliation --------------------------------------------

/**
 * Adopt an account's data key on a device that already had its own.
 *
 * Every device mints a data key on first launch, before any account exists.
 * Sign in to an account that already has notes and those notes are encrypted
 * under a DIFFERENT key -- the one belonging to the device that created the
 * account. Without adoption they download and are simply unreadable.
 *
 * THE TRAP, and the reason this function is not three lines: the data key is
 * being replaced, so every wrapping of it has to be rewritten in the same
 * pass. Leave wrappedByDevice pointing at the old key and the next launch
 * unlocks silently into a key the account cannot read -- no error, no prompt,
 * just notes that won't decrypt. Meanwhile dbSeed must NOT change, or the open
 * database file stops opening.
 *
 * Re-encrypting the notes already on this device is the caller's job (see
 * lib/crypto/reEncrypt.ts) and must happen while BOTH keys are available --
 * hence the old key is returned rather than discarded.
 */
export async function adoptAccountDataKey(
  accountKey: Uint8Array,
  // The account being adopted FROM, stamped onto the recovery material below.
  // Adoption copies that material verbatim from the server, so it belongs to
  // this account by definition -- and recording that is what stops the next
  // sign-up on this device mistaking it for its own.
  userId: string,
  accountRecoveryWrapped: string,
  accountRecoverySalt: string,
  // The ACCOUNT's kdf params, not this device's. Adopting copies the account's
  // recovery blob verbatim, so the format that blob was written in has to come
  // with it -- stamping today's default onto an account claimed before word
  // codes existed would make this device normalise its owner's perfectly good
  // character code the wrong way and refuse it on the next restore.
  accountKdfParams?: KdfParams
): Promise<{ previousKey: Uint8Array }> {
  const vault = await readVault();
  if (!vault) throw new Error('No vault on this device.');
  if (!deviceKey) throw new Error('The vault is locked -- cannot adopt an account key.');

  const previousKey = unwrapWith(vault.wrappedByDevice, deviceKey);
  const seed = unwrapWith(vault.wrappedDbSeedByDevice, deviceKey);

  await writeVault({
    ...vault,
    // Both re-wrapped under the SAME device key: it identifies the device, not
    // the account, so adopting an account key doesn't change it.
    wrappedByDevice: wrapWith(accountKey, deviceKey),
    wrappedDbSeedByDevice: wrapWith(seed, deviceKey),
    // The account's recovery material replaces this device's, because the
    // account key is now what needs recovering. This device's original
    // recovery code becomes meaningless and is discarded.
    wrappedByRecoveryCode: accountRecoveryWrapped,
    recoverySalt: accountRecoverySalt,
    kdfParams: accountKdfParams ?? { alg: RECOVERY_KDF_PARAMS.alg },
    recoveryUserId: userId,
    backedUp: true, // it came from the server by definition
    recoveryConfirmed: true,
  });

  dataKey = accountKey;
  dbSeed = seed;
  return { previousKey };
}

/**
 * This device's key material, ready to become the account's if the account
 * doesn't have one yet. Null until a recovery code exists, which is what
 * gates sign-in on the recovery step.
 */
export async function getKeyBackupPayload(): Promise<{
  wrappedByRecoveryCode: string;
  recoverySalt: string;
  kdfParams: KdfParams;
  fingerprint: string;
} | null> {
  const vault = await readVault();
  if (!vault?.wrappedByRecoveryCode || !vault.recoverySalt || !vault.recoveryConfirmed) {
    return null;
  }
  return {
    wrappedByRecoveryCode: vault.wrappedByRecoveryCode,
    recoverySalt: vault.recoverySalt,
    kdfParams: vault.kdfParams ?? RECOVERY_KDF_PARAMS,
    fingerprint: keyFingerprint(getDataKey()),
  };
}

/** Identifies the key this device currently holds, for comparison against
 *  the account's. Non-secret -- see keyFingerprint. */
export function getDataKeyFingerprint(): string {
  return keyFingerprint(getDataKey());
}

export async function markKeyBackedUp(): Promise<void> {
  const vault = await readVault();
  if (!vault) return;
  await writeVault({ ...vault, backedUp: true });
}

// --- SQLCipher -------------------------------------------------------------

const SQLCIPHER_INFO = utf8ToBytes('notes-sqlcipher-v1');

/**
 * The key SQLCipher opens notes-v2.db with, derived from dbSeed via HKDF.
 *
 * Domain separation is what makes one root secret safe to use twice: learning
 * the database key tells you nothing about the seed, and the seed is not the
 * data key, so the note-content key is two steps removed from the file key.
 *
 * Returned as hex because op-sqlite takes the key as a string.
 */
export function getDatabaseKey(): string {
  if (!dbSeed) {
    throw new Error('The vault is locked -- no database key available.');
  }
  return bytesToHex(hkdf(sha256, dbSeed, undefined, SQLCIPHER_INFO, 32));
}
