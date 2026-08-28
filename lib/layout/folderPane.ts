import { WIDE_LAYOUT_MIN_WIDTH } from './editorChrome';

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
 * ── THE ASYMMETRY THIS EXPOSES, WHICH IS WORTH ARGUING ABOUT ──────────────
 *
 * `platform !== 'ios'` means an ANDROID TABLET IN PORTRAIT gets `persistent`,
 * while an iPad of identical dimensions gets `overlay`. Same form factor, same
 * window, different answer. That is preserved here exactly as it shipped
 * rather than quietly fixed -- see the note on `folderPanePresentation` -- but
 * it looks like an accident of writing the condition against iOS instead of
 * against shape, and `presentationDiffersByPlatform()` exists so the test can
 * pin the current behaviour and make the disagreement visible.
 */
export type FolderPanePresentation = 'navigation' | 'overlay' | 'persistent';

export interface FolderPaneInput {
  width: number;
  height: number;
  /** `Platform.OS`. Only 'ios' is treated specially -- see above. */
  platform: string;
}

export function folderPanePresentation({
  width,
  height,
  platform,
}: FolderPaneInput): FolderPanePresentation {
  // Below the md: breakpoint the folder pane and the list cannot both fit, so
  // the pane becomes a destination rather than a column.
  if (width < WIDE_LAYOUT_MIN_WIDTH) return 'navigation';

  // Landscape is derived from the WINDOW, not the device, so Split View is
  // classified by the shape the user is actually looking at.
  const isLandscape = width > height;
  return platform !== 'ios' || isLandscape ? 'persistent' : 'overlay';
}

/**
 * Do two platforms disagree about the same window? Exists for the test, which
 * documents the iOS/Android asymmetry rather than letting it be rediscovered.
 */
export function presentationDiffersByPlatform(width: number, height: number): boolean {
  return (
    folderPanePresentation({ width, height, platform: 'ios' }) !==
    folderPanePresentation({ width, height, platform: 'android' })
  );
}
