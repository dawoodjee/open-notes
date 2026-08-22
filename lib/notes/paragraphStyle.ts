import type { ToolKey } from './toolbarContext';

/**
 * Which paragraph style a line is in — and the fact that "none of them" is
 * itself an answer.
 *
 * ── WHY THIS IS A MODULE ──────────────────────────────────────────────────
 *
 * Three places need the same list and would each have written it out:
 * the desktop `Aa` panel (to tick exactly one row), the editor's Body action
 * (to turn off whatever is on), and the harness fixture that stands in for the
 * editor. Three copies of a list whose ORDER does not matter but whose
 * MEMBERSHIP does is how a style ends up unticked in the menu but still
 * clearable by Body, or the reverse.
 *
 * ── BODY IS DERIVED, NOT REPORTED ─────────────────────────────────────────
 *
 * `react-native-enriched-html` has no "paragraph" state. It reports h1..h3,
 * code block, block quote and the three list kinds; a plain line is simply
 * none of those. So Body cannot be read, only inferred — and inferring it is
 * what makes the menu honest, because a menu where nothing is ticked on an
 * ordinary line looks broken.
 */
export const BLOCK_STYLES: readonly ToolKey[] = [
  'heading',
  'heading2',
  'heading3',
  'codeBlock',
  'blockquote',
  'bulletList',
  'numberedList',
  'checklist',
] as const;

/**
 * The one paragraph style active at the caret, or `'body'` for none.
 *
 * Returns the FIRST match rather than asserting there is only one. The editor
 * makes them mutually exclusive, but if that ever stopped holding, a menu that
 * ticks one row is a much smaller problem than one that throws.
 */
export function activeParagraphStyle(active: Partial<Record<ToolKey, boolean>>): ToolKey {
  return BLOCK_STYLES.find((key) => active[key] === true) ?? 'body';
}

/**
 * Applying a paragraph style, expressed as which styles to TOGGLE.
 *
 * The editor's block toggles are their own inverse, so "make this Body" is
 * "toggle off whatever is on", and "make this a Heading" is "toggle off what is
 * on, then toggle Heading". Returning the list instead of performing it keeps
 * this testable without an editor instance.
 *
 * Selecting the style that is ALREADY active returns just that style, which
 * toggles it off and lands on Body — matching how the editor behaves when you
 * press an active block button, rather than inventing a no-op.
 */
export function paragraphStyleToggles(
  active: Partial<Record<ToolKey, boolean>>,
  target: ToolKey
): ToolKey[] {
  const current = activeParagraphStyle(active);

  if (target === 'body') return current === 'body' ? [] : [current];
  if (target === current) return [target];
  return current === 'body' ? [target] : [current, target];
}
