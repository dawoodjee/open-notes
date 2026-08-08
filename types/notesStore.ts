import { NotesState, NotesAction } from './note';

export const initialNotesState: NotesState = {
  notes: [],
  selectedNoteId: null,
  searchQuery: '',
  isLoading: true,
};

export function notesReducer(state: NotesState, action: NotesAction): NotesState {
  switch (action.type) {
    case 'SET_NOTES': {
      const newNotes = action.payload.notes;

      // Instant-open logic: auto select first non-trashed note if nothing is
      // selected yet, or the current selection no longer exists among these
      // notes AND there's something to fall back to (e.g. it was just
      // trashed). Deliberately does NOT clear an existing selection to null
      // just because this one batch doesn't contain it yet -- a note
      // optimistically selected right after creation (see handleCreateNote)
      // won't appear in the *very next* watch() tick if that tick was
      // already in flight before the insert committed; clearing on that
      // transient miss would flash the editor open then immediately closed.
      // Genuinely-stale selections (e.g. a leftover ui_state.last_opened_note_id
      // pointing at nothing) are handled once, explicitly, at boot -- not
      // implicitly here on every update.
      let nextSelectedId = state.selectedNoteId;
      const activeNotes = newNotes.filter((n) => !n.isTrashed);

      if (
        (!nextSelectedId || !newNotes.some((n) => n.id === nextSelectedId)) &&
        activeNotes.length > 0
      ) {
        nextSelectedId = activeNotes[0].id;
      }

      return {
        ...state,
        notes: newNotes,
        selectedNoteId: nextSelectedId,
        isLoading: false,
      };
    }

    case 'SELECT_NOTE': {
      return {
        ...state,
        selectedNoteId: action.payload.id,
      };
    }

    case 'SET_SEARCH_QUERY': {
      return {
        ...state,
        searchQuery: action.payload.query,
      };
    }

    case 'SET_LOADING': {
      return {
        ...state,
        isLoading: action.payload.isLoading,
      };
    }

    default:
      return state;
  }
}
