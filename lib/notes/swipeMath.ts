/**
 * The arithmetic behind the swipe row, kept out of the component so it can be
 * tested without a device.
 *
 * WHY IT LIVES HERE. This maths shipped wrong twice while the pan gesture was
 * hand-rolled: first a clamp that made the commit threshold unreachable, so
 * force-swipe never fired; then an easing expression that collapsed to a
 * constant for any drag SHORTER than the revealed strip, so a 5pt nudge
 * snapped the row wide open. Both read fine in a component and are obvious the
 * moment they are given numbers.
 *
 * The pan itself now belongs to `components/vendor/ReanimatedSwipeable`, so the
 * easing and the release decision are the library's. What is still ours is
 * everything that answers "how far is far enough" and "how wide is the capsule
 * right now" -- which is exactly the part that was getting it wrong.
 */

/** Width of one action slot: the capsule plus room for its label. */
export const ACTION_WIDTH = 72;
/** Swipe-left reveals three actions, swipe-right one. */
export const LEFT_ACTION_COUNT = 3;
/** Full width of the three-action panel revealed by swiping left. */
export const RIGHT_PANEL_WIDTH = ACTION_WIDTH * LEFT_ACTION_COUNT;

/**
 * Past this much drag, a release settles open instead of closed. Passed to the
 * component as `leftThreshold`/`rightThreshold`; its own default is half the
 * panel width, which on the 216pt side would mean 108pt of travel before the
 * row would stay open at all.
 */
export const REVEAL_THRESHOLD = 44;

/**
 * Where a release stops revealing and starts ACTING, as a fraction of the row
 * width. Two numbers because the two sides reveal different amounts: the right
 * shows one button, the left shows three (216pt, already over half a 402pt
 * row), so a single shared fraction would make "drag far enough to see Share"
 * and "delete this note" the same gesture.
 *
 * Named by DIRECTION OF TRAVEL, matching the library's own callbacks:
 * ..._RIGHT is the row moving right, which uncovers the LEFT panel (Pin).
 */
export const COMMIT_FRACTION_RIGHT = 0.55;
export const COMMIT_FRACTION_LEFT = 0.75;

/**
 * How much of each point of finger movement PAST the revealed panel actually
 * moves the row. 1 would feel loose and make accidental commits easy; too low
 * and the row barely moves while the finger crosses the screen, which is what
 * "it just budges and stops" felt like.
 */
export const OVERSHOOT_RATE = 0.85;

/**
 * The same number in the units the library wants. `overshootFriction` is a
 * DIVISOR -- its docs suggest 8+, but that is for a small rubber-band at the
 * end of an open gesture, not for a full swipe that has to cross most of the
 * row. At 8 the row would move 18pt while the thumb moved 150.
 */
export const OVERSHOOT_FRICTION = 1 / OVERSHOOT_RATE;

/**
 * How far the finger must drag for a release to fire the outermost action.
 * Fed straight to the vendored component's `fullSwipeLeftThreshold` /
 * `fullSwipeRightThreshold`, which compare against raw drag, not eased travel.
 * Conflating those two was the original unreachable-commit bug.
 */
export function fullSwipeThreshold(rowWidth: number, panel: 'left' | 'right'): number {
  return rowWidth * (panel === 'left' ? COMMIT_FRACTION_RIGHT : COMMIT_FRACTION_LEFT);
}

/**
 * The on-screen translation at the moment the gesture becomes armed -- i.e.
 * where the row will actually be when the finger has dragged far enough to
 * commit.
 *
 * The two differ because the library eases everything past the open position:
 * `appliedTranslation = panelWidth + (drag - panelWidth) / overshootFriction`.
 * The colour has to change at the translation the row is really at, not at the
 * distance the finger has really moved, or it lights up early and lies about
 * what releasing will do.
 */
export function armTranslation(panelWidth: number, threshold: number): number {
  'worklet';
  if (threshold <= panelWidth) return threshold;
  return panelWidth + (threshold - panelWidth) * OVERSHOOT_RATE;
}

/**
 * 0 closed, 1 when the panel is exactly fully revealed, >1 while overshooting.
 * Drives the capsule stretch. `translation` is the library's own signed value:
 * positive uncovers the left panel, negative the right.
 */
export function revealFraction(translation: number, panelWidth: number): number {
  'worklet';
  if (panelWidth <= 0) return 0;
  return Math.abs(translation) / panelWidth;
}

/**
 * 0 up to `from`, reaching 1 exactly at the armed translation. Drives the
 * outermost capsule's colour and the icon's lean.
 *
 * Guarded against a pre-layout width of 0, which would otherwise divide by zero
 * and light the armed colour before the first point of drag.
 */
export function armFraction(translation: number, armAt: number, from = 0.75): number {
  'worklet';
  if (armAt <= 0) return 0;
  const progress = Math.abs(translation) / armAt;
  if (progress <= from) return 0;
  return Math.min(1, (progress - from) / (1 - from));
}
