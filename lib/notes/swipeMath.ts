/**
 * The arithmetic behind the swipe row, pulled out of the component so it can
 * be tested.
 *
 * WHY IT LIVES HERE. This maths shipped wrong twice. First a clamp that made
 * the commit threshold unreachable, so force-swipe-to-commit never fired; then
 * an easing expression that collapsed to a constant for any drag SHORTER than
 * the revealed strip, so a 5pt nudge snapped the row wide open. Both read fine
 * in a component and are obvious the moment they are given numbers. Neither
 * needs a device to check.
 */

/** Width of one action slot: the capsule plus room for its label. */
export const ACTION_WIDTH = 72;
/** Swipe-left reveals three actions, swipe-right one. */
export const LEFT_ACTION_COUNT = 3;
/** Past this much drag, a release settles open instead of closed. */
export const REVEAL_THRESHOLD = 44;

/**
 * Where a release stops revealing and starts ACTING, as a fraction of the row
 * width. Two numbers because the two sides reveal different amounts: the right
 * shows one button, the left shows three (216pt, already over half a 402pt
 * row), so a single shared fraction would make "drag far enough to see Share"
 * and "delete this note" the same gesture.
 */
export const COMMIT_FRACTION_RIGHT = 0.55;
export const COMMIT_FRACTION_LEFT = 0.75;

/**
 * How much of each pixel of finger movement PAST the revealed strip actually
 * moves the row. 1 would feel loose and make accidental commits easy; too low
 * puts the commit past the edge of the screen.
 */
export const OVERSHOOT_RATE = 0.85;

/**
 * Turn raw finger translation into how far the row should actually move.
 *
 * 1:1 until the buttons are fully revealed, then eased, then capped at the row
 * width -- there is nothing to see past the row's own edge.
 */
export function easeSwipe(rawTranslation: number, rowWidth: number): number {
  // Runs on the UI thread from Gesture.Pan's onUpdate. Without the directive
  // Reanimated's babel plugin will not workletize it, and calling it from a
  // worklet throws at runtime rather than at build time.
  'worklet';
  const limit = rawTranslation > 0 ? ACTION_WIDTH : ACTION_WIDTH * LEFT_ACTION_COUNT;
  const magnitude = Math.abs(rawTranslation);
  const cap = rowWidth > 0 ? rowWidth : magnitude;

  // The branch that was missing. Below the strip the row tracks the finger
  // exactly; the easing only applies to the part BEYOND it.
  const eased =
    magnitude <= limit ? magnitude : limit + (magnitude - limit) * OVERSHOOT_RATE;

  const capped = Math.min(eased, cap);
  return rawTranslation < 0 ? -capped : capped;
}

/** What a release at this translation should do. */
export type SwipeOutcome = 'commit-left' | 'commit-right' | 'open-left' | 'open-right' | 'close';

/**
 * `translation` is the eased value, i.e. what easeSwipe returned -- NOT raw
 * finger movement. Mixing those up is what made the commit unreachable.
 */
export function outcomeFor(translation: number, rowWidth: number): SwipeOutcome {
  'worklet'; // Called from onEnd on the UI thread -- see easeSwipe.
  if (translation >= rowWidth * COMMIT_FRACTION_RIGHT) return 'commit-right';
  if (translation <= -rowWidth * COMMIT_FRACTION_LEFT) return 'commit-left';
  if (translation >= REVEAL_THRESHOLD) return 'open-right';
  if (translation <= -REVEAL_THRESHOLD) return 'open-left';
  return 'close';
}
