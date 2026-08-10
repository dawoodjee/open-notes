/**
 * Phase 1 verification (Stage 6): the crypto primitives every note now
 * depends on.
 *
 * SCOPE NOTE, and it's a genuinely better one than Stage 5 could offer:
 * this exercises the REAL lib/crypto modules, not a transcription of them.
 * @noble/ciphers and @noble/hashes are dependency-free TypeScript with no
 * native module and no React Native imports, so the exact code the app runs
 * also runs here under Node. (Compare scripts/verify-merge-two-devices.ts,
 * which had to restate uploadEntry because the connector pulls in
 * expo-secure-store.) lib/crypto/vault.ts is the only part not covered here,
 * because it is pure expo-secure-store I/O -- that gets verified on device.
 *
 * Run: npx tsx scripts/verify-crypto.ts
 */
import { randomBytes } from '@noble/ciphers/utils.js';
import { base64ToBytes, bytesToBase64 } from '../lib/crypto/base64';
import { decrypt, encrypt, isEncrypted } from '../lib/crypto/envelope';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/ciphers/utils.js';
import {
  WrongRecoveryCodeError,
  generateDataKey,
  generateDeviceKey,
  generateRecoveryCode,
  generateSalt,
  isWellFormedRecoveryCode,
  normalizeRecoveryCode,
  unwrapDataKeyWithRecoveryCode,
  unwrapWith,
  wrapDataKeyWithRecoveryCode,
  wrapWith,
} from '../lib/crypto/keys';

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => b[i] === byte);

let failed = 0;

function check(name: string, condition: boolean, detail = '') {
  if (!condition) failed++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
}

function throws(name: string, fn: () => unknown, expectedName?: string) {
  try {
    fn();
    check(name, false, 'expected a throw, got a return value');
  } catch (err: any) {
    const ok = !expectedName || err?.name === expectedName;
    check(name, ok, `threw ${err?.name}: ${err?.message}`);
  }
}

// --- base64 -----------------------------------------------------------------
console.log('\n--- base64 ---');
{
  // Every length 0..64 covers all three padding cases many times over.
  let allRoundTripped = true;
  for (let len = 0; len <= 64; len++) {
    const original = randomBytes(len);
    const back = base64ToBytes(bytesToBase64(original));
    if (back.length !== original.length || !original.every((b, i) => back[i] === b)) {
      allRoundTripped = false;
      console.log(`      mismatch at length ${len}`);
    }
  }
  check('round-trips every length 0..64', allRoundTripped);

  // Cross-check against Node's own implementation -- if these ever disagree,
  // the hand-rolled codec is wrong, not Node.
  const sample = randomBytes(300);
  check(
    'agrees with Node Buffer base64',
    bytesToBase64(sample) === Buffer.from(sample).toString('base64'),
    bytesToBase64(sample).slice(0, 32) + '...'
  );

  throws('rejects non-base64 input', () => base64ToBytes('not valid base64!!'));
}

// --- envelope ---------------------------------------------------------------
console.log('\n--- envelope (AES-256-GCM) ---');
{
  const key = generateDataKey();
  const plaintext = '<p>Alpha one</p><p>Beta two</p>';
  const envelope = encrypt(plaintext, key);

  check('output carries the enc:v1: prefix', isEncrypted(envelope), envelope.slice(0, 48) + '...');
  check('round-trips', decrypt(envelope, key) === plaintext);

  // Reason 1 the prefix exists: notes written before this stage.
  check('passes legacy plaintext through untouched', decrypt(plaintext, key) === plaintext);
  check('unicode survives', decrypt(encrypt('héllo 🔐 世界', key), key) === 'héllo 🔐 世界');
  check('empty string survives', decrypt(encrypt('', key), key) === '');

  throws('rejects the wrong key', () => decrypt(envelope, generateDataKey()));

  // Flip one bit of the ciphertext. Without GCM's tag this would decrypt to
  // corrupted text and nobody would know.
  const [, , nonceB64, ctB64] = envelope.split(':');
  const tampered = base64ToBytes(ctB64);
  tampered[0] ^= 0x01;
  throws('rejects a single flipped ciphertext bit', () =>
    decrypt(`enc:v1:${nonceB64}:${bytesToBase64(tampered)}`, key)
  );

  throws('rejects a malformed envelope', () => decrypt('enc:v1:onlyonepart', key));
  throws('rejects a short key', () => encrypt('x', randomBytes(16)));

  // Nonce reuse is the one catastrophic misuse available in GCM.
  const nonces = new Set<string>();
  for (let i = 0; i < 1000; i++) nonces.add(encrypt('same plaintext every time', key).split(':')[2]);
  check('1000 encryptions produce 1000 distinct nonces', nonces.size === 1000, `${nonces.size} unique`);

  // Same plaintext, same key -> different bytes. This is what makes Phase 2's
  // "does a no-op re-save look like an edit?" question worth asking at all.
  check(
    'same plaintext encrypts to different ciphertext each time',
    encrypt('identical', key) !== encrypt('identical', key)
  );
}

