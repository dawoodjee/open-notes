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
  SCRYPT_PARAMS,
  generateDataKey,
  generateRecoveryCode,
  generateSalt,
  unwrapDataKeyWithPin,
  unwrapDataKeyWithRecoveryCode,
  wrapDataKeyWithPin,
  wrapDataKeyWithRecoveryCode,
} from './keys';

/**
 * Everything that persists the vault, and the in-memory unlocked state.
 *
 * Split from keys.ts on purpose: keys.ts is pure computation with no Expo or
 * React Native imports, which is what lets scripts/verify-crypto.ts exercise
 * the real code under Node. This file is the part that can only run on a
 * device, and it's deliberately thin so there's little here that isn't
 * covered by that script.
 */

const VAULT_KEY = 'notes.vault.v1';

interface StoredVault {
  /** The data key, wrapped under scrypt(PIN). */
  wrappedByPin: string;
  pinSalt: string;
  /**
   * The same data key, wrapped under the recovery code.
   *
   * Held locally as well as server-side because PIN setup happens on first
   * launch, BEFORE any account exists -- there is no user_keys row to write
   * to yet. It's uploaded the first time the user signs in (see
   * lib/crypto/keyBackup.ts). Keeping it here is not a weakness: it's already
   * wrapped, and it sits in the Keychain next to the PIN-wrapped copy.
   */
  wrappedByRecoveryCode: string;
  recoverySalt: string;
  /** Travels with the blob so a future cost bump doesn't strand old vaults. */
  kdfParams: KdfParams;
  /** Whether wrappedByRecoveryCode has made it to public.user_keys yet. */
  backedUp: boolean;
}

// --- in-memory unlocked state ----------------------------------------------
//
// Module-level rather than React state, mirroring lib/auth/currentUser.ts:
// lib/powersync/connector.ts needs the key from inside uploadData(), which
// has no component and no render cycle to read from.
//
// The key deliberately STAYS here while the app is locked (a Stage 6 decision
// taken knowingly). What that does and doesn't buy: a device that's powered
// off, or picked up casually by someone else, is protected -- the key is only
// ever reconstructed from the PIN. A memory dump of a running, locked app is
// not protected. The upside is that sync keeps working in the background
// while locked, which is what a notes app should do.
let dataKey: Uint8Array | null = null;

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
 *  inherit the previous one's key. Locking the screen does not call this. */
export function forgetDataKey(): void {
  if (dataKey) dataKey.fill(0);
  dataKey = null;
}

// --- persistence ------------------------------------------------------------

async function readVault(): Promise<StoredVault | null> {
  const raw = await SecureStore.getItemAsync(VAULT_KEY);
  return raw ? (JSON.parse(raw) as StoredVault) : null;
}

async function writeVault(vault: StoredVault): Promise<void> {
  // Comfortably inside SecureStore's ~2KB per-value cap: two envelopes of a
  // 32-byte key plus two salts is well under 600 bytes. (Contrast
  // lib/supabase/client.ts, where a full session blew past the cap and needed
  // the LargeSecureStore workaround.)
  await SecureStore.setItemAsync(VAULT_KEY, JSON.stringify(vault));
}

export async function hasVault(): Promise<boolean> {
  return (await readVault()) !== null;
}

/**
 * First launch. Mints the data key, wraps it twice, and returns the recovery
 * code -- the ONLY time it is ever available in plaintext. It is not stored
 * anywhere in readable form, so if the user doesn't write it down here, it
 * genuinely cannot be produced again.
 *
 * Leaves the vault unlocked, since the user just proved they know the PIN.
 */
export async function createVault(pin: string): Promise<{ recoveryCode: string }> {
  const key = generateDataKey();
  const pinSalt = generateSalt();
  const recoverySalt = generateSalt();
  const recoveryCode = generateRecoveryCode();

  await writeVault({
    wrappedByPin: wrapDataKeyWithPin(key, pin, pinSalt, SCRYPT_PARAMS),
    pinSalt,
    wrappedByRecoveryCode: wrapDataKeyWithRecoveryCode(key, recoveryCode, recoverySalt),
    recoverySalt,
    kdfParams: SCRYPT_PARAMS,
    backedUp: false,
  });

  dataKey = key;
  return { recoveryCode };
}

