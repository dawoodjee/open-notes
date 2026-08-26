import { bytesToHex } from '@noble/ciphers/utils.js';

import * as SecureStore from './secureStorage';
import { hasGate } from './webGate';

/**
 * The web device-key store: in the clear when there is no lock, behind the gate
 * when there is.
 *
 * ── WHY THIS DIFFERS FROM NATIVE AT ALL ───────────────────────────────────
 *
 * Native's lock is a gate over a key that remains readable -- `deviceAuth.ts`
 * says so plainly, and it is the right trade behind an OS sandbox. A browser
 * tab has no sandbox, so Adam's call (2026-08-25) was that locking must WIPE
 * the keys and unlocking must re-derive them.
 *
 * "Wipe the keys" is only meaningful if they cannot simply be read back. So
 * when a gate is enrolled, the stored copy of the device key is removed and the
 * only copy lives inside `webGate`'s record, wrapped under the passcode or
 * passkey. This module then holds the unwrapped key in memory for the duration
 * of the unlocked session, and drops it on lock.
 *
 * ── THE TWO STATES, AND WHY BOTH ARE CORRECT ──────────────────────────────
 *
 *   lock off   the key is in `secureStorage`, which on web is already
 *              encrypted under a non-extractable WebCrypto key. Same posture
 *              as native with the lock off, which is the shipped default.
 *
 *   lock on    the stored copy is gone. The key exists only wrapped under the
 *              gate, and in memory while unlocked.
 *
 * The transition between them is the delicate part and belongs to `webGate`'s
 * enrol/clear functions, which must never remove the plain copy before the
 * wrapped one is written -- a crash in between would strand every note on this
 * device behind a key nobody has. `enrolGate` below enforces that order.
 */

const DEVICE_KEY_ITEM = 'notes.devicekey.v2';

/**
 * The unwrapped key for this session. Module scope rather than React state
 * because `vault.ts` reads it outside any component, and it is exactly what
 * `lock()` throws away.
 */
let unlocked: string | null = null;

export async function readDeviceKey(): Promise<string | null> {
  if (unlocked) return unlocked;
  // Absent when a gate is enrolled -- that is the point. The caller then has to
  // go through the lock screen, which calls setUnlockedDeviceKey().
  return SecureStore.getItemAsync(DEVICE_KEY_ITEM);
}

export async function writeDeviceKey(hex: string): Promise<void> {
  unlocked = hex;
  // Only persisted in the clear while there is no gate. With one enrolled the
  // wrapped copy is authoritative and a plain copy beside it would undo the
  // entire lock.
  if (!(await hasGate())) await SecureStore.setItemAsync(DEVICE_KEY_ITEM, hex);
}

export async function clearDeviceKey(): Promise<void> {
  unlocked = null;
  await SecureStore.deleteItemAsync(DEVICE_KEY_ITEM);
}

export function forgetUnlockedDeviceKey(): void {
  unlocked = null;
}

export function setUnlockedDeviceKey(hex: string): void {
  unlocked = hex;
}

export async function isDeviceKeyGated(): Promise<boolean> {
  return hasGate();
}

/**
 * Move this device's key behind a gate. WRAPPED COPY FIRST, then remove the
 * plain one -- never the other way round.
 *
 * A crash between the two steps has to leave the key recoverable. In this order
 * the worst case is a gate that exists alongside a plain copy, which is merely
 * a lock that is not yet effective; the reverse order's worst case is a device
 * whose notes nobody can open. Those are not comparable failures.
 */
export async function enrolGate(
  enrol: () => Promise<boolean>,
  deviceKeyHex: string
): Promise<boolean> {
  unlocked = deviceKeyHex;
  const ok = await enrol();
  if (!ok) return false;
  await SecureStore.deleteItemAsync(DEVICE_KEY_ITEM);
  return true;
}

/** Restore the plain copy when the lock is switched off. */
export async function retireGate(deviceKey: Uint8Array): Promise<void> {
  await SecureStore.setItemAsync(DEVICE_KEY_ITEM, bytesToHex(deviceKey));
  unlocked = bytesToHex(deviceKey);
}
