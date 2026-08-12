import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, randomBytes, utf8ToBytes } from '@noble/ciphers/utils.js';
import { base64ToBytes, bytesToBase64 } from './base64';
import { decrypt, encrypt } from './envelope';
import { WORDLIST, WORD_INDEX } from './wordlist';

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

/**
 * How a recovery code is written down. NOT how the key is derived.
 *
 * 'crockford25' -- 25 Crockford base32 characters, five dashed groups, the
 *                  original format. Recorded as ABSENT on every blob written
 *                  before words existed, so a missing `format` means this one.
 * 'words12'     -- 12 words from lib/crypto/wordlist.
 */
export type RecoveryFormat = 'crockford25' | 'words12';

/** What a blob with no `format` recorded must be read as. */
export const LEGACY_RECOVERY_FORMAT: RecoveryFormat = 'crockford25';

/** The format newly issued codes are written in. */
export const CURRENT_RECOVERY_FORMAT: RecoveryFormat = 'words12';

// Travels with the blob (kdf_params in user_keys, and KdfParams below) rather
// than being implied by the code, so a future change of derivation doesn't
// strand existing wrapped keys.
//
// `format` was added when codes became words. It is optional on the type
// because it is genuinely absent from every record written before that, and
// those records must keep opening with the codes people already wrote down --
// the key derivation eats the NORMALISED STRING, so a change of alphabet is a
// change of key. Everything that reads it goes through resolveRecoveryFormat.
export const RECOVERY_KDF_PARAMS = {
  alg: 'hkdf-sha256' as const,
  format: 'words12' as const,
};

export type KdfParams = {
  alg: 'hkdf-sha256';
  format?: RecoveryFormat;
};

/** The format a stored blob was written in. Absent means the original. */
export function resolveRecoveryFormat(params: KdfParams | null | undefined): RecoveryFormat {
  return params?.format ?? LEGACY_RECOVERY_FORMAT;
}

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

/**
 * NOTE the keying material: the NORMALISED STRING, not raw bytes. That is why
 * `format` has to travel with every stored blob -- normalising the same typed
 * characters under a different format gives a different string, hence a
 * different key, hence a blob that will not open. See resolveRecoveryFormat.
 */
function deriveKeyFromRecoveryCode(
  code: string,
  salt: string,
  format: RecoveryFormat
): Uint8Array {
  return hkdf(
    sha256,
    utf8ToBytes(normalizeRecoveryCode(code, format)),
    base64ToBytes(salt),
    RECOVERY_INFO,
    32
  );
}

// `format` is REQUIRED on both of these, with no default, and that is worth a
// note because a default would be more convenient.
//
// The first draft gave wrap 'words12' and unwrap the legacy format -- each
// sensible alone, and together a pair whose defaults silently disagree.
// scripts/verify-crypto.ts caught it immediately by wrapping and unwrapping
// the same key and getting WrongRecoveryCodeError. A default here cannot be
// right for both new codes and old blobs, and picking either one turns a
// mistake at a call site into a wrong key rather than a compile error. So
// every caller says which format it means.
export function wrapDataKeyWithRecoveryCode(
  dataKey: Uint8Array,
  code: string,
  salt: string,
  format: RecoveryFormat
): string {
  return encrypt(bytesToBase64(dataKey), deriveKeyFromRecoveryCode(code, salt, format));
}

export function unwrapDataKeyWithRecoveryCode(
  wrapped: string,
  code: string,
  salt: string,
  format: RecoveryFormat
): Uint8Array {
  try {
    return base64ToBytes(decrypt(wrapped, deriveKeyFromRecoveryCode(code, salt, format)));
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

/** Words in a current-format code: 12 x 11 bits = 132 bits. */
export const RECOVERY_WORDS = 12;

/**
 * A new recovery code, in the current format: 12 words, 132 bits.
 *
 * More entropy than the 125 bits the character format carried, and far easier
 * to transcribe -- which is the failure that actually loses people their
 * notes, not brute force. Brute force was never a threat model at either size.
 *
 * Sampling is rejection-based rather than `% 2048`, because the modulo of a
 * uniform byte pair over 2048 is NOT uniform and would quietly bias the first
 * words of every code. Reading 11 bits at a time out of a bit buffer is the
 * other correct answer; this one is simply easier to read and to be sure of.
 */
export function generateRecoveryCode(): string {
  const words: string[] = [];

  while (words.length < RECOVERY_WORDS) {
    const bytes = randomBytes(2 * (RECOVERY_WORDS - words.length) + 8);
    for (let i = 0; i + 1 < bytes.length && words.length < RECOVERY_WORDS; i += 2) {
      // 16 bits -> keep the low 11, discard anything above the list. 2048 is
      // exactly 2^11, so nothing is ever discarded; the guard exists so this
      // stays correct if the list is ever a different size.
      const value = ((bytes[i] << 8) | bytes[i + 1]) & 0x7ff;
      if (value < WORDLIST.length) words.push(WORDLIST[value]);
    }
  }

  return words.join('-');
}

/** The original 125-bit character format. Kept only to read old blobs and for
 *  the tests that pin its behaviour -- nothing issues one any more. */
export function generateLegacyRecoveryCode(): string {
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
 * Accepts what a human actually types, and produces the ONE string that gets
 * fed to the key derivation.
 *
 * This function is the compatibility boundary. Its output for a given format
 * can never change: it is the HKDF input keying material, so a different
 * string is a different key, and every recovery code already written down
 * would stop opening its blob. Presentation may change freely -- how the code
 * is grouped, spaced or cased on screen is not an input here.
 *
 * words12     -- lowercase, split on anything that is not a letter, rejoined
 *                with single dashes. So spaces, dashes, newlines, stray
 *                capitals and a trailing separator all land on one string.
 * crockford25 -- upper case, non-alphanumerics dropped, and the classic
 *                confusions folded back (I and L are 1, O is zero).
 */
export function normalizeRecoveryCode(
  code: string,
  format: RecoveryFormat = 'words12'
): string {
  if (format === 'words12') {
    return code
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean)
      .join('-');
  }

  return code
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

/** Whether this could be a code at all, before spending a decryption on it. */
export function isWellFormedRecoveryCode(
  code: string,
  format: RecoveryFormat = 'words12'
): boolean {
  const normalized = normalizeRecoveryCode(code, format);

  if (format === 'words12') {
    const words = normalized.split('-').filter(Boolean);
    return words.length === RECOVERY_WORDS && words.every((w) => WORD_INDEX.has(w));
  }

  return (
    normalized.length === RECOVERY_CHARS &&
    [...normalized].every((c) => CROCKFORD.includes(c))
  );
}

/** Is this a word from the list? Used per slot while typing, so the wrong one
 *  is caught where it was typed rather than after all twelve. */
export function isRecoveryWord(word: string): boolean {
  return WORD_INDEX.has(word.trim().toLowerCase());
}

/**
 * Words from the list starting with `prefix`, for the entry field's
 * suggestions. Capped, because a one-letter prefix matches well over a
 * hundred and nobody reads past a few.
 */
export function suggestRecoveryWords(prefix: string, limit = 3): string[] {
  const p = prefix.trim().toLowerCase();
  if (!p) return [];
  const out: string[] = [];
  for (const word of WORDLIST) {
    if (word.startsWith(p)) {
      out.push(word);
      if (out.length === limit) break;
    }
  }
  return out;
}
