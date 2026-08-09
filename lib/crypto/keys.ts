import { scrypt } from '@noble/hashes/scrypt.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes, utf8ToBytes } from '@noble/ciphers/utils.js';
import { base64ToBytes, bytesToBase64 } from './base64';
import { decrypt, encrypt } from './envelope';

/**
 * The key model, in one place:
 *
 *   dataKey   32 random bytes. Encrypts every note. NEVER stored raw, anywhere.
 *
 *   locally   SecureStore holds an envelope of dataKey wrapped under
 *             scrypt(PIN, salt). See vault.ts.
 *
 *   server    public.user_keys.recovery_wrapped_key holds an envelope of the
 *             SAME dataKey wrapped under hkdf(recovery code). That's what
 *             lets a second device decrypt notes it never created.
 *
 * WHY TWO DIFFERENT KDFs -- this is the part worth internalising.
 *
 * A KDF turns a secret into a key. When the secret is *low entropy*, like a
 * 6-digit PIN (a million possibilities), the KDF's job is to be deliberately
 * slow and memory-hungry, so an attacker guessing all million pays a million
 * times that cost. That's scrypt, and it's why the PIN path takes ~1 second
 * on purpose.
 *
 * When the secret is *high entropy*, like the 125-bit recovery code, there is
 * nothing to stretch -- no attacker is enumerating 2^125 candidates no matter
 * how fast the function is. Stretching there would cost seconds of real user
 * time and buy exactly nothing. So the recovery path uses HKDF, which is fast
 * by design and is the right tool for deriving a key from material that's
 * already unguessable.
 *
 * Choosing scrypt for both would look more "secure" and would in fact just be
 * slower. Choosing HKDF for both would be a genuine vulnerability.
 *
 * ACCEPTED LIMIT, on the record: the 6-digit PIN protects the *local* wrapped
 * key, where the OS keychain is the real barrier. It deliberately does not
 * protect anything stored server-side -- no scrypt parameter makes a million
 * candidates safe against an attacker running native GPU code on a stolen
 * database. That's why the server blob is wrapped under the recovery code and
 * never under the PIN.
 */

// Versioned so a future cost increase can be rolled out without stranding
// existing wrapped keys: the parameters travel with the blob (kdf_params in
// user_keys, and KdfParams below) rather than being implied by the code.
export const SCRYPT_PARAMS = {
  alg: 'scrypt' as const,
  N: 2 ** 14, // ~890ms under Node; re-confirmed on-device before shipping
  r: 8,
  p: 1,
  dkLen: 32,
};

export type KdfParams = typeof SCRYPT_PARAMS;

export const SALT_BYTES = 16;

export class WrongPinError extends Error {
  constructor() {
    super('That PIN is incorrect.');
    this.name = 'WrongPinError';
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

export function generateSalt(): string {
  return bytesToBase64(randomBytes(SALT_BYTES));
}

// --- PIN path (low entropy -> deliberately slow) ---------------------------

function deriveKeyFromPin(pin: string, salt: string, params: KdfParams = SCRYPT_PARAMS) {
  return scrypt(utf8ToBytes(pin), base64ToBytes(salt), {
    N: params.N,
    r: params.r,
    p: params.p,
    dkLen: params.dkLen,
  });
}

export function wrapDataKeyWithPin(
  dataKey: Uint8Array,
  pin: string,
  salt: string,
  params: KdfParams = SCRYPT_PARAMS
): string {
  return encrypt(bytesToBase64(dataKey), deriveKeyFromPin(pin, salt, params));
}

export function unwrapDataKeyWithPin(
  wrapped: string,
  pin: string,
  salt: string,
  params: KdfParams = SCRYPT_PARAMS
): Uint8Array {
  try {
    return base64ToBytes(decrypt(wrapped, deriveKeyFromPin(pin, salt, params)));
  } catch {
    // A GCM tag mismatch IS the wrong-PIN signal. Nothing derived from the
    // PIN is stored for comparison, so there is no PIN hash on the device to
    // steal or to brute-force offline -- the only way to test a guess is to
    // attempt the unwrap and pay the scrypt cost.
    throw new WrongPinError();
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
