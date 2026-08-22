// VENDORED: imports rewritten from the library's internal relative paths to
// its public entry point. `RelationPropType` and `applyRelationProp` are
// internal to the package, so they are reproduced verbatim at the bottom of
// this file. See README.md.
import React from 'react';
import type { GestureType, PanGestureHandlerProps } from 'react-native-gesture-handler';
import { SharedValue } from 'react-native-reanimated';
import { StyleProp, ViewStyle } from 'react-native';

type SwipeableExcludes = Exclude<
  keyof PanGestureHandlerProps,
  'onGestureEvent' | 'onHandlerStateChange'
>;

export enum SwipeDirection {
  LEFT = 'left',
  RIGHT = 'right',
}

export interface SwipeableProps
  extends Pick<PanGestureHandlerProps, SwipeableExcludes> {
  /**
   *
   */
  ref?: React.RefObject<SwipeableMethods | null>;

  /**
   * Enables two-finger gestures on supported devices, for example iPads with
   * trackpads. If not enabled the gesture will require click + drag, with
   * `enableTrackpadTwoFingerGesture` swiping with two fingers will also trigger
   * the gesture.
   */
  enableTrackpadTwoFingerGesture?: boolean;

  /**
   * Specifies how much the visual interaction will be delayed compared to the
   * gesture distance. e.g. value of 1 will indicate that the swipeable panel
   * should exactly follow the gesture, 2 means it is going to be two times
   * "slower".
   */
  friction?: number;

  /**
   * Distance from the left edge at which released panel will animate to the
   * open state (or the open panel will animate into the closed state). By
   * default it's a half of the panel's width.
   */
  leftThreshold?: number;

  /**
   * Distance from the right edge at which released panel will animate to the
   * open state (or the open panel will animate into the closed state). By
   * default it's a half of the panel's width.
   */
  rightThreshold?: number;

  /**
   * Distance that the panel must be dragged from the left edge to be considered
   * a swipe. The default value is 10.
   */
  dragOffsetFromLeftEdge?: number;

  /**
   * Distance that the panel must be dragged from the right edge to be considered
   * a swipe. The default value is 10.
   */
  dragOffsetFromRightEdge?: number;

  /**
   * Value indicating if the swipeable panel can be pulled further than the left
   * actions panel's width. It is set to true by default as long as the left
   * panel render method is present.
   */
  overshootLeft?: boolean;

  /**
   * Value indicating if the swipeable panel can be pulled further than the
   * right actions panel's width. It is set to true by default as long as the
   * right panel render method is present.
   */
  overshootRight?: boolean;

  /**
   * Specifies how much the visual interaction will be delayed compared to the
   * gesture distance at overshoot. Default value is 1, it mean no friction, for
   * a native feel, try 8 or above.
   */
  overshootFriction?: number;

  /**
   * Called when action panel gets open (either right or left).
   */
  onSwipeableOpen?: (
    direction: SwipeDirection.LEFT | SwipeDirection.RIGHT
  ) => void;

  /**
   * Called when action panel is closed.
   */
  onSwipeableClose?: (
    direction: SwipeDirection.LEFT | SwipeDirection.RIGHT
  ) => void;

  /**
   * Called when action panel starts animating on open (either right or left).
   */
  onSwipeableWillOpen?: (
    direction: SwipeDirection.LEFT | SwipeDirection.RIGHT
  ) => void;

  /**
   * Called when action panel starts animating on close.
   */
  onSwipeableWillClose?: (
    direction: SwipeDirection.LEFT | SwipeDirection.RIGHT
  ) => void;

  /**
   * Called when action panel starts being shown on dragging to open.
   */
  onSwipeableOpenStartDrag?: (
    direction: SwipeDirection.LEFT | SwipeDirection.RIGHT
  ) => void;

  /**
   * Called when action panel starts being shown on dragging to close.
   */
  onSwipeableCloseStartDrag?: (
    direction: SwipeDirection.LEFT | SwipeDirection.RIGHT
  ) => void;

  /**
   * `progress`: Equals `0` when `swipeable` is closed, `1` when `swipeable` is opened.
   *  - When the element overshoots it's opened position the value tends towards `Infinity`.
   *  - Goes back to `1` when `swipeable` is released.
   *
   * `translation`: a horizontal offset of the `swipeable` relative to its closed position.\
   * `swipeableMethods`: provides an object exposing methods for controlling the `swipeable`.
   *
   * To support `rtl` flexbox layouts use `flexDirection` styling.
   * */
  renderLeftActions?: (
    progress: SharedValue<number>,
    translation: SharedValue<number>,
    swipeableMethods: SwipeableMethods
  ) => React.ReactNode;

  /**
   * `progress`: Equals `0` when `swipeable` is closed, `1` when `swipeable` is opened.
   *  - When the element overshoots it's opened position the value tends towards `Infinity`.
   *  - Goes back to `1` when `swipeable` is released.
   *
   * `translation`: a horizontal offset of the `swipeable` relative to its closed position.\
   * `swipeableMethods`: provides an object exposing methods for controlling the `swipeable`.
   *
   * To support `rtl` flexbox layouts use `flexDirection` styling.
   * */
  renderRightActions?: (
    progress: SharedValue<number>,
    translation: SharedValue<number>,
    swipeableMethods: SwipeableMethods
  ) => React.ReactNode;

  animationOptions?: Record<string, unknown>;

  /**
   * Style object for the container (`Animated.View`), for example to override
   * `overflow: 'hidden'`.
   */
  containerStyle?: StyleProp<ViewStyle>;

  /**
   * Style object for the children container (`Animated.View`), for example to
   * apply `flex: 1`
   */
  childrenContainerStyle?: StyleProp<ViewStyle>;

  /**
   * VENDORED -- not upstream. Distance the panel must be dragged towards the
   * RIGHT, in points, for a release to fire `onFullSwipe` instead of settling
   * the LEFT actions panel open. Measured the same way `leftThreshold` is: the
   * released translation including fling, plus the panel's current open offset.
   *
   * Leave undefined to disable full swipe on this side, which is upstream's
   * behaviour.
   */
  fullSwipeLeftThreshold?: number;

  /**
   * VENDORED -- not upstream. The `fullSwipeLeftThreshold` mirror for the RIGHT
   * actions panel, i.e. for dragging towards the LEFT.
   */
  fullSwipeRightThreshold?: number;

  /**
   * VENDORED -- not upstream. Called on release when the drag went past the
   * corresponding full-swipe threshold. The panel animates closed rather than
   * open, so the caller does not have to close it.
   *
   * DIRECTION IS THE DIRECTION OF MOTION, matching every other callback in this
   * file: `SwipeDirection.RIGHT` means the row travelled right, which uncovers
   * the LEFT actions panel. Reading it as "the right-hand buttons" is the exact
   * mistake that made an earlier attempt at this fire the wrong action.
   */
  onFullSwipe?: (direction: SwipeDirection.LEFT | SwipeDirection.RIGHT) => void;

  /**
   * A gesture object or an array of gesture objects containing the configuration and callbacks to be
   * used with the swipeable's gesture handler.
   */
  simultaneousWithExternalGesture?: RelationPropType;

  /**
   * A gesture object or an array of gesture objects containing the configuration and callbacks to be
   * used with the swipeable's gesture handler.
   */
  requireExternalGestureToFail?: RelationPropType;

  /**
   * A gesture object or an array of gesture objects containing the configuration and callbacks to be
   * used with the swipeable's gesture handler.
   */
  blocksExternalGesture?: RelationPropType;
}

export interface SwipeableMethods {
  close: () => void;
  openLeft: () => void;
  openRight: () => void;
  reset: () => void;
}

/**
 * VENDORED: reproduced verbatim from the package's own
 * `src/components/utils.ts`, which is not part of its public API. Unused by
 * this app today -- kept only so the component stays a clean diff against
 * upstream.
 */
export type RelationPropName =
  | 'simultaneousWithExternalGesture'
  | 'requireExternalGestureToFail'
  | 'blocksExternalGesture';

export type RelationPropType =
  | React.Ref<React.Component>
  | GestureType
  | (React.Ref<React.Component> | GestureType)[];

export function applyRelationProp(
  gesture: any,
  relationPropName: RelationPropName,
  relationProp: RelationPropType
) {
  if (!relationProp) {
    return;
  }

  if (Array.isArray(relationProp)) {
    gesture[relationPropName](...relationProp);
  } else {
    gesture[relationPropName](relationProp);
  }
}
