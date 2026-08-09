import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Delete } from 'lucide-react-native';
import { useVault } from '@/contexts/VaultContext';
import { WrongPinError } from '@/lib/crypto/keys';

export const PIN_LENGTH = 6;

// --- shared keypad ----------------------------------------------------------

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

function PinPad({
  title,
  subtitle,
  error,
  busy,
  value,
  onChange,
}: {
  title: string;
  subtitle?: string;
  error?: string;
  busy?: boolean;
  value: string;
  onChange: (next: string) => void;
}) {
  const press = (key: string) => {
    if (busy) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (key === '⌫') {
      onChange(value.slice(0, -1));
    } else if (key !== '' && value.length < PIN_LENGTH) {
      onChange(value + key);
    }
  };

  return (
    <View className="flex-1 items-center justify-center px-8">
      <Text className="text-xl font-semibold text-gray-900 text-center">{title}</Text>

      {/* Fixed height so the dots never jump when the subtitle wraps or the
          error appears -- the same fixed-slot approach as AccountField. */}
      <View className="h-12 justify-center">
        <Text className="text-sm text-gray-500 text-center">{subtitle ?? ''}</Text>
      </View>

      <View className="flex-row gap-4 mb-4">
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View
            key={i}
            className={`w-3.5 h-3.5 rounded-full ${
              i < value.length ? 'bg-gray-900' : 'bg-gray-300'
            }`}
          />
        ))}
      </View>

      <View className="h-8 justify-center">
        <Text className="text-sm text-red-500 text-center">
          {busy ? 'Checking…' : (error ?? '')}
        </Text>
      </View>

      <View className="flex-row flex-wrap justify-center" style={{ width: 300 }}>
        {KEYS.map((key, i) => (
          <Pressable
            key={i}
            onPress={() => press(key)}
            disabled={key === '' || busy}
            className="w-[100px] h-[76px] items-center justify-center active:opacity-40"
          >
            {key === '⌫' ? (
              <Delete size={26} color="#111827" />
            ) : (
              <Text className="text-3xl text-gray-900">{key}</Text>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// --- unlock -----------------------------------------------------------------

/**
 * Escalating delay after repeated wrong PINs.
 *
 * This is a speed bump for someone tapping at the screen, and nothing more --
 * an attacker with the device image bypasses the UI entirely and attacks the
 * wrapped blob directly. The real cost imposed on them is scrypt (~1s per
 * guess by construction), not this counter. Worth being clear about, because
 * a lockout screen can easily read as stronger protection than it is.
 */
function penaltyMs(failures: number): number {
  if (failures < 5) return 0;
  return Math.min(30_000, 2 ** (failures - 5) * 1000);
}

export function PinUnlockScreen() {
  const { unlock } = useVault();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const failures = useRef(0);

  const submit = useCallback(
    async (pin: string) => {
      setBusy(true);
      setError(undefined);
      try {
        const wait = penaltyMs(failures.current);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));

        await unlock(pin);
        failures.current = 0;
      } catch (err) {
        failures.current += 1;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError(
          err instanceof WrongPinError
            ? failures.current >= 5
              ? 'Incorrect PIN. Further attempts are slowed down.'
              : 'Incorrect PIN.'
            : 'Something went wrong unlocking your notes.'
        );
        setValue('');
      } finally {
        setBusy(false);
      }
    },
    [unlock]
  );

  useEffect(() => {
    if (value.length === PIN_LENGTH) void submit(value);
  }, [value, submit]);

  return (
    <PinPad
      title="Enter your PIN"
      subtitle="Your notes are encrypted on this device."
      error={error}
      busy={busy}
      value={value}
      onChange={setValue}
    />
  );
}

// --- setup ------------------------------------------------------------------

type SetupStep = 'choose' | 'confirm' | 'save-code' | 'verify-code';

export function PinSetupScreen() {
  const { beginSetup, finishSetup } = useVault();
  const [step, setStep] = useState<SetupStep>('choose');
  const [first, setFirst] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [typedCode, setTypedCode] = useState('');

  const onPinComplete = useCallback(
    async (pin: string) => {
      if (step === 'choose') {
        setFirst(pin);
        setValue('');
        setError(undefined);
        setStep('confirm');
        return;
      }

      if (pin !== first) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError("Those PINs didn't match. Start again.");
        setFirst('');
        setValue('');
        setStep('choose');
        return;
      }

      setBusy(true);
      try {
        setRecoveryCode(await beginSetup(pin));
        setStep('save-code');
      } catch {
        setError('Could not set up encryption on this device.');
        setValue('');
        setStep('choose');
      } finally {
        setBusy(false);
      }
    },
    [step, first, beginSetup]
  );

  useEffect(() => {
    if (value.length === PIN_LENGTH && (step === 'choose' || step === 'confirm')) {
      void onPinComplete(value);
    }
  }, [value, step, onPinComplete]);

  if (step === 'save-code' || step === 'verify-code') {
    return (
      <RecoveryCodeStep
        code={recoveryCode}
        step={step}
        typed={typedCode}
        onTyped={setTypedCode}
        onContinue={() => setStep('verify-code')}
        onConfirmed={finishSetup}
      />
    );
  }

  return (
    <PinPad
      title={step === 'choose' ? 'Choose a PIN' : 'Confirm your PIN'}
      subtitle={
        step === 'choose'
          ? 'Six digits. This unlocks your notes on this device.'
          : 'Enter the same six digits again.'
      }
      error={error}
      busy={busy}
      value={value}
      onChange={setValue}
    />
  );
}

// --- recovery code ----------------------------------------------------------

/**
 * The only moment the recovery code exists in readable form. It is not stored
 * anywhere decryptable, is deliberately never emailed (an inbox that can also
 * receive a sign-in link would otherwise be a single point of total
 * compromise), and cannot be regenerated.
 *
 * Hence typing it back rather than a checkbox: "I saved it" is a box people
 * tick reflexively. Transcribing 25 characters is weak proof, but it is proof.
 */
function RecoveryCodeStep({
  code,
  step,
  typed,
  onTyped,
  onContinue,
  onConfirmed,
}: {
  code: string;
  step: 'save-code' | 'verify-code';
  typed: string;
  onTyped: (next: string) => void;
  onContinue: () => void;
  onConfirmed: () => void | Promise<void>;
}) {
  const { normalized, matches } = React.useMemo(() => {
    const strip = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '');
    return { normalized: strip(typed), matches: strip(typed) === strip(code) };
  }, [typed, code]);

  if (step === 'save-code') {
    return (
      <View className="flex-1 justify-center px-8">
        <Text className="text-xl font-semibold text-gray-900 mb-3">Save your recovery code</Text>
        <Text className="text-sm text-gray-500 mb-6">
          This is the only way to read your notes on a new device, or if you forget your PIN. Write
          it down somewhere safe. We can&apos;t show it again, and we can&apos;t recover it for you.
        </Text>

        <View className="bg-gray-100 rounded-2xl py-5 px-4 mb-6">
          <Text className="text-center text-lg tracking-widest text-gray-900 font-mono">{code}</Text>
        </View>

        <Pressable
          onPress={onContinue}
          className="bg-gray-900 rounded-2xl h-12 items-center justify-center active:opacity-70"
        >
          <Text className="text-white font-semibold">I&apos;ve written it down</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 justify-center px-8">
      <Text className="text-xl font-semibold text-gray-900 mb-3">Type it back</Text>
      <Text className="text-sm text-gray-500 mb-6">
        Just to be sure you have it. Dashes and capitals don&apos;t matter.
      </Text>

      <RecoveryCodeInput value={typed} onChange={onTyped} />

      <View className="h-8 justify-center">
        <Text className="text-sm text-gray-500">
          {normalized.length === 0
            ? ''
            : matches
              ? 'That matches.'
              : `${normalized.length} of 25 characters`}
        </Text>
      </View>

      <Pressable
        onPress={() => void onConfirmed()}
        disabled={!matches}
        className={`rounded-2xl h-12 items-center justify-center ${
          matches ? 'bg-gray-900 active:opacity-70' : 'bg-gray-200'
        }`}
      >
        <Text className={`font-semibold ${matches ? 'text-white' : 'text-gray-400'}`}>
          Finish setup
        </Text>
      </Pressable>
    </View>
  );
}

function RecoveryCodeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      autoCapitalize="characters"
      autoCorrect={false}
      spellCheck={false}
      placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
      placeholderTextColor="#9CA3AF"
      className="border border-gray-300 rounded-2xl h-12 px-4 text-base text-gray-900 tracking-wider"
    />
  );
}
