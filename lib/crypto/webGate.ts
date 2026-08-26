import { bytesToHex, hexToBytes, randomBytes } from '@noble/ciphers/utils.js';

import * as SecureStore from './secureStorage';
import { UnwrapError, unwrapWith, wrapWith } from './keys';
import {
  GATE_KDF_PARAMS,
  type GateKdfParams,
  derivePasscodeGateKey,
  derivePrfGateKey,
} from './gateKey';

/**
 * The web lock: what actually stands between a closed tab and readable notes.
 *
 * WEB ONLY. Imported exclusively from `.web` files -- it speaks to
 * `navigator.credentials`, which does not exist in React Native.
 *
 * ── WHY THE WEB LOCK IS NOT THE NATIVE LOCK ───────────────────────────────
 *
 * Native's lock is a GATE and says so: `deviceAuth.ts` notes that "the data key
 * is retrievable from the keychain whether or not this function was ever
 * called", and `vault.ts` keeps the keys in memory while locked on purpose, so
 * sync keeps running in a pocket. That is the right trade on a device with an
 * OS sandbox around the process.
 *
 * A browser tab has no such sandbox, so Adam's call (2026-08-25) was for the
 * stronger version: **locking wipes the keys and unlocking re-derives them.**
 * This module is what makes re-deriving possible. Without it there would be
 * nothing to re-derive FROM, and "wipe on lock" would just mean "sign in again".
 *
 * ── THE STORED SHAPE ──────────────────────────────────────────────────────
 *
 * One record, held through `secureStorage` -- which on web is itself encrypted
 * under a non-extractable WebCrypto key. So the wrapped device key below is
 * double-wrapped: once by the gate factor (PIN or biometric), once by a key
 * whose bytes no script can read. That is what makes a 6-digit PIN defensible;
 * see the long note in `gateKey.ts`.
 *
 * `browserSecret` lives in the same record. It is the second input to every
 * derivation and never leaves this profile.
 */

const GATE_KEY = 'notes.webgate.v1';

/**
 * How many wrong passcodes before local data is destroyed.
 *
 * Not arbitrary: the PIN keyspace is 10^6 and scrypt only makes each guess
 * expensive, it does not make a sweep impossible. A counter is what converts
 * "slow" into "bounded". Ten is generous enough that a person mistyping is
 * never at risk and small enough that an attacker gets nowhere.
 *
 * The recovery code is what makes this safe to be destructive -- see the note
 * on `registerFailure`.
 */
export const MAX_PASSCODE_ATTEMPTS = 10;

export type GateKind = 'passcode' | 'prf';

interface WebGateConfig {
  kind: GateKind;
  /** Hex. The second input to every derivation. See gateKey.ts. */
  browserSecret: string;
  /** Hex. Per-device, so one PIN is two different keys on two devices. */
  salt: string;
  /** Travels with the record so raising the cost later cannot strand a PIN. */
  kdf: GateKdfParams;
  /** The device key, wrapped under the gate key. */
  wrappedDeviceKey: string;
  /** WebAuthn credential id (base64url), `prf` only. */
  credentialId?: string;
  failures: number;
}

async function readConfig(): Promise<WebGateConfig | null> {
  const raw = await SecureStore.getItemAsync(GATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WebGateConfig;
  } catch {
    return null;
  }
}

async function writeConfig(config: WebGateConfig): Promise<void> {
  await SecureStore.setItemAsync(GATE_KEY, JSON.stringify(config));
}

export async function hasGate(): Promise<boolean> {
  return (await readConfig()) !== null;
}

export async function gateKind(): Promise<GateKind | null> {
  return (await readConfig())?.kind ?? null;
}

export async function clearGate(): Promise<void> {
  await SecureStore.deleteItemAsync(GATE_KEY);
}

export async function remainingAttempts(): Promise<number> {
  const config = await readConfig();
  if (!config) return MAX_PASSCODE_ATTEMPTS;
  return Math.max(0, MAX_PASSCODE_ATTEMPTS - config.failures);
}

// ─── WebAuthn PRF ──────────────────────────────────────────────────────────

/**
 * The PRF salt. Fixed and app-specific rather than random: PRF is a
 * deterministic function of (authenticator secret, this salt), so it has to be
 * the SAME bytes every unlock or the output -- and therefore the derived key --
 * changes and the wrapped device key stops opening.
 *
 * Being fixed and public costs nothing: the secret half lives in the
 * authenticator's hardware and never leaves it.
 */
const PRF_SALT = new TextEncoder().encode('notes-web-gate-prf-v1');

const b64url = {
  encode: (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (text: string) => {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  },
};

/**
 * Is a platform authenticator with the PRF extension usable here?
 *
 * Two separate questions, and both have to be yes. A platform authenticator
 * (Touch ID, Face ID, Windows Hello) may exist while PRF is unsupported -- PRF
 * landed later and support in 2026 is good but NOT universal, which is the
 * entire reason the passcode path exists rather than being a fallback nobody
 * hits.
 *
 * This can only report *availability*; whether PRF actually yields output is
 * not known until a credential is created and evaluated, so `enrolBiometric`
 * verifies it for real and reports failure rather than trusting this.
 */
export async function isBiometricGateAvailable(): Promise<boolean> {
  if (typeof PublicKeyCredential === 'undefined') return false;
  try {
    const platform = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!platform) return false;
    // Feature-detection for the extension itself, where the browser offers it.
    const supported = (PublicKeyCredential as any).getClientCapabilities
      ? await (PublicKeyCredential as any).getClientCapabilities()
      : null;
    return supported ? supported.extension_prf !== false : true;
  } catch {
    return false;
  }
}

