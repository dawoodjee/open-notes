import { WIDE_LAYOUT_MIN_WIDTH, type EditorChromeKind } from './editorChrome';
import { minBarWidth } from './desktopTopBar';

/**
 * How the folder pane is presented: replacing the screen, floating over it, or
 * pushing it aside.
 *
 * ── WHY THIS IS A MODULE NOW ──────────────────────────────────────────────
 *
 * The rule was three inline expressions in NotesLayout, and it has been the
 * project's longest-standing unverified claim -- the iPad landscape/portrait
 * behaviour has been asserted since Stage 11 and never actually confirmed,
 * because `simctl` cannot rotate a simulator (rotation needs Accessibility
 * permission for System Events, which is a separate grant from Automation).
 *
 * But the rule never needed a device. It is a pure function of the window and
 * the platform, and the cases that matter -- iPad portrait versus landscape,
 * Split View, an Android tablet -- are just numbers. Extracting it turns "we
 * think the iPad does the right thing" into something a test states.
 *
 * ── THE THREE PRESENTATIONS ───────────────────────────────────────────────
 *
 *   'navigation'  narrow: the folder pane IS a screen you navigate to, and the
 *                 list is somewhere else entirely. Phones, and an iPad squeezed
 *                 into a narrow Split View -- which is genuinely narrow and
 *                 should behave like a phone, which asking "is this an iPad"
 *                 gets wrong.
 *   'overlay'     wide, but the pane floats OVER the content with the content
 *                 still visible behind it. iPad portrait, per
 *                 ipad-portrait-folder-view.jpeg.
 *   'persistent'  wide: a real column that pushes the content aside. Desktop,
 *                 and a landscape iPad.
 *
 * ── IT ANSWERS ON SHAPE, NOT ON PLATFORM (Adam, 2026-08-28) ───────────────
 *
 * This used to read `platform !== 'ios' || isLandscape`, which meant an ANDROID
 * TABLET IN PORTRAIT got `persistent` while an iPad of identical dimensions got
 * `overlay` -- same window, same shape, different answer. That was an accident
 * of writing the condition against iOS rather than against the window, and Adam
 * called it: make it uniform.
 *
 * So the platform is gone from the decision entirely. Two windows of the same
 * size now always get the same layout, which is the property that makes this
 * rule explainable in one sentence.
 *
 * THE CONSEQUENCE, ACCEPTED: a desktop browser window that is TALLER than it is
 * wide -- drag a window narrow on a big display, say 900x1000 -- now gets the
 * floating overlay where it used to get the column. That follows from the same
 * reasoning that makes iPad portrait an overlay (a tall, narrow window has no
 * width to spare for a permanent column), and it is the price of uniformity.
 * `platform` stays in the input type because callers already pass it and it
 * documents what the rule deliberately ignores.
 */
export type FolderPanePresentation = 'navigation' | 'overlay' | 'persistent';

export interface FolderPaneInput {
  width: number;
  height: number;
  /**
   * `Platform.OS`. DELIBERATELY UNUSED since 2026-08-28 — kept in the type
   * because every caller already passes it, and because its presence is what
   * makes "this rule ignores the platform" a visible decision rather than an
   * omission somebody re-adds by accident.
   */
  platform?: string;
  /**
   * Which top bar the editor draws. Optional, and the ONE input besides the
   * window that changes the answer -- see DESKTOP_PINNED_FOLDERS_MIN_WIDTH.
   * This is not the platform coming back in: it is keyed on what the bar
   * needs, and with it omitted the rule is exactly as platform-blind as before.
   */
  chrome?: EditorChromeKind;
}

/** The pinned Folders column (`md:w-72` in FolderSidebar). */
const FOLDER_PANE_WIDTH = 288;
/** The note list column (`md:w-80` in NotesLayout). */
const NOTE_LIST_WIDTH = 320;
/** The two columns' right-hand borders. Measured: the editor starts at 612. */
const PANE_BORDERS = 4;

/**
 * Below this window width the Folders pane is not pinned under DESKTOP chrome.
 *
 * WHY. The desktop top bar needs `minBarWidth` to show every control without
 * overlap, even in its smallest form (lib/layout/desktopTopBar.ts). With both
 * columns pinned the editor gets `window - 612`. Narrower than this, no form of
 * the bar fits and its formatting icons end up underneath Share and Search --
 * measured at an 800-wide window, where the bar had 188px. So the Folders pane
 * floats instead, which is what portrait windows already do.
 *
 * DESKTOP CHROME ONLY, deliberately. The iPad draws a different bar
 * (PadTopBar) with different needs, and its pinned landscape layout is a
 * verified design; tying the iPad's layout to the width of a bar it does not
 * draw would be an accident waiting for the next button added here.
 *
 * Derived, not typed in: add a control to the desktop bar and this moves with it.
 */
export const DESKTOP_PINNED_FOLDERS_MIN_WIDTH =
  FOLDER_PANE_WIDTH + NOTE_LIST_WIDTH + PANE_BORDERS + minBarWidth(1);

export function folderPanePresentation({
  width,
  height,
  chrome,
}: FolderPaneInput): FolderPanePresentation {
  // Below the md: breakpoint the folder pane and the list cannot both fit, so
  // the pane becomes a destination rather than a column.
  if (width < WIDE_LAYOUT_MIN_WIDTH) return 'navigation';

  // Derived from the WINDOW, not the device, so Split View and a resized
  // desktop window are both classified by the shape the user is looking at.
  const isLandscape = width > height;
  if (!isLandscape) return 'overlay';

  // Landscape, but too narrow for the desktop bar beside two pinned columns.
  if (chrome === 'desktop' && width < DESKTOP_PINNED_FOLDERS_MIN_WIDTH) return 'overlay';
  return 'persistent';
}

/**
 * Do two platforms disagree about the same window? Now always false, and the
 * test asserts that — it is the property Adam asked for, so it is worth being
 * unable to break silently.
 */
export function presentationDiffersByPlatform(width: number, height: number): boolean {
  return (
    folderPanePresentation({ width, height, platform: 'ios' }) !==
    folderPanePresentation({ width, height, platform: 'android' })
  );
}
