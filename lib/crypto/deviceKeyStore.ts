import * as SecureStore from './secureStorage';

/**
 * Where this device's key is kept between launches.
 *
 * A seam, added in Stage 13b, and on NATIVE it is exactly what `vault.ts` did
 * inline before: the key sits in the OS keychain, readable whenever the device
 * is unlocked. Nothing about native behaviour changes -- that is deliberate,
 * because the alternative was a `Platform.OS` branch inside the vault, and the
 * vault is the one file in this app where a subtle change is least affordable.
 *
 * `deviceKeyStore.web.ts` is where the interesting version lives: there the key
 * is wrapped under a passcode or a passkey, so wiping it on lock actually means
 * something.
 */

const DEVICE_KEY_ITEM = 'notes.devicekey.v2';

const OPTIONS: SecureStore.SecureStorageOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Hex, or null when there is nothing stored. */
export async function readDeviceKey(): Promise<string | null> {
  return SecureStore.getItemAsync(DEVICE_KEY_ITEM, OPTIONS);
}

export async function writeDeviceKey(hex: string): Promise<void> {
  await SecureStore.setItemAsync(DEVICE_KEY_ITEM, hex, OPTIONS);
}

export async function clearDeviceKey(): Promise<void> {
  await SecureStore.deleteItemAsync(DEVICE_KEY_ITEM);
}

/**
 * Drop the key from memory. A no-op natively: there is no in-memory copy here,
 * the keychain is the store. Web overrides this and it is load-bearing there.
 */
export function forgetUnlockedDeviceKey(): void {}

/**
 * Hand the store a key obtained by passing the gate. A no-op natively for the
 * same reason -- native's lock is a gate, not a key binding, exactly as
 * `deviceAuth.ts` describes.
 */
export function setUnlockedDeviceKey(_hex: string): void {}

/** True when the key cannot be read without passing a lock first. Native: never. */
export async function isDeviceKeyGated(): Promise<boolean> {
  return false;
}
