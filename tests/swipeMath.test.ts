/**
 * Swipe arithmetic.
 *
 * These exist because this maths shipped wrong twice, and both bugs are
 * one-liners the moment real numbers are put through them:
 *
 *  1. The row was clamped to the revealed strip while the commit test compared
 *     against a fraction of the ROW width, so the commit could never fire.
 *  2. The easing collapsed to a constant for any drag shorter than the strip,
 *     so a 5pt nudge snapped the row wide open.
 *
 * A 402pt row is used throughout -- the iPhone 17 Pro width the design
 * references were captured at.
 */
import { describe, it, expect } from './harness';
import {
  easeSwipe,
  outcomeFor,
  ACTION_WIDTH,
  LEFT_ACTION_COUNT,
  COMMIT_FRACTION_LEFT,
  COMMIT_FRACTION_RIGHT,
} from '../lib/notes/swipeMath';

const ROW = 402;
const LEFT_STRIP = ACTION_WIDTH * LEFT_ACTION_COUNT; // 216

describe('easeSwipe', () => {
  it('no drag, no movement', () => {
    expect(easeSwipe(0, ROW)).toBe(0);
  });

  it('a SMALL drag moves exactly as far as the finger', () => {
    // The regression: this used to jump straight to the full strip width,
    // so the row snapped wide open on the smallest nudge.
    expect(easeSwipe(-5, ROW)).toBe(-5);
    expect(easeSwipe(-20, ROW)).toBe(-20);
    expect(easeSwipe(5, ROW)).toBe(5);
  });

  it('tracks the finger 1:1 right up to full reveal', () => {
    expect(easeSwipe(-LEFT_STRIP, ROW)).toBe(-LEFT_STRIP);
    expect(easeSwipe(ACTION_WIDTH, ROW)).toBe(ACTION_WIDTH);
  });

  it('eases only the part BEYOND the strip', () => {
    // 100pt past 216 should contribute 85, not 100.
    expect(easeSwipe(-(LEFT_STRIP + 100), ROW)).toBe(-(LEFT_STRIP + 85));
  });

  it('never moves the row further than its own width', () => {
    expect(easeSwipe(-9999, ROW)).toBe(-ROW);
    expect(easeSwipe(9999, ROW)).toBe(ROW);
  });

  it('is NOT symmetric in sign, deliberately', () => {
    // Written the other way round first, and the suite caught it. The two
    // sides reveal different amounts, so the same finger travel eases
    // differently -- 150pt right is already past the 72pt strip and gets
    // eased, while 150pt left is still inside the 216pt strip and does not.
    expect(easeSwipe(150, ROW)).toBe(138.3);
    expect(easeSwipe(-150, ROW)).toBe(-150);
  });

  it('the two sides have different 1:1 limits', () => {
    // Right reveals one button, left reveals three, so the same finger travel
    // eases differently depending on direction.
    expect(easeSwipe(150, ROW)).toBe(ACTION_WIDTH + (150 - ACTION_WIDTH) * 0.85);
    expect(easeSwipe(-150, ROW)).toBe(-150);
  });

  it('falls back to the drag distance before layout has measured the row', () => {
    // rowWidth is 0 until onLayout fires. Capping at 0 would freeze the row.
    expect(easeSwipe(-30, 0)).toBe(-30);
  });

  it('is monotonic -- more finger always means more row', () => {
    let previous = 0;
    for (let drag = 0; drag <= 400; drag += 7) {
      const value = Math.abs(easeSwipe(-drag, ROW));
      expect(value >= previous).toBe(true);
      previous = value;
    }
  });
});

describe('outcomeFor', () => {
  it('a tiny translation closes', () => {
    expect(outcomeFor(-10, ROW)).toBe('close');
    expect(outcomeFor(10, ROW)).toBe('close');
  });

  it('past the reveal threshold it opens', () => {
    expect(outcomeFor(-60, ROW)).toBe('open-left');
    expect(outcomeFor(60, ROW)).toBe('open-right');
  });

  it('a fully revealed left strip OPENS -- it does not commit', () => {
    // The distinction the whole two-stage gesture rests on: seeing all three
    // buttons must not be the same thing as deleting the note.
    expect(outcomeFor(-LEFT_STRIP, ROW)).toBe('open-left');
  });

  it('past the commit fraction it commits', () => {
    expect(outcomeFor(-(ROW * COMMIT_FRACTION_LEFT) - 1, ROW)).toBe('commit-left');
    expect(outcomeFor(ROW * COMMIT_FRACTION_RIGHT + 1, ROW)).toBe('commit-right');
  });

  it('THE COMMIT IS REACHABLE -- the bug that made force-swipe dead code', () => {
    // easeSwipe caps at the row width, so the most a full-width drag can
    // produce is -ROW. If the commit threshold sat above that in magnitude,
    // no gesture could ever reach it. That is precisely what shipped.
    const furthest = easeSwipe(-99999, ROW);
    expect(outcomeFor(furthest, ROW)).toBe('commit-left');

    const furthestRight = easeSwipe(99999, ROW);
    expect(outcomeFor(furthestRight, ROW)).toBe('commit-right');
  });

  it('the commit is reachable with a drag that fits ON the screen', () => {
    // Not just mathematically reachable -- reachable by a thumb that cannot
    // travel further than the row is wide.
    const realisticFullWidthDrag = easeSwipe(-ROW, ROW);
    expect(outcomeFor(realisticFullWidthDrag, ROW)).toBe('commit-left');
  });

  it('committing left needs MORE than fully revealing the strip', () => {
    expect(ROW * COMMIT_FRACTION_LEFT > LEFT_STRIP).toBe(true);
  });
});
