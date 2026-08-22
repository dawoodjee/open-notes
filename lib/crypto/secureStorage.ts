/**
 * The one place the app talks to the device keychain.
 *
 * WHY A SEAM RATHER THAN `import * as SecureStore` EVERYWHERE. `expo-secure-store`
 * has no web implementation -- every call throws `UnavailabilityError`. The vault
 * does not catch, so on web the very first `hasVault()` rejected, VaultContext's
 * boot landed in its catch, and the whole app was replaced by BootFailureScreen
 * with no way forward. A dead end on a platform the user is meant to be able to
 * work in.
 *
 * `secureStorage.web.ts` sits beside this file. Metro resolves `.web.ts` ahead of
 * `.ts`, so web gets an in-memory store and native is untouched -- the same
 * mechanism `RichEditor.web.tsx` uses, and the reason nothing here needs a
 * `Platform.OS` branch.
 *
 * `isSessionOnly` is exported so the UI can SAY which one it got. A web session
 * that silently forgets everything on refresh would be worse than the error
 * screen it replaced.
 */
import * as SecureStore from 'expo-secure-store';

export type SecureStorageOptions = SecureStore.SecureStoreOptions;

/** Keychain items are readable only while the device is unlocked, and never
 *  leave it -- no iCloud keychain sync. */
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY;

/** False here: the keychain outlives the process, and on iOS it outlives the
 *  app itself (see the reinstall handling in VaultContext's loadKeys). */
export const isSessionOnly = false;

export function getItemAsync(
  key: string,
  options?: SecureStorageOptions
): Promise<string | null> {
  return SecureStore.getItemAsync(key, options);
}

export function setItemAsync(
  key: string,
  value: string,
  options?: SecureStorageOptions
): Promise<void> {
  return SecureStore.setItemAsync(key, value, options);
}

export function deleteItemAsync(key: string, options?: SecureStorageOptions): Promise<void> {
  return SecureStore.deleteItemAsync(key, options);
}
