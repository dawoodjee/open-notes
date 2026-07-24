// =============================================================================
// TYPESCRIPT INTERFACES & TYPES
// =============================================================================

export interface Note {
  id: string;
  body: string;
  title: string;          // Derived from 1st line of body
  createdAt: Date;
  updatedAt: Date;

  // Trash / Soft Delete
  isTrashed: boolean;
  trashedAt: Date | null;

  // Local-first Sync Metadata
  isSynced: boolean;
  version: number;
}

export interface NotesState {
  notes: Note[];
  selectedNoteId: string | null;
  searchQuery: string;
}

export type NotesAction =
  | { type: 'CREATE_NOTE' }
  | { type: 'SELECT_NOTE'; payload: { id: string | null } }
  | { type: 'UPDATE_NOTE'; payload: { id: string; body: string } }
  | { type: 'TRASH_NOTE'; payload: { id: string } }
  | { type: 'RESTORE_NOTE'; payload: { id: string } }
  | { type: 'PERMANENT_DELETE_NOTE'; payload: { id: string } }
  | { type: 'EMPTY_TRASH' }
  | { type: 'SET_SEARCH_QUERY'; payload: { query: string } };

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
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
