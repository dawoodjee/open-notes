import { describe, it, expect } from './harness';
import {
  GATE_KDF_PARAMS,
  derivePasscodeGateKey,
  derivePrfGateKey,
  isWellFormedPasscode,
} from '../lib/crypto/gateKey';

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);
const SALT = bytes(16, 7);
const BROWSER_SECRET = bytes(32, 42);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// Fast params: the shipped N=2^16 is ~64MB per call, which is the point in
// production and unusable in a test suite that runs on every change.
const FAST = { ...GATE_KDF_PARAMS, N: 256 };

describe('isWellFormedPasscode', () => {
  it('accepts exactly six digits', () => {
    expect(isWellFormedPasscode('012345')).toBe(true);
  });

  it('rejects the near misses', () => {
    const bad = ['12345', '1234567', '', 'abcdef', '12 345', '12345a'];
    expect(bad.some(isWellFormedPasscode)).toBe(false);
  });
});

describe('derivePasscodeGateKey', () => {
  it('is deterministic', () => {
    const a = derivePasscodeGateKey('123456', SALT, BROWSER_SECRET, FAST);
    const b = derivePasscodeGateKey('123456', SALT, BROWSER_SECRET, FAST);
    expect(hex(a)).toBe(hex(b));
  });

  it('returns 32 bytes', () => {
    expect(derivePasscodeGateKey('123456', SALT, BROWSER_SECRET, FAST).length).toBe(32);
  });

  it('changes with the passcode', () => {
    const a = derivePasscodeGateKey('123456', SALT, BROWSER_SECRET, FAST);
    const b = derivePasscodeGateKey('123457', SALT, BROWSER_SECRET, FAST);
    expect(hex(a) === hex(b)).toBe(false);
  });

  it('changes with the salt, so one PIN is two keys on two devices', () => {
    const a = derivePasscodeGateKey('123456', SALT, BROWSER_SECRET, FAST);
    const b = derivePasscodeGateKey('123456', bytes(16, 9), BROWSER_SECRET, FAST);
    expect(hex(a) === hex(b)).toBe(false);
  });

  it('CHANGES WITH THE BROWSER SECRET -- the property the whole design rests on', () => {
    // Without this, knowing the PIN would be enough. With it, an attacker
    // holding only the files cannot test even one candidate.
    const a = derivePasscodeGateKey('123456', SALT, BROWSER_SECRET, FAST);
    const b = derivePasscodeGateKey('123456', SALT, bytes(32, 43), FAST);
    expect(hex(a) === hex(b)).toBe(false);
  });
});

describe('derivePrfGateKey', () => {
  it('is deterministic and 32 bytes', () => {
    const a = derivePrfGateKey(bytes(32, 3), BROWSER_SECRET);
    const b = derivePrfGateKey(bytes(32, 3), BROWSER_SECRET);
    expect(hex(a)).toBe(hex(b));
    expect(a.length).toBe(32);
  });

  it('also depends on the browser secret', () => {
    const a = derivePrfGateKey(bytes(32, 3), BROWSER_SECRET);
    const b = derivePrfGateKey(bytes(32, 3), bytes(32, 4));
    expect(hex(a) === hex(b)).toBe(false);
  });

  it('is not the same key a passcode would produce from the same bytes', () => {
    const prf = derivePrfGateKey(bytes(32, 3), BROWSER_SECRET);
    const pin = derivePasscodeGateKey('123456', SALT, BROWSER_SECRET, FAST);
    expect(hex(prf) === hex(pin)).toBe(false);
  });
});
