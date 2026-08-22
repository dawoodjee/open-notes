/**
 * What the keyboard-docked formatting bar shows, and in what order, for where
 * the caret currently is.
 *
 * ── THE RULE THAT SHAPES ALL OF THIS ──────────────────────────────────────
 *
 * Context REORDERS the bar. It never adds or removes anything.
 *
 * That is not a simplification, it is the requirement. The bar is a horizontal
 * scroller sitting directly above the keyboard, and the caret's context changes
 * while the user is already reaching for a button -- typing `- ` turns a
 * paragraph into a list item mid-gesture. If the set changed, a thumb already
 * travelling toward "italic" would land on whatever slid into that slot. Every
 * control is always present, so the worst a context switch can do is move a
 * button the user has not started reaching for yet.
 *
 * It also means the "swap in place, no bounce, no flash" requirement is
 * achievable at all: reordering a fixed set is a layout animation, whereas a
 * changing set is an enter/exit animation, and those are what draw the eye.
 *
 * ── WHAT COMES FORWARD, AND WHY ───────────────────────────────────────────
 *
 *   on a list item      indent, outdent, strikethrough
 *   on a blank body line  heading, bulleted list
 *   anywhere else       the plain inline set
 *
 * Both fronts are Adam's, 2026-08-22, and both are about the thing you most
 * likely want next: nesting when you are in a list, structure when you are at
 * the start of an empty line.
 */

/**
 * Every formatting action the app can NAME, which is deliberately more than
 * any one surface shows.
 *
 * The phone's bar shows `RESTING_ORDER`; the desktop `Aa` panel shows a
 * different, overlapping set (it has Title/Heading/Subheading as separate rows
 * where the bar has one H1, and it names Body explicitly). Keeping one
 * vocabulary means `isSupported` and the editor's RUN map are shared rather
 * than duplicated per surface -- and a control that gains support gains it
 * everywhere at once.
 */
export type ToolKey =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'heading'
  /** h2 and h3, named by the reference's own labels: Heading and Subheading. */
  | 'heading2'
  | 'heading3'
  /** The absence of any block style. Not a format the editor reports -- the
   *  desktop panel derives it, and running it clears whatever is active. */
  | 'body'
  | 'bulletList'
  /** A bulleted list drawn with dashes. The app stores a bullet-style
   *  preference already, but nothing yet applies it to the editor, so this is
   *  a distinct action the editor cannot perform. */
  | 'dashedList'
  | 'numberedList'
  | 'checklist'
  | 'blockquote'
  | 'code'
  /** A monospaced BLOCK -- the reference's "Monostyled" row. Distinct from
   *  `code`, which is the inline mark. */
  | 'codeBlock'
  | 'link'
  | 'image'
  | 'indent'
  | 'outdent'
  | 'highlight'
  | 'textColor'
  | 'table';

/**
 * Present in the bar, permanently disabled, because
 * `react-native-enriched-html` cannot perform them. Rendered rather than
 * hidden so the bar's layout is final now and does not shift the day the
 * native editor gains them -- Adam's call, 2026-08-22. See the Decisions Log.
 *
 * `indent`/`outdent` are the sharp end of this: they are two of the three
 * controls the list context is specified to bring forward, so on a bullet the
 * bar leads with two buttons that are visibly there and visibly unavailable.
 * That is the honest rendering of the current state, and it is why the third,
 * strikethrough, matters -- it is the one that works.
 */
export const UNSUPPORTED: readonly ToolKey[] = [
  'indent',
  'outdent',
  'highlight',
  'textColor',
  'table',
  // Rendered by the desktop panel, disabled: `react-native-enriched-html` has
  // one bulleted list. The stored bullet-style preference (Settings ->
  // Appearance) is not yet wired to the editor, so there is no second list
  // style to switch to.
  'dashedList',
] as const;

export function isSupported(key: ToolKey): boolean {
  return !UNSUPPORTED.includes(key);
}

/**
 * Resting order: inline marks first, then block structure, then insertions.
 * Everything THE PHONE BAR can ever show appears here exactly once.
 *
 * Not every `ToolKey` is here, and that is the point: `heading2`, `heading3`,
 * `body` and `dashedList` exist for the desktop `Aa` panel, which has room for
 * named paragraph styles where a thumb-width scroller does not.
 */
const RESTING_ORDER: readonly ToolKey[] = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'highlight',
  'textColor',
  'heading',
  'bulletList',
  'numberedList',
  'checklist',
  'indent',
  'outdent',
  'blockquote',
  'code',
  'link',
  'image',
  'table',
] as const;

const LIST_FRONT: readonly ToolKey[] = ['indent', 'outdent', 'strikethrough'] as const;
const BLANK_LINE_FRONT: readonly ToolKey[] = ['heading', 'bulletList'] as const;

export interface EditorContext {
  /** Caret is inside a bulleted, numbered or checklist item. */
  onListItem: boolean;
  /**
   * Caret is on a line of body text with nothing on it. Derived by the caller:
   * the editor's `onChangeState` reports which FORMATS are active, never
   * whether the line has any text.
   */
  onBlankBodyLine: boolean;
}

/**
 * The bar's order for this context.
 *
 * `onListItem` wins when both are true, because an empty bullet is still a
 * bullet: what you want on it is to nest or unnest it, not to turn the blank
 * line it sits on into a heading.
 */
export function toolbarOrder({ onListItem, onBlankBodyLine }: EditorContext): ToolKey[] {
  const front = onListItem ? LIST_FRONT : onBlankBodyLine ? BLANK_LINE_FRONT : [];
  return [...front, ...RESTING_ORDER.filter((key) => !front.includes(key))];
}
