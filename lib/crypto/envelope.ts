import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes, utf8ToBytes, bytesToUtf8 } from '@noble/ciphers/utils.js';
import { base64ToBytes, bytesToBase64 } from './base64';

/**
 * The on-the-wire and at-rest format for every encrypted value in the app:
 *
 *     enc:v1:<base64 nonce (12 bytes)>:<base64 ciphertext || GCM tag>
 *
 * AES-256-GCM, with a fresh random nonce per encryption.
 *
 * WHY GCM AND NOT aes-js (which is already a dependency):
 * aes-js ships CBC, CTR, CFB, OFB and ECB -- none of them authenticated. With
 * an unauthenticated mode, an attacker who can modify stored bytes can flip
 * bits in the ciphertext and decryption still "succeeds", handing back
 * corrupted plaintext with no indication anything happened. GCM appends an
 * authentication tag, so tampering is a hard failure instead of silent
 * corruption. That same property is what lets the PIN screen detect a wrong
 * PIN (see keys.ts) without storing a PIN hash anywhere to be stolen.
 *
 * WHY THE VERSIONED PREFIX -- it earns its keep three separate times:
 *   1. Notes written before this stage are sitting in Postgres as plaintext.
 *      decrypt() passes anything without the prefix straight through, so old
 *      rows keep working and get encrypted the next time they're saved.
 *      Without this, enabling encryption would make every existing note
 *      unreadable.
 *   2. Stage 6's Phase 3 adversarial check becomes mechanical rather than a
 *      judgement call: every body in Postgres must start with `enc:v1:`.
 *   3. A future v2 (different cipher, different parameters) can coexist with
 *      v1 data instead of requiring a flag-day migration.
 *
 * NONCE REUSE is the one catastrophic mistake available in GCM -- encrypting
 * two different plaintexts under the same key and nonce leaks the XOR of the
 * plaintexts and destroys the authentication guarantee. Hence a fresh random
 * 12-byte nonce on every single call, never a counter, never derived from the
 * content.
 */

const PREFIX = 'enc:v1:';
const NONCE_BYTES = 12; // 96 bits -- the size GCM is actually specified for

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encrypt(plaintext: string, key: Uint8Array): string {
  if (key.length !== 32) {
    throw new Error(`Expected a 32-byte key, got ${key.length}`);
  }
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = gcm(key, nonce).encrypt(utf8ToBytes(plaintext));
  return `${PREFIX}${bytesToBase64(nonce)}:${bytesToBase64(ciphertext)}`;
}

/**
 * Returns `value` unchanged if it isn't an envelope -- see reason 1 above.
 * Throws if it IS an envelope but can't be authenticated, because at that
 * point the alternatives are worse: returning the raw ciphertext would put
 * gibberish in the editor and then save it over the real note.
 */
export function decrypt(value: string, key: Uint8Array): string {
  if (!isEncrypted(value)) return value;

  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 2) {
    throw new Error('Malformed encrypted value');
  }

  const nonce = base64ToBytes(parts[0]);
  const ciphertext = base64ToBytes(parts[1]);
  if (nonce.length !== NONCE_BYTES) {
    throw new Error(`Malformed nonce: expected ${NONCE_BYTES} bytes, got ${nonce.length}`);
  }

  // Throws on a bad tag -- wrong key, or tampered bytes. Deliberately not
  // caught here; callers decide what a decryption failure means for them.
  return bytesToUtf8(gcm(key, nonce).decrypt(ciphertext));
}
