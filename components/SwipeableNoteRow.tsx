import React, { useCallback, useEffect } from 'react';
import { Platform, Pressable, Text as RNText, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Folder as FolderIcon, Pin, Trash2 } from 'lucide-react-native';

import { Icon } from '@/components/ui/icon';
import { spring, SPRING_EXPAND } from '@/lib/theme/motion';

/**
 * Swipe actions on a note row: right reveals Pin, left reveals Move + Delete.
 *
 * WHY THIS IS HAND-ROLLED rather than gesture-handler's `Swipeable`. The
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
const ACTION_WIDTH = 76;
/** Past this, a release snaps open instead of closed. */
const REVEAL_THRESHOLD = 44;
/** Fraction of the row's width past which a release fires the action outright. */
const COMMIT_FRACTION = 0.55;

export interface SwipeableNoteRowProps {
  id: string;
  isPinned: boolean;
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  onPin: () => void;
  onMove: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}

export function SwipeableNoteRow({
  id,
  isPinned,
  openId,
  onOpenChange,
  onPin,
  onMove,
  onDelete,
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
      const min = -ACTION_WIDTH * 2;
      translateX.value = Math.min(max, Math.max(min, e.translationX));
    })
    .onEnd(() => {
      const tx = translateX.value;
      const commitAt = rowWidth.value * COMMIT_FRACTION;

      if (tx >= commitAt) {
        translateX.value = spring(0, SPRING_EXPAND);
        runOnJS(commit)('pin');
        return;
      }
      if (tx <= -commitAt) {
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
        translateX.value = spring(-ACTION_WIDTH * 2, SPRING_EXPAND);
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
          className="bg-lime-500"
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
            width: ACTION_WIDTH * 2,
            flexDirection: 'row',
          },
          rightStyle,
        ]}
      >
        <SwipeAction
          label="Move"
          icon={FolderIcon}
          className="bg-blue-500"
          onPress={() => runAction(onMove)}
        />
        <SwipeAction
          label="Delete"
          icon={Trash2}
          className="bg-red-500"
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
 * A capsule with its label underneath, per the reference -- the text is NOT
 * inside the coloured shape. Painted at 60x40, which is smaller than 44pt in
 * one dimension on purpose; the Pressable around it fills the whole slot, so
 * the real touch target is 76 wide by the full row height.
 */
function SwipeAction({
  label,
  icon,
  className,
  onPress,
}: {
  label: string;
  icon: React.ComponentType<any>;
  className: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View
        className={`${className} items-center justify-center rounded-full`}
        style={{ width: 60, height: 40 }}
      >
        <Icon as={icon} className="w-5 h-5 text-on-accent" />
      </View>
      <RNText className="text-xs text-muted-foreground" numberOfLines={1}>
        {label}
      </RNText>
    </Pressable>
  );
}
