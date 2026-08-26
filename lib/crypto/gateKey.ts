import { hkdf } from '@noble/hashes/hkdf.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/ciphers/utils.js';

/**
 * The web lock's key derivation: turning a 6-digit PIN, or a biometric, into
 * something that can actually unwrap a key.
 *
 * ── WHY A PIN IS BACK, HAVING BEEN DELIBERATELY REMOVED ───────────────────
 *
 * Stage 6.5 deleted the app PIN and scrypt with it, because Stage 6 had already
 * flagged the problem: "a bare 6-digit PIN is too weak to be an encryption
 * key's only protection". A million candidates is nothing to an attacker who
 * can guess offline. `lib/crypto/keys.ts` says so at length, and ends with the
 * exact instruction this file follows:
 *
 *   "The reverse mistake is the dangerous one: HKDF over a low-entropy secret
 *    is a genuine vulnerability. If a password-shaped secret is ever
 *    reintroduced here, it needs scrypt back, not this."
 *
 * So: scrypt, and the PIN is never the only input.
 *
 * ── THE TWO-INPUT DESIGN, WHICH IS THE WHOLE POINT ────────────────────────
 *
 *   gateKey = HKDF( scrypt(PIN, salt)  ‖  browserSecret )
 *
 * `browserSecret` is 32 random bytes stored through `secureStorage`, which on
 * web means encrypted under a **non-extractable** WebCrypto key whose bytes no
 * script can read (see secureStorage.web.ts). It is not derived from anything
 * the user knows and it never leaves the browser profile.
 *
 * That changes what a low-entropy PIN means, and it is worth being precise
 * about who is stopped and who is not:
 *
 *   Attacker with the FILES (a copied browser profile, a stolen disk):
 *     cannot obtain browserSecret -- the key that decrypts it lives in the
 *     browser's key store, not in the files -- so they cannot test even one
 *     PIN. The 10^6 keyspace is irrelevant to them. This is the case the whole
 *     design targets.
 *
 *   Attacker with SCRIPT running on the origin (XSS, malicious extension):
 *     can use the KEK, so they can reach browserSecret and brute-force the
 *     PIN. scrypt makes each attempt cost real time, and the caller keeps a
 *     failed-attempt counter that wipes local data. Both are mitigations, not
 *     solutions -- script on the origin is web's standing residual gap and it
 *     is documented as such in dev-docs/web-at-rest-findings.md.
 *
 * The biometric path skips scrypt entirely and is stronger: a WebAuthn PRF
 * output is 32 bytes of hardware-backed material, so it is high-entropy and
 * HKDF is the correct tool -- the same reasoning `keys.ts` applies to the
 * recovery code. Stretching it would cost the user time and buy nothing.
 */

