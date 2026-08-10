import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { useVault } from '@/contexts/VaultContext';

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
  const attempted = useRef(false);

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
    <View className="flex-1 items-center justify-center px-8 bg-white">
      <View className="w-16 h-16 rounded-full bg-gray-100 items-center justify-center mb-6">
        <Icon as={Lock} className="w-7 h-7 text-gray-500" />
      </View>

      <Text className="text-xl font-semibold text-gray-900 mb-2">Notes are locked</Text>
      <Text className="text-sm text-gray-500 text-center mb-8">
        Unlock with Face ID, Touch ID, or your device passcode.
      </Text>

      <Pressable
        onPress={() => void attempt()}
        disabled={busy}
        className={`rounded-2xl h-12 px-8 items-center justify-center ${
          busy ? 'bg-gray-200' : 'bg-black active:opacity-70'
        }`}
      >
        <Text className={`font-semibold ${busy ? 'text-gray-400' : 'text-white'}`}>
          {busy ? 'Waiting…' : 'Unlock'}
        </Text>
      </Pressable>
    </View>
  );
}
