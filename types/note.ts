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
  if (paragraphs.length > 1) {
    // If more than one paragraph -> Start from second paragraph
    preview = paragraphs.slice(1).join(' ').trim();
  } else {
    // Only one paragraph
    const dotIndex = firstLine.indexOf('.');
    const commaIndex = firstLine.indexOf(',');

    // 1. Check for full stop and extract second sentence
    if (dotIndex !== -1 && dotIndex < firstLine.length - 1) {
      const secondSentence = firstLine.slice(dotIndex + 1).trim();
      if (secondSentence.length > 0) {
        preview = secondSentence;
      }
    }

    // 2. Else if has comma -> Extract portion after comma
    if (!preview && commaIndex !== -1 && commaIndex < firstLine.length - 1) {
      const secondPortion = firstLine.slice(commaIndex + 1).trim();
      if (secondPortion.length > 0) {
        preview = secondPortion;
      }
    }

    // 3. Else -> Start from title's truncation point
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
