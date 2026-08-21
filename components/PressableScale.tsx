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
type PressableScaleProps = Omit<PressableProps, 'children' | 'style'> & {
  /** Plain nodes only. Pressable's render-prop children form is deliberately
   *  not supported: the pressed state it reports is exactly what this
   *  component already expresses through the spring. */
  children?: React.ReactNode;
  className?: string;
  /** Styling INSIDE the pressable -- padding, min-height, background. */
  style?: ViewStyle;
  /**
   * How this pressable sits in ITS PARENT: `flex`, `width`, `alignSelf`.
   *
   * Separate from `style` because of the three-view structure below. `style`
   * lands on the innermost View, and a `flex: 1` there is measured against the
   * Animated.View above it -- which is itself content-sized, so the flex
   * resolves against nothing and the whole stack collapses to its content.
   *
   * Invisible in a COLUMN parent, where the default align-stretch gives full
   * width anyway. It bites in a ROW parent: the folder sidebar's rows sized
   * themselves to their icon and count, and the label -- `flex-1` inside a
   * container with no width to divide -- rendered at zero width and vanished
   * entirely. No error, no warning, just no text.
   */
  containerStyle?: ViewStyle;
  /** Override the resting-while-held scale. Defaults to the shared token. */
  scaleTo?: number;
};

/**
 * `forwardRef` so this can double as a Gluestack `Menu` trigger, which needs
 * a ref to the real native node to measure where to draw the popover. A
 * plain function component drops an incoming `ref` silently -- React treats
 * it as a reserved prop, not a regular one -- so without this the ref would
 * just be `null` and the menu would have nothing to position itself against.
 * None of this component's existing callers pass a ref, so it changes
 * nothing for them.
 */
export const PressableScale = React.forwardRef<View, PressableScaleProps>(function PressableScale(
  {
    children,
    className,
    style,
    containerStyle,
    onPressIn,
    onPressOut,
    scaleTo = PRESS_SCALE,
    ...pressableProps
  },
  ref
) {
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
    <Pressable
      ref={ref}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={containerStyle}
      {...pressableProps}
    >
      {/* alignSelf: 'stretch' keeps the transform wrapper transparent to
          layout. Without it this view is content-sized, so anything below it
          measuring against a width has nothing to measure. */}
      <Animated.View style={[{ alignSelf: 'stretch' }, animatedStyle]}>
        <View className={className} style={style}>
          {children}
        </View>
      </Animated.View>
    </Pressable>
  );
});

PressableScale.displayName = 'PressableScale';
