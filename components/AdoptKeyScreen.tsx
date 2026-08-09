import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { PIN_LENGTH, PinPad } from '@/components/PinScreen';
import {
  getPendingAdoption,
  subscribePendingAdoption,
} from '@/lib/crypto/adoption';
import { WrongPinError, WrongRecoveryCodeError, isWellFormedRecoveryCode } from '@/lib/crypto/keys';

export function usePendingAdoption() {
  return useSyncExternalStore(subscribePendingAdoption, getPendingAdoption, getPendingAdoption);
}

/**
 * Shown when this device signs into an account whose notes were encrypted on
 * a different device.
 *
 * The device cannot simply be handed the key: the account's key lives on the
 * server wrapped under the recovery code, and nothing else can unwrap it --
 * deliberately, because a blob an attacker could take offline must not be
 * protected by six digits. So this is the one moment the recovery code is
 * genuinely required rather than merely a backup.
 */
export function AdoptKeyScreen() {
  const pending = usePendingAdoption();
  const [step, setStep] = useState<'code' | 'pin'>('code');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (enteredPin: string) => {
      if (!pending) return;
      setBusy(true);
      setError(undefined);
      try {
        await pending.complete(code, enteredPin);
      } catch (err) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        if (err instanceof WrongRecoveryCodeError) {
          setError("That recovery code doesn't match this account.");
          setStep('code');
        } else if (err instanceof WrongPinError) {
          setError('That PIN is incorrect.');
        } else {
          setError('Could not unlock this account on this device.');
          setStep('code');
        }
        setPin('');
      } finally {
        setBusy(false);
      }
    },
    [pending, code]
  );

  useEffect(() => {
    if (pin.length === PIN_LENGTH && step === 'pin') void submit(pin);
  }, [pin, step, submit]);

  if (!pending) return null;

  if (step === 'pin') {
    return (
      <PinPad
        title="Enter this device's PIN"
        subtitle="So your notes stay locked to this PIN afterwards."
        error={error}
        busy={busy}
        value={pin}
        onChange={setPin}
      />
    );
  }

  const ready = isWellFormedRecoveryCode(code);

  return (
    <View className="flex-1 justify-center px-8">
      <Text className="text-xl font-semibold text-gray-900 mb-3">Unlock your notes here</Text>
      <Text className="text-sm text-gray-500 mb-6">
        This account&apos;s notes were encrypted on another device. Enter your recovery code to
        unlock them here. We can&apos;t do this for you — the code is the only thing that can.
      </Text>

      <TextInput
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
        placeholderTextColor="#9CA3AF"
        className="border border-gray-300 rounded-2xl h-12 px-4 text-base text-gray-900 tracking-wider"
      />

      <View className="h-8 justify-center">
        <Text className={`text-sm ${error ? 'text-red-500' : 'text-gray-500'}`}>{error ?? ''}</Text>
      </View>

      <Pressable
        onPress={() => {
          setError(undefined);
          setStep('pin');
        }}
        disabled={!ready || busy}
        className={`rounded-2xl h-12 items-center justify-center mb-3 ${
          ready ? 'bg-black active:opacity-70' : 'bg-gray-200'
        }`}
      >
        <Text className={`font-semibold ${ready ? 'text-white' : 'text-gray-400'}`}>Continue</Text>
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
