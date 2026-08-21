import React, { useCallback, useEffect } from 'react';
import { Platform, Pressable, Text as RNText, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useDerivedValue,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Folder as FolderIcon, Pin, Share as ShareIcon, Trash2 } from 'lucide-react-native';

import { Icon } from '@/components/ui/icon';
import { spring, SPRING_EXPAND } from '@/lib/theme/motion';

/**
 * Swipe actions on a note row: right reveals Pin, left reveals Move + Delete.
 *
 * WHY THIS IS HAND-ROLLED -- re-decided 2026-08-22 after actually trying the
 * alternative. `ReanimatedSwipeable` was built out in full and reverted, because
 * on Android its LEFT action (Pin) rendered correctly but would not receive a
 * tap, while the right-hand three worked. The cause is structural: it lays both
 * action panels out as `StyleSheet.absoluteFillObject` siblings that each cover
 * the whole row, and it also ignores `activeOffsetX`/`failOffsetY` (those props
 * land on a View via prop-spreading; the pan is built from its own
 * `dragOffsetFrom*Edge`), so the scroll-conflict guards below would have been
 * silently inert too. It additionally has no full-swipe-to-commit, which this
 * file has had working all along. See the Decisions Log.
 *
 * The original reasoning, still true. The
 * reference has a two-stage gesture -- a short swipe REVEALS the buttons and
 * leaves them there, a long swipe COMMITS the outermost action without you
 * ever touching a button -- and the release has to use Stage 9's spring so it
 * feels like every other motion in the app. Both of those are the parts a
 * prebuilt Swipeable owns and does its own way.
 *
 * NATIVE ONLY. On web there is no swipe: the equivalent affordance is
 * right-click, which NoteRow already handles. Rendering the gesture layer
 * anyway would just add a pan recognizer that competes with text selection.
 *
 * ONE ROW OPEN AT A TIME. The parent owns `openId` -- a row that isn't the
 * open one springs shut. Letting each row keep its own state means swiping a
 * second row leaves the first hanging open behind it, and then a tap meant for
 * the list hits a stale Delete button.
 */

/** Width of one action slot: the capsule plus room for its label. */
const ACTION_WIDTH = 72;
/** Swipe-left reveals three actions, swipe-right one. */
const LEFT_ACTION_COUNT = 3;
/** Past this, a release snaps open instead of closed. */
const REVEAL_THRESHOLD = 44;
/**
 * Where a release stops revealing and starts ACTING.
 *
 * Two different numbers, because the two directions reveal different amounts.
 * Right shows one button, so committing past a bit over half the row is
 * comfortably clear of it. Left shows three -- 216pt of a 402pt row, which is
 * already 54% -- so a single shared fraction would have made "drag far enough
 * to see Share" and "delete this note" the same gesture. Left therefore has to
 * be dragged almost the whole way.
 */
const COMMIT_FRACTION_RIGHT = 0.55;
const COMMIT_FRACTION_LEFT = 0.9;

/**
 * The shape starts as a CIRCLE and STRETCHES into a capsule as the drag
 * deepens. Height and corner radius are fixed, so it stays fully rounded at
 * every width -- it reads as one shape growing, not a rectangle acquiring
 * rounded ends.
 *
 * MEASURED off mobile-swipe-left-actions.png rather than guessed: in that shot
 * the slot pitch is 176px on a 976px-wide crop of a 402pt screen (2.43 px/pt),
 * which is the 72pt ACTION_WIDTH above, and the capsule itself is ~150x105px,
 * so ~62x43pt at full reveal. 44 is the circle diameter, which doubles as the
 * minimum touch dimension.
 */
const CAPSULE_MIN_WIDTH = 44;
const CAPSULE_MAX_WIDTH = 62;
const CAPSULE_HEIGHT = 44;

/**
 * Tailwind's 500 and 600 steps, spelled as hex because these are ANIMATED.
 * interpolateColor works on the values themselves, so a NativeWind className
 * cannot participate -- it compiles down to a static style.
 */
const ACTION_COLORS = {
  pin: ['#84cc16', '#65a30d'], // lime-500 -> lime-600
  share: ['#3b82f6', '#2563eb'], // blue-500 -> blue-600
  move: ['#6366f1', '#4f46e5'], // indigo-500 -> indigo-600
  delete: ['#ef4444', '#dc2626'], // red-500 -> red-600
} as const;