// --- device-key wrapping ----------------------------------------------------
console.log('\n--- device-key wrap ---');
{
  const dataKey = generateDataKey();
  const deviceKey = generateDeviceKey();

  const wrapped = wrapWith(dataKey, deviceKey);
  check('unwraps to the identical data key', sameBytes(unwrapWith(wrapped, deviceKey), dataKey));

  throws('a different device key is rejected', () =>
    unwrapWith(wrapped, generateDeviceKey()), 'UnwrapError'
  );
  check(
    'the raw data key never appears in the wrapped blob',
    !wrapped.includes(bytesToBase64(dataKey))
  );

  // No KDF here on purpose. The device key is 32 random bytes rather than
  // anything a user types, so there is no low-entropy input to stretch and
  // scrypt would cost seconds to buy nothing. (Reintroduce a typed secret and
  // that reasoning inverts -- see the header comment in lib/crypto/keys.ts.)
  const started = Date.now();
  for (let i = 0; i < 100; i++) unwrapWith(wrapped, deviceKey);
  const unwrapMs = Date.now() - started;
  check(
    `100 unwraps cost ${unwrapMs}ms`,
    unwrapMs < 500,
    'unlock is not allowed to be slow any more -- nothing is being stretched'
  );
}

// --- recovery code ----------------------------------------------------------
console.log('\n--- recovery code (HKDF) ---');
{
  const dataKey = generateDataKey();
  const salt = generateSalt();
  const code = generateRecoveryCode();

  check('formatted as five groups of five', /^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/.test(code), code);
  check('recognised as well-formed', isWellFormedRecoveryCode(code));
  check('125 bits of entropy', normalizeRecoveryCode(code).length * 5 === 125);

  const codes = new Set<string>();
  for (let i = 0; i < 1000; i++) codes.add(generateRecoveryCode());
  check('1000 generated codes are all distinct', codes.size === 1000);

  const wrapped = wrapDataKeyWithRecoveryCode(dataKey, code, salt);
  const unwrapped = unwrapDataKeyWithRecoveryCode(wrapped, code, salt);
  check(
    'unwraps to the identical data key',
    unwrapped.length === dataKey.length && dataKey.every((b, i) => unwrapped[i] === b)
  );

  // What someone actually types off a piece of paper.
  const mangled = code.toLowerCase().replace(/-/g, ' ');
  const viaMangled = unwrapDataKeyWithRecoveryCode(wrapped, mangled, salt);
  check('accepts lowercase with spaces instead of dashes', dataKey.every((b, i) => viaMangled[i] === b));

  check('folds I and L to 1, O to 0', normalizeRecoveryCode('ILO12') === '11012');

  throws(
    'wrong recovery code is rejected',
    () => unwrapDataKeyWithRecoveryCode(wrapped, generateRecoveryCode(), salt),
    'WrongRecoveryCodeError'
  );

  // The server blob is derived from the recovery code and nothing else. No
  // local unlock factor has ever been able to open it, which is why moving
  // unlock to the device credential changed nothing about this guarantee.
  throws('a short guess cannot unwrap the recovery blob', () =>
    unwrapDataKeyWithRecoveryCode(wrapped, '123456', salt)
  );
}

