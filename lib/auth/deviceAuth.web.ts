import { bytesToHex } from '@noble/ciphers/utils.js';

import {
  gateKind,
  hasGate,
  isBiometricGateAvailable,
  unlockWithBiometric,
} from '@/lib/crypto/webGate';
import { setUnlockedDeviceKey } from '@/lib/crypto/deviceKeyStore';
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

/**
 * What the gate CAN do, not what it currently is -- and the distinction was a
 * bug before it was a design note.
 *
 * The first version reported 'none' whenever no gate was enrolled. That reads
 * correctly and produces a dead end: `SecurityView` disables the "Require
 * unlock" toggle when the capability is 'none', so the only control that can
 * create a gate was greyed out until a gate existed. Caught by opening the
 * screen, which is the only way it could have been caught -- every layer below
 * was behaving exactly as written.
 *
 * Native's 'none' means "this device has no passcode and no biometrics", a
 * state the app cannot change and should not nag about. Web has no equivalent:
 * a 6-digit PIN can always be set. So 'none' is unreachable here, and that is
 * the honest answer rather than a workaround.
 */
export async function getLockCapability(): Promise<LockCapability> {
  const kind = await gateKind();
  if (kind === 'prf') return 'biometric';
  if (kind === 'passcode') return 'credential-only';
  // Nothing enrolled yet: report what could be enrolled.
  return (await isBiometricGateAvailable()) ? 'biometric' : 'credential-only';
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
  // Only claim a passkey once one is actually enrolled. Before that the
  // capability is a statement about what is possible, and "unlocks with your
  // passkey" would be describing a credential that does not exist yet.
  const biometric = (await gateKind()) === 'prf' ? 'your passkey' : null;

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
  // The ENROLLED kind, deliberately not getLockCapability() -- that now reports
  // what could be set up, which would send a passcode user into a passkey
  // prompt that has no credential to find.
  if ((await gateKind()) !== 'prf') return 'unavailable';

  const deviceKey = await unlockWithBiometric();
  if (!deviceKey) return 'cancelled';

  /**
   * The difference between this and the native implementation, in one line.
   *
   * Native returns a boolean and the keys were never gone -- the gate is
   * advisory. Here the passkey has just produced the ONLY copy of the device
   * key in existence outside its wrapped blob, and handing back 'ok' without
   * keeping it would unlock a session that then cannot open its own database.
   */
  setUnlockedDeviceKey(bytesToHex(deviceKey));
  return 'ok';
}