/**
 * scrypt cost. Deliberately a named constant that TRAVELS WITH THE STORED BLOB
 * (see WebGateConfig), for the same reason RECOVERY_KDF_PARAMS does: changing
 * the cost later must not strand a PIN somebody already set. That property was
 * immediately useful -- these numbers changed once already, after measurement,
 * and existing enrolments kept working.
 *
 * ── THE NUMBERS ARE MEASURED, AND THE FIRST GUESS WAS BADLY WRONG ─────────
 *
 * N = 2^16, r = 8 was written here on the estimate of "a few hundred
 * milliseconds". It actually costs **~3.1 seconds** per attempt. Not a tuning
 * detail -- a lock nobody would keep switched on.
 *
 * Measure with `npx tsx scripts/bench-gate-kdf.ts` rather than in a browser.
 * The browser was tried first and lied: an automated pane reports
 * `visibilityState === 'hidden'`, which clamps setTimeout to 1s and pauses
 * requestAnimationFrame, so every reading came back pinned near 6000ms whatever
 * the parameters were -- including for an 8x change that should have been
 * obvious. A second retune was very nearly made on those numbers.
 *
 * ── WHY scrypt AT ALL, WHEN NATIVE PBKDF2 IS 44x FASTER ──────────────────
 *
 * Measured in the same browser: WebCrypto PBKDF2-SHA256 at 1,000,000
 * iterations costs 126 ms, against 5,500 ms for this pure-JS scrypt. The
 * obvious conclusion -- pure JS is a terrible place to pay for a KDF, because
 * an attacker using an optimised native implementation gets a 50x head start --
 * is the RIGHT conclusion in general and does not apply here, for one specific
 * reason worth writing down:
 *
 * **The attacker is confined to the same browser we are.** Guessing the PIN
 * requires `browserSecret`, which is sealed under a non-extractable WebCrypto
 * key. Non-extractable means the bytes never leave that key store, so the
 * material cannot be carried off to a GPU farm or a native binary -- any sweep
 * has to execute in the victim's own browser, in JavaScript, at our speed. The
 * defender/attacker ratio is therefore ~1:1 whichever KDF we pick, and the only
 * question left is cost per attempt versus cost per unlock. scrypt's memory
 * hardness is then a free bonus rather than the point.
 *
 * ── THE CHOSEN POINT ──────────────────────────────────────────────────────
 *
 * N = 2^13, r = 8: ~8 MB and **434 ms** per attempt, against 3,123 ms for the
 * original. A browser-confined sweep of all 10^6 PINs then costs about **5
 * days**, for a user cost comparable to a Face ID prompt. The 10-attempt wipe
 * in webGate covers the legitimate entry path; this covers the one that
 * bypasses it.
 *
 * Raising it is cheap if that trade ever looks wrong -- 2^14 buys 9.2 days at
 * 793 ms -- and costs nothing to existing users, because the parameters travel
 * with each stored blob rather than being implied by this constant.
 */
export const GATE_KDF_PARAMS = {
  alg: 'scrypt' as const,
  N: 8192,
  r: 8,
  p: 1,
  dkLen: 32,
};

export type GateKdfParams = typeof GATE_KDF_PARAMS;

const GATE_INFO = utf8ToBytes('notes-web-gate-v1');

/** Six digits, exactly. Nothing else is a passcode. */
export function isWellFormedPasscode(passcode: string): boolean {
  return /^[0-9]{6}$/.test(passcode);
}

/**
 * Combine a low-entropy secret with the browser-held one.
 *
 * HKDF over the CONCATENATION rather than XOR or a plain hash: both halves are
 * fixed-length 32 bytes here, so there is no ambiguity about where one ends,
 * and HKDF's extract step is designed for exactly this -- mixing inputs of
 * differing quality into one uniform key.
 */
function combine(factor: Uint8Array, browserSecret: Uint8Array): Uint8Array {
  const material = new Uint8Array(factor.length + browserSecret.length);
  material.set(factor, 0);
  material.set(browserSecret, factor.length);
  return hkdf(sha256, material, undefined, GATE_INFO, 32);
}

/**
 * Derive the gate key from a passcode. Slow on purpose.
 *
 * `salt` is per-device random bytes, so two devices with the same PIN produce
 * different keys and a precomputed table is useless.
 */
export function derivePasscodeGateKey(
  passcode: string,
  salt: Uint8Array,
  browserSecret: Uint8Array,
  params: GateKdfParams = GATE_KDF_PARAMS
): Uint8Array {
  const stretched = scrypt(utf8ToBytes(passcode), salt, {
    N: params.N,
    r: params.r,
    p: params.p,
    dkLen: params.dkLen,
  });
  return combine(stretched, browserSecret);
}

/**
 * Derive the gate key from a WebAuthn PRF output.
 *
 * No stretching, and that is correct rather than lazy: PRF returns 32 bytes
 * produced by the authenticator's own hardware key. It is not guessable, so
 * a slow KDF would cost the user latency and defend against nothing --
 * precisely the argument `keys.ts` makes for the recovery code.
 */
export function derivePrfGateKey(prfOutput: Uint8Array, browserSecret: Uint8Array): Uint8Array {
  return combine(prfOutput, browserSecret);
}
