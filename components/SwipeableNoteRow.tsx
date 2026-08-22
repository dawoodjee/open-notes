import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text as RNText, View } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Folder as FolderIcon, Pin, Share as ShareIcon, Trash2 } from 'lucide-react-native';

import { Icon } from '@/components/ui/icon';
import ReanimatedSwipeable, {
  SwipeDirection,
  type SwipeableMethods,
} from '@/components/vendor/ReanimatedSwipeable';
import {
  ACTION_WIDTH,
  OVERSHOOT_FRICTION,
  REVEAL_THRESHOLD,
  RIGHT_PANEL_WIDTH,
  armFraction,
  armTranslation,
  fullSwipeThreshold,
  revealFraction,
} from '@/lib/notes/swipeMath';

/**
 * Swipe actions on a note row: right reveals Pin, left reveals Share, Move and
 * Delete.
 *
 * WHY THE GESTURE IS NOT OURS ANY MORE -- decided 2026-08-22. A hand-rolled
 * `Gesture.Pan()` shipped three separate bugs (an unreachable commit threshold,
 * an easing expression that collapsed to a constant below the strip, and a
 * vertical guard so tight the gesture cancelled itself on any normal thumb
 * drift). That is too much surface area to own for a control every list row
 * uses. `ReanimatedSwipeable` owns the pan, the easing and the release
 * decision; this file owns what the actions look like and what they do.
 *
 * WHY IT IS VENDORED rather than imported -- two upstream gaps, both with issue
 * numbers, both unreachable on this RN version. The full reasoning and the
 * exact modifications are in `components/vendor/ReanimatedSwipeable/README.md`;
 * the short version is that the library's hidden action panel swallows taps
 * meant for the visible one, and it has no full swipe.
 *
 * WHAT THE GESTURE DOES. Two stages, matching the reference and iOS Mail: a
 * short swipe REVEALS the buttons and leaves them there, a long swipe past them
 * COMMITS the outermost action on release without you ever touching a button.
 *
 * NATIVE ONLY. On web there is no swipe: the equivalent affordance is
 * right-click, which NoteRow already handles. Rendering the gesture layer
 * anyway would just add a pan recognizer competing with text selection.
 *
 * ONE ROW OPEN AT A TIME. The parent owns `openId` -- a row that isn't the open
 * one closes itself. Letting each row keep its own state means swiping a second
 * row leaves the first hanging open behind it, and then a tap meant for the
 * list hits a stale Delete button.
 *
 * A NOTE ON DIRECTION NAMES. The library reports the direction the ROW
 * TRAVELLED, not which panel that uncovered. `SwipeDirection.RIGHT` means the
 * row moved right, which reveals the LEFT panel -- Pin. Reading it the other
 * way round is what made an earlier attempt at this fire Delete for a Pin
 * swipe, so every use of it below is spelled out.
 */

/**
 * The shape starts as a CIRCLE and STRETCHES into a capsule as the drag
 * deepens. Height and corner radius are fixed, so it stays fully rounded at
 * every width -- it reads as one shape growing, not a rectangle acquiring
 * rounded ends.
 *
 * MEASURED off mobile-swipe-left-actions.png rather than guessed: in that shot
 * the slot pitch is 176px on a 976px-wide crop of a 402pt screen (2.43 px/pt),
 * which is the 72pt ACTION_WIDTH, and the capsule itself is ~150x105px, so
 * ~62x43pt at full reveal. 44 is the circle diameter, which doubles as the
 * minimum touch dimension.
 */
const CAPSULE_MIN_WIDTH = 44;
const CAPSULE_MAX_WIDTH = 62;
const CAPSULE_HEIGHT = 44;

