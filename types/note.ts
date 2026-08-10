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
  isLoading: boolean;
}

export type NotesAction =
  | { type: 'SET_NOTES'; payload: { notes: Note[] } }
  | { type: 'SELECT_NOTE'; payload: { id: string | null } }
  | { type: 'SET_SEARCH_QUERY'; payload: { query: string } }
  | { type: 'SET_LOADING'; payload: { isLoading: boolean } };

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
export function parseNoteContent(body: string, titleLimit: number = 120) {
  // 1. Strip HTML tags, decode non-breaking spaces, and convert block tags to newlines
  const plainText = body
    .replace(/&nbsp;/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();

  // Split text into distinct non-empty paragraphs
  const paragraphs = plainText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

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
