import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { useVault } from '@/contexts/VaultContext';
import { getUnlockLabels } from '@/lib/auth/deviceAuth';

/**
 * What replaced the PIN pad.
 *
 * There is nothing to type: the prompt is the OS's own, so it accepts Face ID,
 * Touch ID, a fingerprint, or the device passcode -- whatever this device
 * actually has. The button exists only for the case where the user dismissed
 * that prompt and wants it back; the prompt itself is raised automatically on
 * mount, so the common path is glance-and-in with no taps at all.
 */
export function LockScreen() {
  const { unlock } = useVault();
  const [busy, setBusy] = useState(true);
  const [phrase, setPhrase] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getUnlockLabels().then((l) => {
      if (!cancelled) setPhrase(l.phrase);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const attempt = React.useCallback(async () => {
    setBusy(true);
    try {
      await unlock();
    } finally {
      setBusy(false);
    }
  }, [unlock]);

  // Once per mount, not once per render. Without the ref, a re-render while
  // the OS prompt is already up would stack a second prompt on top of it --
  // which on iOS cancels the first and reads to the user as a flicker.
  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    void attempt();
  }, [attempt]);

  return (
    <View className="flex-1 items-center justify-center px-8 bg-background">
      <View className="w-16 h-16 rounded-full bg-muted items-center justify-center mb-6">
        <Icon as={Lock} className="w-7 h-7 text-muted-foreground" />
      </View>

      <Text className="text-xl font-semibold text-foreground mb-2">Notes are locked</Text>
      {/* Empty until the device has been asked what it offers. Rendering a
          guess first and correcting it a frame later is worse than a beat of
          nothing, because the guess is wrong on one platform or the other. */}
      <Text className="text-sm text-muted-foreground text-center mb-8 min-h-[20px]">
        {phrase ? `Unlock with ${phrase}.` : ''}
      </Text>

      <Pressable
        onPress={() => void attempt()}
        disabled={busy}
        className={`rounded-2xl h-12 px-8 items-center justify-center ${
          busy ? 'bg-muted' : 'bg-primary active:opacity-70'
        }`}
      >
        <Text className={`font-semibold ${busy ? 'text-muted-foreground' : 'text-primary-foreground'}`}>
          {busy ? 'Waiting…' : 'Unlock'}
        </Text>
      </Pressable>
    </View>
  );
}
