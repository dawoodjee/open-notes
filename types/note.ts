// =============================================================================
// TYPESCRIPT INTERFACES & TYPES
// =============================================================================

export interface Note {
  id: string;              // UUID — parsed as Postgres uuid on sync
  userId: string | null;   // null = local-only, not yet claimed by an account
  body: string;
  title: string;           // Derived from 1st line of body
  createdAt: string;       // ISO string — matches Postgres timestamptz later
  updatedAt: string;       // ISO string — matches Postgres timestamptz later

  // Trash / Soft Delete.
  // No separate trashedAt: updatedAt already moves on trash and restore, and a
  // second field could contradict this one. One field = no illegal states.
  isTrashed: boolean;

  // Per-note opt-out of the API access gate. This app reads, edits and syncs
  // the note exactly as before either way -- the flag governs only what
  // lib/plaintext/ will hand to an outside caller, content and metadata alike.
  isHiddenFromApi: boolean;

  // True when the stored ciphertext could not be decrypted with the current
  // data key -- a locked vault, or content written under a different key.
  // Distinguishes "this note is empty" from "this note is unreadable right
  // now", which matters because the first is safe to overwrite and the second
  // very much is not.
  decryptFailed?: boolean;
}

export interface NotesState {
  notes: Note[];
  selectedNoteId: string | null;
  searchQuery: string;

  // No loading flag here on purpose. There used to be one, dispatched by
  // nobody and read by nobody. Whether the app is still settling on what to
  // show at launch is NotesLayout's `launchSettled`, because it depends on
  // more than this state -- see the comment there.

  // Whether the "open something on launch" rule has already had its turn.
  // Without this the rule re-fires on every watch tick, so going back to the
  // list instantly re-opens a note and the list is unreachable. See the
  // reducer.
  hasAutoSelected: boolean;
}

export type NotesAction =
  | { type: 'SET_NOTES'; payload: { notes: Note[] } }
  | { type: 'SELECT_NOTE'; payload: { id: string | null } }
  | { type: 'SET_SEARCH_QUERY'; payload: { query: string } };

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
/**
 * Strip a note's HTML down to the non-empty lines a reader would actually see.
 *
 * Shared by parseNoteContent and isBlankNote so the two can never disagree
 * about what "empty" means -- which matters a lot more than it sounds, since
 * one of them is used to decide whether a note may be deleted.
 */
function toVisibleLines(body: string): string[] {
  return body
    .replace(/&nbsp;/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    // List items, so bullets are separate lines rather than one run of text.
    // Today they usually separate anyway -- TenTap emits <li><p>...</p></li>
    // and the inner </p> above does the work -- but that is luck, not design:
    // a list item without an inner paragraph concatenates with the next one
    // and no space at all ("MilkEggsBread"). Harmless where it already works
    // (two newlines collapse and the blank line is filtered below).
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Does this note contain nothing a person would call content?
 *
 * Not `body === ''`. An "empty" note in a rich-text editor is almost never an
 * empty string: TenTap seeds every document with `<h1></h1>` (see
 * formatInitialContent), typing and deleting leaves `<p></p>`, and both look
 * blank on screen. Comparing raw HTML would treat all of those as content.
 *
 * Anything that decides to DELETE a note must ALSO check `decryptFailed`
 * separately -- an unreadable note reads as empty here, and it is not.
 */
export function isBlankNote(body: string): boolean {
  return toVisibleLines(body).length === 0;
}

/**
 * Where the first sentence of a line ends, or -1.
 *
 * Returns the index the NEXT sentence starts at, so callers can slice.
 *
 * This replaces `indexOf('.')`, which is wrong in a way that only shows up on
 * real notes: it splits inside "v1.2", "e.g.", "Dr." and every URL, so the
 * preview would begin mid-abbreviation. It also missed "?" and "!" entirely,
 * so a note that opened with a question never got a preview at all.
 *
 * The rule that does the work is requiring WHITESPACE after the terminator --
 * that alone rules out decimals and domain names, because nobody writes
 * "v1. 2". The abbreviation list handles what survives that: a single capital
 * ("J. Smith") and a short closed set of honorifics and Latin tags. Kept
 * short on purpose. This is a preview line, not a parser; the cost of missing
 * a case is a slightly odd second line, so an exhaustive list would be effort
 * spent where nothing is riding on it.
 */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st',
  'eg', 'ie', 'etc', 'vs', 'approx', 'no', 'fig', 'al',
]);