/** Throws WrongPinError on a bad PIN -- see unwrapDataKeyWithPin. */
export async function unlockWithPin(pin: string): Promise<void> {
  const vault = await readVault();
  if (!vault) throw new Error('No vault on this device.');
  dataKey = unwrapDataKeyWithPin(vault.wrappedByPin, pin, vault.pinSalt, vault.kdfParams);
}

/**
 * Change PIN is a RE-WRAP, not a re-encryption. The data key is unchanged, so
 * every note's ciphertext is byte-identical afterwards and nothing is queued
 * for upload. Only the ~200-byte blob in the Keychain changes.
 *
 * Throws WrongPinError if the old PIN is wrong, before anything is written.
 */
export async function changePin(oldPin: string, newPin: string): Promise<void> {
  const vault = await readVault();
  if (!vault) throw new Error('No vault on this device.');

  const key = unwrapDataKeyWithPin(vault.wrappedByPin, oldPin, vault.pinSalt, vault.kdfParams);
  const pinSalt = generateSalt();

  await writeVault({
    ...vault,
    wrappedByPin: wrapDataKeyWithPin(key, newPin, pinSalt, SCRYPT_PARAMS),
    pinSalt,
    kdfParams: SCRYPT_PARAMS,
  });

  dataKey = key;
}

/**
 * Second device: the account's key blob came down from user_keys, and the
 * recovery code unwraps it. Establishes a local vault with a fresh PIN so
 * subsequent unlocks on this device don't need the code again.
 *
 * Throws WrongRecoveryCodeError if the code doesn't match.
 */
export async function restoreVaultFromRecovery(
  wrappedByRecoveryCode: string,
  recoverySalt: string,
  recoveryCode: string,
  newPin: string
): Promise<void> {
  const key = unwrapDataKeyWithRecoveryCode(wrappedByRecoveryCode, recoveryCode, recoverySalt);
  const pinSalt = generateSalt();

  await writeVault({
    wrappedByPin: wrapDataKeyWithPin(key, newPin, pinSalt, SCRYPT_PARAMS),
    pinSalt,
    wrappedByRecoveryCode,
    recoverySalt,
    kdfParams: SCRYPT_PARAMS,
    backedUp: true, // it came from the server, so it's by definition already there
  });

  dataKey = key;
}

/** What Phase 3's upload step needs, and the flag it flips afterwards. */
export async function getPendingKeyBackup(): Promise<{
  wrappedByRecoveryCode: string;
  recoverySalt: string;
  kdfParams: KdfParams;
} | null> {
  const vault = await readVault();
  if (!vault || vault.backedUp) return null;
  return {
    wrappedByRecoveryCode: vault.wrappedByRecoveryCode,
    recoverySalt: vault.recoverySalt,
    kdfParams: vault.kdfParams,
  };
}

export async function markKeyBackedUp(): Promise<void> {
  const vault = await readVault();
  if (!vault) return;
  await writeVault({ ...vault, backedUp: true });
}

// --- SQLCipher -------------------------------------------------------------

const SQLCIPHER_INFO = utf8ToBytes('notes-sqlcipher-v1');

/**
 * The key SQLCipher opens notes.db with, derived from the data key rather
 * than generated separately.
 *
 * One root secret, two uses, kept cryptographically independent by HKDF's
 * domain separation -- learning the database key tells you nothing about the
 * note-content key, and vice versa. The alternative, a second random key with
 * its own storage and its own recovery story, is more moving parts for no
 * benefit: both are lost together anyway if the vault is lost.
 *
 * Returned as hex because op-sqlite takes the key as a string.
 */
export function getDatabaseKey(): string {
  return bytesToHex(hkdf(sha256, getDataKey(), undefined, SQLCIPHER_INFO, 32));
}
