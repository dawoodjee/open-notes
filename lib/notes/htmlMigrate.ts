/**
 * Converting the HTML this app stored under TenTap into the dialect
 * `react-native-enriched-html` will accept.
 *
 * WHY ANY OF THIS IS NEEDED. The new editor's `setValue()` is fussy in two
 * ways that were found by measurement, not documentation:
 *
 *  1. It decides "is this HTML or is this plain text?" by INPUT STRING LENGTH.
 *     At or below ~12 characters it escapes the markup and shows it as text,
 *     so `<h1>r</h1>` -- a real note here -- displayed as the literal
 *     characters `<h1>r</h1>`. Wrapping in `<html>…</html>` adds 14 characters
 *     and clears the threshold for every possible document, which is why the
 *     wrapper is applied unconditionally rather than only when it looks needed.
 *
 *  2. Once wrapped, it understands `<b>` and `<i>` but silently DROPS
 *     `<strong>` and `<em>` -- and those are exactly what TenTap emits for
 *     bold and italic. Unwrapped input gets converted; wrapped input does not.
 *     So the conversion has to happen here, before wrapping.
 *
 * Everything else survives: headings, `<u>`, `<s>`, `<code>`, links, lists and
 * blockquotes were all verified round-tripping unchanged.
 *
 * WHAT IS LOST, accepted deliberately (see the Decisions Log):
 *  - nested lists flatten to one level;
 *  - task-list checked state;
 *  - `<pre><code>` becomes the library's non-standard `<codeblock>`.
 */

/** Documents already in the new dialect start with this and are left alone. */
const ENRICHED_PREFIX = '<html>';

/**
 * Block-level tags the editor understands. Used to put each block on its own
 * line, because the parser is line-oriented and TenTap writes blocks with no
 * separator between them.
 */
const BLOCK_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'blockquote', 'pre'];

export function isEnrichedHtml(body: string): boolean {
  return body.trimStart().startsWith(ENRICHED_PREFIX);
}

/**
 * Make a stored note body safe to hand to `EnrichedTextInput.setValue()`.
 *
 * Idempotent: a body that has already been migrated is returned untouched, so
 * this can sit on the read path and run on every open without the document
 * drifting a little further each time.
 */
export function toEnrichedHtml(body: string): string {
  if (isEnrichedHtml(body)) return body;

  const trimmed = body.trim();

  // An empty note is a real and very common state -- it is what every new note
  // starts as.
  //
  // SEEDED AS A HEADING, NOT A PARAGRAPH (Adam, 2026-08-22): the first line of
  // a note is its title, and typing it should not require reaching for a
  // formatting control first. Carried in the document itself rather than as a
  // runtime rule, so there is nothing to re-apply, nothing to race the editor's
  // own initialisation, and no state to get out of step.
  //
  // Safe for `isBlankNote`, which strips tags and asks whether any VISIBLE text
  // remains: an empty <h1> has none, exactly as an empty <p> had none. That
  // matters more than it sounds -- isBlankNote decides whether a note is
  // permanently deleted, so a seed that read as non-blank would leak an empty
  // note into the list every time one was opened and abandoned.
  if (trimmed === '') return '<html>\n<h1></h1>\n</html>';

  let html = trimmed
    // The semantic tags the library drops. Attribute forms are not matched on
    // purpose: TenTap emits these bare, and a regex loose enough to catch
    // arbitrary attributes is loose enough to corrupt text that merely
    // mentions them.
    .replace(/<strong>/g, '<b>')
    .replace(/<\/strong>/g, '</b>')
    .replace(/<em>/g, '<i>')
    .replace(/<\/em>/g, '</i>');

  // One block per line. The parser reads line by line, and two block tags
  // sharing a line cost the second one its inline formatting.
  for (const tag of BLOCK_TAGS) {
    html = html.replace(new RegExp(`(</${tag}>)(<)`, 'g'), '$1\n$2');
  }

  return `<html>\n${html}\n</html>`;
}

/**
 * Strip the wrapper back off, for the plain-text and title helpers that read a
 * body without rendering it.
 *
 * They work on tag-stripped text anyway, so this is mostly about not leaving a
 * stray "html" in a preview line if the tag-stripping is ever loosened.
 */
export function stripEnrichedWrapper(body: string): string {
  if (!isEnrichedHtml(body)) return body;
  return body
    .trim()
    .replace(/^<html>\s*/, '')
    .replace(/\s*<\/html>$/, '');
}
