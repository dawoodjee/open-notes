import { GROUP_GAP, SURFACE, groupWidth } from './chromeMetrics';

/**
 * Which form the desktop top bar takes, from its own measured width.
 *
 * WHY THIS EXISTS. The bar is one row -- compose | four formatting icons |
 * Share, More, Search -- and it used to assume it had room. In a landscape
 * window narrower than ~1150 with both side panes open it does not: the centre
 * zone was `flex: 1`, shrank to nothing, and its icons overflowed sideways
 * UNDER the right-hand group. Clicking "Checklist" clicked "Share this note".
 * Nothing looked obviously broken, which is how it survived: the icons were
 * still drawn, just not on top.
 *
 * So the bar now picks a form that FITS, and Search is what gives way:
 *
 *   full     Search field at its designed width
 *   narrow   Search field takes what is left, down to SEARCH_MIN
 *   button   Search is a round button; pressing it opens the field in place of
 *            the formatting icons, because there is no room for both
 *
 * Below `minBarWidth` not even `button` fits. The bar cannot solve that -- the
 * window layout does, by not pinning the Folders pane (lib/layout/folderPane.ts).
 *
 * Keyed on the BAR's width, not the window's: the bar's room depends on which
 * panes are open, which the window width alone does not say.
 */

/** The bar's own horizontal padding, each side. */
export const BAR_PADDING = 16;
/** Search at its designed width. */
export const SEARCH_FULL = 200;
/** Narrower than this a search FIELD stops being usable; it becomes a button. */
export const SEARCH_MIN = 120;

/** Formatting icons: text styles, checklist, table, attach. */
const FORMAT_COUNT = 4;
/** Share and More. */
const NOTE_ACTION_COUNT = 2;

export type TopBarForm = 'full' | 'narrow' | 'button';

export interface TopBarLayout {
  form: TopBarForm;
  /** Width of the Search surface: the field, or the round button. */
  searchWidth: number;
}

/**
 * Everything in the bar except Search, with a GROUP_GAP between each surface.
 * `leftCount` is 1 (compose) or 2 (restore-panes + compose).
 */
export function fixedWidth(leftCount: number): number {
  return (
    2 * BAR_PADDING +
    groupWidth(leftCount) +
    GROUP_GAP +
    groupWidth(FORMAT_COUNT) +
    GROUP_GAP +
    groupWidth(NOTE_ACTION_COUNT) +
    GROUP_GAP
  );
}

/** The narrowest bar that still shows every control without overlap. */
export function minBarWidth(leftCount: number): number {
  return fixedWidth(leftCount) + SURFACE;
}

export function topBarLayout({
  barWidth,
  leftCount,
}: {
  /** null before the first measurement. */
  barWidth: number | null;
  leftCount: number;
}): TopBarLayout {
  // Not measured yet: draw the designed form. Most windows are wide, and one
  // frame of the wrong form beats collapsing Search on every first paint.
  if (barWidth === null) return { form: 'full', searchWidth: SEARCH_FULL };

  const room = barWidth - fixedWidth(leftCount);
  if (room >= SEARCH_FULL) return { form: 'full', searchWidth: SEARCH_FULL };
  if (room >= SEARCH_MIN) return { form: 'narrow', searchWidth: Math.floor(room) };
  return { form: 'button', searchWidth: SURFACE };
}