// --- the two wrapped copies are of the SAME key ------------------------------
console.log('\n--- cross-check ---');
{
  const dataKey = generateDataKey();
  const deviceKey = generateDeviceKey();
  const recoverySalt = generateSalt();
  const code = generateRecoveryCode();

  const viaDevice = unwrapWith(wrapWith(dataKey, deviceKey), deviceKey);
  const viaCode = unwrapDataKeyWithRecoveryCode(
    wrapDataKeyWithRecoveryCode(dataKey, code, recoverySalt),
    code,
    recoverySalt
  );

  check('device path and recovery path yield the same data key', sameBytes(viaDevice, viaCode));

  // A note encrypted on device A must open on device B, which only ever saw
  // the recovery-wrapped copy. That is the whole premise of cross-device sync.
  const note = '<p>written on device A</p>';
  check(
    'a note encrypted under one path decrypts under the other',
    decrypt(encrypt(note, viaDevice), viaCode) === note
  );
}

// --- adopting an account key --------------------------------------------
//
// The single most dangerous operation in the vault, and the reason it gets its
// own section. adoptAccountDataKey() REPLACES the data key, so every wrapping
// of it has to be rewritten in the same pass. Miss the device wrapping and the
// next launch unlocks silently into the old key -- no error, no prompt, just
// notes that won't decrypt. Meanwhile the database seed must NOT change, or
// the open SQLCipher file stops opening.
//
// Transcribed rather than imported: lib/crypto/vault.ts pulls in
// expo-secure-store and can't run under Node. What's modelled here is exactly
// the field-by-field rewrite that function performs.
console.log('\n--- adopt account key ---');
{
  const SQLCIPHER_INFO = utf8ToBytes('notes-sqlcipher-v1');
  const databaseKeyFrom = (seed: Uint8Array) =>
    bytesToHex(hkdf(sha256, seed, undefined, SQLCIPHER_INFO, 32));

  const deviceKey = generateDeviceKey();
  const ownKey = generateDataKey();
  const dbSeed = generateDataKey();

  // Before: this device holds its own key, minted at first launch.
  let wrappedByDevice = wrapWith(ownKey, deviceKey);
  const wrappedDbSeedByDevice = wrapWith(dbSeed, deviceKey);
  const databaseKeyBefore = databaseKeyFrom(unwrapWith(wrappedDbSeedByDevice, deviceKey));

  // A note that already exists on the account, written elsewhere under the
  // account's key -- the thing adoption exists to make readable.
  const accountKey = generateDataKey();
  const accountNote = '<p>written on the other device</p>';
  const accountCiphertext = encrypt(accountNote, accountKey);

  check(
    'before adopting, the account note is unreadable here',
    (() => {
      try {
        decrypt(accountCiphertext, unwrapWith(wrappedByDevice, deviceKey));
        return false;
      } catch {
        return true;
      }
    })()
  );

  // Adopt: re-wrap under the SAME device key (it identifies the device, not
  // the account), leaving the seed alone.
  wrappedByDevice = wrapWith(accountKey, deviceKey);

  check(
    'the device wrapping now yields the ACCOUNT key, not the old one',
    sameBytes(unwrapWith(wrappedByDevice, deviceKey), accountKey)
  );
  check(
    'the old key is genuinely gone from the device wrapping',
    !sameBytes(unwrapWith(wrappedByDevice, deviceKey), ownKey)
  );
  check(
    'the account note now decrypts on this device',
    decrypt(accountCiphertext, unwrapWith(wrappedByDevice, deviceKey)) === accountNote
  );
  check(
    'the database key is byte-identical, so the open file still opens',
    databaseKeyFrom(unwrapWith(wrappedDbSeedByDevice, deviceKey)) === databaseKeyBefore
  );

  // The negative case, which is what proves the checks above have teeth: had
  // the device wrapping been left pointing at the old key, this is the silent
  // failure that would have shipped.
  const staleWrapping = wrapWith(ownKey, deviceKey);
  check(
    'a stale device wrapping would fail to read the account note',
    (() => {
      try {
        decrypt(accountCiphertext, unwrapWith(staleWrapping, deviceKey));
        return false;
      } catch {
        return true;
      }
    })()
  );
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${failed} failing check(s)`);
process.exit(failed === 0 ? 0 : 1);
