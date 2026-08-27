import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Delete } from 'lucide-react-native';

import { Icon } from '@/components/ui/icon';
import { haptics } from '@/lib/theme/haptics';

/**
 * Six-digit entry, used for both setting a passcode and entering one.
 *
 * ── WHY A KEYPAD ON A PLATFORM WITH A KEYBOARD ────────────────────────────
 *
 * The obvious web control is a text input with `inputMode="numeric"`, and it is
 * the wrong one here for two reasons. A passcode has a fixed length, so the
 * filling dots tell the user exactly where they are without a caret; and a text
 * input invites autofill and password managers to offer the WRONG secret --
 * this is the app's own PIN, not the machine's login, and a manager prompting
 * for the latter is how people end up typing their computer password into a
 * web page.
 *
 * Physical keys still work, because refusing them on a device with a keyboard
 * would be perverse. Both routes land in the same handler.
 */

export const PASSCODE_LENGTH = 6;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

export function PasscodePad({
  value,
  onChange,
  onComplete,
  disabled = false,
  shake = false,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Fired once the sixth digit lands, so no confirm button is needed. */
  onComplete: (code: string) => void;
  disabled?: boolean;
  /** Set after a wrong code; drives the dots' error colour. */
  shake?: boolean;
}) {
  const press = useCallback(
    (key: string) => {
      if (disabled) return;
      if (key === 'del') {
        haptics.tap();
        onChange(value.slice(0, -1));
        return;
      }
      if (value.length >= PASSCODE_LENGTH) return;
      haptics.tap();
      const next = value + key;
      onChange(next);
      if (next.length === PASSCODE_LENGTH) onComplete(next);
    },
    [disabled, onChange, onComplete, value]
  );

  // Hardware keyboard. Web only -- there is no document to listen on in React
  // Native, and this component is only ever rendered on web today.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (event: KeyboardEvent) => {
      if (event.key >= '0' && event.key <= '9') press(event.key);
      else if (event.key === 'Backspace') press('del');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [press]);

  return (
    <View className="items-center">
      <View className="flex-row gap-4 mb-10" accessibilityRole="progressbar">
        {Array.from({ length: PASSCODE_LENGTH }, (_, i) => (
          <View
            key={i}
            className={`w-3.5 h-3.5 rounded-full ${
              shake
                ? 'bg-red-500'
                : i < value.length
                  ? 'bg-lime-500'
                  : 'bg-foreground/20'
            }`}
          />
        ))}
      </View>

      <View className="flex-row flex-wrap justify-center" style={{ width: 260 }}>
        {KEYS.map((key, i) =>
          key === '' ? (
            <View key={i} style={{ width: 80, height: 72 }} />
          ) : (
            <Pressable
              key={i}
              onPress={() => press(key)}
              disabled={disabled}
              style={{ width: 80, height: 72, alignItems: 'center', justifyContent: 'center' }}
              accessibilityRole="button"
              accessibilityLabel={key === 'del' ? 'Delete' : key}
            >
              {({ pressed }) => (
                <View
                  className={`w-14 h-14 rounded-full items-center justify-center ${
                    pressed ? 'bg-foreground/10' : 'bg-transparent'
                  }`}
                >
                  {key === 'del' ? (
                    <Icon as={Delete} className="w-6 h-6 text-foreground" />
                  ) : (
                    <Text className="text-2xl text-foreground">{key}</Text>
                  )}
                </View>
              )}
            </Pressable>
          )
        )}
      </View>
    </View>
  );
}

/** Small helper both callers need: clear the code after a failure, briefly
 *  showing the error state first so the user sees that it was rejected. */
export function usePasscodeError(): [boolean, () => void] {
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(false), 600);
    return () => clearTimeout(timer);
  }, [error]);
  return [error, useCallback(() => setError(true), [])];
}
