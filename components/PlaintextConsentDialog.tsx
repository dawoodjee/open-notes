import React, { useSyncExternalStore } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import { getPendingConsent, subscribePendingConsent } from '@/lib/plaintext/consent';

export function usePendingConsent() {
  return useSyncExternalStore(subscribePendingConsent, getPendingConsent, getPendingConsent);
}

/**
 * The first time plaintext is about to go to a given destination.
 *
 * Names the host rather than describing the action, because the host is the
 * part the user can actually judge. "Summarise this note" tells you nothing;
 * "send it to api.example.com" tells you everything you need to decide.
 *
 * Deny is the softer-styled option but not the buried one -- this is a
 * question, not a confirmation of something already decided.
 */
export function PlaintextConsentDialog() {
  const pending = usePendingConsent();
  if (!pending) return null;

  const { endpoint, purpose, noteCount, approve, deny } = pending;
  const host = (() => {
    try {
      return new URL(endpoint.url).host;
    } catch {
      return endpoint.url;
    }
  })();

  return (
    <View className="absolute inset-0 items-center justify-center px-8 bg-black/40">
      <View className="w-full rounded-2xl bg-background p-6">
        <RNText className="text-lg font-semibold text-foreground mb-2">
          Send {noteCount === 1 ? 'this note' : `${noteCount} notes`} to {host}?
        </RNText>
        <RNText className="text-sm text-muted-foreground mb-1">{purpose}</RNText>
        <RNText className="text-sm text-muted-foreground mb-5">
          The text will be decrypted on this device and sent as readable text. Your key stays here.
          You&apos;ll only be asked once for {endpoint.name || 'this endpoint'}.
        </RNText>

        <Pressable
          onPress={approve}
          className="rounded-2xl h-12 items-center justify-center bg-black active:opacity-70 mb-2"
        >
          <RNText className="text-white font-semibold">Send</RNText>
        </Pressable>
        <Pressable
          onPress={deny}
          className="rounded-2xl h-12 items-center justify-center active:bg-muted"
        >
          <RNText className="text-muted-foreground font-medium">Don&apos;t send</RNText>
        </Pressable>
      </View>
    </View>
  );
}
