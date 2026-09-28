import { htmlToMarkdown } from './htmlToMarkdown';

/**
 * What import does when a note with the same title already exists in the
 * destination folder. Decided in the Stage 15 prompt, implemented exactly:
 *
 *   same title, identical content   -> skip
 *   same title, different content   -> duplicate (keep both)
 *   ...unless "overwrite" is on     -> overwrite the existing note
 *
 * ── WHAT "IDENTICAL" MEANS, WHICH IS THE WHOLE DIFFICULTY ─────────────────
 *
 * Get this wrong and "skip" silently becomes "duplicate" on every re-import --
 * import the same zip twice and every note doubles.
 *
 * Comparing stored HTML does exactly that. Measured: `<b><i>x</i></b>` exports
 * as `***x***`, which Markdown parses back as `<i><b>x</b></i>` -- identical on
 * screen, different as strings. Native bodies also carry newlines between
 * blocks that web bodies do not.
 *
 * So bodies are compared as MARKDOWN: both nestings above are the same
 * `***x***`, and block newlines are not content in Markdown at all. On top of
 * that: CRLF -> LF, trailing whitespace dropped per line, runs of blank lines
 * collapsed to one, ends trimmed. Case and interior spacing are NOT normalised
 * -- those are real edits.
 */
export function contentKey(body: string): string {
  return htmlToMarkdown(body)
    .markdown.replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type CollisionAction =
  | { action: 'create' }
  | { action: 'skip'; existingId: string }
  | { action: 'duplicate' }
  | { action: 'overwrite'; existingId: string };

export interface ExistingNote {
  id: string;
  /** contentKey of its body. */
  key: string;
  updatedAt: string;
}

/**
 * @param sameTitle  existing notes in the destination folder with this exact title
 */
export function resolveCollision(
  sameTitle: ExistingNote[],
  incomingKey: string,
  overwrite: boolean
): CollisionAction {
  if (!sameTitle.length) return { action: 'create' };

  // Checked before overwrite on purpose: overwriting a note with its own
  // content is a no-op, and reporting it as "overwritten" would overstate
  // what the import did.
  const identical = sameTitle.find((n) => n.key === incomingKey);
  if (identical) return { action: 'skip', existingId: identical.id };

  if (overwrite) {
    // Several notes can share a title; the most recently edited is the one a
    // user means by "the note called X".
    const newest = [...sameTitle].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return { action: 'overwrite', existingId: newest.id };
  }
  return { action: 'duplicate' };
}
