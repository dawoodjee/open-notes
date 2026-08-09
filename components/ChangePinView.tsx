import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ChevronLeft } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { PIN_LENGTH, PinPad } from '@/components/PinScreen';
import { WrongPinError } from '@/lib/crypto/keys';
import { changePin } from '@/lib/crypto/vault';

/**
 * Changing the PIN is a RE-WRAP, not a re-encryption.
 *
 * The data key never changes -- only the ~200-byte blob in the Keychain that
 * wraps it does. So every note's stored ciphertext is byte-for-byte identical
 * afterwards, nothing is queued for upload, and the operation costs one scrypt
 * derivation rather than touching the whole database.
 *
 * That property is the entire reason the key model has a data key at all,
 * rather than deriving an encryption key from the PIN directly. Under that
 * simpler design, changing your PIN would mean decrypting and re-encrypting
 * every note -- slow, and a window where a crash leaves half the database
 * under each key.
 */

type Step = 'old' | 'new' | 'confirm' | 'done';

export function ChangePinView({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<Step>('old');
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const handleComplete = useCallback(
    async (pin: string) => {
      setError(undefined);

      if (step === 'old') {
        setOldPin(pin);
        setValue('');
        setStep('new');
        return;
      }

      if (step === 'new') {
        if (pin === oldPin) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setError('That is your current PIN. Choose a different one.');
          setValue('');
          return;
        }
        setNewPin(pin);
        setValue('');
        setStep('confirm');
        return;
      }

      if (pin !== newPin) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError("Those didn't match. Enter your new PIN again.");
        setValue('');
        setStep('new');
        return;
      }

      setBusy(true);
      try {
        // Throws WrongPinError before writing anything if the old PIN was
        // wrong -- which is only discovered here, at the end, because that is
        // the first moment we actually try to unwrap with it.
        await changePin(oldPin, newPin);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setStep('done');
      } catch (err) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError(
          err instanceof WrongPinError
            ? 'Your current PIN was incorrect. Start again.'
            : 'Could not change your PIN.'
        );
        setOldPin('');
        setNewPin('');
        setValue('');
        setStep('old');
      } finally {
        setBusy(false);
      }
    },
    [step, oldPin, newPin]
  );

  useEffect(() => {
    if (value.length === PIN_LENGTH && step !== 'done') void handleComplete(value);
  }, [value, step, handleComplete]);

  if (step === 'done') {
    return (
      <View className="flex-1 justify-center px-8">
        <Text className="text-xl font-semibold text-gray-900 mb-3">PIN changed</Text>
        <Text className="text-sm text-gray-500 mb-6">
          Your notes were not re-encrypted and nothing was re-uploaded — only the PIN that unlocks
          this device changed. Your recovery code is unchanged and still works.
        </Text>
        <Pressable
          onPress={onBack}
          className="bg-black rounded-2xl h-12 items-center justify-center active:opacity-70"
        >
          <Text className="text-white font-semibold">Done</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1">
      <Pressable onPress={onBack} className="flex-row items-center px-2 py-3 active:opacity-60">
        <Icon as={ChevronLeft} className="text-gray-500 w-5 h-5" />
        <Text className="text-base text-gray-500">Settings</Text>
      </Pressable>

      <PinPad
        title={
          step === 'old' ? 'Enter your current PIN' : step === 'new' ? 'Choose a new PIN' : 'Confirm your new PIN'
        }
        subtitle={
          step === 'old'
            ? 'This proves the change is really you.'
            : step === 'new'
              ? 'Six digits.'
              : 'Enter the same six digits again.'
        }
        error={error}
        busy={busy}
        value={value}
        onChange={setValue}
      />
    </View>
  );
}