export interface SwipeableNoteRowProps {
  id: string;
  isPinned: boolean;
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  onPin: () => void;
  onShare: () => void;
  onMove: () => void;
  onDelete: () => void;
  /**
   * TEST SEAM. Drives the row open without a gesture, so the revealed actions
   * can be exercised by an ordinary tap.
   *
   * WHY THIS EXISTS AS PRODUCTION CODE. Synthesised touches reach React
   * Native's own touch handling but never fire `UIGestureRecognizer`s, so on
   * the iOS Simulator a swipe cannot be automated at all -- which is how the
   * Pin action shipped broken once and was only caught by hand. Injected TAPS
   * do work on both platforms, so the only thing automation cannot do for
   * itself is the opening. This prop supplies exactly that and nothing more:
   * no behaviour, no state, no bypass of the real hit-testing that the bug
   * lived in.
   *
   * `NoteListPane` never passes it. `app/dev-swipe.tsx` is the only caller.
   */
  testOpen?: 'left' | 'right' | null;
  children: React.ReactNode;
}

export function SwipeableNoteRow({
  id,
  isPinned,
  openId,
  onOpenChange,
  onPin,
  onShare,
  onMove,
  onDelete,
  testOpen = null,
  children,
}: SwipeableNoteRowProps) {
  const translateX = useSharedValue(0);
  const rowWidth = useSharedValue(0);

  const close = useCallback(() => {
    translateX.value = spring(0, SPRING_EXPAND);
  }, [translateX]);

  // Someone else opened, or the parent closed everything.
  useEffect(() => {
    if (openId !== id) close();
  }, [openId, id, close]);

  // Test seam -- see `testOpen` on the props. Deliberately drives the SAME
  // shared value the gesture drives, so what a test opens is the same state a
  // finger opens, not a lookalike.
  useEffect(() => {
    if (testOpen === 'left') {
      translateX.value = spring(ACTION_WIDTH, SPRING_EXPAND);
    } else if (testOpen === 'right') {
      translateX.value = spring(-ACTION_WIDTH * LEFT_ACTION_COUNT, SPRING_EXPAND);
    } else if (testOpen === null) {
      translateX.value = spring(0, SPRING_EXPAND);
    }
  }, [testOpen, translateX]);

  const commit = useCallback(
    (action: 'pin' | 'delete') => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onOpenChange(null);
      if (action === 'pin') onPin();
      else onDelete();
    },
    [onOpenChange, onPin, onDelete]
  );

  const runAction = useCallback(
    (fn: () => void) => {
      onOpenChange(null);
      fn();
    },
    [onOpenChange]
  );

  const pan = Gesture.Pan()
    // Only claim the gesture once it is clearly horizontal. Without both of
    // these the pan wins over the SectionList's vertical scroll and the list
    // becomes very hard to scroll with a thumb, which never travels straight.
    .activeOffsetX([-15, 15])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      // Clamp the far side of each direction so the row cannot be dragged
      // clean off screen -- there is nothing revealed past the buttons.
      const max = ACTION_WIDTH;
      const min = -ACTION_WIDTH * LEFT_ACTION_COUNT;
      translateX.value = Math.min(max, Math.max(min, e.translationX));
    })
    .onEnd(() => {
      const tx = translateX.value;

      if (tx >= rowWidth.value * COMMIT_FRACTION_RIGHT) {
        translateX.value = spring(0, SPRING_EXPAND);
        runOnJS(commit)('pin');
        return;
      }
      if (tx <= -rowWidth.value * COMMIT_FRACTION_LEFT) {
        translateX.value = spring(0, SPRING_EXPAND);
        runOnJS(commit)('delete');
        return;
      }
      if (tx >= REVEAL_THRESHOLD) {
        translateX.value = spring(ACTION_WIDTH, SPRING_EXPAND);
        runOnJS(onOpenChange)(id);
        return;
      }
      if (tx <= -REVEAL_THRESHOLD) {
        translateX.value = spring(-ACTION_WIDTH * LEFT_ACTION_COUNT, SPRING_EXPAND);
        runOnJS(onOpenChange)(id);
        return;
      }
      translateX.value = spring(0, SPRING_EXPAND);
      runOnJS(onOpenChange)(null);
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // The revealed sides fade in with the drag rather than sitting there at full
  // strength behind a stationary row, which reads as a rendering glitch on the
  // first pixel of movement.
  const leftStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, translateX.value / REVEAL_THRESHOLD)),
  }));
  const rightStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, -translateX.value / REVEAL_THRESHOLD)),
  }));

  /**
   * How far each side is revealed, as a fraction: 0 closed, 1 fully open, and
   * ABOVE 1 once the drag is heading for a commit. Derived rather than stored
   * so there is exactly one source of truth for the gesture -- translateX.
   *
   * The >1 region is what the outermost action's colour shift reads, so the
   * deepening lines up with "keep pulling and this will fire" rather than with
   * "the buttons are now visible".
   */
  const leftReveal = useDerivedValue(() => translateX.value / ACTION_WIDTH);
  const rightReveal = useDerivedValue(
    () => -translateX.value / (ACTION_WIDTH * LEFT_ACTION_COUNT)
  );

  if (Platform.OS === 'web') return <>{children}</>;

  return (
    <View
      style={{ position: 'relative' }}
      onLayout={(e) => {
        rowWidth.value = e.nativeEvent.layout.width;
      }}
    >
      {/* Behind the row, revealed by dragging it aside. `pointerEvents` is
          left alone deliberately: while the row is closed these are covered,
          and once it is open they are exactly what should be tappable. */}
      <Animated.View
        style={[
          { position: 'absolute', left: 0, top: 0, bottom: 0, width: ACTION_WIDTH },
          leftStyle,
        ]}
      >
        <SwipeAction
          label={isPinned ? 'Unpin' : 'Pin'}
          icon={Pin}
          colors={ACTION_COLORS.pin}
          reveal={leftReveal}
          // The only action on this side, so it is also the outermost one.
          isOutermost
          onPress={() => runAction(onPin)}
        />
      </Animated.View>

      <Animated.View
        style={[
          {
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: ACTION_WIDTH * LEFT_ACTION_COUNT,
            flexDirection: 'row',
          },
          rightStyle,
        ]}
      >
        <SwipeAction
          label="Share"
          icon={ShareIcon}
          colors={ACTION_COLORS.share}
          reveal={rightReveal}
          onPress={() => runAction(onShare)}
        />
        <SwipeAction
          label="Move"
          icon={FolderIcon}
          colors={ACTION_COLORS.move}
          reveal={rightReveal}
          onPress={() => runAction(onMove)}
        />
        <SwipeAction
          label="Delete"
          icon={Trash2}
          colors={ACTION_COLORS.delete}
          reveal={rightReveal}
          // Outermost on this side: the one a full-swipe commits.
          isOutermost
          onPress={() => runAction(onDelete)}
        />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

/**
 * One action slot: a coloured shape with its label underneath -- the text is
 * NOT inside the shape, per the reference.
 *
 * TWO THINGS ANIMATE OFF `reveal` (0 closed, 1 fully open, >1 heading for a
 * commit):
 *   - WIDTH, so the shape starts as a circle and stretches into a capsule as
 *     the swipe deepens.
 *   - COLOUR, but only on the outermost action, and only ABOVE 1 -- the region
 *     where releasing will fire that action rather than just leave the row
 *     open. That is what makes it an ARMED indicator rather than a decoration.
 *
 * The Pressable fills the whole 72-wide slot, so the touch target is the full
 * row height by 72 even though the painted shape is at most 62 wide.
 */
function SwipeAction({
  label,
  icon,
  colors,
  reveal,
  isOutermost = false,
  onPress,
}: {
  label: string;
  icon: React.ComponentType<any>;
  colors: readonly [string, string];
  reveal: SharedValue<number>;
  isOutermost?: boolean;
  onPress: () => void;
}) {
  const shapeStyle = useAnimatedStyle(() => ({
    width: interpolate(reveal.value, [0, 1], [CAPSULE_MIN_WIDTH, CAPSULE_MAX_WIDTH], 'clamp'),
    backgroundColor: isOutermost
      ? interpolateColor(reveal.value, [1, 1.35], [colors[0], colors[1]], 'RGB', { gamma: 1 })
      : colors[0],
  }));

  return (
    <Pressable
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Animated.View
        style={[
          {
            height: CAPSULE_HEIGHT,
            borderRadius: CAPSULE_HEIGHT / 2,
            alignItems: 'center',
            justifyContent: 'center',
          },
          shapeStyle,
        ]}
      >
        <Icon as={icon} className="w-5 h-5 text-on-accent" />
      </Animated.View>
      <RNText className="text-xs text-muted-foreground" numberOfLines={1}>
        {label}
      </RNText>
    </Pressable>
  );
}
