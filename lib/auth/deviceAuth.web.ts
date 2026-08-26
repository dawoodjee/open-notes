import {
  gateKind,
  hasGate,
  isBiometricGateAvailable,
  unlockWithBiometric,
} from '@/lib/crypto/webGate';
import type { AuthOutcome, LockCapability, UnlockLabels } from './deviceAuth';

/**
 * The web build of the device-lock contract.
 *
 * ── WHY THE SHAPES MATCH BUT THE MEANINGS SHIFT ───────────────────────────
 *
 * Native's `LockCapability` describes what the DEVICE can do -- has it a
 * passcode, has it a face. On web there is nothing equivalent to ask: a browser
 * will not tell a page whether the machine has a login password, and it should
 * not.
 *
 * So here the capability describes what THIS APP'S GATE can do, which is a
 * different question with the same three answers:
 *
 *   biometric        a passkey with PRF is enrolled (Touch ID / Face ID /
 *                    Windows Hello). Unlocking yields real key material.
 *   credential-only  a 6-digit passcode is set.
 *   none             no gate is set up yet.
 *
 * ── AND WHY 'none' MEANS SOMETHING ELSE HERE, WHICH MATTERS ───────────────
 *
 * On native, 'none' means the user chose not to secure their device, and
 * `authenticateWithDeviceCredential` returns 'unavailable' so the app unlocks
 * rather than locking them out of their own notes. That reasoning does not
 * transfer. On web, 'none' means the gate has not been SET UP -- and if the
 * lock setting is on, the honest response is to ask the user to set one up, not
 * to wave them through.
 *
 * That is why the web lock screen owns the passcode flow directly rather than
 * calling the function below: a PIN needs a keypad and several attempts, which
 * is a UI, not a one-shot system prompt. This module covers the part that IS a
 * one-shot prompt -- the passkey -- and reports honestly for the rest.
 */

export type { AuthOutcome, LockCapability, UnlockLabels };

export async function getLockCapability(): Promise<LockCapability> {
  const kind = await gateKind();
  if (kind === 'prf') return 'biometric';
  if (kind === 'passcode') return 'credential-only';
  return 'none';
}

/** True when a passkey gate could be offered on this browser but is not set up
 *  yet. Drives whether the setup screen shows the biometric option at all. */
export async function canEnrolBiometric(): Promise<boolean> {
  return (await hasGate()) ? false : isBiometricGateAvailable();
}

export async function getUnlockLabels(): Promise<UnlockLabels> {
  const capability = await getLockCapability();

  // No `Platform.OS === 'ios' ? 'passcode' : 'screen lock'` here: on web the
  // credential is the app's own 6-digit code, not the machine's. Calling it a
  // "passcode" would invite the user to type their computer's.
  const credential = 'PIN';
  const biometric = capability === 'biometric' ? 'your passkey' : null;

  const phrase =
    capability === 'none' ? '' : biometric ? `${biometric}` : `your ${credential}`;

  return { capability, biometric, credential, phrase };
}

/**
 * Prompt the passkey.
 *
 * Passcode returns 'unavailable' NOT because nothing can authenticate, but
 * because nothing can authenticate *from here* -- the keypad lives in the lock
 * screen. Callers on web must check the capability first; VaultContext does.
 */
export async function authenticateWithDeviceCredential(_reason: string): Promise<AuthOutcome> {
  if ((await getLockCapability()) !== 'biometric') return 'unavailable';
  return (await unlockWithBiometric()) ? 'ok' : 'cancelled';
}
