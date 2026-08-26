import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Fingerprint, Lock } from 'lucide-react-native';

import { Icon } from '@/components/ui/icon';
import { useVault } from '@/contexts/VaultContext';
import { PasscodePad, usePasscodeError } from '@/components/PasscodePad';
import { setUnlockedDeviceKey } from '@/lib/crypto/deviceKeyStore';
import { MAX_PASSCODE_ATTEMPTS, gateKind, unlockWithPasscode } from '@/lib/crypto/webGate';
import { bytesToHex } from '@noble/ciphers/utils.js';
import { haptics } from '@/lib/theme/haptics';

/**
 * The web lock screen.
 *
 * ── WHY THIS IS A SEPARATE FILE FROM LockScreen.tsx ───────────────────────
 *
 * The native one has nothing to type: it raises the OS prompt on mount and the
 * whole screen is a fallback button for the case where you dismissed it. That
 * works because native's unlock is a GATE over keys that were never discarded.
 *
 * On web the keys are gone (see lib/auth/lockBehaviour.web.ts) and unlocking
 * has to RE-DERIVE them, from a passkey or from six digits. Six digits need a
 * keypad, several attempts and a remaining-attempts count, none of which the
 * native screen has any reason to carry.
 *
 * ── THE ORDER OF OPERATIONS, WHICH IS THE PART THAT MATTERS ───────────────
 *
 * The passcode does not "log in". It produces the device key, which is put back
 * where the vault expects to find it, and only then does the normal unlock path
 * run -- the same `unlock()` a cold launch uses. That is deliberate: there is
 * one route into an unlocked app, and this screen feeds it rather than
 * duplicating it.
 */
export function LockScreen() {
  const { unlock, updateLockSettings, lockSettings, resetLocalData } = useVault();
  const [kind, setKind] = useState<'passcode' | 'prf' | null | 'loading'>('loading');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(MAX_PASSCODE_ATTEMPTS);
  const [wiped, setWiped] = useState(false);
  const [error, flagError] = usePasscodeError();
  const attempted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void gateKind().then((k) => {
      if (!cancelled) setKind(k);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const runPasskey = useCallback(async () => {
    setBusy(true);
    try {
      // `unlock()` calls authenticateWithDeviceCredential, which on this
      // platform performs the passkey assertion AND stashes the device key it
      // produces. See lib/auth/deviceAuth.web.ts.
      await unlock();
    } finally {
      setBusy(false);
    }
  }, [unlock]);

  // Raise the passkey prompt once on mount, matching the native screen's
  // glance-and-in feel. Once per MOUNT rather than per render: a re-render
  // while the browser's own dialog is up would stack a second request on it.
  useEffect(() => {
    if (kind !== 'prf' || attempted.current) return;
    attempted.current = true;
    void runPasskey();
  }, [kind, runPasskey]);

  const submit = useCallback(
    async (entered: string) => {
      setBusy(true);
      try {
        const result = await unlockWithPasscode(entered);
        if (!result.deviceKey) {
          haptics.commit();
          flagError();
          setCode('');
          setRemaining(result.remaining);

          /**
           * 0 remaining means the gate has destroyed itself rather than allow
           * an unbounded sweep of a 10^6 keyspace.
           *
           * THE CLEAN-UP HERE IS NOT OPTIONAL, and leaving it out produced a
           * genuine dead end that only showed up by driving the counter to zero
           * for real. Destroying the gate removes the only copy of the device
           * key, so the encrypted database can never be opened again -- but the
           * lock setting was still `enabled`, so the next boot went straight
           * back to this screen, with a keypad that could never succeed and no
           * route past it. The notes were gone AND the app was bricked.
           *
           * So: switch the lock off and reset the local data, which is what the
           * message above already promises. `resetLocalData` closes the
           * database, deletes it, builds a fresh vault and reopens -- leaving a
           * working, empty app that a sign-in or the 12-word recovery code
           * refills.
           */
          if (result.remaining === 0) {
            setWiped(true);
            await updateLockSettings({ ...lockSettings, enabled: false });
            await resetLocalData();
          }
          return;
        }
        setUnlockedDeviceKey(bytesToHex(result.deviceKey));
        await unlock();
      } finally {
        setBusy(false);
      }
    },
    [flagError, unlock, updateLockSettings, lockSettings, resetLocalData]
  );

  if (kind === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center px-8 bg-background">
      <View className="w-16 h-16 rounded-full bg-muted items-center justify-center mb-6">
        <Icon as={kind === 'prf' ? Fingerprint : Lock} className="w-7 h-7 text-muted-foreground" />
      </View>

      <Text className="text-xl font-semibold text-foreground mb-2">Notes are locked</Text>

      {wiped ? (
        <Text className="text-base text-red-500 text-center mb-8 max-w-sm">
          Too many wrong codes, so the notes on this device were deleted. Sign in to restore
          them from your account, or use your 12-word recovery code.
        </Text>
      ) : kind === 'prf' ? (
        <>
          <Text className="text-base text-muted-foreground text-center mb-8">
            Unlock with your passkey.
          </Text>
          <Pressable
            onPress={() => void runPasskey()}
            disabled={busy}
            className="px-6 py-3 rounded-full bg-lime-500"
            accessibilityRole="button"
            accessibilityLabel="Unlock with your passkey"
          >
            {busy ? (
              <ActivityIndicator />
            ) : (
              <Text className="text-base font-medium text-on-accent">Unlock</Text>
            )}
          </Pressable>
        </>
      ) : (
        <>
          <Text className="text-base text-muted-foreground text-center mb-8">
            Enter your 6-digit PIN.
          </Text>
          <PasscodePad
            value={code}
            onChange={setCode}
            onComplete={(entered) => void submit(entered)}
            disabled={busy}
            shake={error}
          />
          {/* Only shown once it is real information. A permanent "10 attempts
              remaining" reads as a threat on a screen the owner sees daily. */}
          {remaining < MAX_PASSCODE_ATTEMPTS ? (
            <Text className="text-sm text-red-500 mt-6">
              {remaining === 1
                ? '1 attempt left before this device is erased'
                : `${remaining} attempts left`}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
