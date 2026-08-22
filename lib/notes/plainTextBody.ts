/**
 * Plain text in, the app's stored HTML out, and back again.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Web has no rich editor. The native one is `react-native-enriched-html`, whose
 * web implementation drags in the whole `@tiptap` chain that Stage 12b had to
 * keep out of the bundle, and Stage 13 owns what the web editor actually
 * becomes. Until then web either edits notes as plain text or does not edit
 * them at all -- and "does not edit them at all" was the dead end this
 * sub-phase exists to remove. Adam's requirement, 2026-08-22: the user must be
 * "able to work offline, create and export notes".
 *
 * So: a lossless-enough plain-text projection, and an explicit refusal to
 * flatten anything it would damage.
 *
 * ── THE REFUSAL IS THE IMPORTANT HALF ─────────────────────────────────────
 *
 * Round-tripping a formatted note through plain text destroys the formatting
 * SILENTLY -- open a note with bold and a bulleted list on web, touch nothing,
 * and an autosave would write back a flat document. That is data loss caused
 * by looking. `isPlainTextSafe` is what stops it: a note is editable on web
 * only if its body is already nothing but a heading and paragraphs, so the
 * projection has nothing to lose.
 */

import { stripEnrichedWrapper } from './htmlMigrate';

/**
 * The complete set of markup this projection can reproduce. Anything else in a
 * body means the note is richer than plain text can hold.
 *
 * `<br>` is included because the projection emits newlines for it and can emit
 * it back; the block tags are `<h1>` and `<p>` because that is exactly what
 * `toPlainTextHtml` writes.
 */
const ALLOWED_TAG = /^<\/?(h1|p|br\s*\/?)>$/i;

/** Every tag in the body, wrapper stripped. */
function tagsIn(body: string): string[] {
  return stripEnrichedWrapper(body).match(/<[^>]+>/g) ?? [];
}

/**
 * Can this note be edited as plain text without losing anything?
 *
 * An empty note is safe, which matters: it is what every new note starts as,
 * and a new note is the main thing anybody is going to do on web.
 */
export function isPlainTextSafe(body: string): boolean {
  return tagsIn(body).every((tag) => ALLOWED_TAG.test(tag));
}

/** `&amp;` is deliberately LAST: decode it first and a literal `&amp;lt;`
 *  -- the correct storage for the four characters `&lt;` -- comes back as `<`. */
const ENTITIES: [RegExp, string][] = [
  [/&nbsp;/g, ' '],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&amp;/g, '&'],
];

/**
 * A stored body as editable text.
 *
 * Handles bodies this module did not write, because it is also what the
 * READ-ONLY view uses -- a richly formatted note still has to be legible on
 * web even though it cannot be edited there.
 *
 * The first replace is the one that is easy to get wrong. Stored bodies put
 * each block on its own LINE -- `toEnrichedHtml` does it so the native parser
 * can read them, and `toPlainTextHtml` follows suit. Those newlines are
 * formatting, not content, so they have to go before closing block tags become
 * newlines; otherwise every paragraph break doubles, and a round trip through
 * this pair grows the note a blank line at a time.
 */
export function toPlainText(body: string): string {
  let text = stripEnrichedWrapper(body)
    // Formatting whitespace BETWEEN tags, dropped. Whitespace inside a block is
    // the note's own and is left alone.
    .replace(/>\s*\n\s*</g, '><')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  for (const [pattern, replacement] of ENTITIES) {
    text = text.replace(pattern, replacement);
  }
  // Only the trailing newline the last block tag produced. Blank lines inside
  // the note are the user's and are not collapsed -- they round-trip as empty
  // paragraphs.
  return text.replace(/\n$/, '');
}

/** The three characters that would otherwise reopen as markup. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Editable text back into a stored body.
 *
 * THE FIRST LINE BECOMES AN `<h1>`, matching the seed in `htmlMigrate.ts` and
 * Adam's rule that a note's first line is its heading. Without this, a note
 * started on web and later opened on the phone would have a paragraph where
 * every other note has a title -- the same note looking different on two
 * devices, which is the kind of drift nobody attributes to the right cause.
 *
 * Returns `''` for empty input rather than an empty document, because `''` is
 * what `createNoteInDB` stores and what `isBlankNote` recognises. Emitting
 * `<html><h1></h1></html>` here instead would be harmless for display and
 * wrong for deletion.
 */
export function toPlainTextHtml(text: string): string {
  if (text.trim() === '') return '';

  const lines = text.split('\n');
  const blocks = lines.map((line, index) => {
    const escaped = escapeHtml(line);
    return index === 0 ? `<h1>${escaped}</h1>` : `<p>${escaped}</p>`;
  });
  return `<html>\n${blocks.join('\n')}\n</html>`;
}