/**
 * Tailwind's 500 and 600 steps, spelled as hex because these are ANIMATED.
 * `interpolateColor` works on the values themselves, so a NativeWind className
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
   * itself is the opening. This drives the library's own `openLeft`/`openRight`
   * methods and nothing else: no behaviour, no state, no bypass of the real
   * hit-testing that the bug lived in.
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
  const ref = useRef<SwipeableMethods | null>(null);

  /**
   * The full-swipe thresholds are fractions of the ROW, and the row is not the
   * window: on iPad the list is a 320pt pane inside a much wider screen. So it
   * has to be measured. 0 until layout, which just means full swipe is
   * disabled for the first frame -- the props below are left undefined rather
   * than set to 0, because a threshold of 0 would fire on the first pixel.
   */
  const [rowWidth, setRowWidth] = useState(0);

  // Someone else opened, or the parent closed everything.
  useEffect(() => {
    if (openId !== id) ref.current?.close();
  }, [openId, id]);

  // Test seam -- see `testOpen` on the props.
  useEffect(() => {
    if (testOpen === 'left') ref.current?.openLeft();
    else if (testOpen === 'right') ref.current?.openRight();
    else ref.current?.close();
  }, [testOpen]);

  const runAction = useCallback(
    (fn: () => void) => {
      onOpenChange(null);
      fn();
    },
    [onOpenChange]
  );

  /**
   * A full swipe fires the OUTERMOST action on the side that was revealed, and
   * the library has already animated the row shut by the time this runs.
   *
   * `RIGHT` is the row travelling right, uncovering the LEFT panel: Pin.
   */
  const handleFullSwipe = useCallback(
    (direction: SwipeDirection) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onOpenChange(null);
      if (direction === SwipeDirection.RIGHT) onPin();
      else onDelete();
    },
    [onOpenChange, onPin, onDelete]
  );

  const handleWillOpen = useCallback(() => onOpenChange(id), [onOpenChange, id]);
  const handleWillClose = useCallback(() => {
    // Only clear if this row is the one the parent thinks is open. Without the
    // guard, a row closing because ANOTHER row opened would immediately close
    // that other row too.
    if (openId === id) onOpenChange(null);
  }, [openId, id, onOpenChange]);

  const leftThresholdPx = rowWidth > 0 ? fullSwipeThreshold(rowWidth, 'left') : undefined;
  const rightThresholdPx = rowWidth > 0 ? fullSwipeThreshold(rowWidth, 'right') : undefined;

  const renderLeft = useCallback(
    (_progress: SharedValue<number>, translation: SharedValue<number>) => (
      <View style={{ width: ACTION_WIDTH }}>
        <SwipeAction
          label={isPinned ? 'Unpin' : 'Pin'}
          icon={Pin}
          colors={ACTION_COLORS.pin}
          translation={translation}
          panelWidth={ACTION_WIDTH}
          // The only action on this side, so it is also the outermost one.
          armAt={leftThresholdPx}
          onPress={() => runAction(onPin)}
        />
      </View>
    ),
    [isPinned, leftThresholdPx, runAction, onPin]
  );

  const renderRight = useCallback(
    (_progress: SharedValue<number>, translation: SharedValue<number>) => (
      /**
       * ONE inner row rather than three siblings. The library lays the right
       * panel out `row-reverse` so that its own measurement marker ends up on
       * the correct edge; dropping three children straight in would reverse
       * them and put Delete against the middle of the row instead of the screen
       * edge. A single child sits where row-reverse puts it and lays its own
       * contents out left-to-right.
       */
      <View style={{ width: RIGHT_PANEL_WIDTH, flexDirection: 'row' }}>
        <SwipeAction
          label="Share"
          icon={ShareIcon}
          colors={ACTION_COLORS.share}
          translation={translation}
          panelWidth={RIGHT_PANEL_WIDTH}
          onPress={() => runAction(onShare)}
        />
        <SwipeAction
          label="Move"
          icon={FolderIcon}
          colors={ACTION_COLORS.move}
          translation={translation}
          panelWidth={RIGHT_PANEL_WIDTH}
          onPress={() => runAction(onMove)}
        />
        <SwipeAction
          label="Delete"
          icon={Trash2}
          colors={ACTION_COLORS.delete}
          translation={translation}
          panelWidth={RIGHT_PANEL_WIDTH}
          // Outermost on this side: the one a full swipe commits.
          armAt={rightThresholdPx}
          onPress={() => runAction(onDelete)}
        />
      </View>
    ),
    [rightThresholdPx, runAction, onShare, onMove, onDelete]
  );

  if (Platform.OS === 'web') return <>{children}</>;

  return (
    <View onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
      <ReanimatedSwipeable
        ref={ref}
        renderLeftActions={renderLeft}
        renderRightActions={renderRight}
        // A release past this settles OPEN. The library's default is half the
        // panel width, which on the 216pt side would need 108pt of travel
        // before the buttons would stay put at all.
        leftThreshold={REVEAL_THRESHOLD}
        rightThreshold={REVEAL_THRESHOLD}
        // Past THIS, a release ACTS. See swipeMath.
        fullSwipeLeftThreshold={leftThresholdPx}
        fullSwipeRightThreshold={rightThresholdPx}
        onFullSwipe={handleFullSwipe}
        // Dragging past the revealed buttons is the whole point of full swipe,
        // so overshoot has to be on -- and lightly damped, or the row barely
        // moves while the thumb crosses the screen.
        overshootLeft
        overshootRight
        overshootFriction={OVERSHOOT_FRICTION}
        // Claim the gesture only once it is clearly horizontal, or the pan wins
        // over the list's vertical scroll and the list becomes very hard to
        // scroll with a thumb, which never travels straight.
        dragOffsetFromLeftEdge={12}
        dragOffsetFromRightEdge={12}
        onSwipeableWillOpen={handleWillOpen}
        onSwipeableWillClose={handleWillClose}
      >
        {children}
      </ReanimatedSwipeable>
    </View>
  );
}

