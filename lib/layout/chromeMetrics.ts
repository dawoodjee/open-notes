/**
 * The icon-button system's sizes, as plain numbers.
 *
 * They live here, not in components/IconButton.tsx, for one reason: layout
 * rules that depend on them (lib/layout/desktopTopBar.ts) are pure functions
 * with unit tests, and the test harness cannot load a file that imports React
 * Native. IconButton re-exports them, so there is still exactly one copy.
 */

/** Circle diameter and capsule height. 72px in a 2x reference. */
export const SURFACE = 36;
/** Width of one icon's slot inside a capsule. 78px in a 2x reference. */
export const SLOT = 39;
/** Between two separate surfaces on one row. 37px in a 2x reference. */
export const GROUP_GAP = 18;
/** A capsule's end-cap padding, each side. See IconButtonGroup. */
export const CAPSULE_PADDING = 4;

/** Width of an IconButtonGroup holding `count` buttons: a circle, or a capsule. */
export function groupWidth(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return SURFACE;
  return count * SLOT + 2 * CAPSULE_PADDING;
}
