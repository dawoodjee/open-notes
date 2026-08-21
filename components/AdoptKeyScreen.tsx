import React, { useCallback, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LegacyRecoveryCodeInput, RecoveryCodeInput } from '@/components/RecoveryCodeView';
import { KeyStepScreen, confirmSignOut } from '@/components/KeyStepScreen';
import { getPendingAdoption, subscribePendingAdoption } from '@/lib/crypto/adoption';
import {
  RECOVERY_WORDS,
  WrongRecoveryCodeError,
  isWellFormedRecoveryCode,
  resolveRecoveryFormat,
} from '@/lib/crypto/keys';

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

  // Which format THIS account's blob was written in, taken from the record
  // that was just fetched -- never assumed. An account claimed before word
  // codes existed has no `format` in its kdf_params, and its owner is holding
  // a 25-character code; showing them twelve word slots would be a screen they
  // could not possibly complete.
  const format = resolveRecoveryFormat(pending?.record.kdfParams);
  const isWords = format === 'words12';

  const [words, setWords] = useState<string[]>(() => Array(RECOVERY_WORDS).fill(''));
  const [legacyCode, setLegacyCode] = useState('');
  const code = isWords ? words.join(' ') : legacyCode;
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

  /**
   * Leaving here is not destructive -- no note is touched and no key is
   * written -- but it does mean this device carries on unable to read the
   * account's notes, so the wording says exactly that.
   */
  const onCancel = useCallback(() => {
    if (!pending) return;
    confirmSignOut(
      "Your notes stay on this device. You won't be able to read this account's notes here until you enter the recovery code.",
      () => void pending.cancel()
    );
  }, [pending]);

  if (!pending) return null;

  const ready = isWellFormedRecoveryCode(code, format) && !busy;

  return (
    // cancelDisabled while busy is load-bearing here specifically: submit()
    // unwraps the account key, calls adoptAccountDataKey, and then rewrites
    // every local note through reEncryptLocalNotes. A sign-out landing
    // mid-rewrite is the one genuinely damaging thing a stray tap on these
    // screens could do.
    <KeyStepScreen onCancel={onCancel} cancelDisabled={busy}>
      <Text className="text-xl font-semibold text-foreground mb-3">Unlock your notes here</Text>
      <Text className="text-sm text-muted-foreground mb-6">
        This account&apos;s notes were encrypted on another device. Enter your recovery code to
        unlock them here. We can&apos;t do this for you — the code is the only thing that can.
      </Text>

      {isWords ? (
        <RecoveryCodeInput value={words} onChange={setWords} />
      ) : (
        <LegacyRecoveryCodeInput value={legacyCode} onChange={setLegacyCode} />
      )}

      <View className="h-8 justify-center">
        <Text className={`text-sm ${error ? 'text-destructive' : 'text-muted-foreground'}`}>{error ?? ''}</Text>
      </View>

      <Pressable
        onPress={() => void submit()}
        disabled={!ready}
        className={`rounded-2xl h-12 items-center justify-center ${
          ready ? 'bg-primary active:opacity-70' : 'bg-muted'
        }`}
      >
        <Text className={`font-semibold ${ready ? 'text-primary-foreground' : 'text-muted-foreground'}`}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </Text>
      </Pressable>

      {/* The "Sign out instead" link that used to sit here is gone -- leaving
          is now the X in the header, the same control key setup has. */}
      <Text className="text-xs text-muted-foreground mt-4">
        Don&apos;t have it? Any device still signed in to this account can read these notes. Without
        the code and without such a device, they can&apos;t be recovered by anyone.
      </Text>
    </KeyStepScreen>
  );
}
