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
import {
  SCRYPT_PARAMS,
  WrongPinError,
  WrongRecoveryCodeError,
  generateDataKey,
  generateRecoveryCode,
  generateSalt,
  isWellFormedRecoveryCode,
  normalizeRecoveryCode,
  unwrapDataKeyWithPin,
  unwrapDataKeyWithRecoveryCode,
  wrapDataKeyWithPin,
  wrapDataKeyWithRecoveryCode,
} from '../lib/crypto/keys';

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

// --- PIN wrapping -----------------------------------------------------------
console.log('\n--- PIN wrap (scrypt) ---');
{
  const dataKey = generateDataKey();
  const salt = generateSalt();

  const started = Date.now();
  const wrapped = wrapDataKeyWithPin(dataKey, '123456', salt);
  const wrapMs = Date.now() - started;

  const unwrapped = unwrapDataKeyWithPin(wrapped, '123456', salt);
  check(
    'unwraps to the identical data key',
    unwrapped.length === dataKey.length && dataKey.every((b, i) => unwrapped[i] === b)
  );
  check(
    `scrypt N=2^${Math.log2(SCRYPT_PARAMS.N)} costs ${wrapMs}ms under Node`,
    wrapMs > 100,
    'deliberately slow; must be re-measured on Hermes before shipping'
  );

  throws('wrong PIN is rejected', () => unwrapDataKeyWithPin(wrapped, '654321', salt), 'WrongPinError');
  throws('right PIN, wrong salt is rejected', () =>
    unwrapDataKeyWithPin(wrapped, '123456', generateSalt())
  );
  check('the raw data key never appears in the wrapped blob', !wrapped.includes(bytesToBase64(dataKey)));
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

  // The whole point of the design decision: the server blob is not
  // PIN-derived, so a PIN guess can't touch it.
  throws('a PIN cannot unwrap the recovery blob', () =>
    unwrapDataKeyWithRecoveryCode(wrapped, '123456', salt)
  );
}

// --- the two wrapped copies are of the SAME key ------------------------------
console.log('\n--- cross-check ---');
{
  const dataKey = generateDataKey();
  const pinSalt = generateSalt();
  const recoverySalt = generateSalt();
  const code = generateRecoveryCode();

  const viaPin = unwrapDataKeyWithPin(wrapDataKeyWithPin(dataKey, '000000', pinSalt), '000000', pinSalt);
  const viaCode = unwrapDataKeyWithRecoveryCode(
    wrapDataKeyWithRecoveryCode(dataKey, code, recoverySalt),
    code,
    recoverySalt
  );

  check(
    'PIN path and recovery path yield the same data key',
    viaPin.every((b, i) => viaCode[i] === b)
  );

  // A note encrypted on device A must open on device B, which only ever saw
  // the recovery-wrapped copy. This is Phase 3's whole premise, checked early.
  const note = '<p>written on device A</p>';
  check('a note encrypted under one path decrypts under the other', decrypt(encrypt(note, viaPin), viaCode) === note);
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${failed} failing check(s)`);
process.exit(failed === 0 ? 0 : 1);
