import { scryptSync } from 'react-native-quick-crypto';
import { ScryptFn, getReferenceScrypt, setScryptImplementation } from './keys';

/**
 * Installs react-native-quick-crypto's native scrypt in place of the pure-JS
 * default. See the comment on ScryptFn in ./keys.ts for the measurements that
 * made this necessary (8956ms -> expected sub-second).
 *
 * This file is React Native-only by design; keys.ts stays importable under
 * Node so scripts/verify-crypto.ts can test the real logic.
 */

const nativeScrypt: ScryptFn = (password, salt, params) => {
  const out = scryptSync(password, salt, params.dkLen, {
    N: params.N,
    r: params.r,
    p: params.p,
    // The work buffer is 128 * r * N bytes -- 16MB at N=2^14, r=8. The
    // library's default maxmem is 32MB, which would reject any future bump to
    // N=2^15. Sized with headroom so raising the cost parameter later is a
    // one-line change rather than a confusing runtime rejection.
    maxmem: 256 * 1024 * 1024,
  });
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
};

let installed = false;

export function installNativeScrypt(): void {
  if (installed) return;

  try {
    // Prove the native implementation agrees with the JS one BEFORE trusting
    // it with real vaults. scrypt is specified (RFC 7914), so any correct
    // implementation must produce identical bytes -- but "must" is a claim
    // about the spec, not about this build. If they disagree, every existing
    // vault silently becomes unopenable and every new one is wrapped with a
    // key nothing else can reproduce.
    //
    // Deliberately checked at N=2^10: correctness doesn't depend on the cost
    // parameter, and running the reference at N=2^14 would cost the 9 seconds
    // this whole change exists to avoid.
    const password = new TextEncoder().encode('scrypt-compat-check');
    const salt = new TextEncoder().encode('0123456789abcdef');
    const params = { N: 1024, r: 8, p: 1, dkLen: 32 };

    const expected = getReferenceScrypt()(password, salt, params);
    const actual = nativeScrypt(password, salt, params);

    const matches =
      expected.length === actual.length && expected.every((b, i) => b === actual[i]);

    if (!matches) {
      throw new Error('native scrypt disagrees with the reference implementation');
    }

    setScryptImplementation(nativeScrypt);
    installed = true;
  } catch (error) {
    // Fall back to the pure-JS implementation rather than failing to start.
    // Unlocking becomes slow, but the user's notes remain reachable -- which
    // is the right trade when the alternative is an app that cannot open.
    if (__DEV__) {
      console.warn('[vault] native scrypt unavailable, falling back to JS:', error);
    }
  }
}
