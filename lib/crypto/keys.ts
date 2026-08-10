import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, randomBytes, utf8ToBytes } from '@noble/ciphers/utils.js';
import { base64ToBytes, bytesToBase64 } from './base64';
import { decrypt, encrypt } from './envelope';

/**
 * The key model, in one place:
 *
 *   dataKey   32 random bytes. Encrypts every note. NEVER stored raw, anywhere.
 *
 *   locally   SecureStore holds an envelope of dataKey wrapped under a random
 *             32-byte device key, which itself lives in the OS keychain. See
 *             vault.ts.
 *
 *   server    public.user_keys.recovery_wrapped_key holds an envelope of the
 *             SAME dataKey wrapped under hkdf(recovery code). That's what
 *             lets a second device decrypt notes it never created.
 *
 * WHY THERE IS NO PASSWORD KDF HERE ANY MORE.
 *
 * A KDF that is deliberately slow -- scrypt, argon2, pbkdf2 -- exists for one
 * situation: the secret is *low entropy* and an attacker can guess candidates
 * offline. A 6-digit PIN is exactly that (a million possibilities), so the
 * earlier design paid ~1 second per unlock to make a million guesses expensive.
 *
 * Both secrets in the model above are now *high entropy* -- 32 random bytes and
 * a 125-bit recovery code. Nobody enumerates 2^125 candidates however fast the
 * function is, so stretching would cost real user time and buy exactly nothing.
 * HKDF is the right tool for deriving a key from material that is already
 * unguessable, and it is what both paths use.
 *
 * The reverse mistake is the dangerous one: HKDF over a low-entropy secret is
 * a genuine vulnerability. If a password-shaped secret is ever reintroduced
 * here, it needs scrypt back, not this.
 *
 * ON THE RECORD, since it was a deliberate call: unlock is now the device's own
 * credential (see lib/auth/deviceAuth.ts), which is a gate rather than a
 * cryptographic binding. The at-rest protection for the local key is the OS
 * keychain plus SQLCipher; the server-side blob is protected by the recovery
 * code and nothing else. No local unlock factor has ever protected the
 * server-side blob, and none does now.
 */

// Travels with the blob (kdf_params in user_keys, and KdfParams below) rather
// than being implied by the code, so a future change of derivation doesn't
// strand existing wrapped keys.
export const RECOVERY_KDF_PARAMS = {
  alg: 'hkdf-sha256' as const,
};

export type KdfParams = typeof RECOVERY_KDF_PARAMS;

export const SALT_BYTES = 16;

/**
 * A wrapped blob would not open with the key we had.
 *
 * Always an authentication-tag failure from AES-GCM rather than a guess, so it
 * genuinely means "wrong key or tampered ciphertext" -- there is no separately
 * stored hash to compare against, and nothing to brute-force offline.
 */
export class UnwrapError extends Error {
  constructor() {
    super('That key could not open this data.');
    this.name = 'UnwrapError';
  }
}

export class WrongRecoveryCodeError extends Error {
  constructor() {
    super("That recovery code doesn't match this account.");
    this.name = 'WrongRecoveryCodeError';
  }
}

export function generateDataKey(): Uint8Array {
  return randomBytes(32);
}

const FINGERPRINT_INFO = utf8ToBytes('notes-key-fingerprint-v1');

/**
 * A short, non-secret tag identifying a data key.
 *
 * Exists to answer one question cheaply: "is the key this device holds the
 * same one this account already uses?" Comparing the wrapped blobs cannot
 * answer it -- different salts and nonces make two wrappings of the SAME key
 * look entirely different -- and comparing raw keys would mean putting a raw
 * key somewhere it can be compared, which is the one thing this design never
 * does.
 *
 * Safe to store server-side and to log: HKDF is one-way, and 16 bytes of
 * output reveals nothing usable about a 32-byte input.
 */
export function keyFingerprint(dataKey: Uint8Array): string {
  return bytesToHex(hkdf(sha256, dataKey, undefined, FINGERPRINT_INFO, 16));
}

export function generateSalt(): string {
  return bytesToBase64(randomBytes(SALT_BYTES));
}

// --- Device-key path -------------------------------------------------------

/**
 * The device key: 32 random bytes that wrap this device's copy of the data
 * key. Stored in the OS keychain by vault.ts, never derived from anything the
 * user types, and never leaves the device.
 */
export function generateDeviceKey(): Uint8Array {
  return randomBytes(32);
}

/** Wrap/unwrap an arbitrary 32-byte secret under an already-derived key. */
export function wrapWith(secret: Uint8Array, wrappingKey: Uint8Array): string {
  return encrypt(bytesToBase64(secret), wrappingKey);
}

export function unwrapWith(blob: string, wrappingKey: Uint8Array): Uint8Array {
  try {
    return base64ToBytes(decrypt(blob, wrappingKey));
  } catch {
    throw new UnwrapError();
  }
}

// --- Recovery-code path (high entropy -> fast is correct) ------------------

// The `info` string domain-separates this derivation: the same recovery code
// used for some other purpose later would produce an unrelated key. noble
// requires it as bytes, not a string -- its TypeScript signature accepts both
// but the runtime asserts Uint8Array.
const RECOVERY_INFO = utf8ToBytes('notes-recovery-v1');

function deriveKeyFromRecoveryCode(code: string, salt: string): Uint8Array {
  return hkdf(
    sha256,
    utf8ToBytes(normalizeRecoveryCode(code)),
    base64ToBytes(salt),
    RECOVERY_INFO,
    32
  );
}

export function wrapDataKeyWithRecoveryCode(
  dataKey: Uint8Array,
  code: string,
  salt: string
): string {
  return encrypt(bytesToBase64(dataKey), deriveKeyFromRecoveryCode(code, salt));
}

export function unwrapDataKeyWithRecoveryCode(
  wrapped: string,
  code: string,
  salt: string
): Uint8Array {
  try {
    return base64ToBytes(decrypt(wrapped, deriveKeyFromRecoveryCode(code, salt)));
  } catch {
    throw new WrongRecoveryCodeError();
  }
}

// --- Recovery code format --------------------------------------------------

// Crockford base32: no I, L, O or U. The first three are dropped because they
// are indistinguishable from 1, 1 and 0 in most fonts, and this is a string
// people copy onto paper by hand and type back months later. U is dropped so
// a random code can't spell something unfortunate.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_CHARS = 25; // 25 chars x 5 bits = 125 bits

/**
 * 125 bits, formatted as five groups of five. Long enough that brute force is
 * not a threat model at all -- which is exactly why the server-side wrapped
 * key hangs off this and not off the PIN.
 */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(16); // 128 bits; we consume 125
  let bits = 0;
  let buffer = 0;
  let out = '';

  for (let i = 0; i < bytes.length && out.length < RECOVERY_CHARS; i++) {
    buffer = (buffer << 8) | bytes[i];
    bits += 8;
    while (bits >= 5 && out.length < RECOVERY_CHARS) {
      bits -= 5;
      out += CROCKFORD[(buffer >> bits) & 0x1f];
    }
  }

  return out.match(/.{1,5}/g)!.join('-');
}

/**
 * Accepts what a human actually types: any case, with or without the dashes,
 * and with the classic confusions folded back (I and L are 1, O is zero).
 * Normalising here rather than at the input field means the same rules apply
 * to key derivation no matter which screen the code came from.
 */
export function normalizeRecoveryCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

export function isWellFormedRecoveryCode(code: string): boolean {
  const normalized = normalizeRecoveryCode(code);
  return (
    normalized.length === RECOVERY_CHARS &&
    [...normalized].every((c) => CROCKFORD.includes(c))
  );
}