async function evaluatePrf(credentialId?: string): Promise<Uint8Array | null> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      rpId: location.hostname,
      userVerification: 'required',
      allowCredentials: credentialId
        ? [{ id: b64url.decode(credentialId), type: 'public-key' }]
        : [],
      extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  const results = (assertion?.getClientExtensionResults() as any)?.prf?.results?.first;
  return results ? new Uint8Array(results) : null;
}

/**
 * Create a passkey and bind the device key to it.
 *
 * Note the two round trips: `create()` registers the credential, and a
 * following `get()` is what actually produces PRF output. Some authenticators
 * return PRF results at creation and some do not, so evaluating separately is
 * the only reliable order -- and it doubles as proof that the unlock path
 * works before we throw away the ability to unlock any other way.
 */
export async function enrolBiometric(deviceKey: Uint8Array, accountLabel: string): Promise<boolean> {
  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { id: location.hostname, name: 'Notes' },
        user: { id: randomBytes(16), name: accountLabel, displayName: accountLabel },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'required',
        },
        extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;

    if (!credential) return false;
    const credentialId = b64url.encode(new Uint8Array(credential.rawId));

    const prf = await evaluatePrf(credentialId);
    // The authenticator registered but will not produce PRF output. Refusing
    // here is deliberate: enrolling anyway would leave a lock that looks set up
    // and cannot ever be opened.
    if (!prf) return false;

    const browserSecret = randomBytes(32);
    await writeConfig({
      kind: 'prf',
      browserSecret: bytesToHex(browserSecret),
      salt: bytesToHex(randomBytes(16)),
      kdf: GATE_KDF_PARAMS,
      wrappedDeviceKey: wrapWith(deviceKey, derivePrfGateKey(prf, browserSecret)),
      credentialId,
      failures: 0,
    });
    return true;
  } catch {
    // Cancelled, unsupported, or no authenticator. All the same to the caller:
    // the biometric gate is not set up, offer the passcode instead.
    return false;
  }
}

export async function enrolPasscode(deviceKey: Uint8Array, passcode: string): Promise<void> {
  const browserSecret = randomBytes(32);
  const salt = randomBytes(16);
  await writeConfig({
    kind: 'passcode',
    browserSecret: bytesToHex(browserSecret),
    salt: bytesToHex(salt),
    kdf: GATE_KDF_PARAMS,
    wrappedDeviceKey: wrapWith(
      deviceKey,
      derivePasscodeGateKey(passcode, salt, browserSecret, GATE_KDF_PARAMS)
    ),
    failures: 0,
  });
}

/**
 * A wrong passcode. Counts, and destroys local data once the budget is gone.
 *
 * Destructive by design, and safe to be, for a reason specific to this app: the
 * 12-word recovery code is an independent path to the data key, so a wipe costs
 * a re-sync rather than the notes. That is also why the usual objection to
 * hardware-bound keys does not apply here -- see the spike findings.
 */
async function registerFailure(config: WebGateConfig): Promise<number> {
  const failures = config.failures + 1;
  if (failures >= MAX_PASSCODE_ATTEMPTS) {
    await clearGate();
    return 0;
  }
  await writeConfig({ ...config, failures });
  return MAX_PASSCODE_ATTEMPTS - failures;
}

export interface UnlockResult {
  deviceKey: Uint8Array | null;
  /** Attempts left after this one. 0 means the gate was just destroyed. */
  remaining: number;
}

export async function unlockWithPasscode(passcode: string): Promise<UnlockResult> {
  const config = await readConfig();
  if (!config || config.kind !== 'passcode') return { deviceKey: null, remaining: 0 };

  const gateKey = derivePasscodeGateKey(
    passcode,
    hexToBytes(config.salt),
    hexToBytes(config.browserSecret),
    // The stored params, not the current constant -- a PIN set under older
    // settings must keep opening.
    config.kdf
  );

  try {
    const deviceKey = unwrapWith(config.wrappedDeviceKey, gateKey);
    // Only a SUCCESSFUL unlock clears the counter, so an attacker cannot reset
    // their own budget by interleaving guesses with anything else.
    if (config.failures > 0) await writeConfig({ ...config, failures: 0 });
    return { deviceKey, remaining: MAX_PASSCODE_ATTEMPTS };
  } catch (err) {
    if (!(err instanceof UnwrapError)) throw err;
    return { deviceKey: null, remaining: await registerFailure(config) };
  }
}

/**
 * Unlock with the passkey. No attempt counter, deliberately: the authenticator
 * enforces user verification itself and there is nothing here to guess.
 */
export async function unlockWithBiometric(): Promise<Uint8Array | null> {
  const config = await readConfig();
  if (!config || config.kind !== 'prf') return null;

  try {
    const prf = await evaluatePrf(config.credentialId);
    if (!prf) return null;
    return unwrapWith(
      config.wrappedDeviceKey,
      derivePrfGateKey(prf, hexToBytes(config.browserSecret))
    );
  } catch {
    return null;
  }
}
