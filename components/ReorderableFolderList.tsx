import React, { useCallback, useEffect } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { GripVertical } from 'lucide-react-native';

import { Icon } from '@/components/ui/icon';
import { SURFACE } from './IconButton';
import { haptics } from '@/lib/theme/haptics';
import { rowShift, targetIndexFor } from '@/lib/notes/reorder';
import { SPRING_EXPAND, SPRING_PRESS, spring } from '@/lib/theme/motion';

/**
 * Drag-to-reorder for the top-level folder list, hand-built on gesture-handler
 * and Reanimated rather than taken from a library.
 *
 * ── WHY THERE IS NO DEPENDENCY HERE ───────────────────────────────────────
 *
 * `react-native-reanimated-dnd` was tried first and neither published version
 * is usable in this tree. 1.1.0 peers on `react-native-reanimated >=3.0.0` but
 * calls `useAnimatedGestureHandler`, which Reanimated 4 REMOVED -- so it
 * installs, type-checks and builds, then throws
 * `useAnimatedGestureHandler is not a function` the instant edit mode renders.
 * 2.0.0 fixes that by requiring Reanimated >=4.2.0, and Expo SDK 54 pins
 * `~4.1.1`. Adam's call, 2026-08-23: build it directly.
 *
 * That is a smaller job than it sounds, because of what this list is NOT. One
 * level, under a dozen rows, uniform height, and only in edit mode -- so there
 * is no nesting, no virtualisation, no cross-list drag and no auto-scroll to
 * get right. The general library has to solve all four.
 *
 * ── WHY THE HANDLE OWNS THE GESTURE ───────────────────────────────────────
 *
 * A whole-row pan would have to be disambiguated from the row's own tap and
 * from the ScrollView, usually with a long press -- which is already taken
 * here by the folder context menu. A grip is also the only affordance that
 * says "this moves" without a tutorial, and it is what iOS puts in an editing
 * list. The arrow buttons it replaces do not disappear so much as move: they
 * become VoiceOver actions on the row (see FolderRow), because a drag handle
 * is unusable to a screen reader and reordering must not become sighted-only.
 *
 * ── HOW IT WINS AGAINST THE SCROLLVIEW ────────────────────────────────────
 *
 * The pan and the scroll are both vertical and both begin inside the same
 * scroll view, so on iOS the scroll view's own recogniser will cancel ours part
 * way through a drag -- which reads as the row sticking. TWO defences, because
 * this is the one part of the drag that cannot be tested here: gesture-handler
 * recognisers are invisible to injected simulator touches, so a browser run
 * proves the logic and nothing proves the arbitration but a real finger.
 *
 *   1. `blocksExternalGesture(scrollRef)` -- the documented mechanism. It tells
 *      gesture-handler that this pan outranks the scroll view's recogniser, so
 *      the scroll never gets to steal the touch in the first place.
 *   2. `scrollEnabled={false}` for the duration, driven by `onDragActiveChange`.
 *      Belt and braces on a control whose failure mode is silent.
 *
 * ── HOW IT SETTLES WITHOUT A FLASH ────────────────────────────────────────
 *
 * On release the dragged row springs to `(target - start) * height` -- the
 * slot it is going to occupy -- rather than back to zero, and the database
 * write goes out in parallel. When the new order arrives from PowerSync the
 * rows are re-keyed into their new positions and every offset is reset to zero
 * IN THE SAME FRAME, so the row is already exactly where the reset puts it.
 * Springing back to zero first would show the row snapping home and then
 * re-appearing in its new slot.
 *
 * `animate` is the other half of that: displaced rows spring while a finger is
 * down and jump instantly during the reset, so they do not animate out of a
 * displacement that has already been made real by the reorder.
 */

/** Only used before the first row has measured itself. FolderRow's own floor. */
const FALLBACK_ROW_HEIGHT = 44;

/** How much the dragged row lifts off the list. */
const LIFT_SCALE = 1.02;

interface ReorderableFolderListProps {
  /** In render order. Identity is what tells this component a reorder landed. */
  ids: string[];
  /** Fired once on release, with the slot the row was dropped into. */
  onMove: (id: string, toIndex: number) => void;
  /** True while a finger is down, so the parent can freeze its ScrollView. */
  onDragActiveChange?: (active: boolean) => void;
  /**
   * The enclosing scrollable. Must be gesture-handler's own ScrollView (or any
   * component it can resolve a handler tag from) for `blocksExternalGesture` to
   * have anything to outrank.
   */
  scrollRef?: React.RefObject<any>;
  /** The handle is built here and handed back, so the row decides where it sits. */
  renderRow: (index: number, handle: React.ReactNode) => React.ReactNode;
}

export function ReorderableFolderList({
  ids,
  onMove,
  onDragActiveChange,
  scrollRef,
  renderRow,
}: ReorderableFolderListProps) {
  // -1 is idle for all three. Kept as shared values rather than React state
  // because they are read by style worklets on every frame of a drag.
  const startIndex = useSharedValue(-1);
  const targetIndex = useSharedValue(-1);
  const dragY = useSharedValue(0);
  const rowHeight = useSharedValue(0);
  const animate = useSharedValue(false);

  const key = ids.join('|');

  useEffect(() => {
    // A new order (or a folder added/removed) means the displacement under
    // these offsets is now real. Clear `animate` FIRST so that whichever
    // recomputation the style worklets do next is an instant one.
    animate.value = false;
    startIndex.value = -1;
    targetIndex.value = -1;
    dragY.value = 0;
  }, [key, animate, startIndex, targetIndex, dragY]);

  return (
    <>
      {ids.map((id, index) => (
        <ReorderableRow
          key={id}
          id={id}
          index={index}
          count={ids.length}
          startIndex={startIndex}
          targetIndex={targetIndex}
          dragY={dragY}
          rowHeight={rowHeight}
          animate={animate}
          onMove={onMove}
          onDragActiveChange={onDragActiveChange}
          scrollRef={scrollRef}
        >
          {renderRow}
        </ReorderableRow>
      ))}
    </>
  );
}

