/**
 * Which chrome the editor wears: the phone's floating nav bar, the iPad's
 * capsule-and-circles bar, or the desktop's three-zone bar.
 *
 * ── WHY THIS IS A FUNCTION AND NOT THREE TERNARIES IN A COMPONENT ─────────
 *
 * Because of Split View, which the stage checkpoint names and which is
 * genuinely awkward to drive from a script: it is a drag out of the Dock, and
 * on iPadOS 26 the whole multitasking model changed underneath it. But what
 * Split View actually DOES to this app is make its window narrow — every other
 * consequence follows from that. So the decision that matters is a pure
 * function of width and platform, and it can be asserted directly instead of
 * eyeballed once and hoped about afterwards.
 *
 * The trap it exists to prevent: `isPad` is still true in a Split View pane, so
 * a rule written as "iPad gets the iPad bar" hands a 507pt-wide pane a bar laid
 * out for a full screen. Width has to win, and the test says so.
 */

export type EditorChromeKind = 'phone' | 'pad' | 'desktop';

export interface ChromeInputs {
  /** The WINDOW's width, not the screen's. In Split View they differ. */
  width: number;
  platform: 'ios' | 'android' | 'web';
  /** True for an iPad, including one sharing the screen with another app. */
  isPad: boolean;
}

/**
 * Below this, the editor wears the phone's two-zone chrome whatever it is
 * running on.
 *
 * The same 768 the rest of the app uses for "is this a wide layout", and it is
 * deliberately the same number: a window that is too narrow for three panes is
 * too narrow for a bar with three zones, and two thresholds that meant almost
 * the same thing would drift apart the first time one of them was tuned.
 */
export const WIDE_LAYOUT_MIN_WIDTH = 768;

export function editorChrome({ width, platform, isPad }: ChromeInputs): EditorChromeKind {
  if (width < WIDE_LAYOUT_MIN_WIDTH) return 'phone';
  if (platform === 'web') return 'desktop';
  if (platform === 'ios' && isPad) return 'pad';
  // A wide Android tablet, or an iPhone held sideways above the threshold.
  // Neither has chrome of its own yet, and the phone's is the honest fallback:
  // it is the one that works at any width.
  return 'phone';
}
