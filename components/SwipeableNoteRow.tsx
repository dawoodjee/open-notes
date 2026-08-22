import React, { useCallback, useEffect } from 'react';
import { Platform, Pressable, Text as RNText, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedReaction,
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
/**
 * Was 0.9, which needed 334pt of TRANSLATION on a 371pt row. With the
 * overshoot easing below, that costs more finger travel than the screen has,
 * so it was unreachable even after the clamp was fixed. 0.75 lands the commit
 * at ~278pt of translation, about 289pt of travel -- comfortably reachable,
 * and still far enough past the 216pt reveal that "look at Share" and "delete
 * this note" stay obviously different gestures.
 */
const COMMIT_FRACTION_LEFT = 0.75;

/**
 * How much of each pixel of finger movement past the revealed strip actually
 * moves the row. 1 would feel loose and make accidental commits easy; too low
 * puts the commit past the edge of the screen. 0.85 keeps it reachable while
 * making the extra distance feel deliberate.
 */
const OVERSHOOT_RATE = 0.85;

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

/** Fired from a worklet, so it has to be a plain module-scope function. */
function tick() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

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
      /**
       * Past the revealed strip the row keeps moving, at a reduced rate.
       *
       * THIS USED TO CLAMP AT THE STRIP WIDTH, and that quietly disabled the
       * whole force-swipe feature: translateX could never exceed 216pt on the
       * left, while onEnd's commit test is a fraction of the ROW width (~334pt
       * of a 371pt row). The test could not be true, so releasing after a long
       * drag only ever opened the row. Same on the right, where the clamp was
       * 72 and the threshold ~204. It read as working in the source and did
       * nothing on the device -- found by measuring the drag needed to arm the
       * colour and discovering no drag could.
       *
       * OVERSHOOT_RATE is what keeps that from feeling loose: the buttons
       * arrive at 1:1, and going beyond them costs more finger per pixel, so a
       * commit has to be meant. The cap is the row width -- there is nothing
       * to see past the row's own edge.
       */
      const raw = e.translationX;
      const limit = raw > 0 ? ACTION_WIDTH : ACTION_WIDTH * LEFT_ACTION_COUNT;
      const magnitude = Math.abs(raw);
      const beyond = Math.max(0, magnitude - limit);
      const eased = Math.min(limit + beyond * OVERSHOOT_RATE, rowWidth.value || magnitude);
      translateX.value = raw < 0 ? -eased : eased;
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
   * TWO different fractions, because they answer two different questions, and
   * conflating them was a real bug in the first cut of this.
   *
   * REVEAL is progress toward "the buttons are fully visible" -- 0 closed, 1
   * when the action strip is entirely uncovered. It drives the capsule stretch.
   *
   * ARM is progress toward "let go now and this action fires" -- 1 exactly at
   * the commit threshold. It drives the outermost action's colour.
   *
   * These are far apart. Swiping left reveals three buttons after 216pt, but
   * committing needs 90% of a 402pt row -- 362pt. Driving the colour off reveal
   * meant the capsule looked armed from 216pt onward while releasing there just
   * left the row open. The colour was lying about what the gesture would do.
   */
  const leftReveal = useDerivedValue(() => translateX.value / ACTION_WIDTH);
  const rightReveal = useDerivedValue(
    () => -translateX.value / (ACTION_WIDTH * LEFT_ACTION_COUNT)
  );
  // Guarded against a pre-layout rowWidth of 0, which would make every arm
  // fraction Infinity and light the colour before the first pixel of drag.
  const leftArm = useDerivedValue(() =>
    rowWidth.value > 0 ? translateX.value / (rowWidth.value * COMMIT_FRACTION_RIGHT) : 0
  );
  const rightArm = useDerivedValue(() =>
    rowWidth.value > 0 ? -translateX.value / (rowWidth.value * COMMIT_FRACTION_LEFT) : 0
  );

  /**
   * One haptic tick the moment a side becomes armed, and nothing on the way
   * back. This is the part that makes a force-swipe feel committed before you
   * let go -- without it the colour change is the only signal and it is easy to
   * miss mid-gesture, with your thumb over the button.
   */
  const wasArmed = useSharedValue(false);
  useAnimatedReaction(
    () => Math.max(leftArm.value, rightArm.value) >= 1,
    (armed, previous) => {
      if (armed === previous) return;
      wasArmed.value = armed;
      if (armed) runOnJS(tick)();
    }
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
          arm={leftArm}
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
          arm={rightArm}
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
 * TWO THINGS ANIMATE, off two DIFFERENT fractions:
 *   - WIDTH, off `reveal` (0 closed, 1 fully visible), so the shape starts as
 *     a circle and stretches into a capsule as the swipe deepens.
 *   - COLOUR, off `arm` (1 exactly at the commit threshold), and only on the
 *     outermost action. It deepens across the last stretch before release
 *     would actually fire, so it means "let go now and this happens" -- not
 *     merely "the buttons are visible", which is a much earlier and different
 *     moment. See the note where the two fractions are derived.
 *
 * The Pressable fills the whole 72-wide slot, so the touch target is the full
 * row height by 72 even though the painted shape is at most 62 wide.
 */
function SwipeAction({
  label,
  icon,
  colors,
  reveal,
  arm,
  isOutermost = false,
  onPress,
}: {
  label: string;
  icon: React.ComponentType<any>;
  colors: readonly [string, string];
  reveal: SharedValue<number>;
  /** Only the outermost action on a side is armable, so only it gets this. */
  arm?: SharedValue<number>;
  isOutermost?: boolean;
  onPress: () => void;
}) {
  const shapeStyle = useAnimatedStyle(() => ({
    width: interpolate(reveal.value, [0, 1], [CAPSULE_MIN_WIDTH, CAPSULE_MAX_WIDTH], 'clamp'),
    backgroundColor:
      isOutermost && arm
        ? interpolateColor(arm.value, [0.75, 1], [colors[0], colors[1]], 'RGB', { gamma: 1 })
        : colors[0],
  }));

  /**
   * The icon leans in slightly as the action arms. Small on purpose -- 1.12 is
   * enough to register in peripheral vision while a thumb is covering the
   * capsule, which is exactly when the colour alone is hardest to see.
   */
  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: arm ? interpolate(arm.value, [0.75, 1], [1, 1.12], 'clamp') : 1 },
    ],
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
        <Animated.View style={iconStyle}>
          <Icon as={icon} className="w-5 h-5 text-on-accent" />
        </Animated.View>
      </Animated.View>
      <RNText className="text-xs text-muted-foreground" numberOfLines={1}>
        {label}
      </RNText>
    </Pressable>
  );
}