/**
 * One action slot: a coloured shape with its label underneath -- the text is
 * NOT inside the shape, per the reference.
 *
 * TWO THINGS ANIMATE, off two DIFFERENT fractions, and conflating them was a
 * real bug in the first cut of this.
 *
 *   - WIDTH, off REVEAL (0 closed, 1 when the panel is fully visible), so the
 *     shape starts as a circle and stretches into a capsule as the swipe
 *     deepens.
 *   - COLOUR, off ARM (1 exactly where releasing would fire this action), and
 *     only on the outermost action.
 *
 * These are far apart. Swiping left reveals three buttons after 216pt, but
 * committing needs 75% of a 402pt row. Driving the colour off reveal meant the
 * capsule looked armed from 216pt onward while releasing there just left the
 * row open -- the colour was lying about what the gesture would do.
 *
 * The Pressable fills the whole 72-wide slot, so the touch target is the full
 * row height by 72 even though the painted shape is at most 62 wide.
 */
function SwipeAction({
  label,
  icon,
  colors,
  translation,
  panelWidth,
  armAt,
  onPress,
}: {
  label: string;
  icon: React.ComponentType<any>;
  colors: readonly [string, string];
  /** The library's signed offset of the row from its closed position. */
  translation: SharedValue<number>;
  panelWidth: number;
  /**
   * Drag distance at which releasing fires this action. Only the outermost
   * action on a side is armable, so only it gets this. Undefined before the
   * row has been measured.
   */
  armAt?: number;
  onPress: () => void;
}) {
  const reveal = useDerivedValue(() => revealFraction(translation.value, panelWidth));

  const arm = useDerivedValue(() => {
    if (armAt === undefined) return 0;
    return armFraction(translation.value, armTranslation(panelWidth, armAt));
  });

  /**
   * One haptic tick the moment the action becomes armed, and nothing on the way
   * back. This is what makes a full swipe feel committed before you let go --
   * without it the colour change is the only signal, and it is easy to miss
   * mid-gesture with a thumb over the capsule.
   */
  useAnimatedReaction(
    () => arm.value >= 1,
    (armed, previous) => {
      if (previous === null || armed === previous) return;
      if (armed) runOnJS(tick)();
    }
  );

  const shapeStyle = useAnimatedStyle(() => ({
    width: interpolate(reveal.value, [0, 1], [CAPSULE_MIN_WIDTH, CAPSULE_MAX_WIDTH], 'clamp'),
    backgroundColor:
      armAt === undefined
        ? colors[0]
        : interpolateColor(arm.value, [0, 1], [colors[0], colors[1]], 'RGB', { gamma: 1 }),
  }));

  /**
   * The icon leans in slightly as the action arms. Small on purpose -- 1.12 is
   * enough to register in peripheral vision while a thumb is covering the
   * capsule, which is exactly when the colour alone is hardest to see.
   */
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(arm.value, [0, 1], [1, 1.12], 'clamp') }],
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
