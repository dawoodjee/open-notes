import React, { useCallback } from 'react';
import { Pressable, View, type PressableProps, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { PRESS_SCALE, SPRING_PRESS, spring } from '@/lib/theme/motion';

/**
 * A Pressable that springs down slightly while held.
 *
 * WHY THIS EXISTS RATHER THAN `active:opacity-70` ON EACH PRESSABLE: there are
 * ~25 of those scattered through the app and they are not animated at all --
 * NativeWind's `active:` variant swaps the style instantly on press and
 * instantly back on release. The result reads as a flicker rather than as the
 * surface responding to a finger. This gives the press an actual curve, from
 * lib/theme/motion.ts, so every consumer moves the same way.
 *
 * STRUCTURE, and it is load-bearing -- three nested views, each doing exactly
 * one job:
 *
 *   Pressable      catches touches, no styling
 *   Animated.View  carries ONLY the transform, no className
 *   View           carries ONLY the className, no animation
 *
 * The obvious version puts className and the animated style on the same
 * Animated.View. That silently does nothing: NativeWind compiles className
 * into its own `style` and hands it to the component, clobbering the animated
 * style passed alongside it. The card renders perfectly and simply never
 * moves -- no error, no warning. Verified by diffing frames of a recorded
 * press: zero changed pixels in the card region.
 *
 * Splitting them means neither prop can overwrite the other. The transform is
 * on the parent, so the whole painted box scales -- background and border
 * included -- rather than just the contents shrinking inside a fixed card.
 */
export function PressableScale({
  children,
  className,
  style,
  onPressIn,
  onPressOut,
  scaleTo = PRESS_SCALE,
  ...pressableProps
}: Omit<PressableProps, 'children'> & {
  /** Plain nodes only. Pressable's render-prop children form is deliberately
   *  not supported: the pressed state it reports is exactly what this
   *  component already expresses through the spring. */
  children?: React.ReactNode;
  className?: string;
  style?: ViewStyle;
  /** Override the resting-while-held scale. Defaults to the shared token. */
  scaleTo?: number;
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback<NonNullable<PressableProps['onPressIn']>>(
    (event) => {
      scale.value = spring(scaleTo, SPRING_PRESS);
      onPressIn?.(event);
    },
    [onPressIn, scale, scaleTo]
  );

  const handlePressOut = useCallback<NonNullable<PressableProps['onPressOut']>>(
    (event) => {
      scale.value = spring(1, SPRING_PRESS);
      onPressOut?.(event);
    },
    [onPressOut, scale]
  );

  return (
    <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut} {...pressableProps}>
      <Animated.View style={animatedStyle}>
        <View className={className} style={style}>
          {children}
        </View>
      </Animated.View>
    </Pressable>
  );
}
