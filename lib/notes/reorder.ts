/**
 * The arithmetic behind drag-to-reorder, kept out of the component so it can
 * be tested without a device.
 *
 * WHY IT LIVES HERE, and it is not the usual reason. The swipe maths was
 * extracted after shipping wrong twice; this is extracted because the drag
 * CANNOT be exercised on a simulator at all. Injected touches drive React
 * Native's own responder system but never fire a `UIGestureRecognizer`, so
 * every gesture-handler recogniser in the app is invisible to `simctl`. Unit
 * tests plus a browser run are the whole verification surface here, which
 * means the decisions worth getting wrong all have to live in this file
 * rather than inside a worklet.
 *
 * Three functions, and the split matters: `moveToIndex` is what the database
 * write is expressed in, and the other two are what the finger is expressed
 * in. They meet only at an integer index.
 */

/**
 * Move one item to a new index. Pure -- `items` is not touched.
 *
 * Splice-out-then-splice-in rather than a swap, because a drag lands on an
 * arbitrary slot: dragging row 0 to row 4 in a swap model would be four
 * separate exchanges, and the intermediate states are not what the user saw
 * under their finger.
 */
export function moveToIndex<T>(items: T[], from: number, to: number): T[] {
  const next = items.slice();
  if (from === to || from < 0 || from >= items.length) return next;
  const clamped = Math.max(0, Math.min(to, items.length - 1));
  const [item] = next.splice(from, 1);
  next.splice(clamped, 0, item);
  return next;
}

/**
 * Which slot the dragged row is currently hovering over.
 *
 * ROUND, not floor. Floor would mean the row only claims the next slot once it
 * has travelled a FULL row height, so the visual gap opens a beat after the
 * finger has clearly committed. Rounding swaps at the halfway point, which is
 * where the dragged row's own body has covered more of the neighbour than of
 * its origin -- i.e. exactly when the screen already looks like the swap
 * happened.
 *
 * `rowHeight` of 0 is the pre-layout case and must not divide: it returns the
 * start index, so a drag that somehow begins before measurement is inert
 * rather than teleporting the row to slot NaN.
 */
export function targetIndexFor(
  startIndex: number,
  translationY: number,
  rowHeight: number,
  count: number
): number {
  'worklet';
  if (rowHeight <= 0 || count <= 0) return startIndex;
  const raw = startIndex + Math.round(translationY / rowHeight);
  return Math.max(0, Math.min(raw, count - 1));
}

/**
 * How far a row that is NOT being dragged has to move out of the way, counted
 * in whole rows.
 *
 * The dragged row leaves a hole at `startIndex` and needs one at
 * `targetIndex`; everything strictly between them slides one place towards the
 * hole. Returning a multiplier rather than a pixel offset keeps this testable
 * without a measured row height, and keeps the one place that knows the height
 * (the style worklet) to a single multiplication.
 */
export function rowShift(index: number, startIndex: number, targetIndex: number): -1 | 0 | 1 {
  'worklet';
  // -1 is the idle sentinel for both, so an untouched list is all zeroes.
  if (startIndex < 0 || targetIndex < 0) return 0;
  if (index === startIndex || startIndex === targetIndex) return 0;
  if (startIndex < targetIndex) return index > startIndex && index <= targetIndex ? -1 : 0;
  return index >= targetIndex && index < startIndex ? 1 : 0;
}
