import React from 'react';
import { Animated, Easing, StyleSheet, Text as RNText, View } from 'react-native';
import { Input, InputField, InputSlot } from '@/components/ui/input';
import { VStack } from '@/components/ui/vstack';
import { Icon } from '@/components/ui/icon';
import { Check, X } from 'lucide-react-native';

export type FieldTone = 'neutral' | 'ok' | 'error';

export interface AccountFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  autoCapitalize?: 'none' | 'sentences';
  keyboardType?: 'default' | 'email-address';
  /** Show the in-field commit button at all (i.e. the value would change). */
  showAction?: boolean;
  /** Whether that button is usable -- green tick vs grey cross. */
  canCommit?: boolean;
  onCommit?: () => void;
  /** One line under the field. Always occupies its slot, so fields don't
   *  shift vertically as messages come and go. */
  status?: string;
  statusTone?: FieldTone;
  /** Increment to pulse the border pink -- see the note on `flash` below. */
  flash?: number;
}

/**
 * One account field: the input, its in-field commit button, and a fixed slot
 * for its status line.
 *
 * The status line reserves its height even when empty. Without that, a field
 * grows by a line the moment "Checking availability…" appears and everything
 * below jumps -- including the button you were about to tap.
 *
 * The button lives inside the input's border rather than beside it, so the
 * two read as one control. Its two states are deliberately distinguishable
 * by shape as well as colour (tick vs cross), not colour alone -- green and
 * grey are hard to tell apart with the common forms of colour blindness, and
 * "can I submit this?" shouldn't depend on seeing hue.
 */
export default function AccountField({
  value,
  onChangeText,
  placeholder,
  autoCapitalize = 'sentences',
  keyboardType = 'default',
  showAction = false,
  canCommit = false,
  onCommit,
  status,
  statusTone = 'neutral',
  flash = 0,
}: AccountFieldProps) {
  // Pulses a pink border twice when `flash` changes, then fades back out.
  //
  // A counter rather than a boolean: the same field can be rejected twice in a
  // row (tap close, tap close again), and a boolean that's already true won't
  // re-trigger an effect -- the second tap would look like nothing happened.
  // Bumping a number always registers as a change.
  //
  // Animated rather than toggling a class on a timer. Snapping between two
  // colours every 160ms read as a glitch rather than a signal; easing the
  // opacity in and out over about a second is long enough for the eye to
  // follow to the field that's actually the problem, which is the whole job
  // of this animation.
  //
  // The pink lives on an overlay rather than on the Input itself. The input's
  // own border is styled by Gluestack and changes with focus state, so
  // animating it would mean fighting that; a sibling layer on top composites
  // cleanly and can't disturb the layout. pointerEvents="none" keeps it from
  // swallowing taps meant for the field beneath.
  //
  // useNativeDriver works here only because this animates opacity. Layout and
  // colour properties can't cross to the native thread, so the same trick on
  // borderColor would have to run in JS and would stutter under load --
  // another reason the pink is a separate layer being faded rather than the
  // input's own border being recoloured.
  const flashOpacity = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!flash) return;
    const pulse = (toValue: number, duration: number) =>
      Animated.timing(flashOpacity, {
        toValue,
        duration,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      });

    // Two pulses, ~1.1s total, with a longer tail on the last fade so it
    // settles rather than stopping dead.
    const animation = Animated.sequence([
      pulse(1, 260),
      pulse(0, 240),
      pulse(1, 260),
      pulse(0, 380),
    ]);
    animation.start();
    return () => {
      animation.stop();
      flashOpacity.setValue(0);
    };
  }, [flash, flashOpacity]);

  const statusColor =
    statusTone === 'ok'
      ? 'text-green-600'
      : statusTone === 'error'
        ? 'text-pink-600'
        : 'text-muted-foreground';

  return (
    <VStack className="gap-1.5">
      <View>
        <Input className="rounded-2xl h-12 pl-4 pr-1.5">
          <InputField
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            autoCapitalize={autoCapitalize}
            keyboardType={keyboardType}
            className="text-base"
          />
          {showAction && (
            <InputSlot
              onPress={canCommit ? onCommit : undefined}
              disabled={!canCommit}
              className={`w-9 h-9 rounded-xl items-center justify-center ${
                canCommit ? 'bg-lime-500 active:bg-lime-600' : 'bg-muted'
              }`}
            >
              <Icon as={canCommit ? Check : X} className="text-on-accent w-4 h-4" />
            </InputSlot>
          )}
        </Input>

        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFillObject, { opacity: flashOpacity }]}
          className="rounded-2xl border-2 border-pink-500"
        />
      </View>

      <RNText className={`text-xs px-1 h-4 ${statusColor}`}>{status ?? ''}</RNText>
    </VStack>
  );
}
