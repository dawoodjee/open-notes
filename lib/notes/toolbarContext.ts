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

export type ToolKey =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'heading'
  | 'bulletList'
  | 'numberedList'
  | 'checklist'
  | 'blockquote'
  | 'code'
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
] as const;

export function isSupported(key: ToolKey): boolean {
  return !UNSUPPORTED.includes(key);
}

/**
 * Resting order: inline marks first, then block structure, then insertions.
 * Everything the bar can ever show appears here exactly once.
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