function ReorderableRow({
  id,
  index,
  count,
  startIndex,
  targetIndex,
  dragY,
  rowHeight,
  animate,
  onMove,
  onDragActiveChange,
  scrollRef,
  children: renderRow,
}: {
  id: string;
  index: number;
  count: number;
  startIndex: SharedValue<number>;
  targetIndex: SharedValue<number>;
  dragY: SharedValue<number>;
  rowHeight: SharedValue<number>;
  animate: SharedValue<boolean>;
  onMove: (id: string, toIndex: number) => void;
  onDragActiveChange?: (active: boolean) => void;
  scrollRef?: React.RefObject<any>;
  children: (index: number, handle: React.ReactNode) => React.ReactNode;
}) {
  const lift = useSharedValue(0);

  const setDragActive = useCallback(
    (active: boolean) => {
      onDragActiveChange?.(active);
      // Pick-up only. Release either lands on a slot (commit, below) or puts
      // the row back, and a tick for "nothing happened" is noise.
      if (active) haptics.step();
    },
    [onDragActiveChange]
  );

  const commit = useCallback(
    (toIndex: number) => {
      onDragActiveChange?.(false);
      haptics.commit();
      onMove(id, toIndex);
    },
    [id, onMove, onDragActiveChange]
  );

  let pan = Gesture.Pan();
  if (scrollRef?.current) pan = pan.blocksExternalGesture(scrollRef);
  pan = pan
    // The handle is small and the gesture is unambiguous once it starts there,
    // so no activation distance: the row should move with the very first pixel
    // or the handle feels dead.
    .onStart(() => {
      startIndex.value = index;
      targetIndex.value = index;
      dragY.value = 0;
      animate.value = true;
      lift.value = spring(1, SPRING_PRESS);
      runOnJS(setDragActive)(true);
    })
    .onUpdate((event) => {
      dragY.value = event.translationY;
      const next = targetIndexFor(
        startIndex.value,
        event.translationY,
        rowHeight.value || FALLBACK_ROW_HEIGHT,
        count
      );
      if (next !== targetIndex.value) {
        targetIndex.value = next;
        // One tick per slot crossed -- the same "moving through a set" meaning
        // the find bar and the folder picker use.
        runOnJS(haptics.step)();
      }
    })
    .onEnd((_event, success) => {
      lift.value = spring(0, SPRING_PRESS);
      const from = startIndex.value;
      const to = targetIndex.value;

      if (!success || from < 0 || from === to) {
        // Nothing to write, so nothing will re-key these rows -- this row has
        // to put itself back.
        dragY.value = withSpring(0, SPRING_EXPAND);
        startIndex.value = -1;
        targetIndex.value = -1;
        runOnJS(setDragActive)(false);
        return;
      }

      // Land in the slot rather than springing home. See the header note.
      dragY.value = withSpring((to - from) * (rowHeight.value || FALLBACK_ROW_HEIGHT), SPRING_EXPAND);
      runOnJS(commit)(to);
    });

  const style = useAnimatedStyle(() => {
    const height = rowHeight.value || FALLBACK_ROW_HEIGHT;
    const dragging = startIndex.value === index;

    if (dragging) {
      return {
        transform: [
          { translateY: dragY.value },
          { scale: 1 + lift.value * (LIFT_SCALE - 1) },
        ],
        // Above every other row on both platforms -- zIndex alone does nothing
        // on Android, elevation alone does nothing on iOS.
        zIndex: 2,
        elevation: 4,
        shadowOpacity: lift.value * 0.2,
      };
    }

    const shift = rowShift(index, startIndex.value, targetIndex.value) * height;
    return {
      transform: [
        { translateY: animate.value ? withSpring(shift, SPRING_EXPAND) : shift },
        { scale: 1 },
      ],
      zIndex: 1,
      elevation: 0,
      shadowOpacity: 0,
    };
  });

  const handle = (
    <GestureDetector gesture={pan}>
      <View
        style={{
          width: SURFACE,
          height: SURFACE,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        // Painted 36, touched 44 -- the same rule IconButton applies, restated
        // because this is a bare View rather than one of its buttons.
        hitSlop={4}
        accessible={false}
        // Web only, and it is not cosmetic: without it the browser starts a
        // text/element drag on pointerdown and gesture-handler never sees the
        // move events.
        // @ts-expect-error react-native-web passes this through to the DOM.
        draggable={false}
      >
        <Icon as={GripVertical} style={{ width: 20, height: 20 }} className="text-muted-foreground" />
      </View>
    </GestureDetector>
  );

  return (
    <Animated.View
      style={[{ shadowColor: '#000', shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }, style]}
      onLayout={(event) => {
        // Every row writes the same value: they are uniform by construction
        // (depth 0, single-line labels, no children rendered in edit mode), and
        // measuring keeps the drag correct at large Dynamic Type sizes, where a
        // hardcoded 44 would drift a whole row over a list of ten.
        const height = event.nativeEvent.layout.height;
        if (height > 0) rowHeight.value = height;
      }}
    >
      {renderRow(index, handle)}
    </Animated.View>
  );
}
