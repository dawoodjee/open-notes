import React, { useCallback, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { RecoveryCodeInput } from '@/components/RecoveryCodeView';
import { getPendingAdoption, subscribePendingAdoption } from '@/lib/crypto/adoption';
import { WrongRecoveryCodeError, isWellFormedRecoveryCode } from '@/lib/crypto/keys';

export function usePendingAdoption() {
  return useSyncExternalStore(subscribePendingAdoption, getPendingAdoption, getPendingAdoption);
}

/**
 * Shown when this device signs into an account whose notes were encrypted on
 * a different device.
 *
 * The device cannot simply be handed the key: the account's key lives on the
 * server wrapped under the recovery code, and nothing else can unwrap it. So
 * this is the one moment the recovery code is genuinely required rather than
 * merely a backup.
 *
 * One step, not two. It used to also ask for this device's PIN, because the
 * adopted key had to be re-wrapped under it. The key is now wrapped under a
 * device key held in the keychain, which is already in memory by this point --
 * so there is nothing left to ask the user for.
 */
export function AdoptKeyScreen() {
  const pending = usePendingAdoption();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError(undefined);
    try {
      await pending.complete(code);
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(
        err instanceof WrongRecoveryCodeError
          ? "That recovery code doesn't match this account."
          : 'Could not unlock this account on this device.'
      );
    } finally {
      setBusy(false);
    }
  }, [pending, code]);

  if (!pending) return null;

  const ready = isWellFormedRecoveryCode(code) && !busy;

  return (
    <View className="flex-1 justify-center px-8">
      <Text className="text-xl font-semibold text-gray-900 mb-3">Unlock your notes here</Text>
      <Text className="text-sm text-gray-500 mb-6">
        This account&apos;s notes were encrypted on another device. Enter your recovery code to
        unlock them here. We can&apos;t do this for you — the code is the only thing that can.
      </Text>

      <RecoveryCodeInput value={code} onChange={setCode} />

      <View className="h-8 justify-center">
        <Text className={`text-sm ${error ? 'text-red-500' : 'text-gray-500'}`}>{error ?? ''}</Text>
      </View>

      <Pressable
        onPress={() => void submit()}
        disabled={!ready}
        className={`rounded-2xl h-12 items-center justify-center mb-3 ${
          ready ? 'bg-black active:opacity-70' : 'bg-gray-200'
        }`}
      >
        <Text className={`font-semibold ${ready ? 'text-white' : 'text-gray-400'}`}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => void pending.cancel()}
        className="h-12 items-center justify-center active:opacity-60"
      >
        <Text className="text-gray-500">Sign out instead</Text>
      </Pressable>

      <Text className="text-xs text-gray-400 mt-4">
        Don&apos;t have it? Any device still signed in to this account can read these notes. Without
        the code and without such a device, they can&apos;t be recovered by anyone.
      </Text>
    </View>
  );
}
