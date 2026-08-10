import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { RecoveryCodeView } from '@/components/RecoveryCodeView';
import { getPendingKeySetup, subscribePendingKeySetup } from '@/lib/crypto/keySetup';
import { addRecoveryCode, markRecoveryConfirmed } from '@/lib/crypto/vault';

export function usePendingKeySetup() {
  return useSyncExternalStore(subscribePendingKeySetup, getPendingKeySetup, getPendingKeySetup);
}

/**
 * Shown once, immediately after a device's first sign-in.
 *
 * This is the ceremony that used to happen on first launch, before the user
 * had written anything -- moved to the first moment it actually means
 * something. Before signing in, the notes live on one device and the keychain
 * is the whole story. After signing in they're in Postgres as ciphertext, and
 * the recovery code is the only thing that can ever decrypt them anywhere
 * else.
 *
 * Sync stays disconnected until this finishes. Uploading first would mean
 * ciphertext on the server whose key exists on exactly one device with no way
 * off it -- a backup that cannot be restored.
 */
export function SecureAccountScreen() {
  const pending = usePendingKeySetup();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const generated = await addRecoveryCode();
        if (!cancelled) setCode(generated);
      } catch {
        if (!cancelled) setError('Could not prepare a recovery code on this device.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onConfirmed = useCallback(async () => {
    if (!pending) return;
    // Order matters: the code is only "real" once it's confirmed, and
    // getKeyBackupPayload() refuses to hand over an unconfirmed one -- so
    // marking it first is what lets the upload in complete() succeed.
    await markRecoveryConfirmed();
    await pending.complete();
  }, [pending]);

  if (!pending) return null;

  if (error) {
    return (
      <View className="flex-1 justify-center px-8">
        <Text className="text-xl font-semibold text-gray-900 mb-3">Something went wrong</Text>
        <Text className="text-sm text-gray-500 mb-6">{error}</Text>
        <Pressable
          onPress={() => void pending.cancel()}
          className="h-12 items-center justify-center active:opacity-60"
        >
          <Text className="text-gray-500">Sign out</Text>
        </Pressable>
      </View>
    );
  }

  if (!code) {
    return <View className="flex-1 bg-white" />;
  }

  return (
    <RecoveryCodeView
      code={code}
      onConfirmed={onConfirmed}
      headline="Save your recovery code"
      blurb="Your notes are encrypted so that only your devices can read them. This code is the only way to open them on a new device — write it down somewhere safe. We can’t show it again, and we can’t recover it for you."
    />
  );
}
