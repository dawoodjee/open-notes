import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

/**
 * The one place in this app that talks to the device's own authentication.
 *
 * WHY THIS MODULE EXISTS AT ALL, given that expo-secure-store already has a
 * `requireAuthentication` option: that option cannot accept a device passcode.
 * On Android, expo-secure-store builds its BiometricPrompt with
 * `setNegativeButtonText(...)` and never calls `setAllowedAuthenticators(...)`
 * -- and `setNegativeButtonText` is mutually exclusive with DEVICE_CREDENTIAL,
 * so that builder structurally cannot take one. Its keystore spec likewise
 * calls `setUserAuthenticationRequired(true)` without
 * `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG or
 * AUTH_DEVICE_CREDENTIAL)`. iOS is the same story from the other end:
 * SecureStoreModule.swift hardcodes `.biometryCurrentSet`, with no
 * `.devicePasscode` and no `.userPresence`.
 *
 * The practical consequence is that `requireAuthentication` is BIOMETRICS ONLY
 * on both platforms. A user with a passcode but no enrolled face or finger
 * gets nothing, and a user who enrols a new fingerprint has the stored item
 * destroyed. With no app PIN left to fall back on, either of those would mean
 * unopenable local notes. expo-local-authentication accepts both factors in a
 * single call, on both platforms, which is why the lock lives here.
 *
 * WHAT THIS IS AND ISN'T -- worth being precise, because the two are easy to
 * conflate. This is a GATE: it answers "is this the device owner?" and returns
 * a boolean. It is not a cryptographic binding -- the data key is retrievable
 * from the keychain whether or not this function was ever called. So the lock
 * screen stops someone who picks up your unlocked phone; it does not stop code
 * running as this app. What protects a powered-off or stolen device is
 * SQLCipher plus the keychain's own at-rest protection, and what keeps the
 * server blind is the envelope encryption -- neither depends on this file.
 */

/**
 * What the device can actually ask for.
 *
 *   none              no passcode, no biometrics -- nothing to authenticate
 *                     against. A legitimate choice; we don't nag.
 *   credential-only   passcode / PIN / pattern, but no enrolled biometrics.
 *   biometric         face or fingerprint available (passcode too, as fallback).
 */
export type LockCapability = 'none' | 'credential-only' | 'biometric';

export async function getLockCapability(): Promise<LockCapability> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) return 'none';
    if (level === LocalAuthentication.SecurityLevel.SECRET) return 'credential-only';
    // BIOMETRIC_WEAK and BIOMETRIC_STRONG both mean "there's a face/finger to
    // offer". We don't distinguish: the strength of the biometric doesn't
    // change what we do, because this is a gate rather than a key binding.
    return 'biometric';
  } catch {
    // Treat an unreadable capability as no capability. The failure mode that
    // matters is offering a lock we can't actually satisfy.
    return 'none';
  }
}

/**
 * What this device's unlock is actually CALLED, in the words its own OS uses.
 *
 * "Face ID" and "Touch ID" are Apple trademarks for Apple hardware. Printing
 * them on Android is simply wrong -- there is no Face ID on a Pixel, and a
 * user reading it has no idea what the app is asking for. The reverse is just
 * as bad: Android calls the non-biometric factor a "screen lock", iOS calls it
 * a "passcode", and using one word on both platforms makes the sentence read
 * as a mistake on one of them.
 *
 * So the labels come from the device rather than from a constant, and every
 * user-facing string that names the unlock method is built from this.
 */
export interface UnlockLabels {
  capability: LockCapability;
  /** "Face ID", "Touch ID", "fingerprint", "face unlock" -- null when none. */
  biometric: string | null;
  /** "passcode" on iOS, "screen lock" on Android. */
  credential: string;
  /**
   * Ready to drop into a sentence after "Unlock with ...".
   * e.g. "Face ID or your passcode", "your fingerprint or screen lock".
   */
  phrase: string;
}

export async function getUnlockLabels(): Promise<UnlockLabels> {
  const capability = await getLockCapability();
  const credential = Platform.OS === 'ios' ? 'passcode' : 'screen lock';

  let types: LocalAuthentication.AuthenticationType[] = [];
  try {
    types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  } catch {
    // Fall through to the non-biometric wording rather than guessing.
  }

  const has = (t: LocalAuthentication.AuthenticationType) => types.includes(t);
  const biometric =
    capability !== 'biometric'
      ? null
      : Platform.OS === 'ios'
        ? has(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
          ? 'Face ID'
          : 'Touch ID'
        : has(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
          ? 'face unlock'
          : has(LocalAuthentication.AuthenticationType.IRIS)
            ? 'iris unlock'
            : 'fingerprint';

  // Apple's names are proper nouns and take no article; Android's are common
  // nouns and read wrong without one. That asymmetry is why this is a phrase
  // rather than a list the caller joins itself.
  const phrase =
    capability === 'none'
      ? ''
      : !biometric
        ? `your ${credential}`
        : Platform.OS === 'ios'
          ? `${biometric} or your ${credential}`
          : `your ${biometric} or ${credential}`;

  return { capability, biometric, credential, phrase };
}

export type AuthOutcome = 'ok' | 'cancelled' | 'unavailable';

/**
 * Prompt for whatever the device has: Face ID / Touch ID / fingerprint, with
 * the passcode as fallback in the same prompt.
 *
 * The three outcomes must stay distinct, and 'cancelled' vs 'unavailable' is
 * the pair that matters:
 *
 *   ok           unlock.
 *   cancelled    the user is there and said no. Stay locked -- unlocking here
 *                would make the lock decorative.
 *   unavailable  there is nothing to authenticate against (no passcode, no
 *                biometrics, hardware missing). Unlock. The user chose not to
 *                secure their device, and refusing them their own notes over
 *                that is a lockout, not a security measure.
 *
 * Collapsing those two into one boolean gets one of the cases wrong whichever
 * way you pick.
 */
export async function authenticateWithDeviceCredential(reason: string): Promise<AuthOutcome> {
  if ((await getLockCapability()) === 'none') return 'unavailable';

  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      // The whole point: false means iOS uses LAPolicyDeviceOwnerAuthentication
      // (biometrics OR passcode) and Android allows DEVICE_CREDENTIAL. Setting
      // this to true would reintroduce exactly the biometrics-only limitation
      // this module exists to escape.
      disableDeviceFallback: false,
    });

    if (result.success) return 'ok';

    // Enrolment can change between the capability check above and the prompt
    // (the user can leave for Settings mid-flow), so these are still possible.
    if (
      result.error === 'not_enrolled' ||
      result.error === 'not_available' ||
      result.error === 'passcode_not_set'
    ) {
      return 'unavailable';
    }

    // Everything else -- user_cancel, app_cancel, system_cancel, lockout,
    // unknown -- means we did not authenticate the owner. Lockout resolves
    // through the passcode, which this prompt already offers.
    return 'cancelled';
  } catch {
    return 'cancelled';
  }
}
