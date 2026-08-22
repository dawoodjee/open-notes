/**
 * Finding and replacing inside one note.
 *
 * ── THE PROBLEM THIS SOLVES ───────────────────────────────────────────────
 *
 * A note is stored as HTML and displayed by a native editor that exposes only
 * `setValue(html)`, `setSelection(start, end)` and the plain text it reports
 * through `onChangeText`. So the two halves of find-and-replace live in two
 * different coordinate systems:
 *
 *   FINDING happens in PLAIN TEXT, because that is what the user sees and what
 *   `setSelection` counts in.
 *
 *   REPLACING happens in HTML, because that is what gets stored — and it has to
 *   avoid the markup entirely. A naive `html.replaceAll(query, replacement)`
 *   searching for "b" would rewrite every `<b>` tag in the document into
 *   something that is no longer HTML. That is not a corner case; it is the
 *   first single-letter search anybody types.
 *
 * Both are pure functions here so they can be tested without an editor, which
 * matters more than usual: the failure mode of getting the second one wrong is
 * a silently mangled note.
 */

export interface FindOptions {
  /** Off by default, matching every find bar the user has ever used. */
  caseSensitive?: boolean;
}

export interface Match {
  start: number;
  /** Exclusive, so `end - start` is the length and it drops straight into
   *  `setSelection(start, end)`. */
  end: number;
}

/**
 * Every occurrence of `query` in `text`, left to right, non-overlapping.
 *
 * Non-overlapping is the same rule every find bar uses: searching "aa" in
 * "aaaa" finds two matches, not three. Overlapping would make "next match"
 * advance by one character and feel broken.
 */
export function findMatches(text: string, query: string, options: FindOptions = {}): Match[] {
  if (query === '') return [];

  const haystack = options.caseSensitive ? text : text.toLowerCase();
  const needle = options.caseSensitive ? query : query.toLowerCase();

  const matches: Match[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    matches.push({ start: at, end: at + needle.length });
    from = at + needle.length;
  }
  return matches;
}

/**
 * Which match is "current" after moving, wrapping at both ends.
 *
 * Wrapping is not a nicety: without it, next on the last match does nothing,
 * and a find bar whose button sometimes does nothing reads as broken rather
 * than as finished.
 */
export function stepMatch(current: number, total: number, direction: 1 | -1): number {
  if (total === 0) return -1;
  if (current < 0) return direction === 1 ? 0 : total - 1;
  return (current + direction + total) % total;
}

/**
 * Split HTML into tags and the text between them.
 *
 * Deliberately naive about HTML in general and exactly right for this input:
 * the bodies here are produced by the app's own editor, so there are no
 * comments, no CDATA and no `<script>`. What it must get right is that
 * everything between `<` and `>` is off limits, which it does.
 */
function splitHtml(html: string): { tag: boolean; value: string }[] {
  const parts: { tag: boolean; value: string }[] = [];
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf('<', i);
    if (open === -1) {
      parts.push({ tag: false, value: html.slice(i) });
      break;
    }
    if (open > i) parts.push({ tag: false, value: html.slice(i, open) });
    const close = html.indexOf('>', open);
    if (close === -1) {
      // Unterminated tag: treat the rest as tag, so it is never rewritten.
      parts.push({ tag: true, value: html.slice(open) });
      break;
    }
    parts.push({ tag: true, value: html.slice(open, close + 1) });
    i = close + 1;
  }
  return parts;
}

export interface ReplaceResult {
  html: string;
  /** How many occurrences were rewritten. Zero means the note is unchanged. */
  count: number;
}

/**
 * Replace occurrences of `query` in an HTML body, TEXT NODES ONLY.
 *
 * `occurrence` selects which one: a zero-based index, or `'all'`. Counting is
 * over text nodes in document order, which is the same order `findMatches`
 * produces — that is what keeps "match 3 of 7" in the find bar pointing at the
 * thing this function will rewrite.
 *
 * Matches that straddle a tag boundary are NOT found, by construction: the text
 * "**bo**ld" contains "bold" on screen but not in any single text node. That is
 * a real limitation and the honest one — the alternative is deciding which of
 * the two runs keeps the formatting, and there is no right answer.
 */
export function replaceInHtml(
  html: string,
  query: string,
  replacement: string,
  occurrence: number | 'all',
  options: FindOptions = {}
): ReplaceResult {
  if (query === '') return { html, count: 0 };

  const parts = splitHtml(html);
  let seen = 0;
  let count = 0;

  const out = parts.map((part) => {
    if (part.tag) return part.value;

    const matches = findMatches(part.value, query, options);
    if (matches.length === 0) return part.value;

    let result = '';
    let cursor = 0;
    for (const match of matches) {
      const index = seen++;
      const wanted = occurrence === 'all' || occurrence === index;
      result += part.value.slice(cursor, match.start);
      result += wanted ? replacement : part.value.slice(match.start, match.end);
      if (wanted) count += 1;
      cursor = match.end;
    }
    result += part.value.slice(cursor);
    return result;
  });

  return { html: out.join(''), count };
}