function findSentenceEnd(line: string): number {
  const terminator = /[.?!]+\s+/g;
  let match: RegExpExecArray | null;

  while ((match = terminator.exec(line)) !== null) {
    const end = match.index + match[0].length;
    // Nothing after it -- not a boundary, just trailing punctuation.
    if (end >= line.length) return -1;

    // The word before the terminator, which does NOT include it -- the slice
    // stops at match.index. So "Email J. Smith" gives "J", and "for Q3." gives
    // "Q3".
    const word = line.slice(0, match.index).split(/[\s(]+/).pop() ?? '';

    // "J. Smith" -- a lone capital is an initial, not the end of a thought.
    // Anchored on the WHOLE word rather than "contains a capital": "Q3" also
    // reduces to one letter once digits are stripped, and treating that as an
    // initial swallowed the boundary in "...for Q3. We discussed...".
    if (/^[A-Z]$/.test(word)) continue;
    if (ABBREVIATIONS.has(word.replace(/[^A-Za-z]/g, '').toLowerCase())) continue;

    return end;
  }

  return -1;
}

export function parseNoteContent(body: string, titleLimit: number = 120) {
  const paragraphs = toVisibleLines(body);

  // --- Rule 1: Body is empty ---
  if (paragraphs.length === 0) {
    return {
      title: 'New Note',
      preview: 'No additional text',
    };
  }

  const firstLine = paragraphs[0];

  // --- Title Logic ---
  // Takes first line until truncation point
  const title =
    firstLine.length > titleLimit
      ? firstLine.substring(0, titleLimit) + '...'
      : firstLine;

  let preview = '';

  // --- Preview Logic ---
  //
  // One unit of text, never a concatenation. The rule is "whatever comes
  // immediately after the title", tried in three widths: the next paragraph,
  // else the next sentence of this one, else the part after the next comma.
  if (paragraphs.length > 1) {
    // The SECOND paragraph alone -- not slice(1).join(' '). Joining every
    // remaining paragraph is what turned a bulleted note into one run-on
    // strip ("Milk Eggs Bread Coffee beans") that kept going until the line
    // ran out of room. The row shows one clamped line either way, so the join
    // never bought more information, only a worse-looking version of it.
    preview = paragraphs[1];
  } else {
    // Only one paragraph, so the preview has to come out of the title's own
    // line -- "the rest of the title", in effect.
    const sentenceEnd = findSentenceEnd(firstLine);
    const commaIndex = firstLine.indexOf(',');

    // 1. After the first sentence.
    if (sentenceEnd !== -1) {
      preview = firstLine.slice(sentenceEnd).trim();
    }

    // 2. Else after the first comma.
    if (!preview && commaIndex !== -1 && commaIndex < firstLine.length - 1) {
      preview = firstLine.slice(commaIndex + 1).trim();
    }

    // 3. Else whatever spilled past the title's truncation point.
    if (!preview && firstLine.length > titleLimit) {
      preview = firstLine.slice(titleLimit).trim();
    }
  }

  return {
    title,
    preview: preview || 'No additional text',
  };
}

export function formatNoteDate(date: Date): string {
  const now = new Date();

  // Normalize both dates to midnight (00:00:00) to accurately compare calendar days
  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffTime = nowDate.getTime() - targetDate.getTime();
  const diffDays = diffTime / (1000 * 60 * 60 * 24);

  // 1. If it's today -> Show just the time (e.g., "4:32 PM")
  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // 2. If it's yesterday -> Show "Yesterday"
  if (diffDays === 1) {
    return 'Yesterday';
  }

  // 3. If it's older -> Show short date format (e.g., "Oct 15" or "15 Oct" depending on locale)
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
