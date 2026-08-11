import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { KeyStepScreen } from '@/components/KeyStepScreen';

/**
 * The only moment the recovery code exists in readable form.
 *
 * It is not stored anywhere decryptable, is deliberately never emailed (an
 * inbox that can also receive a sign-in link would otherwise be a single point
 * of total compromise), and cannot be regenerated.
 *
 * Hence typing it back rather than a checkbox: "I saved it" is a box people
 * tick reflexively. Transcribing 25 characters is weak proof, but it is proof.
 *
 * Lifted out of the old PinScreen so it could outlive it -- the recovery code
 * is about transporting the key to another device, which has nothing to do
 * with how this device unlocks.
 */
export function RecoveryCodeView({
  code,
  onConfirmed,
  onCancel,
  headline = 'Save your recovery code',
  blurb = 'This is the only way to read your notes on a new device. Write it down somewhere safe. We can’t show it again, and we can’t recover it for you.',
}: {
  code: string;
  onConfirmed: () => void | Promise<void>;
  /**
   * Required, deliberately. This screen blocks the entire app, and it shipped
   * with no way off it at all -- the only exit was force-quitting. A required
   * prop is what stops a future caller from reintroducing that: you cannot
   * mount this component without saying how someone leaves it.
   */
  onCancel: () => void;
  headline?: string;
  blurb?: string;
}) {
  const [step, setStep] = useState<'save' | 'verify'>('save');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const { normalized, matches } = useMemo(() => {
    const strip = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '');
    return { normalized: strip(typed), matches: strip(typed) === strip(code) };
  }, [typed, code]);

  if (step === 'save') {
    return (
      <KeyStepScreen onCancel={onCancel}>
        <Text className="text-xl font-semibold text-foreground mb-3">{headline}</Text>
        <Text className="text-sm text-muted-foreground mb-6">{blurb}</Text>

        <View className="bg-muted rounded-2xl py-5 px-4 mb-6">
          <Text className="text-center text-lg tracking-widest text-foreground font-mono">{code}</Text>
        </View>

        <Pressable
          onPress={() => setStep('verify')}
          className="bg-black rounded-2xl h-12 items-center justify-center active:opacity-70"
        >
          <Text className="text-white font-semibold">I&apos;ve written it down</Text>
        </Pressable>
      </KeyStepScreen>
    );
  }

  return (
    // cancelDisabled while busy: onConfirmed() is markRecoveryConfirmed()
    // followed by the upload of this device's key as the account's. Cancelling
    // concurrently would race a local sign-out against a key upload for the
    // very account being signed out of.
    <KeyStepScreen onCancel={onCancel} cancelDisabled={busy}>
      <Text className="text-xl font-semibold text-foreground mb-3">Type it back</Text>
      <Text className="text-sm text-muted-foreground mb-6">
        Just to be sure you have it. Dashes and capitals don&apos;t matter.
      </Text>

      <RecoveryCodeInput value={typed} onChange={setTyped} />

      <View className="h-8 justify-center">
        <Text className="text-sm text-muted-foreground">
          {normalized.length === 0
            ? ''
            : matches
              ? 'That matches.'
              : `${normalized.length} of 25 characters`}
        </Text>
      </View>

      <Pressable
        onPress={async () => {
          setBusy(true);
          try {
            await onConfirmed();
          } finally {
            setBusy(false);
          }
        }}
        disabled={!matches || busy}
        className={`rounded-2xl h-12 items-center justify-center ${
          matches && !busy ? 'bg-black active:opacity-70' : 'bg-muted'
        }`}
      >
        <Text className={`font-semibold ${matches && !busy ? 'text-white' : 'text-muted-foreground'}`}>
          {busy ? 'Saving…' : 'Done'}
        </Text>
      </Pressable>
    </KeyStepScreen>
  );
}

export function RecoveryCodeInput({
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
      className="border border-border rounded-2xl h-12 px-4 text-base text-foreground tracking-wider"
    />
  );
}
