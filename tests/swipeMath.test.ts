/**
 * Swipe arithmetic.
 *
 * These exist because this maths shipped wrong twice while the pan gesture was
 * hand-rolled, and both bugs are one-liners the moment real numbers are put
 * through them:
 *
 *  1. The row was clamped to the revealed panel while the commit test compared
 *     against a fraction of the ROW width, so the commit could never fire.
 *  2. The easing collapsed to a constant for any drag shorter than the panel,
 *     so a 5pt nudge snapped the row wide open.
 *
 * The pan now belongs to the vendored `ReanimatedSwipeable`, so the easing and
 * the release decision are the library's. What is still ours -- and still worth
 * testing -- is where the thresholds sit and how the capsule reads them.
 *
 * A 402pt row is used throughout: the iPhone 17 Pro width the design references
 * were captured at.
 */
import { describe, it, expect } from './harness';
import {
  ACTION_WIDTH,
  COMMIT_FRACTION_LEFT,
  COMMIT_FRACTION_RIGHT,
  OVERSHOOT_FRICTION,
  OVERSHOOT_RATE,
  REVEAL_THRESHOLD,
  RIGHT_PANEL_WIDTH,
  armFraction,
  armTranslation,
  fullSwipeThreshold,
  revealFraction,
} from '../lib/notes/swipeMath';

const ROW = 402;

describe('fullSwipeThreshold', () => {
  it('is a fraction of the row, per side', () => {
    expect(fullSwipeThreshold(ROW, 'left')).toBeCloseTo(ROW * COMMIT_FRACTION_RIGHT);
    expect(fullSwipeThreshold(ROW, 'right')).toBeCloseTo(ROW * COMMIT_FRACTION_LEFT);
  });

  it('IS REACHABLE BY A THUMB -- the bug that made full swipe dead code', () => {
    // A finger cannot drag further than the row is wide. If either threshold
    // sat past that, no gesture could ever reach it. That is what shipped.
    expect(fullSwipeThreshold(ROW, 'left') < ROW).toBe(true);
    expect(fullSwipeThreshold(ROW, 'right') < ROW).toBe(true);
  });

  it('needs MORE than fully revealing the panel', () => {
    // Seeing all three buttons must not be the same gesture as deleting.
    expect(fullSwipeThreshold(ROW, 'left') > ACTION_WIDTH).toBe(true);
    expect(fullSwipeThreshold(ROW, 'right') > RIGHT_PANEL_WIDTH).toBe(true);
  });

  it('needs more than merely opening the row', () => {
    expect(fullSwipeThreshold(ROW, 'left') > REVEAL_THRESHOLD).toBe(true);
    expect(fullSwipeThreshold(ROW, 'right') > REVEAL_THRESHOLD).toBe(true);
  });
});

describe('armTranslation', () => {
  it('matches the library easing: full panel, then the rest at OVERSHOOT_RATE', () => {
    const threshold = fullSwipeThreshold(ROW, 'left'); // 221.1
    expect(armTranslation(ACTION_WIDTH, threshold)).toBeCloseTo(
      ACTION_WIDTH + (threshold - ACTION_WIDTH) * OVERSHOOT_RATE
    );
  });

  it('OVERSHOOT_FRICTION is the same number the other way up', () => {
    // The library divides by it; we multiply by the rate. If these ever drift
    // apart, the armed colour lights at a different point from the commit.
    expect(1 / OVERSHOOT_FRICTION).toBeCloseTo(OVERSHOOT_RATE);
  });

  it('the armed row is still ON SCREEN', () => {
    // This is the number that matters for feel: how far the row has actually
    // travelled when the action arms. Past the row width and the armed state
    // would only exist off the edge of the display.
    expect(armTranslation(ACTION_WIDTH, fullSwipeThreshold(ROW, 'left'))).toBeCloseTo(198.735);
    expect(armTranslation(RIGHT_PANEL_WIDTH, fullSwipeThreshold(ROW, 'right'))).toBeCloseTo(288.675);
  });

  it('the armed row has travelled PAST the revealed buttons', () => {
    expect(armTranslation(ACTION_WIDTH, fullSwipeThreshold(ROW, 'left')) > ACTION_WIDTH).toBe(true);
    expect(
      armTranslation(RIGHT_PANEL_WIDTH, fullSwipeThreshold(ROW, 'right')) > RIGHT_PANEL_WIDTH
    ).toBe(true);
  });

  it('does not ease a threshold that sits inside the panel', () => {
    // No overshoot has happened yet at that point, so there is nothing to ease.
    expect(armTranslation(216, 100)).toBe(100);
  });
});

describe('revealFraction', () => {
  it('0 closed, 1 fully revealed', () => {
    expect(revealFraction(0, ACTION_WIDTH)).toBe(0);
    expect(revealFraction(ACTION_WIDTH, ACTION_WIDTH)).toBe(1);
  });

  it('is sign-blind -- each panel only ever sees its own side', () => {
    expect(revealFraction(-RIGHT_PANEL_WIDTH, RIGHT_PANEL_WIDTH)).toBe(1);
  });

  it('goes past 1 while overshooting', () => {
    expect(revealFraction(108, ACTION_WIDTH)).toBe(1.5);
  });

  it('is 0 before layout has measured anything', () => {
    // Would be Infinity otherwise, and the capsule would render at full stretch
    // on the very first frame.
    expect(revealFraction(50, 0)).toBe(0);
  });
});

describe('armFraction', () => {
  const armAt = armTranslation(ACTION_WIDTH, fullSwipeThreshold(ROW, 'left'));

  it('is 0 until the last quarter of the way', () => {
    expect(armFraction(0, armAt)).toBe(0);
    expect(armFraction(armAt * 0.5, armAt)).toBe(0);
    expect(armFraction(armAt * 0.75, armAt)).toBe(0);
  });

  it('reaches exactly 1 at the armed translation', () => {
    expect(armFraction(armAt, armAt)).toBeCloseTo(1);
  });

  it('is half way across the last quarter', () => {
    expect(armFraction(armAt * 0.875, armAt)).toBeCloseTo(0.5);
  });

  it('clamps past the threshold rather than running away', () => {
    expect(armFraction(armAt * 3, armAt)).toBe(1);
  });

  it('is sign-blind, like revealFraction', () => {
    expect(armFraction(-armAt, armAt)).toBeCloseTo(1);
  });

  it('is 0 before layout, not NaN or Infinity', () => {
    expect(armFraction(50, 0)).toBe(0);
  });

  it('is monotonic -- more travel never means less armed', () => {
    let previous = 0;
    for (let t = 0; t <= 400; t += 7) {
      const value = armFraction(t, armAt);
      expect(value >= previous).toBe(true);
      previous = value;
    }
  });

  it('the armed colour does NOT light merely because the buttons are visible', () => {
    // The whole point of separating reveal from arm. On the three-action side
    // the buttons are fully out at 216pt, and releasing there just opens the
    // row -- so the capsule must not look armed yet.
    const rightArmAt = armTranslation(RIGHT_PANEL_WIDTH, fullSwipeThreshold(ROW, 'right'));
    expect(armFraction(-RIGHT_PANEL_WIDTH, rightArmAt)).toBe(0);
  });
});
